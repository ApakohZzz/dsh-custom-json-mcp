/**
 * Host half of the MCP Connectors plugin.
 *
 * Custom servers are stored as standard MCP JSON definitions in this entry's volatile Config, written through
 * DSH Settings, with literal secrets moved into DSH credentials. Each enabled server mounts one instance of the
 * official `@deepseek-ai/dsh-mcp-client` bridge as a child plugin, so protocol, tool registration and process
 * cleanup stay with DSH. The page talks to two owner-only exact Fetch routes on the DSH `/api` transport.
 */
import Schema from '@deepseek-ai/schemastery';
import { createHash } from 'node:crypto';
import { lstatSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { delimiter, extname, isAbsolute, join, resolve } from 'node:path';
import {
  REF_NAME, classifyFailure, cleanDefinition, displayUrl, extractSecrets, isPlainObject, normalizeServer,
  parseDocument, redactText, refsOf, resolveServer, resolveString, summarize,
} from './servers.js';
import * as OAuth from './oauth.js';

export const name = 'dsh-custom-json-mcp';
export const inject = ['credentials', 'tools'];
export const STATE_PATH = '/api/dsh-custom-json-mcp.state';
export const ACTION_PATH = '/api/dsh-custom-json-mcp.action';
export const BRIDGE = '@deepseek-ai/dsh-mcp-client';
const RECORD_SCOPE = 'dsh-custom-json-mcp';
const MAX_BODY_BYTES = 512 * 1024;
const RETRY_DELAYS_MS = [5e3, 15e3, 30e3, 60e3, 120e3, 300e3];
const NO_RETRY = new Set(['missing', 'config', 'command', 'unauthorized', 'forbidden', 'duplicate', 'tls', 'endpoint', 'bridge']);
const STARTUP_WAIT_MS = 10e3;
const FLOW_TIMEOUT_MS = 10 * 60e3;
const REFRESH_LEAD_MS = 120e3;
const MAX_TIMER_MS = 2 ** 31 - 1;
const LOADING = 1, ACTIVE = 2, FAILED = 3;
const ENVIRONMENT_SOURCES = new Set(['env', 'project-env', 'user-env']);

export const Config = Schema.object({
  // Only volatile fields are exposed and written by DSH Settings, so edits apply without remounting this plugin.
  servers: Schema.dict(Schema.any()).default({}).volatile(),
  managedRefs: Schema.array(String).default([]).volatile(),
});

const read = value => typeof value?.get === 'function' ? value.get() : value;
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const digest = text => createHash('sha256').update(text).digest('hex').slice(0, 24);
const authorizationOf = headers => isPlainObject(headers) ? Object.keys(headers).find(key => key.toLowerCase() === 'authorization') : undefined;
const hasAuthorization = headers => authorizationOf(headers) !== undefined;
const isExpression = value => value instanceof Object && '__jsExpr' in value;
const delay = (ms, signal) => new Promise(done => {
  const timer = setTimeout(done, ms);
  timer.unref?.();
  signal?.addEventListener('abort', () => { clearTimeout(timer); done(); }, { once: true });
});
const canonical = url => { try { return OAuth.canonicalResource(url); } catch { return String(url); } };

export class ActionError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.code = code;
    this.details = details;
  }
}

/** Plain text for one thrown value and its causes, without the bridge's generic wrapper. */
export function errorText(error) {
  const parts = [], seen = new Set();
  for (let current = error; current !== undefined && current !== null && !seen.has(current) && parts.length < 4; current = current?.cause) {
    seen.add(current);
    const message = String(current instanceof Error ? current.message : current).replace(/^mcp-client\([^)]*\):\s*/, '');
    if (message && !/initial connection or tool synchronization failed/.test(message)) parts.push(message);
  }
  return parts.join(' — ') || String(error?.message ?? error ?? 'Unknown error');
}

function formatArgs(args) {
  return (args ?? []).map(arg => arg instanceof Error ? errorText(arg)
    : typeof arg === 'string' ? arg : (() => { try { return JSON.stringify(arg); } catch { return String(arg); } })()).join(' ');
}

function envValue(env, key) {
  if (process.platform !== 'win32') return env?.[key];
  const found = Object.keys(env ?? {}).find(name => name.toUpperCase() === key);
  return found === undefined ? undefined : env[found];
}

/**
 * Whether a stdio command can be found the way the child process will look for it. Used only to explain a failed
 * start, because on Windows a missing command surfaces as a closed connection from `cmd.exe`.
 */
