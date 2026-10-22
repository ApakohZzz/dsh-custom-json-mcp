/**
 * Minimal MCP authorization client (OAuth 2.1 authorization code + PKCE) for Streamable HTTP servers.
 * Implements RFC 9728 protected resource metadata, RFC 8414 / OIDC discovery, RFC 7591 dynamic client
 * registration, RFC 8707 resource indicators and refresh tokens with the platform `fetch`.
 */
import { createHash, randomBytes } from 'node:crypto';

const REQUEST_TIMEOUT_MS = 15000;
const PROTOCOL_VERSION = '2025-06-18';

export class OAuthFlowError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'OAuthFlowError';
    this.code = code;
  }
}

export const base64url = bytes => Buffer.from(bytes).toString('base64url');
export const randomState = () => base64url(randomBytes(24));

export function createPkce() {
  const verifier = base64url(randomBytes(32));
  return { verifier, challenge: base64url(createHash('sha256').update(verifier).digest()) };
}

export function isLoopbackHost(hostname) {
  const host = String(hostname).replace(/^\[|\]$/g, '').toLowerCase();
  return host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host);
}

/** Authorization endpoints must use HTTPS; plain HTTP is accepted only for loopback development servers. */
export function secureUrl(value, label) {
  let url;
  try { url = new URL(value); } catch { throw new OAuthFlowError('metadata', `${label} is not a valid URL`); }
  if (url.protocol === 'https:' || (url.protocol === 'http:' && isLoopbackHost(url.hostname))) return url;
  throw new OAuthFlowError('insecure', `${label} must use HTTPS`);
}

/** RFC 8707 resource indicator: the MCP endpoint without its fragment. */
export function canonicalResource(serverUrl) {
  const url = new URL(serverUrl);
  url.hash = '';
  return url.href;
}

const signalFor = signal => signal ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS);

async function getJson(fetchImpl, url, signal) {
  let response;
  try {
    response = await fetchImpl(url, { headers: { accept: 'application/json', 'mcp-protocol-version': PROTOCOL_VERSION }, signal: signalFor(signal) });
  } catch (error) {
    if (signal?.aborted) throw error;
    return undefined;
  }
  if (!response.ok) { await response.body?.cancel().catch(() => {}); return undefined; }
  try {
    const value = JSON.parse(await response.text());
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
  } catch { return undefined; }
}

/** Parse `WWW-Authenticate: Bearer resource_metadata="…", scope="…"` parameters. */
export function parseChallenge(header) {
  const params = {};
  if (typeof header !== 'string') return params;
  for (const match of header.matchAll(/([A-Za-z_][\w-]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/g)) {
    params[match[1].toLowerCase()] = match[2] !== undefined ? match[2].replace(/\\(.)/g, '$1') : match[3];
  }
  return params;
}

/** Send one unauthenticated initialize request; a 401/403 answer marks the server as protected and may carry a challenge. */
async function probeChallenge(fetchImpl, serverUrl, signal) {
  try {
    const response = await fetchImpl(serverUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': PROTOCOL_VERSION },
      body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'dsh-custom-json-mcp', version: '0' } } }),
      signal: signalFor(signal),
    });
    const header = response.headers.get('www-authenticate');
    await response.body?.cancel().catch(() => {});
    const challenged = response.status === 401 || response.status === 403;
    return { challenged, params: challenged ? parseChallenge(header) : {} };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { challenged: false, params: {} };
  }
}

function resourceMetadataUrls(serverUrl, hint) {
  const url = new URL(serverUrl), urls = [];
  if (hint) {
    try { urls.push(secureUrl(new URL(hint, url).href, 'resource_metadata').href); } catch { /* ignore an unusable hint */ }
  }
  const path = url.pathname.replace(/\/+$/, '');
  if (path) urls.push(`${url.origin}/.well-known/oauth-protected-resource${path}`);
  urls.push(`${url.origin}/.well-known/oauth-protected-resource`);
  return [...new Set(urls)];
}

