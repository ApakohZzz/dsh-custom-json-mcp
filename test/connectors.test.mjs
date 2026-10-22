import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { checkMarkdown, decodePng, packagedFiles } from '../tools/lib.mjs';

// The pinned development dependencies live in dev/ (npm ci --prefix dev), outside the plugin package.
const devRequire = createRequire(new URL('../dev/package.json', import.meta.url));
const devImport = name => import(pathToFileURL(devRequire.resolve(name)).href);
const { Context, Service } = await devImport('@deepseek-ai/cordis');
const { Loader } = await devImport('@deepseek-ai/cordis-plugin-loader');
const { entryListSchema } = await devImport('@deepseek-ai/cordis-plugin-include');
const Bridge = await devImport('@deepseek-ai/dsh-mcp-client');
const { default: ToolRuntime } = await devImport('@deepseek-ai/dsh-tools');
const { default: SystemPrompt } = await devImport('@deepseek-ai/dsh-system-prompt');
const { default: SettingsForms } = await devImport('@deepseek-ai/dsh-settings');
const { readPluginMeta } = await devImport('@deepseek-ai/dsh-app-boot');
const { load } = await devImport('js-yaml');
const id = 'dsh-custom-json-mcp';
const root = fileURLToPath(new URL('../', import.meta.url));
const base = new URL('../', import.meta.url);
const devModules = fileURLToPath(new URL('../dev/node_modules/', import.meta.url));
const read = path => readFileSync(new URL(path, base));
const json = path => JSON.parse(read(path));
const fixture = fileURLToPath(new URL('./fixtures/mcp-stdio-server.mjs', import.meta.url));
// Copy the Host half under dev/node_modules so its bare imports resolve to the pinned development dependencies.
const dir = mkdtempSync(join(devModules, '.custom-json-mcp-test-'));
cpSync(new URL('lib/', base), dir, { recursive: true });
after(() => rmSync(dir, { recursive: true, force: true }));
const plugin = await import(pathToFileURL(`${dir}/index.js`));
const servers = await import(pathToFileURL(`${dir}/servers.js`));
const oauth = await import(pathToFileURL(`${dir}/oauth.js`));
const patch = load(read('cordis.patch.yml').toString(), { schema: entryListSchema });
const entry = patch[0].insert[0];

async function eventually(check, message = 'condition did not settle', timeout = 8000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value;
    assert.ok(Date.now() < deadline, message);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

/** In-memory credentials with the official seam's resolve/describe/set/unset and record semantics. */
class MemoryCredentials extends Service {
  constructor(ctx) {
    super(ctx, 'credentials');
    this.refs = new Map();
    this.env = new Map();
    this.records = new Map();
  }
  async resolve(ref) {
    if (this.env.has(ref)) return { value: this.env.get(ref), source: 'env' };
    return this.refs.get(ref) ? { value: this.refs.get(ref), source: 'file' } : undefined;
  }
  async describe(ref) {
    if (this.env.has(ref)) return { configured: true, source: 'env', writable: false };
    return this.refs.get(ref) ? { configured: true, source: 'file', writable: true } : { configured: false, writable: true };
  }
  async set(ref, value) {
    if (!value) throw new Error('empty credential values cannot be stored');
    this.refs.set(ref, value);
    this.ctx.emit('credentials/reference-updated', ref);
  }
  async unset(ref) {
    if (this.refs.delete(ref)) this.ctx.emit('credentials/reference-updated', ref);
  }
  async listRecords() { return [...this.records].map(([key, record]) => ({ key, kind: record.kind })); }
  async readRecord(key) { return this.records.has(key) ? structuredClone(this.records.get(key)) : undefined; }
  async modifyRecord(key, mutate) {
    const next = await mutate(this.records.get(key));
    if (next === undefined) return;
    this.records.set(key, JSON.parse(JSON.stringify(next)));
    this.ctx.emit('credentials/record-updated', key);
  }
  async deleteRecord(key) { if (this.records.delete(key)) this.ctx.emit('credentials/record-updated', key); }
}

/** Real Loader, Settings and official bridge; only profile-file persistence and the transport are in memory. */
async function harness(t, options = {}) {
  const ctx = new Context();
  const saved = new Map();
  const routes = new Map();
  let rows = [structuredClone(entry), ...(options.rows ?? [])];
  class TestLoader extends Loader {
    async import(name) {
      if (name === id) return plugin;
      if (name === '@deepseek-ai/dsh-mcp-client') return Bridge;
      if (options.modules?.[name]) return options.modules[name];
      throw new Error(`unexpected import ${name}`);
    }
  }
  ctx.provide('profileContext', { home: dir });
  ctx.plugin(MemoryCredentials);
  ctx.provide('connection', { fetch: { register: route => ctx.effect(() => { routes.set(route.path, route); return () => routes.delete(route.path); }) } });
  ctx.provide('configEditor', {
    documentPath: `${dir}/cordis.patch.yml`,
    entries: () => [...ctx.loader.entries()],
    configuration: () => [...ctx.loader.entries()].map(row => ({ entry: row, inherited: row.id === entry.id ? entry.config : row.options.config, override: saved.get(row.id) ?? {} })),
    async edit(row, change) {
      const next = change(structuredClone(row.options.config), structuredClone(entry.config));
      saved.set(row.id, next);
      rows = rows.map(item => item.id === row.id ? { ...item, config: next } : item);
      await ctx.loader.root.update(structuredClone(rows));
      await ctx.loader.await();
    },
  });
  await ctx.plugin(SystemPrompt).await();
  await ctx.plugin(ToolRuntime).await();
  await ctx.plugin(TestLoader).await();
  await ctx.plugin(SettingsForms).await();
  await ctx.loader.root.update(structuredClone(rows));
  await ctx.loader.await();
  await ctx.loader.resolve(entry.id).fiber.await();
  t.after(() => ctx.fiber.dispose());
  const call = async (path, init) => {
    const route = routes.get(path);
    assert.ok(route, `${path} must be registered`);
    return route.fetch(new Request(`http://dsh.test${path}`, init));
  };
  const state = async () => (await call(plugin.STATE_PATH, { method: 'GET' })).json();
  const action = async body => (await call(plugin.ACTION_PATH, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  const server = async name => (await state()).custom.find(item => item.name === name);
  const tools = () => ctx.tools.schemas().map(schema => schema.name).sort();
  const setRows = async next => { rows = next; await ctx.loader.root.update(structuredClone(rows)); await ctx.loader.await(); };
  return { ctx, saved, routes, state, action, server, tools, call, setRows, get rows() { return rows; } };
}

function mcpHttpServer(handler = () => {}) {
  const requests = [];
  const http = createServer(async (req, res) => {
    let text = '';
    for await (const chunk of req) text += chunk;
    requests.push({ path: req.url, method: req.method, auth: req.headers.authorization });
    if (handler(req, res, text) === true) return;
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    const body = JSON.parse(text);
    if (body.id === undefined) { res.writeHead(202).end(); return; }
    const results = {
      initialize: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'cjm-http-fixture', version: '1.0.0' } },
      'tools/list': { tools: [{ name: 'lookup', description: 'Fixture lookup', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }] },
      'tools/call': { content: [{ type: 'text', text: `http ${req.url}` }] },
    };
    const result = results[body.method];
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result ? { jsonrpc: '2.0', id: body.id, result } : { jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'Unknown method' } }));
  });
  return { http, requests };
}