export function commandExists(command, env = {}, cwd = process.cwd()) {
  if (typeof command !== 'string' || !command) return false;
  const windows = process.platform === 'win32';
  const extensions = windows ? String(envValue(env, 'PATHEXT') ?? process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [];
  const candidates = path => !windows ? [path] : extname(path) ? [path, ...extensions.map(ext => path + ext)] : extensions.map(ext => path + ext);
  const present = path => {
    try { return statSync(path).isFile(); } catch { try { lstatSync(path); return true; } catch { return false; } }
  };
  if (isAbsolute(command) || /[\\/]/.test(command)) return candidates(resolve(cwd, command)).some(present);
  const path = String(envValue(env, 'PATH') ?? process.env.PATH ?? process.env.Path ?? '');
  return path.split(delimiter).filter(Boolean).some(dir => candidates(join(dir.replace(/^"|"$/g, ''), command)).some(present));
}

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

const escapeHtml = text => String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
function resultPage(success, detail = '') {
  const title = success ? '授权完成 · Authorization complete' : '授权未完成 · Authorization failed';
  const body = success ? '可以关闭此页面，返回 DeepSeek Harness。<br>You can close this page and return to DeepSeek Harness.'
    : `请返回 DeepSeek Harness 重试。<br>Return to DeepSeek Harness and try again.${detail ? `<pre>${escapeHtml(detail)}</pre>` : ''}`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title>`
    + '<style>body{font:15px/1.6 system-ui,sans-serif;margin:15vh auto;max-width:560px;padding:0 24px;color:#1f2937}'
    + 'pre{white-space:pre-wrap;background:#f3f4f6;padding:8px 12px;border-radius:6px;font-size:13px}'
    + '@media(prefers-color-scheme:dark){body{background:#111827;color:#e5e7eb}pre{background:#1f2937}}</style>'
    + `</head><body><h1>${title}</h1><p>${body}</p></body></html>`;
}

export class Manager {
  constructor(ctx, config) {
    this.ctx = ctx;
    this.config = config;
    this.ns = ctx.fiber?.entry?.options?.id ?? name;
    this.servers = new Map();
    this.observed = new WeakMap();
    this.injected = new WeakMap();
    this.grants = new Map();
    this.flows = new Map();
    this.refreshTimers = new Map();
    this.refreshing = new Map();
    this.writes = Promise.resolve();
    this.saving = 0;
    this.starts = 0;
    this.stopped = false;
    this.settings = undefined;
    this.bridge = undefined;
    this.lifetime = new AbortController();
  }

  get credentials() { return this.ctx.credentials; }
  storedServers() { const servers = read(this.config.servers); return isPlainObject(servers) ? servers : {}; }
  managedRefs() { const refs = read(this.config.managedRefs); return Array.isArray(refs) ? refs.filter(ref => typeof ref === 'string') : []; }

  async lookup(ref) {
    try {
      const resolved = await this.credentials.resolve(ref);
      return typeof resolved?.value === 'string' ? resolved.value : undefined;
    } catch { return undefined; }
  }

  async describeRef(ref) {
    try { return await this.credentials.describe(ref); } catch { return undefined; }
  }

  async start() {
    await this.loadGrants();
    this.seedLogs();
    const initial = this.reconcile();
    for (const { fiber } of this.foreign()) void this.syncForeign(fiber);
    await Promise.race([initial, delay(STARTUP_WAIT_MS, this.lifetime.signal)]);
  }

  async dispose() {
    this.stopped = true;
    this.lifetime.abort();
    for (const timer of this.refreshTimers.values()) clearTimeout(timer);
    this.refreshTimers.clear();
    for (const flow of [...this.flows.values()]) this.closeFlow(flow, 'cancelled');
    await Promise.all([...this.servers.values()].map(entry => {
      clearTimeout(entry.retryTimer);
      entry.generation++;
      const fiber = entry.fiber;
      entry.fiber = undefined;
      return fiber?.dispose().catch(() => {});
    }));
  }

  // ---- custom server lifecycle -------------------------------------------------------------------------------

  /** Converge running connections on the stored definitions; `force` restarts the named servers even if unchanged. */
  reconcile(force = []) {
    if (this.stopped) return Promise.resolve();
    const stored = this.storedServers(), seen = new Set(), tasks = [];
    for (const [server, definition] of Object.entries(stored)) {
      seen.add(server);
      const key = JSON.stringify(definition ?? null);
      let entry = this.servers.get(server);
      if (entry?.key === key && !force.includes(server)) continue;
      if (!entry) {
        entry = { name: server, generation: 0, attempts: 0, state: 'connecting', chain: Promise.resolve(), secrets: [] };
        this.servers.set(server, entry);
      }
      entry.key = key;
      entry.definition = clone(definition);
      entry.spec = normalizeServer(server, definition);
      entry.enabled = entry.spec.enabled;
      entry.attempts = 0;
      entry.refreshedAfterFailure = false;
      tasks.push(this.restart(entry));
    }
    for (const [server, entry] of this.servers) {
      if (seen.has(server)) continue;
      this.servers.delete(server);
      tasks.push(this.stop(entry));
    }
    return Promise.all(tasks);
  }

  /** Abort any pending handshake now, then connect again once the previous instance has been released. */
  restart(entry) {
    const generation = ++entry.generation;
    entry.startedAt = ++this.starts;
    clearTimeout(entry.retryTimer);
    entry.retryTimer = undefined;
    const fiber = entry.fiber;
    entry.fiber = undefined;
    const closing = fiber?.dispose().catch(() => {});
    entry.state = entry.enabled === false ? 'disabled' : 'connecting';
    entry.chain = entry.chain.then(() => closing).then(() => this.connect(entry, generation)).catch(error => {
      this.ctx.logger.warn('MCP connector %s: %s', entry.name, redactText(errorText(error), entry.secrets));
    });
    return entry.chain;
  }

  stop(entry) {
    entry.generation++;
    clearTimeout(entry.retryTimer);
    const fiber = entry.fiber;
    entry.fiber = undefined;
    entry.state = 'removed';
    entry.chain = entry.chain.then(() => fiber?.dispose()).catch(() => {});
    return entry.chain;
  }

  async connect(entry, generation) {
    const stale = () => this.stopped || generation !== entry.generation;
    if (stale()) return;
    Object.assign(entry, { error: undefined, reason: undefined, missing: undefined, issues: undefined, connectedAt: undefined, realFiber: undefined, retryAt: undefined });
    const spec = entry.spec;
    if (spec.errors.length) { Object.assign(entry, { state: 'failed', reason: 'config', issues: spec.errors, resolvedKey: undefined }); return; }
    if (!entry.enabled) { Object.assign(entry, { state: 'disabled', resolvedKey: undefined }); return; }
    entry.state = 'connecting';
    const resolved = await resolveServer(spec.normalized, ref => this.lookup(ref));
    if (stale()) return;
    // Credential events reconnect only when the values this connection uses actually changed.
    entry.resolvedKey = digest(JSON.stringify([resolved.config ?? null, resolved.missing, resolved.issue ?? null]));
    entry.secrets = resolved.secrets;
    if (resolved.missing.length) { Object.assign(entry, { state: 'failed', reason: 'missing', missing: resolved.missing }); return; }
    if (resolved.issue) { Object.assign(entry, { state: 'failed', reason: 'config', issues: [{ code: resolved.issue, server: entry.name }] }); return; }
    const config = resolved.config;
    let grant, grantKey;
    if (config.transport === 'streamable-http') {
      entry.url = config.url;
      if (!hasAuthorization(config.headers)) {
        grantKey = this.grantKey('custom', entry.name, config.url);
        grant = await this.usableGrant(grantKey);
        if (stale()) return;
        if (grant) {
          config.headers = { ...config.headers, Authorization: `Bearer ${grant.accessToken}` };
          entry.secrets = [...entry.secrets, grant.accessToken];
        }
      }
    }
    let bridge;
    try { bridge = await this.loadBridge(); }
    catch (error) { Object.assign(entry, { state: 'failed', reason: 'bridge', error: redactText(errorText(error)) }); return; }
    if (stale()) return;
    // Strict startup reports the exact first failure; the bridge's own supervisor handles later outages.
    const fiber = this.ctx.plugin(bridge, { ...config, failOnStartupError: true });
    entry.fiber = fiber;
    entry.realFiber = fiber.ctx?.fiber ?? fiber;
    try {
      await fiber.await();
      if (stale()) return;
      Object.assign(entry, { state: 'connected', connectedAt: Date.now(), attempts: 0, refreshedAfterFailure: false });
    } catch (error) {
      if (stale()) return;
      entry.fiber = undefined;
      await fiber.dispose().catch(() => {});
      if (stale()) return;
      const text = errorText(error);
      let reason = classifyFailure(text) ?? 'unknown';
      if (config.transport === 'stdio' && ['exited', 'unknown', 'timeout'].includes(reason) && !commandExists(config.command, config.env, config.cwd)) reason = 'command';
      Object.assign(entry, { state: 'failed', error: redactText(text, entry.secrets), reason });
      if (reason === 'unauthorized' && grant?.refreshToken && !entry.refreshedAfterFailure) {
        entry.refreshedAfterFailure = true;
        if (await this.refreshGrant(grantKey, true)) { if (!stale()) this.restart(entry); return; }
      }
      this.scheduleRetry(entry);
    }
  }

  scheduleRetry(entry) {
    if (this.stopped || NO_RETRY.has(entry.reason) || entry.attempts >= RETRY_DELAYS_MS.length) return;
    const wait = RETRY_DELAYS_MS[entry.attempts++];
    entry.retryAt = Date.now() + wait;
    const generation = entry.generation;
    entry.retryTimer = setTimeout(() => {
      entry.retryTimer = undefined;
      if (!this.stopped && entry.generation === generation && this.servers.get(entry.name) === entry) this.restart(entry);
    }, wait);
    entry.retryTimer.unref?.();
  }

  async loadBridge() {
    this.bridge ??= await this.ctx.loader.import(BRIDGE);
    return this.bridge;
  }

  // ---- status ------------------------------------------------------------------------------------------------

  /** Record bridge log lines by fiber: the official bridge reports outages only through its logger. */
  observe(message) {
    const fiber = message?.fiber?.deref?.();
    if (!fiber || fiber.runtime?.name !== 'mcp-client') return;
    const text = formatArgs(message.args);
    const info = this.observed.get(fiber) ?? {};
    const at = message.ts ?? Date.now();
    let match;
    if ((match = /connection attempt failed: ([\s\S]*)$/.exec(text))) Object.assign(info, { error: match[1], errorAt: at });
    else if (/connection lost; reconnecting in/.test(text)) Object.assign(info, { phase: 'reconnecting', phaseAt: at, lost: true });
    else if (/connection failed; retrying in/.test(text)) Object.assign(info, { phase: 'retrying', phaseAt: at });
    else if (/giving up after|reconnect is disabled|reconnect stopped/.test(text)) {
      Object.assign(info, { phase: 'stopped', phaseAt: at });
      const entry = [...this.servers.values()].find(item => item.realFiber === fiber);
      if (entry && entry.state === 'connected') {
        Object.assign(entry, { state: 'failed', error: redactText(info.error ?? text, entry.secrets), reason: classifyFailure(info.error ?? text) ?? 'unknown' });
        this.scheduleRetry(entry);
      }
    } else if (/reconnected and re-synced tools/.test(text)) Object.assign(info, { phase: 'ok', phaseAt: at, error: undefined, lost: false });
    else if (/tool registration failed/.test(text)) Object.assign(info, { error: text.replace(/^mcp-client\([^)]*\):\s*/, ''), errorAt: at });
    else if (message.type === 'error' && fiber.state !== ACTIVE) Object.assign(info, { error: info.error ?? text.replace(/^mcp-client\([^)]*\):\s*/, ''), errorAt: at });
    else return;
    this.observed.set(fiber, info);
  }

  /** A bridge instance that starts loading again begins a fresh status record. */
  onStatus(fiber) {
    if (fiber?.runtime?.name === 'mcp-client' && fiber.state === LOADING) this.observed.delete(fiber);
  }

  seedLogs() {
    try { for (const message of this.ctx.logger.buffer ?? []) this.observe(message); } catch { /* the buffer is diagnostic only */ }
  }

  toolNames() {
    try { return this.ctx.tools.schemas().map(schema => schema.name); } catch { return []; }
  }

  isOwn(fiber) { return fiber?.parent?.fiber === this.ctx.fiber; }

  /** Live official bridge instances that other plugins mounted. */
  foreign() {
    const found = [];
    let runtimes;
    try { runtimes = [...this.ctx.registry.values()]; } catch { return found; }
    for (const runtime of runtimes) {
      if (runtime?.name !== 'mcp-client') continue;
      for (const fiber of runtime.fibers ?? []) {
        if (!fiber?.uid || this.isOwn(fiber)) continue;
        const config = fiber.config ?? fiber._config;
        if (!isPlainObject(config) || typeof config.serverName !== 'string') continue;
        found.push({ fiber, config });
      }
    }
    return found;
  }

  customStatus(entry, tools) {
    const prefix = `mcp__${entry.name}__`;
    const count = tools.filter(tool => tool.startsWith(prefix)).length;
    let state = entry.state, error = entry.error, reason = entry.reason;
    if (state === 'connected') {
      const fiber = entry.realFiber;
      const info = fiber && this.observed.get(fiber);
      if (fiber && fiber.state !== ACTIVE) state = 'connecting';
      else if ((info?.phase === 'retrying' || info?.phase === 'reconnecting') && info.phaseAt >= (entry.connectedAt ?? 0)) {
        state = 'reconnecting';
        error = info.error && redactText(info.error, entry.secrets);
        reason = info.error ? classifyFailure(info.error) ?? 'unknown' : undefined;
      }
    }
    return { state, tools: count, ...(error ? { error } : {}), ...(reason ? { reason } : {}) };
  }

  foreignStatus(fiber, serverName, tools) {
    const prefix = `mcp__${serverName}__`;
    const count = tools.filter(tool => tool.startsWith(prefix)).length;
    const info = this.observed.get(fiber) ?? {};
    const error = info.error ? redactText(info.error) : undefined;
    const reason = error ? classifyFailure(info.error) ?? 'unknown' : undefined;
    const failure = { ...(error ? { error } : {}), ...(reason ? { reason } : {}) };
    if (fiber.state === FAILED) return { state: 'failed', tools: 0, ...failure };
    if (fiber.state !== ACTIVE) return { state: 'connecting', tools: count };
    if (info.phase === 'reconnecting' || (info.phase === 'retrying' && info.lost)) return { state: 'reconnecting', tools: count, ...failure };
    // A first connection that keeps failing is a failure, even while the bridge retries in the background.
    if (info.phase === 'retrying' || info.phase === 'stopped') return { state: 'failed', tools: count, ...failure };
    if (count === 0 && info.error && !(info.phase === 'ok' && info.phaseAt >= info.errorAt)) return { state: 'failed', tools: 0, ...failure };
    return { state: 'connected', tools: count };
  }

  oauthState(key, eligible) {
    const flow = key ? this.flows.get(key) : undefined, grant = key ? this.grants.get(key) : undefined;
    return {
      eligible,
      authorized: Boolean(grant?.accessToken),
      ...(grant?.expiresAt ? { expiresAt: grant.expiresAt, refreshable: Boolean(grant.refreshToken) } : {}),
      pending: flow?.status === 'pending',
      ...(flow?.status === 'pending' ? { url: flow.url } : {}),
      ...(flow?.status === 'failed' ? { error: flow.error, code: flow.code } : {}),
    };
  }

  revision() {
    try { return this.settings?.describe().find(row => row.ns === this.ns)?.revision; } catch { return undefined; }
  }

  async describe() {
    const tools = this.toolNames();
    const custom = [...this.servers.values()].sort((a, b) => a.name.localeCompare(b.name)).map(entry => {
      const spec = entry.spec, normalized = spec.normalized;
      const eligible = normalized?.transport === 'streamable-http' && !hasAuthorization(normalized.headers);
      return {
        name: entry.name, transport: spec.transport ?? null, enabled: entry.enabled, summary: summarize(normalized),
        definition: entry.definition, refs: spec.refs, oauthConfigured: isPlainObject(entry.definition?.oauth), ...this.customStatus(entry, tools),
        ...(entry.missing ? { missing: entry.missing } : {}), ...(entry.issues ? { issues: entry.issues } : {}),
        ...(entry.retryTimer ? { retryAt: entry.retryAt } : {}),
        oauth: this.oauthState(eligible ? this.grantKey('custom', entry.name, entry.url ?? normalized.url) : '', eligible),
      };
    });
    const seen = new Set();
    const plugins = [];
    for (const { fiber, config } of this.foreign()) {
      const entryId = fiber.entry?.options?.id ?? null, module = fiber.entry?.options?.name ?? null;
      const id = `${config.serverName}\n${entryId ?? ''}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const http = config.transport === 'streamable-http' && typeof config.url === 'string';
      const eligible = http && (!hasAuthorization(config.headers) || this.injected.has(fiber));
      plugins.push({
        name: config.serverName, transport: config.transport ?? null, entry: entryId, module,
        summary: http ? displayUrl(config.url) : typeof config.command === 'string' ? config.command : '',
        ...this.foreignStatus(fiber, config.serverName, tools),
        oauth: this.oauthState(eligible ? this.grantKey('plugin', config.serverName, config.url) : '', eligible),
      });
    }
    plugins.sort((a, b) => a.name.localeCompare(b.name) || String(a.entry).localeCompare(String(b.entry)));
    return { version: 1, writable: Boolean(this.settings) && this.revision() !== undefined, custom, plugins };
  }

  // ---- configuration writes ------------------------------------------------------------------------------------

  serialize(task) {
    const run = this.writes.then(task, task);
    this.writes = run.catch(() => {});
    return run;
  }

  async writeConfig(servers, managedRefs) {
    const settings = this.settings;
    const revision = this.revision();
    if (!settings || revision === undefined) throw new ActionError('settings');
    try {
      await settings.mutate(this.ns, [{ op: 'set', path: ['servers'], value: servers }, { op: 'set', path: ['managedRefs'], value: managedRefs }], revision);
    } catch (error) {
      if (error?.name === 'SettingsConflictError' || error?.constructor?.name === 'SettingsConflictError') throw new ActionError('conflict');
      throw new ActionError('write', { message: redactText(errorText(error)) });
    }
  }

  nextManaged(servers, added = []) {
    const referenced = refsOf(servers);
    const managed = new Set([...this.managedRefs(), ...added]);
    return { keep: [...managed].filter(ref => referenced.has(ref)).sort(), drop: [...managed].filter(ref => !referenced.has(ref)) };
  }

  async unsetRefs(refs) {
    for (const ref of refs) await this.credentials.unset(ref).catch(() => {});
  }

  /** Parse and validate pasted JSON without side effects; secret values stay in the returned private map. */
  async analyze(text, mode = 'add', target, values = {}) {
    const parsed = parseDocument(text);
    const analysis = { errors: [...parsed.errors], warnings: [...parsed.warnings], servers: [] };
    const secrets = new Map();
    if (parsed.errors.length) return { analysis, secrets };
    const stored = this.storedServers(), names = Object.keys(parsed.servers);
    if (mode === 'edit') {
      if (!Object.hasOwn(stored, target)) analysis.errors.push({ code: 'notFound', server: String(target) });
      if (names.length !== 1) analysis.errors.push({ code: 'editSingle' });
    }
    const reserved = refsOf(Object.fromEntries(Object.entries(stored).filter(([server]) => !(mode === 'edit' && server === target))));
    const foreign = new Map(this.foreign().map(({ fiber, config }) => [config.serverName, fiber.entry?.options?.id ?? config.serverName]));
    for (const server of names) {
      const { definition, secrets: found } = extractSecrets(server, parsed.servers[server], reserved);
      for (const secret of found) reserved.add(secret.ref);
      secrets.set(server, found);
      const spec = normalizeServer(server, definition);
      const replacing = mode === 'edit' && server === target;
      if (Object.hasOwn(stored, server) && !replacing) spec.errors.push({ code: 'exists', server });
      if (foreign.has(server)) spec.errors.push({ code: 'conflict', server, value: foreign.get(server) });
      const extracted = new Set(found.map(secret => secret.ref));
      const refs = [];
      for (const ref of spec.refs) {
        if (extracted.has(ref)) { refs.push({ ref, state: 'extracted' }); continue; }
        const info = await this.describeRef(ref);
        const fixed = info?.writable === false || ENVIRONMENT_SOURCES.has(info?.source);
        const state = typeof values[ref] === 'string' && values[ref].trim() && !fixed ? 'provided' : info?.configured ? 'configured' : 'missing';
        refs.push({ ref, state, ...(info?.source ? { source: info.source } : {}), writable: !fixed });
      }
      analysis.servers.push({
        name: server, transport: spec.transport ?? null, enabled: spec.enabled, summary: summarize(spec.normalized),
        errors: spec.errors, warnings: spec.warnings, refs, secrets: found.map(({ ref, field }) => ({ ref, field })),
        definition: spec.transport ? cleanDefinition(definition, spec.transport) : definition,
      });
    }
    return { analysis, secrets };
  }

  async save({ text, mode = 'add', target, values = {} }) {
    if (mode !== 'add' && mode !== 'edit') throw new ActionError('mode');
    if (!isPlainObject(values)) throw new ActionError('values');
    return this.serialize(async () => {
      const { analysis, secrets } = await this.analyze(text, mode, target, values);
      if (analysis.errors.length || analysis.servers.some(server => server.errors.length)) throw new ActionError('invalid', { analysis });
      const referenced = new Set(analysis.servers.flatMap(server => server.refs.map(ref => ref.ref)));
      const writes = [];
      for (const found of secrets.values()) for (const secret of found) writes.push([secret.ref, secret.value, true]);
      for (const [ref, value] of Object.entries(values)) {
        if (REF_NAME.test(ref) && referenced.has(ref) && typeof value === 'string' && value.trim() && !writes.some(([written]) => written === ref)) writes.push([ref, value.trim(), false]);
      }
      for (const [ref] of writes) {
        const info = await this.describeRef(ref);
        if (info && (info.writable === false || ENVIRONMENT_SOURCES.has(info.source))) throw new ActionError('unwritable', { ref });
      }
      this.saving++;
      const mark = this.starts;
      const saved = analysis.servers.map(server => server.name);
      try {
        for (const [ref, value] of writes) await this.credentials.set(ref, value);
        const current = clone(this.storedServers());
        if (mode === 'edit') delete current[target];
        for (const server of analysis.servers) current[server.name] = server.definition;
        const extracted = writes.filter(([, , managed]) => managed).map(([ref]) => ref);
        const { keep, drop } = this.nextManaged(current, extracted);
        try { await this.writeConfig(current, keep); }
        catch (error) {
          const stillUsed = refsOf(this.storedServers());
          await this.unsetRefs(extracted.filter(ref => !stillUsed.has(ref)));
          throw error;
        }
        await this.unsetRefs(drop);
        if (mode === 'edit' && !saved.includes(target)) await this.dropGrants('custom', target);
        // The settings write already reconnected servers whose definitions changed (`loader/volatile-update`); reconnect
        // the rest so new credential values under an unchanged definition apply too. Connections finish in the background.
        void this.reconcile(saved.filter(server => !(this.servers.get(server)?.startedAt > mark)));
      } finally { this.saving--; }
      // Other servers sharing a credential written here pick up its new value.
      for (const [ref] of writes) void this.onCredential(ref, new Set(saved));
      return { saved };
    });
  }

  async toggle({ name: server, enabled }) {
    if (typeof enabled !== 'boolean') throw new ActionError('enabled');
    return this.serialize(async () => {
      const current = clone(this.storedServers());
      if (!isPlainObject(current[server])) throw new ActionError('notFound', { server });
      const definition = { ...current[server] };
      delete definition.enabled;
      if (enabled) delete definition.disabled;
      else definition.disabled = true;
      current[server] = definition;
      await this.writeConfig(current, this.nextManaged(current).keep);
      void this.reconcile();
      return {};
    });
  }

  async remove({ name: server }) {
    return this.serialize(async () => {
      const current = clone(this.storedServers());
      if (!Object.hasOwn(current, server)) throw new ActionError('notFound', { server });
      delete current[server];
      const { keep, drop } = this.nextManaged(current);
      this.saving++;
      try {
        await this.writeConfig(current, keep);
        await this.unsetRefs(drop);
        await this.dropGrants('custom', server);
        void this.reconcile();
      } finally { this.saving--; }
      return {};
    });
  }

  reconnect({ name: server }) {
    const entry = this.servers.get(server);
    if (!entry) throw new ActionError('notFound', { server });
    entry.attempts = 0;
    entry.refreshedAfterFailure = false;
    void this.restart(entry);
    return {};
  }

  /** A credential changed (another tab, the CLI or a file edit): reconnect servers whose resolved values changed. */
  onCredential(ref, skip = new Set()) {
    if (this.saving || this.stopped) return;
    for (const entry of [...this.servers.values()]) {
      if (skip.has(entry.name) || !entry.spec?.normalized || !entry.spec.refs.includes(ref)) continue;
      void this.recheck(entry);
    }
  }

  /** Once the current attempt settles, reconnect if the values it would resolve now differ from those it used. */
  async recheck(entry) {
    let generation;
    do { generation = entry.generation; await entry.chain; } while (!this.stopped && generation !== entry.generation);
    if (this.stopped || !entry.enabled || this.servers.get(entry.name) !== entry) return;
    const resolved = await resolveServer(entry.spec.normalized, ref => this.lookup(ref));
    const key = digest(JSON.stringify([resolved.config ?? null, resolved.missing, resolved.issue ?? null]));
    if (this.stopped || entry.generation !== generation || key === entry.resolvedKey) return;
    entry.attempts = 0;
    void this.restart(entry);
  }
  // ---- OAuth ---------------------------------------------------------------------------------------------------

  grantKey(kind, server, url) {
    return `${RECORD_SCOPE}/${kind}-${digest(`${server}\n${canonical(url)}`)}`;
  }

  async loadGrants() {
    if (typeof this.credentials.listRecords !== 'function') return;
    let records;
    try { records = await this.credentials.listRecords(); } catch { return; }
    for (const record of records ?? []) {
      if (typeof record?.key !== 'string' || !record.key.startsWith(`${RECORD_SCOPE}/`) || record.kind !== 'grant') continue;
      await this.reloadGrant(record.key);
    }
  }

  /** @returns whether the usable access token changed. */
  async reloadGrant(key) {
    let record;
    try { record = await this.credentials.readRecord(key); } catch { return false; }
    const payload = record?.kind === 'grant' ? record.payload : undefined;
    const previous = this.grants.get(key);
    if (isPlainObject(payload) && typeof payload.accessToken === 'string' && payload.accessToken) {
      this.grants.set(key, payload);
      this.scheduleRefresh(key, payload);
    } else {
      this.grants.delete(key);
      clearTimeout(this.refreshTimers.get(key));
      this.refreshTimers.delete(key);
    }
    return previous?.accessToken !== this.grants.get(key)?.accessToken;
  }

  async onRecord(key) {
    if (typeof key !== 'string' || !key.startsWith(`${RECORD_SCOPE}/`)) return;
    if (await this.reloadGrant(key)) this.applyGrant(key);
  }

  async saveGrant(key, payload) {
    // Records must survive a JSON round trip exactly.
    const record = JSON.parse(JSON.stringify(payload));
    this.grants.set(key, record);
    await this.credentials.modifyRecord(key, () => ({ kind: 'grant', payload: record }));
    this.scheduleRefresh(key, record);
  }

  async dropGrants(kind, server) {
    for (const [key, grant] of [...this.grants]) {
      if (grant.kind !== kind || grant.server !== server) continue;
      this.grants.delete(key);
      clearTimeout(this.refreshTimers.get(key));
      this.refreshTimers.delete(key);
      await this.credentials.deleteRecord(key).catch(() => {});
    }
  }

  /** Refresh shortly before expiry; a grant that is already stale refreshes almost immediately. */
  scheduleRefresh(key, grant) {
    clearTimeout(this.refreshTimers.get(key));
    this.refreshTimers.delete(key);
    if (this.stopped || !grant.refreshToken || !grant.expiresAt) return;
    const wait = Math.min(MAX_TIMER_MS, Math.max(1000, grant.expiresAt - REFRESH_LEAD_MS - Date.now()));
    const timer = setTimeout(async () => {
      this.refreshTimers.delete(key);
      if (await this.refreshGrant(key)) this.applyGrant(key);
    }, wait);
    timer.unref?.();
    this.refreshTimers.set(key, timer);
  }

  /** Refresh once per key at a time. @returns whether a new access token was stored. */
  refreshGrant(key, force = false) {
    if (this.refreshing.has(key)) return this.refreshing.get(key);
    const run = (async () => {
      const grant = this.grants.get(key);
      if (!grant?.refreshToken) return false;
      if (!force && grant.expiresAt && grant.expiresAt - REFRESH_LEAD_MS > Date.now()) return false;
      try {
        const tokens = await OAuth.refreshTokens(grant, { signal: this.lifetime.signal });
        if (this.stopped) return false;
        await this.saveGrant(key, { ...grant, ...tokens, refreshedAt: Date.now() });
        return true;
      } catch (error) {
        if (error?.code === 'invalid_grant') {
          this.grants.delete(key);
          await this.credentials.deleteRecord(key).catch(() => {});
        }
        this.ctx.logger.warn('MCP connector OAuth refresh failed for %s: %s', grant.server, redactText(error?.message, [grant.refreshToken, grant.accessToken]));
        return false;
      } finally { this.refreshing.delete(key); }
    })();
    this.refreshing.set(key, run);
    return run;
  }

  async usableGrant(key) {
    const grant = this.grants.get(key);
    if (!grant) return undefined;
    if (grant.expiresAt && grant.expiresAt - 60e3 < Date.now() && grant.refreshToken) await this.refreshGrant(key, true);
    return this.grants.get(key);
  }

  /** Reconnect the server a grant belongs to so its next handshake carries the current token. */
  applyGrant(key) {
    if (this.stopped) return;
    for (const entry of this.servers.values()) {
      const url = entry.url ?? entry.spec?.normalized?.url;
      if (url && this.grantKey('custom', entry.name, url) === key) { entry.attempts = 0; void this.restart(entry); }
    }
    for (const { fiber, config } of this.foreign()) {
      if (config.transport === 'streamable-http' && typeof config.url === 'string' && this.grantKey('plugin', config.serverName, config.url) === key) void this.syncForeign(fiber);
    }
  }

  /** Restart a plugin-owned bridge once it settles if its running Authorization differs from the current grant. */
  async syncForeign(fiber) {
    try { await fiber.await(); } catch { /* a failed start is retried by the restart below */ }
    if (this.stopped || !fiber.uid) return;
    const config = fiber.config;
    if (!isPlainObject(config) || config.transport !== 'streamable-http' || typeof config.url !== 'string') return;
    const injected = this.injected.get(fiber);
    // The plugin supplies its own Authorization; never replace it.
    if (injected === undefined && hasAuthorization(config.headers)) return;
    const grant = this.grants.get(this.grantKey('plugin', config.serverName, config.url));
    const expected = grant?.accessToken ? `Bearer ${grant.accessToken}` : undefined;
    if (injected === expected) return;
    await fiber.restart().catch(() => {});
  }

  /** `internal/config` waterfall: give a plugin-owned HTTP bridge the token this page obtained for it. */
  injectGrant(fiber, next) {
    const config = next();
    try {
      if (this.stopped || fiber?.runtime?.name !== 'mcp-client' || this.isOwn(fiber)) return config;
      if (!isPlainObject(config) || config.transport !== 'streamable-http' || typeof config.url !== 'string' || typeof config.serverName !== 'string') return config;
      if (config.headers !== undefined && (!isPlainObject(config.headers) || isExpression(config.headers))) return config;
      this.injected.delete(fiber);
      if (hasAuthorization(config.headers)) return config;
      const key = this.grantKey('plugin', config.serverName, config.url);
      const grant = this.grants.get(key);
      if (!grant?.accessToken) return config;
      if (grant.expiresAt && grant.expiresAt - 60e3 < Date.now() && grant.refreshToken) {
        void this.refreshGrant(key, true).then(refreshed => { if (refreshed) this.applyGrant(key); });
      }
      const header = `Bearer ${grant.accessToken}`;
      this.injected.set(fiber, header);
      return { ...config, headers: { ...(config.headers ?? {}), Authorization: header } };
    } catch { return config; }
  }

  /** `internal/update` waterfall: keep an injected token out of any Loader write-back of a resolved config. */
  stripGrant(fiber, config, noSave) {
    try {
      if (noSave || fiber?.runtime?.name !== 'mcp-client' || this.isOwn(fiber) || !isPlainObject(config?.headers)) return;
      const header = authorizationOf(config.headers), injected = this.injected.get(fiber);
      if (header && injected && config.headers[header] === injected) delete config.headers[header];
    } catch { /* never block configuration updates */ }
  }

  async target(kind, server) {
    if (kind === 'custom') {
      const entry = this.servers.get(server);
      const normalized = entry?.spec?.normalized;
      if (!normalized) throw new ActionError('notFound', { server });
      if (normalized.transport !== 'streamable-http') throw new ActionError('oauthUnsupported', { server });
      const resolved = await resolveServer(normalized, ref => this.lookup(ref));
      if (resolved.missing.length) throw new ActionError('missing', { server, refs: resolved.missing });
      if (!resolved.config) throw new ActionError('config', { server });
      const oauth = { ...(normalizeServer(server, entry.definition).oauth ?? {}) };
      for (const field of ['clientId', 'clientSecret']) {
        if (typeof oauth[field] !== 'string' || !oauth[field].includes('${')) continue;
        const missing = new Set();
        oauth[field] = await resolveString(oauth[field], ref => this.lookup(ref), missing, new Set());
        if (missing.size) throw new ActionError('missing', { server, refs: [...missing] });
      }
      return { kind, server, url: resolved.config.url, oauth };
    }
    if (kind === 'plugin') {
      const found = this.foreign().find(({ config }) => config.serverName === server && config.transport === 'streamable-http' && typeof config.url === 'string');
      if (!found) throw new ActionError('notFound', { server });
      return { kind, server, url: found.config.url, oauth: {} };
    }
    throw new ActionError('kind');
  }

  listen(port) {
    return new Promise((done, reject) => {
      const listener = createServer((req, res) => {
        if (listener.flow) void listener.flow.handle(req, res);
        else res.writeHead(404).end();
      });
      listener.once('error', reject);
      listener.listen(port, '127.0.0.1', () => {
        listener.off('error', reject);
        listener.unref?.();
        done(listener);
      });
    });
  }

  async oauthStart({ kind, name: server }) {
    const target = await this.target(kind, server);
    const key = this.grantKey(kind, server, target.url);
    const previous = this.flows.get(key);
    if (previous) this.closeFlow(previous, 'cancelled');
    let info;
    try { info = await OAuth.discover(target.url, { signal: this.lifetime.signal }); }
    catch (error) { throw new ActionError(error?.code ?? 'discovery', { message: redactText(error?.message) }); }
    const existing = this.grants.get(key);
    let client = target.oauth.clientId ? { clientId: target.oauth.clientId, ...(target.oauth.clientSecret ? { clientSecret: target.oauth.clientSecret } : {}) }
      : existing?.client?.issuer === info.issuer ? existing.client : undefined;
    const reusedPort = !target.oauth.clientId && client?.redirectUri ? Number(new URL(client.redirectUri).port) : 0;
    let listener;
    try { listener = await this.listen(target.oauth.callbackPort ?? reusedPort); }
    catch (error) {
      if (target.oauth.callbackPort || !reusedPort) throw new ActionError('port', { message: error?.message });
      listener = await this.listen(0);
    }
    const redirectUri = `http://127.0.0.1:${listener.address().port}/callback`;
    try {
      if (target.oauth.clientId) client = { ...client, redirectUri };
      else if (client?.redirectUri !== redirectUri) client = { ...await OAuth.registerClient(info, redirectUri, { signal: this.lifetime.signal }), issuer: info.issuer };
    } catch (error) {
      listener.close();
      throw new ActionError(error?.code ?? 'registration', { message: redactText(error?.message) });
    }
    const pkce = OAuth.createPkce(), state = OAuth.randomState();
    const scope = target.oauth.scope ?? info.scope;
    const url = OAuth.authorizationUrl(info, client, { redirectUri, state, challenge: pkce.challenge, scope });
    const flow = { key, kind, server, state, verifier: pkce.verifier, info, client, redirectUri, listener, url, status: 'pending' };
    flow.timer = setTimeout(() => this.closeFlow(flow, 'failed', 'timeout', 'timeout'), FLOW_TIMEOUT_MS);
    flow.timer.unref?.();
    flow.handle = (req, res) => this.callback(flow, req, res);
    listener.flow = flow;
    this.flows.set(key, flow);
    return { url };
  }

  closeFlow(flow, status, code, error) {
    clearTimeout(flow.timer);
    flow.listener?.close();
    flow.listener = undefined;
    flow.status = status;
    if (code) flow.code = code;
    if (status === 'failed') flow.error = error ?? code;
    if (status !== 'failed' && this.flows.get(flow.key) === flow) this.flows.delete(flow.key);
  }

  async callback(flow, req, res) {
    const send = (status, html) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'", 'referrer-policy': 'no-referrer' });
      res.end(html);
    };
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method !== 'GET' || url.pathname !== '/callback') { res.writeHead(404).end(); return; }
    if (flow.status !== 'pending' || flow.busy) { send(409, resultPage(false, 'This authorization request is no longer active.')); return; }
    if (url.searchParams.get('state') !== flow.state) { send(400, resultPage(false, 'State mismatch.')); return; }
    flow.busy = true;
    const oauthError = url.searchParams.get('error');
    if (oauthError) {
      const description = redactText(url.searchParams.get('error_description') ?? oauthError).slice(0, 300);
      this.closeFlow(flow, 'failed', oauthError === 'access_denied' ? 'denied' : 'authorization', description);
      send(400, resultPage(false, description));
      return;
    }
    const issuer = url.searchParams.get('iss');
    if (issuer && flow.info.metadata.issuer && issuer !== flow.info.metadata.issuer) {
      this.closeFlow(flow, 'failed', 'issuer', 'Issuer mismatch');
      send(400, resultPage(false, 'Issuer mismatch.'));
      return;
    }
    const code = url.searchParams.get('code');
    if (!code) { this.closeFlow(flow, 'failed', 'authorization', 'Missing authorization code'); send(400, resultPage(false, 'Missing authorization code.')); return; }
    try {
      const tokens = await OAuth.exchangeCode(flow.info, flow.client, { code, verifier: flow.verifier, redirectUri: flow.redirectUri }, { signal: this.lifetime.signal });
      await this.saveGrant(flow.key, {
        v: 1, kind: flow.kind, server: flow.server, resource: flow.info.resource, issuer: flow.info.issuer,
        tokenEndpoint: flow.info.metadata.token_endpoint,
        metadata: Array.isArray(flow.info.metadata.token_endpoint_auth_methods_supported)
          ? { token_endpoint_auth_methods_supported: flow.info.metadata.token_endpoint_auth_methods_supported } : {},
        client: flow.client, ...tokens, obtainedAt: Date.now(),
      });
      this.closeFlow(flow, 'done');
      send(200, resultPage(true));
      this.applyGrant(flow.key);
    } catch (error) {
      const message = redactText(error?.message, [code]);
      this.closeFlow(flow, 'failed', error?.code ?? 'token', message);
      send(400, resultPage(false, message));
    }
  }

  oauthCancel({ kind, name: server }) {
    for (const flow of [...this.flows.values()]) if (flow.kind === kind && flow.server === server) this.closeFlow(flow, 'cancelled');
    return {};
  }

  async oauthRevoke({ kind, name: server }) {
    const keys = [...this.grants].filter(([, grant]) => grant.kind === kind && grant.server === server).map(([key]) => key);
    for (const flow of [...this.flows.values()]) if (flow.kind === kind && flow.server === server) this.closeFlow(flow, 'cancelled');
    await this.dropGrants(kind, server);
    for (const key of keys) this.applyGrant(key);
    return {};
  }

  // ---- HTTP -----------------------------------------------------------------------------------------------------

  async dispatch(body) {
    if (!isPlainObject(body) || typeof body.action !== 'string') throw new ActionError('request');
    const named = ['toggle', 'remove', 'reconnect', 'oauthStart', 'oauthCancel', 'oauthRevoke'];
    if (named.includes(body.action) && typeof body.name !== 'string') throw new ActionError('request');
    switch (body.action) {
      case 'preview': return { analysis: (await this.analyze(String(body.text ?? ''), body.mode === 'edit' ? 'edit' : 'add', body.target, isPlainObject(body.values) ? body.values : {})).analysis };
      case 'save': return this.save(body);
      case 'toggle': return this.toggle(body);
      case 'remove': return this.remove(body);
      case 'reconnect': return this.reconnect(body);
      case 'oauthStart': return this.oauthStart(body);
      case 'oauthCancel': return this.oauthCancel(body);
      case 'oauthRevoke': return this.oauthRevoke(body);
      default: throw new ActionError('request');
    }
  }

  async handleState() {
    return json(await this.describe());
  }

  async handleAction(request) {
    const type = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
    if (type !== 'application/json') return new Response('content type must be application/json', { status: 415 });
    const text = await request.text();
    if (Buffer.byteLength(text) > MAX_BODY_BYTES) return new Response('payload too large', { status: 413 });
    let body;
    try { body = JSON.parse(text); } catch { return new Response('body is not JSON', { status: 400 }); }
    try { return json({ ok: true, ...await this.dispatch(body) }); }
    catch (error) {
      if (error instanceof ActionError) return json({ ok: false, error: { code: error.code, ...error.details } });
      this.ctx.logger.warn('MCP connector action %s failed: %s', body?.action, redactText(errorText(error)));
      return json({ ok: false, error: { code: 'internal', message: redactText(errorText(error)) } });
    }
  }
}

