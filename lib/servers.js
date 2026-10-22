/**
 * Standard MCP JSON (Claude Desktop, Cursor, Claude Code `.mcp.json`, VS Code `mcp.json`, Windsurf, Gemini CLI)
 * parsing, validation, secret extraction and placeholder resolution. Pure functions without I/O.
 * Issues are `{ code, server?, field?, value? }` records that the browser localizes.
 */
import { homedir } from 'node:os';
import { sep } from 'node:path';

/** The official bridge's namespace rule, which also keeps public tool names below 64 characters. */
export const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/;
/** DSH credential reference grammar. */
export const REF_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SECRET_ENV = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|PRIVATE/i;
const SECRET_HEADER = /AUTHORIZATION|COOKIE|KEY|TOKEN|SECRET|PASSWORD|SESSION|AUTH/i;
const SECRET_PARAM = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|AUTH|SIGNATURE/i;
const SECRET_FLAG = /^--?[\w.-]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|AUTH)[\w.-]*$/i;
const HEADER_ARG = /^([A-Za-z0-9-]+):\s*(\S(?:.*\S)?)$/;
const AUTH_SCHEME = /^(Bearer|Basic|Token|Bot)\s+(\S(?:.*\S)?)$/i;
const TOKEN_SHAPE = /^(?:sk-|sk_|ghp_|gho_|ghu_|ghs_|github_pat_|glpat-|xox[abprs]-|AKIA|ASIA|AIza|ya29\.|eyJ[A-Za-z0-9_-]{10,}\.)/;
const PLACEHOLDER = /\$\{([^}]*)\}/g;
const VSCODE_VARIABLES = new Set(['workspaceFolder', 'workspaceFolderBasename', 'workspaceRoot', 'file', 'fileBasename',
  'fileBasenameNoExtension', 'fileDirname', 'fileExtname', 'fileWorkspaceFolder', 'relativeFile', 'relativeFileDirname',
  'cwd', 'lineNumber', 'selectedText', 'execPath', 'defaultBuildTask']);
const STDIO_FIELDS = ['type', 'transport', 'transportType', 'command', 'args', 'env', 'cwd', 'disabled', 'enabled', 'toolCallTimeoutMs'];
const HTTP_FIELDS = ['type', 'transport', 'transportType', 'url', 'httpUrl', 'serverUrl', 'headers', 'disabled', 'enabled', 'oauth', 'toolCallTimeoutMs'];
const OAUTH_FIELDS = new Set(['clientId', 'clientSecret', 'scope', 'scopes', 'callbackPort']);

export const isPlainObject = value => typeof value === 'object' && value !== null && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const clone = value => JSON.parse(JSON.stringify(value));

/** Remove `//` and block comments plus trailing commas outside strings (VS Code accepts JSONC). */
export function stripJsonc(text) {
  let stripped = '';
  for (let i = 0, quoted = false; i < text.length; i++) {
    const char = text[i], next = text[i + 1];
    if (quoted) {
      stripped += char;
      if (char === '\\') stripped += text[++i] ?? '';
      else if (char === '"') quoted = false;
    } else if (char === '"') { quoted = true; stripped += char; }
    else if (char === '/' && next === '/') { while (i + 1 < text.length && text[i + 1] !== '\n') i++; }
    else if (char === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 1;
      stripped += ' ';
    } else stripped += char;
  }
  let result = '';
  for (let i = 0, quoted = false; i < stripped.length; i++) {
    const char = stripped[i];
    if (quoted) {
      result += char;
      if (char === '\\') result += stripped[++i] ?? '';
      else if (char === '"') quoted = false;
    } else if (char === '"') { quoted = true; result += char; }
    else if (char === ',') {
      let j = i + 1;
      while (j < stripped.length && /\s/.test(stripped[j])) j++;
      if (stripped[j] !== '}' && stripped[j] !== ']') result += char;
    } else result += char;
  }
  return result;
}

const looksLikeServer = value => isPlainObject(value)
  && ['command', 'url', 'httpUrl', 'serverUrl', 'type', 'transport', 'transportType'].some(key => Object.hasOwn(value, key));

/**
 * Parse a pasted document into named raw server definitions.
 * Accepts `mcpServers`, VS Code `servers`, VS Code settings `mcp.servers`, or a bare name→server map.
 */