async function listen(t, http) {
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  t.after(() => { http.closeAllConnections(); return new Promise(resolve => http.close(resolve)); });
  return `http://127.0.0.1:${http.address().port}`;
}

const stdioDocument = (name, toolNames, extra = {}) => JSON.stringify({ mcpServers: { [name]: { command: process.execPath, args: [fixture, ...toolNames], ...extra } } });

test('a linked copy imports on its own: every bare Host import is a declared, installed dependency', { timeout: 60000 }, t => {
  // DSH links a local directory without installing its dependencies, and Node resolves the plugin's bare imports
  // from the copy's real path. Copy the package outside every node_modules tree with only its runtime dependencies.
  const target = mkdtempSync(join(tmpdir(), 'cjm-linked-'));
  t.after(() => rmSync(target, { recursive: true, force: true }));
  for (const file of packagedFiles(root)) cpSync(join(root, file), join(target, file), { recursive: true });
  const pending = Object.keys(json('package.json').dependencies ?? {}), copied = new Set();
  while (pending.length) {
    const name = pending.pop();
    if (copied.has(name)) continue;
    copied.add(name);
    cpSync(join(devModules, name), join(target, 'node_modules', name), { recursive: true, dereference: true });
    pending.push(...Object.keys(JSON.parse(readFileSync(join(devModules, name, 'package.json'), 'utf8')).dependencies ?? {}));
  }
  const bare = new Set();
  for (const file of ['index.js', 'servers.js', 'oauth.js']) {
    for (const [, specifier] of read(`lib/${file}`).toString().matchAll(/^import [^;]*? from '([^'.][^']*)';/gm)) if (!specifier.startsWith('node:')) bare.add(specifier);
  }
  assert.deepEqual([...bare].sort(), Object.keys(json('package.json').dependencies).sort(), 'Host imports and declared dependencies must agree');
  const entry = pathToFileURL(join(target, 'lib/index.js')).href;
  const probe = spawnSync(process.execPath, ['--input-type=module', '-e', `const m = await import(${JSON.stringify(entry)}); console.log(m.name, typeof m.apply, typeof m.Config);`],
    { cwd: tmpdir(), env: { ...process.env, NODE_PATH: '' }, encoding: 'utf8' });
  assert.equal(probe.status, 0, probe.stderr);
  assert.equal(probe.stdout.trim(), `${id} function function`);
});