export async function apply(ctx, config) {
  const manager = new Manager(ctx, config);
  ctx.effect(() => () => manager.dispose(), 'dsh-custom-json-mcp: connections');
  ctx.on('loader/volatile-update', () => { void manager.reconcile(); });
  ctx.on('credentials/reference-updated', ref => manager.onCredential(ref));
  ctx.on('credentials/record-updated', key => { void manager.onRecord(key); });
  // Prepended global waterfalls see other plugins' fully interpolated bridge configs and run before Loader write-back.
  ctx.on('internal/config', function (_config, next) { return manager.injectGrant(this, next); }, { global: true, prepend: true });
  ctx.on('internal/update', function (config, noSave, next) { manager.stripGrant(this, config, noSave); return next(); }, { global: true, prepend: true });
  // `internal/status` passes the fiber as its first argument (it is emitted without a `this` target).
  ctx.on('internal/status', fiber => manager.onStatus(fiber), { global: true });
  try { ctx.logger.exporter({ levels: { default: 3 }, export: message => manager.observe(message) }); } catch { /* status degrades to tool counts */ }
  ctx.inject(['settings'], inner => {
    manager.settings = inner.settings;
    inner.effect(() => inner.settings.configure({ auto: false }, ctx.fiber), 'dsh-custom-json-mcp: own settings page');
    inner.effect(() => () => { if (manager.settings === inner.settings) manager.settings = undefined; }, 'dsh-custom-json-mcp: settings');
  });
  ctx.inject(['connection'], inner => {
    inner.connection.fetch.register({ path: STATE_PATH, methods: ['GET'], requestBody: 'buffered', fetch: () => manager.handleState() });
    inner.connection.fetch.register({ path: ACTION_PATH, methods: ['POST'], requestBody: 'buffered', fetch: request => manager.handleAction(request) });
  });
  await manager.start();
}