export function parseDocument(text) {
  if (typeof text !== 'string' || !text.trim()) return { servers: {}, errors: [{ code: 'empty' }], warnings: [] };
  let value;
  try { value = JSON.parse(stripJsonc(text.replace(/^\uFEFF/, ''))); }
  catch (error) { return { servers: {}, errors: [{ code: 'json', value: error.message }], warnings: [] }; }
  const warnings = [];
  let servers, format;
  if (isPlainObject(value) && isPlainObject(value.mcpServers)) { servers = value.mcpServers; format = 'mcpServers'; }
  else if (isPlainObject(value) && isPlainObject(value.servers)) { servers = value.servers; format = 'servers'; }
  else if (isPlainObject(value) && isPlainObject(value.mcp) && isPlainObject(value.mcp.servers)) { servers = value.mcp.servers; format = 'mcp.servers'; }
  else if (isPlainObject(value) && looksLikeServer(value)) return { servers: {}, errors: [{ code: 'unnamed' }], warnings };
  else if (isPlainObject(value) && Object.keys(value).length && Object.values(value).every(looksLikeServer)) { servers = value; format = 'map'; }
  else return { servers: {}, errors: [{ code: 'root' }], warnings };
  const inputs = format === 'servers' ? value.inputs : format === 'mcp.servers' ? value.mcp.inputs : undefined;
  if (Array.isArray(inputs) && inputs.length) warnings.push({ code: 'inputs' });
  if (!Object.keys(servers).length) return { servers: {}, errors: [{ code: 'noServers' }], warnings, format };
  return { servers, errors: [], warnings, format };
}

/** Classify one `${...}` token. */
export function classifyPlaceholder(body) {
  if (body.startsWith('input:')) return { kind: 'input' };
  if (body === 'userHome' || body === 'pathSeparator' || body === '/') return { kind: 'builtin' };
  const separator = body.indexOf(':-');
  const head = separator < 0 ? body : body.slice(0, separator);
  const fallback = separator < 0 ? undefined : body.slice(separator + 2);
  const ref = head.startsWith('env:') ? head.slice(4) : head;
  if (!head.startsWith('env:') && (VSCODE_VARIABLES.has(head) || /^(config|command):/.test(head))) return { kind: 'vscode' };
  if (!REF_NAME.test(ref)) return { kind: 'invalid' };
  return { kind: 'ref', ref, fallback };
}

/** Every credential reference one stored definition (or map of definitions) uses. */
export function refsOf(value) {
  const refs = new Set();
  for (const [, body] of JSON.stringify(value ?? null).matchAll(PLACEHOLDER)) {
    const placeholder = classifyPlaceholder(body);
    if (placeholder.kind === 'ref') refs.add(placeholder.ref);
  }
  return refs;
}

function scanPlaceholders(value, server, errors, refs) {
  for (const [, body] of String(value).matchAll(PLACEHOLDER)) {
    const placeholder = classifyPlaceholder(body);
    if (placeholder.kind === 'ref') refs.add(placeholder.ref);
    else if (placeholder.kind !== 'builtin') {
      errors.push({ code: placeholder.kind === 'input' ? 'input' : placeholder.kind === 'vscode' ? 'vscodeVariable' : 'variable', server, value: `\${${body}}` });
    }
  }
}

function transportOf(raw) {
  const declared = raw.type ?? raw.transport ?? raw.transportType;
  if (declared === undefined) {
    if (typeof raw.command === 'string') return 'stdio';
    if (raw.httpUrl !== undefined || raw.url !== undefined || raw.serverUrl !== undefined) return 'streamable-http';
    return undefined;
  }
  if (typeof declared !== 'string') return 'unknown';
  const kind = declared.trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (kind === 'stdio') return 'stdio';
  if (['http', 'streamable-http', 'streamablehttp', 'streamable'].includes(kind)) return 'streamable-http';
  if (kind === 'sse') return 'sse';
  return 'unknown';
}

const stringArray = value => Array.isArray(value) && value.every(item => typeof item === 'string');
// Configs written by hand often use numbers or booleans for ports and flags; the bridge needs strings.
const scalar = value => typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
const scalarArray = value => Array.isArray(value) && value.every(scalar);
const scalarMap = value => isPlainObject(value) && Object.values(value).every(scalar);
const textMap = value => Object.fromEntries(Object.entries(value ?? {}).map(([key, item]) => [key, String(item)]));
/** A literal that resembles a credential but was not stored by name. */
export const looksLikeSecret = value => typeof value === 'string' && !value.includes('${')
  && (TOKEN_SHAPE.test(value.trim()) || (/^[A-Za-z0-9_-]{32,}$/.test(value.trim()) && /\d/.test(value) && /[A-Za-z]/.test(value)));