test('identity, bilingual metadata, documentation and npm payload agree', () => {
  const pkg = json('package.json');
  assert.equal(pkg.name, id);
  assert.match(pkg.repository.url, /github\.com\/ApakohZzz\/dsh-custom-json-mcp/);
  const meta = readPluginMeta(id, new URL('package.json', base).href);
  assert.equal(meta.error, undefined, meta.error);
  assert.deepEqual(meta.title, { en: 'Connectors (Custom MCP)', zh: '连接器（自定义 MCP）' });
  for (const lang of ['en', 'zh']) assert.equal(meta.description[lang], json(`locale/${lang}.json`).meta.description);
  assert.ok(meta.icon);
  const command = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'npm';
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm pack --dry-run --json --ignore-scripts'] : ['pack', '--dry-run', '--json', '--ignore-scripts'];
  const packed = spawnSync(command, args, { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(packed.status, 0, packed.stderr);
  const files = JSON.parse(packed.stdout)[0].files.map(file => file.path).sort();
  assert.deepEqual(files, packagedFiles(root));
  assert.ok(!files.some(file => /^(test|tools|dev|pictures|\.github)\//.test(file)), 'development files and screenshots stay out of the package');
  for (const file of ['README.md', 'README.en.md']) assert.deepEqual(checkMarkdown(file, root).errors, []);
});

test('icon derives from the original Boxicons glyph and meets the market icon rules', () => {
  const upstream = json('upstream.json');
  const bytes = read('icon.png');
  assert.ok(bytes.length <= 256 * 1024);
  const image = decodePng(bytes);
  assert.equal(image.width, image.height);
  assert.ok(image.width >= 64);
  const last = image.width - 1;
  for (const [x, y] of [[0, 0], [last, 0], [0, last], [last, last]]) assert.equal(image.data[(y * image.width + x) * 4 + 3], 0);
  let opaque = 0;
  for (let index = 3; index < image.data.length; index += 4) if (image.data[index]) opaque++;
  assert.ok(opaque / (image.width * image.height) >= 0.05);
  const check = spawnSync(process.execPath, [fileURLToPath(new URL('../tools/generate-icon.mjs', import.meta.url)), '--check'], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
  assert.match(upstream.commit, /^[0-9a-f]{40}$/);
  const glyph = readFileSync(new URL('upstream/bx-mcp.svg', base), 'utf8');
  // The browser sidebar icon embeds the same path data.
  for (const [, path] of glyph.matchAll(/ d="([^"]+)"/g)) assert.ok(read('lib/client.js').toString().includes(path));
});

test('standard MCP JSON formats parse; unsupported constructs are reported, not dropped', () => {
  assert.equal(servers.parseDocument('{"mcpServers":{"a":{"command":"npx"}}}').format, 'mcpServers');
  const vscode = servers.parseDocument('// VS Code\n{ "servers": { "web": { "type": "http", "url": "https://x.example/mcp", }, }, "inputs": [{ "id": "k" }] }');
  assert.equal(vscode.format, 'servers');
  assert.deepEqual(vscode.warnings, [{ code: 'inputs' }]);
  assert.equal(servers.parseDocument('{"mcp":{"servers":{"a":{"url":"https://h/mcp"}}}}').format, 'mcp.servers');
  assert.equal(servers.parseDocument('{"fs":{"command":"npx"}}').format, 'map');
  assert.deepEqual(servers.parseDocument('{"command":"npx"}').errors, [{ code: 'unnamed' }]);
  assert.equal(servers.parseDocument('{').errors[0].code, 'json');
  const codes = (name, raw) => servers.normalizeServer(name, raw).errors.map(issue => issue.code);
  assert.deepEqual(codes('legacy', { type: 'sse', url: 'https://h/sse' }), ['sse']);
  assert.deepEqual(codes('bad name!', { command: 'x' }), ['name']);
  assert.deepEqual(codes('v', { type: 'http', url: 'https://h/mcp', headers: { Authorization: 'Bearer ${input:tok}' } }), ['input']);
  assert.deepEqual(codes('w', { command: 'x', cwd: '${workspaceFolder}' }), ['vscodeVariable']);
  assert.deepEqual(codes('e', { command: 'x', envFile: '.env' }), ['envFile']);
  assert.deepEqual(codes('u', { url: 'https://user:pw@h/mcp' }), ['urlCredentials']);
  assert.deepEqual(codes('f', { url: 'file:///etc/passwd' }), ['url']);
  const gemini = servers.normalizeServer('g', { httpUrl: 'https://h/mcp', timeout: 5000, trust: true });
  assert.equal(gemini.normalized.url, 'https://h/mcp');
  assert.deepEqual(gemini.warnings[0], { code: 'ignored', server: 'g', fields: ['timeout', 'trust'] });
  const numbers = servers.normalizeServer('n', { command: 'srv', args: ['--port', 8080], env: { DEBUG: true } });
  assert.deepEqual([numbers.normalized.args, numbers.normalized.env], [['--port', '8080'], { DEBUG: 'true' }]);
  assert.equal(servers.normalizeServer('d', { command: 'x', disabled: true }).enabled, false);
});

test('literal secrets move into references; resolution substitutes, encodes queries and reports gaps', async () => {
  const { definition, secrets } = servers.extractSecrets('github', {
    command: 'npx', args: ['-y', 'mcp-remote', 'https://h/mcp', '--header', 'Authorization: Bearer abc123def456', '--api-key', 'k-1'],
    env: { GITHUB_TOKEN: 'ghp_value', PLAIN: 'keep', ALREADY: '${GITHUB_TOKEN}' },
  }, new Set(['MCP_GITHUB_API_KEY']));
  assert.deepEqual(definition.env, { GITHUB_TOKEN: '${MCP_GITHUB_GITHUB_TOKEN}', PLAIN: 'keep', ALREADY: '${GITHUB_TOKEN}' });
  assert.equal(definition.args[4], 'Authorization: Bearer ${MCP_GITHUB_AUTHORIZATION}');
  assert.equal(definition.args[6], '${MCP_GITHUB_API_KEY_2}', 'generated names avoid references other servers use');
  assert.deepEqual(secrets.map(secret => secret.ref).sort(), ['MCP_GITHUB_API_KEY_2', 'MCP_GITHUB_AUTHORIZATION', 'MCP_GITHUB_GITHUB_TOKEN']);
  const http = servers.extractSecrets('web', { url: 'https://h/mcp?api_key=s3cr%20t&x=1', headers: { 'X-API-Key': 'k', Accept: 'json' } });
  assert.equal(http.definition.url, 'https://h/mcp?api_key=${MCP_WEB_API_KEY}&x=1');
  assert.equal(http.definition.headers['X-API-Key'], '${MCP_WEB_X_API_KEY}');
  assert.equal(http.secrets.find(secret => secret.ref === 'MCP_WEB_API_KEY').value, 's3cr t');
  const resolved = await servers.resolveServer(servers.normalizeServer('web', http.definition).normalized, async ref => ({ MCP_WEB_API_KEY: 'a b&c', MCP_WEB_X_API_KEY: 'k' })[ref]);
  assert.equal(resolved.config.url, 'https://h/mcp?api_key=a%20b%26c&x=1');
  assert.deepEqual(resolved.secrets.sort(), ['a b&c']);
  const gaps = await servers.resolveServer(servers.normalizeServer('m', { command: 'x', env: { A: '${NOPE}', B: '${MAYBE:-fallback}' } }).normalized, async () => undefined);
  assert.deepEqual(gaps.missing, ['NOPE']);
  const summary = servers.summarize(servers.normalizeServer('s', { command: 'npx', args: ['--api-key', 'zzz', '--token=abc', 'Authorization: Bearer q'] }).normalized);
  assert.equal(summary, 'npx --api-key *** --token=*** Authorization: ***');
  assert.equal(servers.redactText('HTTP 401 Bearer abcdefghij at https://h/?token=xyz', ['nothing']), 'HTTP 401 Bearer *** at https://h/?token=***');
  assert.deepEqual(['spawn npx ENOENT', 'Error POSTing to endpoint (HTTP 401): no', 'fetch failed', 'Connection closed'].map(servers.classifyFailure),
    ['command', 'unauthorized', 'network', 'exited']);
});

const digest16 = value => createHash('sha256').update(value).digest('hex').slice(0, 16);

test('the page adds stdio servers, stores secrets by reference, toggles, reconnects and deletes them with the official bridge', { timeout: 60000 }, async t => {
  const h = await harness(t);
  assert.deepEqual((await h.state()).custom, []);
  const secret = 'fixture-secret-1';
  const document = stdioDocument('alpha', ['ping', 'echo'], { env: { FIXTURE_TOKEN: secret, FIXTURE_DIGEST: digest16(secret) } });
  const preview = await h.action({ action: 'preview', text: document });
  assert.equal(preview.ok, true);
  assert.deepEqual(preview.analysis.servers[0].secrets, [{ ref: 'MCP_ALPHA_FIXTURE_TOKEN', field: 'FIXTURE_TOKEN' }]);
  assert.doesNotMatch(JSON.stringify(preview), new RegExp(secret), 'previews never echo extracted secrets');
  assert.equal(h.ctx.credentials.refs.size, 0, 'preview must not write credentials');
  assert.deepEqual(await h.action({ action: 'save', text: document }), { ok: true, saved: ['alpha'] });
  const config = h.saved.get(entry.id);
  assert.equal(config.servers.alpha.env.FIXTURE_TOKEN, '${MCP_ALPHA_FIXTURE_TOKEN}');
  assert.deepEqual(config.managedRefs, ['MCP_ALPHA_FIXTURE_TOKEN']);
  assert.doesNotMatch(JSON.stringify(config), new RegExp(secret), 'the profile patch never holds the literal secret');
  assert.equal(h.ctx.credentials.refs.get('MCP_ALPHA_FIXTURE_TOKEN'), secret);
  const connected = await eventually(async () => { const row = await h.server('alpha'); return row?.state === 'connected' && row; }, 'alpha must connect');
  assert.equal(connected.tools, 2);
  assert.deepEqual(h.tools(), ['mcp__alpha__echo', 'mcp__alpha__ping']);
  const result = await h.ctx.tools.execute({ name: 'mcp__alpha__ping', callId: 'c1', arguments: {}, signal: new AbortController().signal });
  assert.match(JSON.stringify(result), /stdio ping/);
  assert.doesNotMatch(JSON.stringify(await h.state()), new RegExp(secret));

  assert.equal((await h.action({ action: 'save', text: stdioDocument('alpha', ['x']) })).error.code, 'invalid', 'duplicate names are rejected');
  assert.deepEqual(await h.action({ action: 'toggle', name: 'alpha', enabled: false }), { ok: true });
  await eventually(async () => (await h.server('alpha')).state === 'disabled');
  assert.deepEqual(h.tools(), []);
  assert.equal(h.saved.get(entry.id).servers.alpha.disabled, true);
  await h.action({ action: 'toggle', name: 'alpha', enabled: true });
  await eventually(async () => (await h.server('alpha')).state === 'connected');
  assert.equal(h.saved.get(entry.id).servers.alpha.disabled, undefined);
  assert.equal(h.tools().length, 2);
  await h.action({ action: 'reconnect', name: 'alpha' });
  await eventually(async () => (await h.server('alpha')).state === 'connected' && h.tools().length === 2);

  const edit = JSON.stringify({ mcpServers: { alpha: { ...h.saved.get(entry.id).servers.alpha, args: [fixture, 'only'] } } });
  assert.deepEqual(await h.action({ action: 'save', mode: 'edit', target: 'alpha', text: edit }), { ok: true, saved: ['alpha'] });
  await eventually(async () => (await h.server('alpha')).state === 'connected' && h.tools().join() === 'mcp__alpha__only');
  assert.equal(h.ctx.credentials.refs.get('MCP_ALPHA_FIXTURE_TOKEN'), secret, 'editing keeps referenced secrets');

  // Rotating the stored credential elsewhere reconnects with the new value; the fixture then rejects it.
  await h.ctx.credentials.set('MCP_ALPHA_FIXTURE_TOKEN', 'rotated-value');
  const rotated = await eventually(async () => { const row = await h.server('alpha'); return row?.state === 'failed' && row; }, 'rotation must reconnect');
  assert.equal(rotated.reason, 'exited');
  assert.doesNotMatch(JSON.stringify(await h.state()), /rotated-value/);

  assert.deepEqual(await h.action({ action: 'remove', name: 'alpha' }), { ok: true });
  await eventually(async () => (await h.state()).custom.length === 0 && h.tools().length === 0);
  assert.equal(h.ctx.credentials.refs.has('MCP_ALPHA_FIXTURE_TOKEN'), false, 'generated credentials are removed with their server');
  assert.deepEqual(h.saved.get(entry.id), { servers: {}, managedRefs: [] });
});

test('failures surface a cause; missing credentials can be supplied and environment values are not overwritten', { timeout: 60000 }, async t => {
  const h = await harness(t);
  await h.action({ action: 'save', text: JSON.stringify({ mcpServers: { broken: { command: 'definitely-not-a-real-command-cjm' } } }) });
  const broken = await eventually(async () => { const row = await h.server('broken'); return row?.state === 'failed' && row; }, 'broken must fail');
  assert.equal(broken.reason, 'command', 'a missing command is identified even when the platform reports a closed connection');
  assert.ok(broken.error);
  assert.equal(broken.retryAt, undefined, 'configuration failures do not retry automatically');

  await h.action({ action: 'save', text: stdioDocument('needs', ['t'], { env: { FIXTURE_TOKEN: '${CJM_NEEDS_TOKEN}', FIXTURE_DIGEST: digest16('from-page') } }) });
  const missing = await eventually(async () => { const row = await h.server('needs'); return row?.state === 'failed' && row; });
  assert.deepEqual([missing.reason, missing.missing], ['missing', ['CJM_NEEDS_TOKEN']]);
  const edit = JSON.stringify({ mcpServers: { needs: h.saved.get(entry.id).servers.needs } });
  const preview = await h.action({ action: 'preview', mode: 'edit', target: 'needs', text: edit });
  assert.deepEqual(preview.analysis.servers[0].refs, [{ ref: 'CJM_NEEDS_TOKEN', state: 'missing', writable: true }]);
  await h.action({ action: 'save', mode: 'edit', target: 'needs', text: edit, values: { CJM_NEEDS_TOKEN: 'from-page' } });
  await eventually(async () => (await h.server('needs')).state === 'connected');
  assert.equal(h.ctx.credentials.refs.get('CJM_NEEDS_TOKEN'), 'from-page');
  assert.deepEqual(h.saved.get(entry.id).managedRefs, [], 'user-named references are never deleted by this plugin');

  h.ctx.credentials.env.set('CJM_ENV_TOKEN', 'from-env');
  const fixed = await h.action({ action: 'save', text: stdioDocument('envy', ['t'], { env: { FIXTURE_TOKEN: '${CJM_ENV_TOKEN}' } }), values: { CJM_ENV_TOKEN: 'ignored' } });
  assert.deepEqual([fixed.error?.code, fixed.error?.ref], ['unwritable', 'CJM_ENV_TOKEN'], 'environment-provided values cannot be replaced from the page');
  const envPreview = await h.action({ action: 'preview', text: stdioDocument('envy', ['t'], { env: { FIXTURE_TOKEN: '${CJM_ENV_TOKEN}' } }) });
  assert.deepEqual(envPreview.analysis.servers[0].refs, [{ ref: 'CJM_ENV_TOKEN', state: 'configured', source: 'env', writable: false }]);
  await h.action({ action: 'save', text: stdioDocument('envy', ['t'], { env: { FIXTURE_TOKEN: '${CJM_ENV_TOKEN}', FIXTURE_DIGEST: digest16('from-env') } }) });
  await eventually(async () => (await h.server('envy')).state === 'connected');
  assert.equal(h.ctx.credentials.refs.has('CJM_ENV_TOKEN'), false);

  // Plain JSON errors are reported per server before anything is written.
  const bad = await h.action({ action: 'preview', text: '{"mcpServers":{"legacy":{"type":"sse","url":"https://h/sse"},"ok":{"command":"x"}}}' });
  assert.deepEqual(bad.analysis.servers.map(server => [server.name, server.errors.map(issue => issue.code)]), [['legacy', ['sse']], ['ok', []]]);
  assert.equal((await h.action({ action: 'save', text: '{"mcpServers":{"legacy":{"type":"sse","url":"https://h/sse"}}}' })).error.code, 'invalid');
  assert.equal((await h.call(plugin.ACTION_PATH, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status, 415);
  assert.equal((await h.action({ action: 'nope' })).error.code, 'request');
});
test('HTTP servers connect with headers, report authentication failures and lists plugin-registered servers read-only', { timeout: 60000 }, async t => {
  let expected = 'Bearer header-token';
  const { http, requests } = mcpHttpServer((req, res) => {
    if (req.headers.authorization !== expected) { res.writeHead(401, { 'www-authenticate': 'Bearer' }).end(); return true; }
    return false;
  });
  const address = await listen(t, http);
  const foreign = { id: 'other-mcp', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'otherhttp', transport: 'streamable-http', url: `${address}/plugin`, headers: { Authorization: expected } } };
  const h = await harness(t, { rows: [foreign] });
  await eventually(() => h.tools().includes('mcp__otherhttp__lookup'), 'plugin bridge must connect');
  await h.action({ action: 'save', text: JSON.stringify({ mcpServers: { remote: { type: 'http', url: `${address}/mcp`, headers: { Authorization: 'Bearer header-token' } } } }) });
  assert.equal(h.saved.get(entry.id).servers.remote.headers.Authorization, 'Bearer ${MCP_REMOTE_AUTHORIZATION}');
  const remote = await eventually(async () => { const row = await h.server('remote'); return row?.state === 'connected' && row; });
  assert.equal(remote.tools, 1);
  assert.ok(requests.some(request => request.path === '/mcp' && request.auth === 'Bearer header-token'));
  const view = await h.state();
  assert.deepEqual(view.plugins.map(row => [row.name, row.entry, row.state, row.tools]), [['otherhttp', 'other-mcp', 'connected', 1]]);
  assert.equal(view.plugins[0].oauth.eligible, false, 'servers with their own Authorization header are not offered OAuth');
  assert.equal((await h.action({ action: 'save', text: JSON.stringify({ mcpServers: { otherhttp: { url: `${address}/x` } } }) })).error.code, 'invalid');
  expected = 'Bearer something-else';
  await h.action({ action: 'reconnect', name: 'remote' });
  const failed = await eventually(async () => { const row = await h.server('remote'); return row?.state === 'failed' && row; });
  assert.equal(failed.reason, 'unauthorized');
  assert.doesNotMatch(JSON.stringify(await h.state()), /header-token/);
});

test('OAuth: discovery, dynamic registration, PKCE callback, refresh, plugin-server injection and revoke', { timeout: 60000 }, async t => {
  const issued = new Set();
  let codes = 0, registrations = 0, refreshes = 0, lastRefresh;
  const pending = new Map();
  let origin = '';
  const json200 = (res, value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value)); return true; };
  const { http, requests } = mcpHttpServer((req, res, text) => {
    const url = new URL(req.url, origin);
    if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
      const resource = `${origin}${url.pathname.slice('/.well-known/oauth-protected-resource'.length) || '/mcp'}`;
      return json200(res, { resource, authorization_servers: [origin], scopes_supported: ['tools'] });
    }
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      return json200(res, { issuer: origin, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`, registration_endpoint: `${origin}/register`,
        response_types_supported: ['code'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'] });
    }
    if (url.pathname === '/register') {
      registrations++;
      return json200(res, { client_id: `client-${registrations}`, redirect_uris: JSON.parse(text).redirect_uris, token_endpoint_auth_method: 'none' }, 201);
    }
    if (url.pathname === '/authorize') {
      const code = `code-${++codes}`;
      pending.set(code, Object.fromEntries(url.searchParams));
      res.writeHead(200).end(code);
      return true;
    }
    if (url.pathname === '/token') {
      const form = new URLSearchParams(text);
      let token;
      if (form.get('grant_type') === 'authorization_code') {
        const request = pending.get(form.get('code'));
        const challenge = oauth.base64url(createHash('sha256').update(form.get('code_verifier') ?? '').digest());
        if (!request || request.code_challenge !== challenge || request.redirect_uri !== form.get('redirect_uri')
          || request.client_id !== form.get('client_id') || form.get('resource') !== request.resource) return json200(res, { error: 'invalid_grant' }, 400);
        pending.delete(form.get('code'));
        token = `access-${codes}`;
      } else {
        refreshes++;
        lastRefresh = form.get('refresh_token');
        token = `refreshed-${refreshes}`;
      }
      issued.add(token);
      return json200(res, { access_token: token, token_type: 'Bearer', expires_in: 3600, refresh_token: `refresh-${token}` });
    }
    if (url.pathname === '/mcp' || url.pathname === '/plugin') {
      const auth = req.headers.authorization?.replace(/^Bearer /, '');
      if (!auth || !issued.has(auth)) {
        res.writeHead(401, { 'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource${url.pathname}"` }).end();
        return true;
      }
    }
    return false;
  });
  origin = await listen(t, http);
  const authorizeVia = async start => {
    const authorize = new URL(start.url);
    const code = await (await fetch(start.url)).text();
    const redirect = new URL(authorize.searchParams.get('redirect_uri'));
    assert.equal(redirect.hostname, '127.0.0.1');
    const callback = await fetch(`${redirect.href}?code=${code}&state=${authorize.searchParams.get('state')}&iss=${encodeURIComponent(origin)}`);
    assert.equal(callback.status, 200, await callback.text());
    return authorize;
  };
  const foreign = { id: 'needs-oauth', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'pluginoauth', transport: 'streamable-http', url: `${origin}/plugin` } };
  const h = await harness(t, { rows: [foreign] });
  await h.action({ action: 'save', text: JSON.stringify({ mcpServers: { secured: { type: 'http', url: `${origin}/mcp` } } }) });
  const unauthorized = await eventually(async () => { const row = await h.server('secured'); return row?.state === 'failed' && row; });
  assert.deepEqual([unauthorized.reason, unauthorized.oauth.eligible], ['unauthorized', true]);

  const start = await h.action({ action: 'oauthStart', kind: 'custom', name: 'secured' });
  assert.equal(start.ok, true, JSON.stringify(start));
  const pendingRow = await h.server('secured');
  assert.equal(pendingRow.oauth.pending, true);
  const authorize = new URL(start.url);
  assert.equal(`${authorize.origin}${authorize.pathname}`, `${origin}/authorize`);
  assert.deepEqual(['code_challenge_method', 'resource', 'scope', 'client_id'].map(key => authorize.searchParams.get(key)), ['S256', `${origin}/mcp`, 'tools', 'client-1']);
  const forged = await fetch(`${authorize.searchParams.get('redirect_uri')}?code=x&state=wrong`);
  assert.equal(forged.status, 400, 'a mismatched state is rejected');
  await authorizeVia(start);
  const authorized = await eventually(async () => { const row = await h.server('secured'); return row?.state === 'connected' && row; }, 'OAuth must reconnect the server');
  assert.deepEqual([authorized.oauth.authorized, authorized.tools, registrations], [true, 1, 1]);
  assert.ok(requests.some(request => request.path === '/mcp' && request.auth === 'Bearer access-1'));
  const [key] = [...h.ctx.credentials.records.keys()];
  assert.match(key, /^dsh-custom-json-mcp\/custom-[0-9a-f]{24}$/);
  assert.equal(h.ctx.credentials.records.get(key).payload.accessToken, 'access-1');
  assert.doesNotMatch(JSON.stringify(h.saved.get(entry.id)), /access-1/, 'tokens never enter the profile patch');
  assert.doesNotMatch(JSON.stringify(await h.state()), /access-1|refresh-access/, 'tokens never reach the page');

  // An expired grant refreshes before reconnecting.
  await h.ctx.credentials.modifyRecord(key, record => ({ ...record, payload: { ...record.payload, expiresAt: Date.now() - 1000 } }));
  await eventually(async () => refreshes === 1 && (await h.server('secured')).state === 'connected', 'expired grant must refresh');
  assert.equal(lastRefresh, 'refresh-access-1');
  assert.equal(h.ctx.credentials.records.get(key).payload.accessToken, 'refreshed-1');

  // Plugin-registered HTTP servers receive the token without any change to their own configuration.
  const before = await eventually(async () => (await h.state()).plugins.find(row => row.name === 'pluginoauth' && row.state === 'failed'), 'plugin server starts unauthorized');
  assert.deepEqual([before.reason, before.oauth.eligible], ['unauthorized', true]);
  const pluginStart = await h.action({ action: 'oauthStart', kind: 'plugin', name: 'pluginoauth' });
  assert.equal(new URL(pluginStart.url).searchParams.get('resource'), `${origin}/plugin`);
  await authorizeVia(pluginStart);
  let lastPlugins;
  const pluginRow = await eventually(async () => { lastPlugins = (await h.state()).plugins; return lastPlugins.find(row => row.name === 'pluginoauth' && row.state === 'connected'); }, 'plugin server must reconnect with the token', 8000)
    .catch(error => { error.message += `\n${JSON.stringify(lastPlugins)}\n${JSON.stringify(requests.slice(-6))}`; throw error; });
  assert.deepEqual([pluginRow.tools, pluginRow.oauth.authorized], [1, true]);
  assert.ok(h.tools().includes('mcp__pluginoauth__lookup'));
  assert.equal(h.rows.find(row => row.id === 'needs-oauth').config.headers, undefined, 'the plugin row is never edited');
  assert.equal(h.ctx.loader.resolve('needs-oauth').options.config.headers, undefined, 'the Loader entry keeps its original config');

  assert.deepEqual(await h.action({ action: 'oauthRevoke', kind: 'plugin', name: 'pluginoauth' }), { ok: true });
  await eventually(async () => (await h.state()).plugins.find(row => row.name === 'pluginoauth')?.state === 'failed', 'revoking restores the original unauthenticated behaviour');
  assert.deepEqual(await h.action({ action: 'oauthRevoke', kind: 'custom', name: 'secured' }), { ok: true });
  assert.equal(h.ctx.credentials.records.size, 0);
  await eventually(async () => (await h.server('secured')).state === 'failed', 'revoking drops the custom token');
});