function authorizationServerMetadataUrls(issuer) {
  const url = new URL(issuer);
  const path = url.pathname.replace(/\/+$/, '');
  if (!path) return [`${url.origin}/.well-known/oauth-authorization-server`, `${url.origin}/.well-known/openid-configuration`];
  return [`${url.origin}/.well-known/oauth-authorization-server${path}`, `${url.origin}/.well-known/openid-configuration${path}`,
    `${url.origin}${path}/.well-known/openid-configuration`];
}

/**
 * Discover the authorization server for one MCP endpoint.
 * @returns {{ resource, issuer, metadata, scope? }}
 */
export async function discover(serverUrl, { fetch: fetchImpl = fetch, signal } = {}) {
  secureUrl(serverUrl, 'MCP server URL');
  const probe = await probeChallenge(fetchImpl, serverUrl, signal), challenge = probe.params;
  let resourceMetadata;
  for (const candidate of resourceMetadataUrls(serverUrl, challenge.resource_metadata)) {
    const value = await getJson(fetchImpl, candidate, signal);
    if (value && (Array.isArray(value.authorization_servers) || typeof value.resource === 'string')) { resourceMetadata = value; break; }
  }
  const origin = new URL(serverUrl).origin;
  const issuer = typeof resourceMetadata?.authorization_servers?.[0] === 'string' ? resourceMetadata.authorization_servers[0] : origin;
  secureUrl(issuer, 'authorization server');
  let metadata;
  for (const candidate of authorizationServerMetadataUrls(issuer)) {
    const value = await getJson(fetchImpl, candidate, signal);
    if (value && typeof value.authorization_endpoint === 'string' && typeof value.token_endpoint === 'string') { metadata = value; break; }
  }
  if (!metadata) {
    // The 2025-03-26 authorization specification lets a protected server without any metadata use default endpoints.
    if (resourceMetadata || !(probe.challenged || await looksProtected(fetchImpl, serverUrl, signal))) {
      throw new OAuthFlowError('discovery', 'The server does not publish OAuth authorization server metadata');
    }
    metadata = { issuer: origin, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`, registration_endpoint: `${origin}/register` };
  }
  secureUrl(metadata.authorization_endpoint, 'authorization_endpoint');
  secureUrl(metadata.token_endpoint, 'token_endpoint');
  if (metadata.registration_endpoint) secureUrl(metadata.registration_endpoint, 'registration_endpoint');
  if (Array.isArray(metadata.response_types_supported) && !metadata.response_types_supported.includes('code')) {
    throw new OAuthFlowError('metadata', 'The authorization server does not support the authorization code flow');
  }
  if (Array.isArray(metadata.code_challenge_methods_supported) && !metadata.code_challenge_methods_supported.includes('S256')) {
    throw new OAuthFlowError('metadata', 'The authorization server does not support PKCE S256');
  }
  const scope = challenge.scope || (Array.isArray(resourceMetadata?.scopes_supported) ? resourceMetadata.scopes_supported.join(' ') : undefined);
  return { resource: canonicalResource(serverUrl), issuer: metadata.issuer || issuer, metadata, ...(scope ? { scope } : {}) };
}

async function looksProtected(fetchImpl, serverUrl, signal) {
  try {
    const response = await fetchImpl(serverUrl, { method: 'GET', headers: { accept: 'text/event-stream' }, signal: signalFor(signal) });
    await response.body?.cancel().catch(() => {});
    return response.status === 401;
  } catch { return false; }
}

/** RFC 7591 dynamic client registration for a public native client. */
export async function registerClient(info, redirectUri, { fetch: fetchImpl = fetch, signal, clientName = 'DeepSeek Harness' } = {}) {
  const endpoint = info.metadata.registration_endpoint;
  if (!endpoint) throw new OAuthFlowError('no-client', 'The authorization server does not support dynamic client registration; set oauth.clientId');
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ client_name: clientName, redirect_uris: [redirectUri], grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'], token_endpoint_auth_method: 'none', application_type: 'native' }),
      signal: signalFor(signal),
    });
  } catch (error) { throw new OAuthFlowError('registration', `Client registration failed: ${error.message}`); }
  const body = await readJson(response);
  if (!response.ok || typeof body?.client_id !== 'string') {
    throw new OAuthFlowError('registration', `Client registration failed: ${describeOAuthError(body, response.status)}`);
  }
  return { clientId: body.client_id, ...(body.client_secret ? { clientSecret: body.client_secret } : {}),
    method: body.token_endpoint_auth_method || (body.client_secret ? 'client_secret_basic' : 'none'), redirectUri, registered: true };
}

export function authorizationUrl(info, client, { redirectUri, state, challenge, scope }) {
  const url = new URL(info.metadata.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', client.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('resource', info.resource);
  if (scope) url.searchParams.set('scope', scope);
  return url.href;
}

async function readJson(response) {
  try { return JSON.parse(await response.text()); } catch { return undefined; }
}

function describeOAuthError(body, status) {
  if (body && typeof body.error === 'string') return body.error_description ? `${body.error}: ${body.error_description}` : body.error;
  return `HTTP ${status}`;
}

function clientMethod(client, metadata) {
  if (!client.clientSecret) return 'none';
  if (client.method && client.method !== 'none') return client.method;
  const supported = metadata?.token_endpoint_auth_methods_supported;
  return Array.isArray(supported) && !supported.includes('client_secret_basic') && supported.includes('client_secret_post') ? 'client_secret_post' : 'client_secret_basic';
}

async function tokenRequest(tokenEndpoint, params, client, metadata, { fetch: fetchImpl = fetch, signal } = {}) {
  const headers = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' };
  const body = new URLSearchParams(params);
  const method = clientMethod(client, metadata);
  if (method === 'client_secret_basic') {
    headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(client.clientId)}:${encodeURIComponent(client.clientSecret)}`).toString('base64')}`;
  } else {
    body.set('client_id', client.clientId);
    if (method === 'client_secret_post') body.set('client_secret', client.clientSecret);
  }
  let response;
  try { response = await fetchImpl(tokenEndpoint, { method: 'POST', headers, body, signal: signalFor(signal) }); }
  catch (error) { throw new OAuthFlowError('token', `Token request failed: ${error.message}`); }
  const json = await readJson(response);
  if (!response.ok || !json || typeof json.access_token !== 'string' || json.error) {
    throw new OAuthFlowError(json?.error === 'invalid_grant' ? 'invalid_grant' : 'token', `Token request failed: ${describeOAuthError(json, response.status)}`);
  }
  if (json.token_type && String(json.token_type).toLowerCase() !== 'bearer') throw new OAuthFlowError('token', `Unsupported token type ${json.token_type}`);
  const expiresIn = Number(json.expires_in);
  return {
    accessToken: json.access_token,
    ...(typeof json.refresh_token === 'string' ? { refreshToken: json.refresh_token } : {}),
    ...(Number.isFinite(expiresIn) && expiresIn > 0 ? { expiresAt: Date.now() + expiresIn * 1000 } : {}),
    ...(typeof json.scope === 'string' ? { scope: json.scope } : {}),
  };
}

export function exchangeCode(info, client, { code, verifier, redirectUri }, options) {
  return tokenRequest(info.metadata.token_endpoint, { grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier, resource: info.resource },
    client, info.metadata, options);
}

export async function refreshTokens(grant, options) {
  if (!grant.refreshToken) throw new OAuthFlowError('invalid_grant', 'No refresh token');
  const next = await tokenRequest(grant.tokenEndpoint, { grant_type: 'refresh_token', refresh_token: grant.refreshToken, resource: grant.resource },
    grant.client, grant.metadata, options);
  return { ...next, refreshToken: next.refreshToken ?? grant.refreshToken };
}