function plaintextWarnings(name, transport, raw) {
  const fields = [];
  if (transport === 'stdio') {
    for (const [key, value] of Object.entries(raw.env ?? {})) if (looksLikeSecret(value)) fields.push(`env.${key}`);
    (raw.args ?? []).forEach((value, index) => { if (looksLikeSecret(value)) fields.push(`args[${index}]`); });
  } else {
    for (const [key, value] of Object.entries(raw.headers ?? {})) {
      const scheme = AUTH_SCHEME.exec(String(value).trim());
      if (looksLikeSecret(scheme ? scheme[2] : value)) fields.push(`headers.${key}`);
    }
  }
  return fields.length ? [{ code: 'plaintext', server: name, fields }] : [];
}

/**
 * Validate one raw definition. `normalized` mirrors the official bridge Config with placeholders still unresolved.
 * @returns {{ name, transport, enabled, errors, warnings, refs: string[], normalized?, oauth? }}
 */
export function normalizeServer(name, raw) {
  const errors = [], warnings = [], refs = new Set();
  const result = { name, transport: undefined, enabled: true, errors, warnings, refs: [] };
  if (!SERVER_NAME.test(name)) errors.push({ code: 'name', server: name });
  if (!isPlainObject(raw)) { errors.push({ code: 'serverObject', server: name }); return result; }
  result.enabled = raw.disabled !== true && raw.enabled !== false;
  for (const key of ['disabled', 'enabled']) if (raw[key] !== undefined && typeof raw[key] !== 'boolean') errors.push({ code: 'boolean', server: name, field: key });
  const transport = transportOf(raw);
  result.transport = transport === 'stdio' || transport === 'streamable-http' ? transport : undefined;
  if (transport === undefined) { errors.push({ code: 'transportMissing', server: name }); return result; }
  if (transport === 'sse') { errors.push({ code: 'sse', server: name }); return result; }
  if (transport === 'unknown') { errors.push({ code: 'type', server: name, value: String(raw.type ?? raw.transport) }); return result; }
  const known = new Set(transport === 'stdio' ? STDIO_FIELDS : HTTP_FIELDS);
  if (transport === 'stdio' && raw.envFile !== undefined) errors.push({ code: 'envFile', server: name });
  const ignored = Object.keys(raw).filter(key => !known.has(key) && !(transport === 'stdio' && key === 'envFile'));
  if (ignored.length) warnings.push({ code: 'ignored', server: name, fields: ignored });
  let toolCallTimeoutMs;
  if (raw.toolCallTimeoutMs !== undefined) {
    if (Number.isInteger(raw.toolCallTimeoutMs) && raw.toolCallTimeoutMs >= 1000 && raw.toolCallTimeoutMs <= 3_600_000) toolCallTimeoutMs = raw.toolCallTimeoutMs;
    else errors.push({ code: 'timeout', server: name });
  }
  if (transport === 'stdio') {
    if (typeof raw.command !== 'string' || !raw.command.trim()) errors.push({ code: 'command', server: name });
    if (raw.args !== undefined && !scalarArray(raw.args)) errors.push({ code: 'stringArray', server: name, field: 'args' });
    if (raw.env !== undefined && !scalarMap(raw.env)) errors.push({ code: 'stringMap', server: name, field: 'env' });
    if (raw.cwd !== undefined && typeof raw.cwd !== 'string') errors.push({ code: 'string', server: name, field: 'cwd' });
    if (errors.length) return result;
    for (const value of [raw.command, ...(raw.args ?? []), ...Object.values(raw.env ?? {}), raw.cwd ?? '']) scanPlaceholders(value, name, errors, refs);
    result.normalized = { serverName: name, transport, command: raw.command.trim(), args: (raw.args ?? []).map(String), env: textMap(raw.env),
      ...(raw.cwd ? { cwd: raw.cwd } : {}), ...(toolCallTimeoutMs ? { toolCallTimeoutMs } : {}) };
  } else {
    const url = raw.httpUrl ?? raw.url ?? raw.serverUrl;
    if (typeof url !== 'string' || !url.trim()) errors.push({ code: 'url', server: name });
    if (raw.headers !== undefined && !scalarMap(raw.headers)) errors.push({ code: 'stringMap', server: name, field: 'headers' });
    let oauth;
    if (raw.oauth !== undefined) {
      if (!isPlainObject(raw.oauth)) errors.push({ code: 'oauth', server: name });
      else {
        for (const key of ['clientId', 'clientSecret', 'scope']) if (raw.oauth[key] !== undefined && typeof raw.oauth[key] !== 'string') errors.push({ code: 'string', server: name, field: `oauth.${key}` });
        if (raw.oauth.scopes !== undefined && !stringArray(raw.oauth.scopes)) errors.push({ code: 'stringArray', server: name, field: 'oauth.scopes' });
        const port = raw.oauth.callbackPort;
        if (port !== undefined && !(Number.isInteger(port) && port >= 1024 && port <= 65535)) errors.push({ code: 'callbackPort', server: name });
        const extra = Object.keys(raw.oauth).filter(key => !OAUTH_FIELDS.has(key));
        if (extra.length) warnings.push({ code: 'ignored', server: name, fields: extra.map(key => `oauth.${key}`) });
        const scope = raw.oauth.scope ?? (stringArray(raw.oauth.scopes) ? raw.oauth.scopes.join(' ') : undefined);
        oauth = { ...(typeof raw.oauth.clientId === 'string' && raw.oauth.clientId ? { clientId: raw.oauth.clientId } : {}),
          ...(typeof raw.oauth.clientSecret === 'string' && raw.oauth.clientSecret ? { clientSecret: raw.oauth.clientSecret } : {}),
          ...(scope ? { scope } : {}), ...(Number.isInteger(port) ? { callbackPort: port } : {}) };
      }
    }
    if (errors.length) return result;
    const trimmed = url.trim();
    if (!trimmed.includes('${')) {
      const issue = checkHttpUrl(trimmed);
      if (issue) errors.push({ code: issue, server: name });
    }
    for (const value of [trimmed, ...Object.values(raw.headers ?? {}), oauth?.clientId ?? '', oauth?.clientSecret ?? '']) scanPlaceholders(value, name, errors, refs);
    result.normalized = { serverName: name, transport, url: trimmed, headers: textMap(raw.headers), ...(toolCallTimeoutMs ? { toolCallTimeoutMs } : {}) };
    if (oauth) result.oauth = oauth;
  }
  warnings.push(...plaintextWarnings(name, transport, raw));
  result.refs = [...refs].sort();
  if (errors.length) delete result.normalized;
  return result;
}