test('OAuth helpers reject insecure endpoints and parse challenges', () => {
  assert.throws(() => oauth.secureUrl('http://auth.example/token', 'token_endpoint'), /HTTPS/);
  assert.equal(oauth.secureUrl('http://127.0.0.1:9/token', 'token_endpoint').port, '9');
  assert.equal(oauth.canonicalResource('https://h.example/mcp#frag'), 'https://h.example/mcp');
  assert.deepEqual(oauth.parseChallenge('Bearer error="invalid_token", resource_metadata="https://h/.well-known/x", scope="a b"'),
    { error: 'invalid_token', resource_metadata: 'https://h/.well-known/x', scope: 'a b' });
  const { verifier, challenge } = oauth.createPkce();
  assert.equal(challenge, oauth.base64url(createHash('sha256').update(verifier).digest()));
});
const fakeReact = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  Fragment: 'Fragment',
  useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useMemo: compute => compute(),
  useRef: current => ({ current }),
};

function client() {
  let descriptor;
  vm.runInNewContext(read('lib/client.js').toString(), { URL, window: { __ModuleLoader__: { load(value) { descriptor = value; } } } });
  return descriptor.factory(name => { assert.equal(name, 'react', 'the client loads no Harness Client package as a module'); return fakeReact; });
}

/** Render function components with first-render hook values into plain host-element trees. */
function render(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return [];
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) return node.flatMap(render);
  if (typeof node.type === 'function') return render(node.type({ ...node.props, children: node.children }));
  if (node.type === 'Fragment') return node.children.flatMap(render);
  return [{ type: node.type, props: node.props, children: node.children.flatMap(render) }];
}
const textOf = nodes => nodes.map(node => typeof node === 'string' ? node : textOf(node.children)).join('');
const findAll = (nodes, match) => nodes.flatMap(node => typeof node === 'string' ? [] : [...(match(node) ? [node] : []), ...findAll(node.children, match)]);