/** Keep only the fields this plugin understands, preserving the user's order and spelling. */
export function cleanDefinition(raw, transport) {
  const known = transport === 'stdio' ? STDIO_FIELDS : transport === 'streamable-http' ? HTTP_FIELDS : [];
  return Object.fromEntries(Object.entries(raw).filter(([key]) => known.includes(key)));
}

/** @returns an issue code, or undefined when the URL is an acceptable HTTP(S) endpoint. */
export function checkHttpUrl(value) {
  let url;
  try { url = new URL(value); } catch { return 'url'; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'url';
  if (url.username || url.password) return 'urlCredentials';
  return undefined;
}

const upper = value => String(value).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
/** Prefix of every credential reference generated for one server. */
export const secretPrefix = server => `MCP_${upper(server) || 'SERVER'}_`;
/** Deterministic credential reference for one extracted secret, e.g. `MCP_GITHUB_GITHUB_TOKEN`. */
export const secretRef = (server, field) => `${secretPrefix(server)}${upper(field) || 'SECRET'}`;

/**
 * Move literal secrets into credential references. Values that already contain `${` are left untouched.
 * @param reserved - references used by other servers, which a generated name must not collide with.
 * @returns {{ definition: object, secrets: { ref: string, value: string, field: string }[] }}
 */
export function extractSecrets(name, raw, reserved = new Set()) {
  if (!isPlainObject(raw)) return { definition: raw, secrets: [] };
  const definition = clone(raw);
  const secrets = [], used = new Map();
  const take = (field, value) => {
    const base = secretRef(name, field);
    let ref = base;
    for (let n = 2; reserved.has(ref) || (used.has(ref) && used.get(ref) !== value); n++) ref = `${base}_${n}`;
    used.set(ref, value);
    if (!secrets.some(secret => secret.ref === ref)) secrets.push({ ref, value, field });
    return `\${${ref}}`;
  };
  const literal = value => typeof value === 'string' && value.trim() !== '' && !value.includes('${');
  const header = (key, value) => {
    const scheme = AUTH_SCHEME.exec(value.trim());
    return scheme ? `${scheme[1]} ${take(key, scheme[2])}` : take(key, value.trim());
  };
  if (isPlainObject(definition.env)) {
    for (const [key, value] of Object.entries(definition.env)) if (SECRET_ENV.test(key) && literal(value)) definition.env[key] = take(key, value);
  }
  if (isPlainObject(definition.headers)) {
    for (const [key, value] of Object.entries(definition.headers)) if (SECRET_HEADER.test(key) && literal(value)) definition.headers[key] = header(key, value);
  }
  if (Array.isArray(definition.args)) {
    for (let i = 0; i < definition.args.length; i++) {
      const arg = definition.args[i];
      if (typeof arg !== 'string' || arg.includes('${')) continue;
      const equals = arg.indexOf('='), headerArg = HEADER_ARG.exec(arg);
      if (equals > 0 && SECRET_FLAG.test(arg.slice(0, equals)) && literal(arg.slice(equals + 1))) {
        definition.args[i] = `${arg.slice(0, equals + 1)}${take(arg.slice(0, equals).replace(/^-+/, ''), arg.slice(equals + 1))}`;
      } else if (equals < 0 && SECRET_FLAG.test(arg) && literal(definition.args[i + 1]) && !definition.args[i + 1].startsWith('-')) {
        definition.args[i + 1] = take(arg.replace(/^-+/, ''), definition.args[i + 1]);
        i++;
      } else if (headerArg && SECRET_HEADER.test(headerArg[1])) {
        // mcp-remote style: `--header "Authorization: Bearer <token>"`.
        definition.args[i] = `${headerArg[1]}: ${header(headerArg[1], headerArg[2])}`;
      }
    }
  }
  for (const key of ['httpUrl', 'url', 'serverUrl']) {
    if (typeof definition[key] === 'string') definition[key] = extractQuerySecrets(definition[key], take);
  }
  if (isPlainObject(definition.oauth) && literal(definition.oauth.clientSecret)) definition.oauth.clientSecret = take('OAUTH_CLIENT_SECRET', definition.oauth.clientSecret);
  return { definition, secrets };
}

function extractQuerySecrets(url, take) {
  const hashAt = url.indexOf('#');
  const head = hashAt < 0 ? url : url.slice(0, hashAt), hash = hashAt < 0 ? '' : url.slice(hashAt);
  const queryAt = head.indexOf('?');
  if (queryAt < 0) return url;
  const pairs = head.slice(queryAt + 1).split('&').map(pair => {
    const equals = pair.indexOf('=');
    if (equals <= 0) return pair;
    const key = pair.slice(0, equals), value = pair.slice(equals + 1);
    let decoded;
    try { decoded = decodeURIComponent(value.replace(/\+/g, ' ')); } catch { decoded = value; }
    return SECRET_PARAM.test(key) && value && !value.includes('${') ? `${key}=${take(key, decoded)}` : pair;
  });
  return `${head.slice(0, queryAt + 1)}${pairs.join('&')}${hash}`;
}

/**
 * Resolve every `${...}` in one string.
 * @param lookup - `(ref) => Promise<string | undefined>`; empty values count as missing.
 */
export async function resolveString(value, lookup, missing, used, encode = text => text) {
  let result = '', last = 0;
  for (const match of value.matchAll(PLACEHOLDER)) {
    result += value.slice(last, match.index);
    last = match.index + match[0].length;
    const body = match[1];
    if (body === 'userHome') { result += homedir(); continue; }
    if (body === 'pathSeparator' || body === '/') { result += sep; continue; }
    const placeholder = classifyPlaceholder(body);
    if (placeholder.kind !== 'ref') { missing.add(match[0]); continue; }
    const resolved = await lookup(placeholder.ref);
    if (typeof resolved === 'string' && resolved !== '') { result += encode(resolved); used.add(resolved); }
    else if (placeholder.fallback !== undefined) result += encode(placeholder.fallback);
    else missing.add(placeholder.ref);
  }
  return result + value.slice(last);
}

/**
 * Resolve a normalized definition into an official bridge Config.
 * @returns {{ config?: object, missing: string[], secrets: string[], issue?: string }}
 */
export async function resolveServer(normalized, lookup) {
  const missing = new Set(), used = new Set();
  const text = (value, encode) => resolveString(value, lookup, missing, used, encode);
  const map = async source => Object.fromEntries(await Promise.all(Object.entries(source).map(async ([key, value]) => [key, await text(value)])));
  let config;
  if (normalized.transport === 'stdio') {
    config = { serverName: normalized.serverName, transport: 'stdio', command: await text(normalized.command),
      args: await Promise.all(normalized.args.map(arg => text(arg))), env: await map(normalized.env) };
    if (normalized.cwd) config.cwd = await text(normalized.cwd);
  } else {
    // Values substituted into a URL query must stay one query component.
    const queryAt = normalized.url.indexOf('?');
    const url = queryAt < 0 ? await text(normalized.url)
      : `${await text(normalized.url.slice(0, queryAt + 1))}${await text(normalized.url.slice(queryAt + 1), encodeURIComponent)}`;
    config = { serverName: normalized.serverName, transport: 'streamable-http', url, headers: await map(normalized.headers) };
  }
  if (normalized.toolCallTimeoutMs) config.toolCallTimeoutMs = normalized.toolCallTimeoutMs;
  const secrets = [...used].filter(value => value.length >= 4);
  if (missing.size) return { missing: [...missing].sort(), secrets };
  if (config.transport === 'streamable-http') {
    const issue = checkHttpUrl(config.url);
    if (issue) return { missing: [], secrets, issue };
  }
  return { config, missing: [], secrets };
}

/** Text shown for one server in lists; never contains resolved secrets. */
export function summarize(normalized) {
  if (!normalized) return '';
  if (normalized.transport === 'streamable-http') return displayUrl(normalized.url);
  return [normalized.command, ...redactArgs(normalized.args ?? [])].join(' ').slice(0, 200);
}

/** Origin and path only: queries may carry keys. */
export function displayUrl(value) {
  if (typeof value !== 'string') return '';
  try { const url = new URL(value); return `${url.origin}${url.pathname === '/' ? '' : url.pathname}`; }
  catch { return value.replace(/[?#].*$/, ''); }
}

export function redactArgs(args) {
  const shown = [];
  for (let i = 0; i < args.length; i++) {
    const arg = String(args[i]), equals = arg.indexOf('='), headerArg = HEADER_ARG.exec(arg);
    if (equals > 0 && SECRET_FLAG.test(arg.slice(0, equals)) && !arg.includes('${')) shown.push(`${arg.slice(0, equals + 1)}***`);
    else if (equals < 0 && SECRET_FLAG.test(arg) && i + 1 < args.length && !String(args[i + 1]).startsWith('-')) { shown.push(arg, String(args[i + 1]).includes('${') ? String(args[i + 1]) : '***'); i++; }
    else if (headerArg && SECRET_HEADER.test(headerArg[1]) && !arg.includes('${')) shown.push(`${headerArg[1]}: ***`);
    else shown.push(looksLikeSecret(arg) ? '***' : arg);
  }
  return shown;
}

/** Remove known secret values and common credential shapes from diagnostic text. */
export function redactText(text, secrets = []) {
  let result = String(text ?? '');
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) if (secret) result = result.split(secret).join('***');
  return result
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{6,}/gi, '$1 ***')
    .replace(/([?&][^=&\s"']*(?:key|token|secret|password|auth|sig)[^=&\s"']*=)[^&\s"']+/gi, '$1***')
    .slice(0, 2000);
}

/** Map a connection failure onto a remedy the page can explain. */
export function classifyFailure(text) {
  const value = String(text ?? '');
  if (/already in use by another mcp-client/i.test(value)) return 'duplicate';
  if (/ENOENT|is not recognized as an internal or external command|command not found|spawn .* EACCES/i.test(value)) return 'command';
  if (/\b401\b|unauthori[sz]ed|invalid_token/i.test(value)) return 'unauthorized';
  if (/\b403\b|forbidden|insufficient_scope/i.test(value)) return 'forbidden';
  if (/certificate|self[- ]signed|UNABLE_TO_VERIFY|ERR_TLS|SSL routines/i.test(value)) return 'tls';
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|EHOSTUNREACH|fetch failed|socket hang up|getaddrinfo/i.test(value)) return 'network';
  if (/timed? ?out|ETIMEDOUT|-32001/i.test(value)) return 'timeout';
  if (/\b404\b|\b405\b/.test(value)) return 'endpoint';
  if (/Connection closed|exited|exit code/i.test(value)) return 'exited';
  return undefined;
}