test('browser half registers the sidebar entry and main page through real Cordis', async t => {
  const ctx = new Context(), registrations = [], dictionaries = [];
  ctx.provide('slots', { inject: (_, fn) => fn(), register: (options, component) => { registrations.push({ options, component }); return () => {}; } });
  ctx.provide('locale', { register: (ns, dicts) => { dictionaries.push([ns, dicts]); return () => {}; }, bind: () => key => key });
  t.after(() => ctx.fiber.dispose());
  const factory = client();
  await ctx.plugin(factory).await();
  assert.deepEqual(registrations.map(item => [item.options.name, item.options.id ?? item.options.key]), [['sidebar.panellist', id], ['main', id]]);
  assert.equal(registrations[0].options.label(), '连接器', 'unknown host keys fall back to the bundled dictionary');
  const icon = render(fakeReact.createElement(registrations[0].component, { size: 16, active: false }));
  assert.deepEqual([icon[0].type, icon[0].props.width, icon[0].props.fill], ['svg', 16, 'currentColor']);
  const { zh, en } = dictionaries[0][1];
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort(), 'both dictionaries define the same keys');
  assert.equal(dictionaries[0][0], 'dshCustomJsonMcp');
  const source = read('lib/client.js').toString();
  assert.match(source, /\.cjm-dot\[data-state=error\]\{[^}]*animation:cjm-blink/, 'failed servers show a blinking red dot');
  assert.match(source, /prefers-reduced-motion:reduce\)\{\.cjm-dot/, 'the blink respects reduced motion');
  assert.doesNotMatch(source, /require\('@deepseek-ai\//, 'host packages are never loaded as modules');
});

test('connectors page shows the two groups, row status, failure callout and plugin OAuth only', () => {
  const { testing } = client();
  const t = testing.translatorFrom(undefined);
  const state = {
    version: 1, writable: true,
    custom: [
      { name: 'files', transport: 'stdio', enabled: true, summary: 'npx -y server', state: 'connected', tools: 7, oauth: { eligible: false } },
      { name: 'broken', transport: 'stdio', enabled: true, summary: 'nope', state: 'failed', tools: 0, reason: 'command', error: 'spawn nope ENOENT', oauth: { eligible: false } },
      { name: 'off', transport: 'streamable-http', enabled: false, summary: 'https://h/mcp', state: 'disabled', tools: 0, oauth: { eligible: true } },
    ],
    plugins: [
      { name: 'remote', transport: 'streamable-http', entry: 'x', module: 'dsh-x', summary: 'https://r/mcp', state: 'failed', tools: 0, reason: 'unauthorized', oauth: { eligible: true, authorized: false } },
      { name: 'local', transport: 'stdio', entry: 'y', module: 'dsh-y', summary: 'node', state: 'connected', tools: 2, oauth: { eligible: false } },
    ],
  };
  const tree = render(fakeReact.createElement(testing.ListView, { t, state, busy: false, run: () => {}, onAdd: () => {}, onEdit: () => {}, now: Date.now(), confirming: null, setConfirming: () => {} }));
  const all = textOf(tree);
  for (const text of ['添加 MCP 服务器', '自定义 MCP 服务器', '插件注册的 MCP 服务器']) assert.ok(all.includes(text), text);
  const row = name => findAll(tree, node => node.type === 'li' && node.props['data-server'] === name)[0];
  const dots = name => findAll([row(name)], node => node.props.className === 'cjm-dot').map(node => node.props['data-state']);
  assert.deepEqual(dots('files'), ['done']);
  assert.ok(textOf([row('files')]).includes('7 个工具'));
  assert.deepEqual(dots('broken'), ['error']);
  const callout = findAll([row('broken')], node => node.props.className === 'cjm-callout');
  assert.equal(callout.length, 1, 'a failed server shows one warning callout');
  assert.ok(textOf(callout).includes('找不到要运行的命令') && textOf(callout).includes('spawn nope ENOENT'));
  assert.equal(findAll([row('files')], node => node.props.className === 'cjm-callout').length, 0);
  const switches = name => findAll([row(name)], node => node.props.role === 'switch').map(node => node.props['aria-checked']);
  assert.deepEqual([switches('files'), switches('off')], [['true'], ['false']]);
  for (const name of ['files', 'broken', 'off']) {
    const labels = findAll([row(name)], node => node.type === 'button').map(node => node.props['aria-label']).filter(Boolean);
    assert.deepEqual(labels, [`编辑 ${name}`, `重新连接 ${name}`, `删除 ${name}`, `启用 ${name}`]);
  }
  assert.equal(findAll([row('off')], node => textOf([node]) === 'OAuth 授权').length, 0, 'custom rows offer OAuth only when needed');
  const pluginButtons = findAll([row('remote')], node => node.type === 'button').map(node => textOf([node]));
  assert.deepEqual(pluginButtons, ['OAuth 授权'], 'plugin servers expose only OAuth');
  assert.equal(findAll([row('local')], node => node.type === 'button').length, 0);
  assert.equal(findAll([row('remote'), row('local')], node => node.props.role === 'switch').length, 0);
  // Each group's rows sit on one shared panel, and the page carries no explanatory hint text.
  const panels = findAll(tree, node => node.props.className === 'cjm-panel');
  assert.equal(panels.length, 2);
  assert.deepEqual(panels.map(panel => findAll([panel], node => node.type === 'li').length), [3, 2]);
  assert.ok(!all.includes('由所属插件管理配置'));

  const props = { t, busy: false, run: () => {}, onAdd: () => {}, onEdit: () => {}, now: 0, confirming: null, setConfirming: () => {} };
  const empty = render(fakeReact.createElement(testing.ListView, { ...props, state: { version: 1, writable: true, custom: [], plugins: [] } }));
  const emptyPanels = findAll(empty, node => node.props.className === 'cjm-panel');
  assert.deepEqual(emptyPanels.map(panel => textOf([panel])), ['当前暂无自定义 MCP 连接', '当前暂无插件注册了 MCP 连接'], 'empty groups keep their panel');
  assert.deepEqual(findAll(empty, node => node.props.role === 'status' || node.props.role === 'alert'), [], 'no notice without a failed action');
  const failed = render(fakeReact.createElement(testing.ListView, { ...props, failure: '操作失败：boom', state: { version: 1, writable: true, custom: [], plugins: [] } }));
  assert.deepEqual(findAll(failed, node => node.props.role === 'alert').map(node => textOf([node])), ['操作失败：boom']);
  const en = testing.translatorFrom(key => testing.DICTIONARIES.en[key] ?? key);
  assert.deepEqual(findAll(render(fakeReact.createElement(testing.ListView, { ...props, t: en, state: { version: 1, writable: true, custom: [], plugins: [] } })),
    node => node.props.className === 'cjm-panel').map(panel => textOf([panel])), ['No custom MCP connections yet', 'No plugin has registered an MCP connection yet']);

  const readOnly = render(fakeReact.createElement(testing.ListView, { t, state: { ...state, writable: false }, busy: false, run: () => {}, onAdd: () => {}, onEdit: () => {}, now: 0, confirming: null, setConfirming: () => {} }));
  assert.equal(findAll(readOnly, node => node.type === 'button' && textOf([node]).includes('添加 MCP 服务器'))[0].props.disabled, true);
  const confirm = render(fakeReact.createElement(testing.CustomRow, { t, server: state.custom[0], writable: true, busy: false, run: () => {}, onEdit: () => {}, confirming: 'files', setConfirming: () => {}, now: 0 }));
  assert.ok(findAll(confirm, node => node.type === 'button' && textOf([node]) === '确认删除').length === 1, 'deleting asks for confirmation');

  const editor = render(fakeReact.createElement(testing.EditorView, { t, mode: 'edit', target: 'files', state: { custom: [{ name: 'files', definition: { command: 'npx' } }] }, onDone: () => {}, onCancel: () => {} }));
  assert.equal(findAll(editor, node => node.type === 'textarea')[0].props.value, JSON.stringify({ mcpServers: { files: { command: 'npx' } } }, null, 2));
  assert.equal(findAll(editor, node => node.type === 'button' && textOf([node]) === '保存并连接')[0].props.disabled, true, 'saving waits for a clean preview');
  // Page-level callouts span the text column exactly: no row indent, and padding inside the box width.
  assert.deepEqual(findAll(editor, node => /(^| )cjm-callout( |$)/.test(String(node.props.className))).map(node => node.props.className), ['cjm-callout cjm-flush']);
  const css = read('lib/client.js').toString();
  assert.match(css, /\.cjm-callout\{box-sizing:border-box;/);
  assert.match(css, /\.cjm-callout\.cjm-flush\{margin:0\}/);
  assert.match(css, /\.cjm-page>\*\{box-sizing:border-box;width:100%;max-width:960px\}/);

  const view = server => JSON.parse(JSON.stringify(testing.statusView(t, server)));
  assert.deepEqual(view({ state: 'connected', tools: 3 }), { dot: 'done', text: '3 个工具' });
  assert.deepEqual(view({ state: 'failed' }), { dot: 'error', text: '连接失败', callout: true });
  assert.deepEqual(view({ state: 'reconnecting' }), { dot: 'warning', text: '连接中断，正在重连…', callout: true });
  assert.match(testing.reasonText(t, { reason: 'missing', missing: ['A', 'B'] }), /A, B/);
  for (const code of ['sse', 'input', 'exists', 'conflict', 'plaintext', 'ignored']) assert.notEqual(testing.issueText(t, { code, server: 's', fields: ['x'] }), `issue.${code}`);
  assert.equal(testing.errorText(t, { code: 'never-seen', details: { message: 'boom' } }), '操作失败：boom');
  assert.equal(testing.hasBlockingIssues({ errors: [], servers: [{ errors: [] }] }), false);
  assert.equal(testing.hasBlockingIssues({ errors: [], servers: [] }), true);
});