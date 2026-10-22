/** Browser half: sidebar "Connectors" entry and the main connectors page. Talks to this plugin's Host routes only. */
window.__ModuleLoader__.load({
  id: 'dsh-custom-json-mcp',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'dshCustomJsonMcp';
    const PANEL_ID = 'dsh-custom-json-mcp';
    const STATE_URL = 'api/dsh-custom-json-mcp.state';
    const ACTION_URL = 'api/dsh-custom-json-mcp.action';
    // Boxicons "bx-mcp" path data (MIT, Copyright (c) 2026 Boxicons); see the package's upstream.json.
    const ICON_PATHS = [
      'm19.97,11.84c.66-.66,1.02-1.53,1.02-2.46s-.36-1.8-1.02-2.46l-.04-.04c-.66-.66-1.53-1.02-2.46-1.02-.17,0-.34.03-.51.05.02-.17.05-.33.05-.51,0-.93-.36-1.8-1.02-2.46-.66-.66-1.53-1.02-2.46-1.02s-1.8.36-2.46,1.02l-7.87,7.87c-.27.27-.27.71,0,.98s.71.27.98,0l7.87-7.87c.39-.39.92-.61,1.47-.61s1.08.22,1.47.61c.39.39.61.92.61,1.48s-.22,1.08-.61,1.48l-5.86,5.86-.08.08c-.27.27-.27.71,0,.98.14.14.31.2.49.2s.36-.07.49-.2l5.94-5.94c.39-.39.92-.61,1.48-.61s1.08.22,1.47.61l.04.04c.39.39.61.92.61,1.47s-.22,1.08-.61,1.48l-7.11,7.11c-.63.63-.63,1.66,0,2.29l1.46,1.46c.14.14.31.2.49.2s.36-.07.49-.2c.27-.27.27-.71,0-.98l-1.46-1.46c-.09-.09-.09-.24,0-.33l7.11-7.11Z',
      'm17.96,9.83c.27-.27.27-.71,0-.98-.27-.27-.71-.27-.98,0l-5.82,5.82c-.81.81-2.14.81-2.95,0-.81-.81-.81-2.14,0-2.95l5.82-5.82c.27-.27.27-.71,0-.98-.27-.27-.71-.27-.98,0l-5.82,5.82c-1.36,1.36-1.36,3.56,0,4.92.68.68,1.57,1.02,2.46,1.02s1.78-.34,2.46-1.02l5.82-5.82Z',
    ];
    const EXAMPLE_STDIO = '{\n  "mcpServers": {\n    "filesystem": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:/Users/me/Documents"]\n    }\n  }\n}';
    const EXAMPLE_HTTP = '{\n  "mcpServers": {\n    "remote": {\n      "type": "http",\n      "url": "https://example.com/mcp",\n      "headers": { "Authorization": "Bearer ${MY_MCP_TOKEN}" }\n    }\n  }\n}';
    const ENVIRONMENT_SOURCES = ['env', 'project-env', 'user-env'];

    const zh = {
      nav: '连接器',
      title: '连接器',
      intro: '粘贴标准 MCP JSON 配置，随时添加、停用或删除 MCP 服务器。',
      add: '添加 MCP 服务器',
      customTitle: '自定义 MCP 服务器',
      customEmpty: '当前暂无自定义 MCP 连接',
      pluginTitle: '插件注册的 MCP 服务器',
      pluginEmpty: '当前暂无插件注册了 MCP 连接',
      fromPlugin: '来自 {module}',
      loading: '正在读取连接器…',
      loadFailed: '读取连接器状态失败：{message}',
      retry: '重试',
      readOnly: 'DSH 设置服务暂不可用，当前只能查看。请确认插件已启用后刷新页面。',
      statusConnected: '{count} 个工具',
      statusConnecting: '正在连接…',
      statusReconnecting: '连接中断，正在重连…',
      statusFailed: '连接失败',
      statusDisabled: '已停用',
      retryAt: '将在 {seconds} 秒后自动重试。',
      enable: '启用 {name}',
      edit: '编辑 {name}',
      reconnect: '重新连接 {name}',
      remove: '删除 {name}',
      confirmRemove: '确认删除',
      oauthAuthorize: 'OAuth 授权',
      oauthReauthorize: '重新授权',
      oauthPending: '请在浏览器中完成授权…',
      oauthOpen: '打开授权页面',
      oauthCopy: '复制链接',
      oauthCopied: '已复制',
      oauthCancel: '取消',
      oauthAuthorized: '已授权',
      oauthRevoke: '撤销授权',
      oauthExpires: '有效期至 {time}',
      oauthNeeded: '该服务器需要身份验证。',
      oauthFailed: '授权失败：{message}',
      back: '连接器',
      addTitle: '添加 MCP 服务器',
      editTitle: '编辑 {name}',
      editorHelp: '粘贴 MCP 服务器 JSON。支持 Claude Desktop / Cursor / Windsurf 的 mcpServers、Claude Code 的 .mcp.json 与 VS Code 的 servers 格式，可一次添加多个服务器。',
      editHelp: '保存后立即重新连接。已存入凭据库的密钥以 ${名称} 引用显示，不会回显原值。',
      exampleStdio: '本地命令示例',
      exampleHttp: '远程 HTTP 示例',
      jsonLabel: 'MCP JSON 配置',
      previewTitle: '解析结果',
      previewEmpty: '输入 JSON 后在此显示将要保存的服务器。',
      previewing: '正在解析…',
      secretsMoved: '以下明文将存入 DSH 凭据库，配置中只保存引用：{refs}',
      refConfigured: '{ref}：已配置（{source}）',
      refProvided: '{ref}：将保存新值',
      refMissing: '{ref}：未配置，请填写',
      refLabel: '{ref} 的值',
      refPlaceholder: '填写后存入 DSH 凭据库',
      refFixed: '{ref}：由启动环境提供，无法在此修改',
      security: 'stdio 服务器会以你的用户权限在本机运行所填命令，请只添加可信来源的服务器。密钥、令牌等字段会自动存入 DSH 凭据库。',
      save: '保存并连接',
      saving: '正在保存…',
      cancel: '取消',
      transportStdio: '本地命令',
      transportHttp: 'HTTP',
      sourceFile: 'DSH 凭据库',
      sourceEnv: '环境变量',
      reasonMissing: '缺少凭据：{refs}。请编辑该服务器填写，或在启动 DSH 的环境中设置同名变量后重新连接。',
      reasonConfig: '配置无效，请编辑后重新保存。',
      reasonCommand: '找不到要运行的命令。请确认已安装该程序且位于 PATH 中（npx 需要 Node.js，uvx 需要 uv），或改用程序的绝对路径。',
      reasonUnauthorized: '服务器拒绝了身份验证（401）。请检查令牌，或进行 OAuth 授权。',
      reasonForbidden: '服务器拒绝访问（403）。请确认账号或令牌具备所需权限。',
      reasonNetwork: '无法连接到服务器。请检查地址、网络或代理设置。',
      reasonTls: 'TLS 证书校验失败。请确认服务器证书有效。',
      reasonTimeout: '连接超时。服务器可能仍在启动，可稍后重新连接。',
      reasonEndpoint: '该地址不是 Streamable HTTP MCP 端点（不支持 SSE 端点）。',
      reasonExited: '服务器进程已退出或关闭了连接。请在终端中手动运行该命令查看错误输出。',
      reasonDuplicate: '已有同名 MCP 服务器，请更换名称。',
      reasonBridge: '无法加载 DSH 官方 MCP 客户端。',
      reasonUnknown: '连接失败，请检查配置后重新连接。',
      'issue.empty': '请输入 JSON。',
      'issue.json': 'JSON 格式错误：{value}',
      'issue.root': '未找到 mcpServers、servers 或服务器映射。',
      'issue.unnamed': '缺少服务器名称。请写成 {"mcpServers": {"名称": {...}}}。',
      'issue.noServers': '没有任何服务器。',
      'issue.inputs': '不支持 VS Code 的 inputs 提示，请把 ${input:…} 改为 ${变量名} 并在下方填写。',
      'issue.name': '名称 {server} 无效：只能包含字母、数字、- 和 _，最多 32 个字符。',
      'issue.serverObject': '{server} 的配置必须是对象。',
      'issue.boolean': '{server}：{field} 必须是 true 或 false。',
      'issue.transportMissing': '{server}：缺少 command 或 url。',
      'issue.sse': '{server}：不支持 SSE 传输。请改用 Streamable HTTP（type: "http"）地址，或通过 mcp-remote 以本地命令连接。',
      'issue.type': '{server}：不支持的传输类型 {value}。',
      'issue.envFile': '{server}：不支持 envFile，请把变量写入 env。',
      'issue.ignored': '{server}：以下字段将被忽略：{fields}',
      'issue.timeout': '{server}：toolCallTimeoutMs 须为 1000–3600000 之间的整数。',
      'issue.command': '{server}：command 不能为空。',
      'issue.stringArray': '{server}：{field} 必须是字符串数组。',
      'issue.stringMap': '{server}：{field} 必须是字符串键值对象。',
      'issue.string': '{server}：{field} 必须是字符串。',
      'issue.url': '{server}：url 必须是有效的 http(s) 地址。',
      'issue.urlCredentials': '{server}：url 不能包含用户名或密码，请改用 headers。',
      'issue.oauth': '{server}：oauth 必须是对象。',
      'issue.callbackPort': '{server}：oauth.callbackPort 须为 1024–65535 的整数。',
      'issue.input': '{server}：不支持 {value}，请改为 ${变量名}。',
      'issue.vscodeVariable': '{server}：不支持 VS Code 变量 {value}。',
      'issue.variable': '{server}：无效的占位符 {value}，名称只能包含字母、数字和下划线。',
      'issue.plaintext': '{server}：{fields} 疑似明文密钥，但字段名未被识别；建议改为 ${变量名} 引用。',
      'issue.exists': '已存在名为 {server} 的服务器。请换一个名称，或编辑原服务器。',
      'issue.conflict': '{server} 已被插件 {value} 使用，请换一个名称。',
      'issue.notFound': '找不到服务器 {server}，它可能已被删除。',
      'issue.editSingle': '编辑时只能包含一个服务器。',
      'error.settings': 'DSH 设置服务暂不可用，请刷新页面后重试。',
      'error.conflict': '配置已在别处修改，请刷新后重试。',
      'error.write': '保存配置失败：{message}',
      'error.invalid': '配置有误，请根据提示修改。',
      'error.unwritable': '凭据 {ref} 不可写入（可能由启动环境提供）。',
      'error.notFound': '找不到该服务器，请刷新页面。',
      'error.oauthUnsupported': '只有 HTTP 服务器支持 OAuth 授权。',
      'error.missing': '缺少凭据：{refs}。',
      'error.config': '配置无效。',
      'error.discovery': '该服务器未提供 OAuth 授权信息：{message}',
      'error.insecure': '授权服务器必须使用 HTTPS：{message}',
      'error.metadata': '授权服务器信息无效：{message}',
      'error.no-client': '授权服务器不支持动态注册客户端。请在 JSON 的 oauth.clientId 中填写预先注册的客户端 ID。',
      'error.registration': '注册 OAuth 客户端失败：{message}',
      'error.port': '无法监听授权回调端口：{message}',
      'error.token': '获取令牌失败：{message}',
      'error.issuer': '授权服务器身份不匹配。',
      'error.authorization': '{message}',
      'error.denied': '授权已被拒绝。',
      'error.timeout': '授权超时，请重新开始。',
      'error.network': '无法连接到 DSH：{message}',
      'error.internal': '操作失败：{message}',
      'error.unknown': '操作失败：{message}',
    };
    const en = {
      nav: 'Connectors',
      title: 'Connectors',
      intro: 'Paste standard MCP JSON to add, disable or remove MCP servers at any time.',
      add: 'Add MCP server',
      customTitle: 'Custom MCP servers',
      customEmpty: 'No custom MCP connections yet',
      pluginTitle: 'MCP servers from plugins',
      pluginEmpty: 'No plugin has registered an MCP connection yet',
      fromPlugin: 'From {module}',
      loading: 'Loading connectors…',
      loadFailed: 'Could not read connector status: {message}',
      retry: 'Retry',
      readOnly: 'DSH settings are unavailable, so this page is read-only. Make sure the plugin is enabled, then reload the page.',
      statusConnected: '{count} tools',
      statusConnecting: 'Connecting…',
      statusReconnecting: 'Connection lost, reconnecting…',
      statusFailed: 'Connection failed',
      statusDisabled: 'Disabled',
      retryAt: 'Retrying automatically in {seconds}s.',
      enable: 'Enable {name}',
      edit: 'Edit {name}',
      reconnect: 'Reconnect {name}',
      remove: 'Delete {name}',
      confirmRemove: 'Confirm delete',
      oauthAuthorize: 'Authorize with OAuth',
      oauthReauthorize: 'Authorize again',
      oauthPending: 'Finish authorization in your browser…',
      oauthOpen: 'Open authorization page',
      oauthCopy: 'Copy link',
      oauthCopied: 'Copied',
      oauthCancel: 'Cancel',
      oauthAuthorized: 'Authorized',
      oauthRevoke: 'Revoke',
      oauthExpires: 'Valid until {time}',
      oauthNeeded: 'This server requires authentication.',
      oauthFailed: 'Authorization failed: {message}',
      back: 'Connectors',
      addTitle: 'Add MCP server',
      editTitle: 'Edit {name}',
      editorHelp: 'Paste MCP server JSON. Supports mcpServers from Claude Desktop / Cursor / Windsurf, Claude Code .mcp.json and VS Code servers. You can add several servers at once.',
      editHelp: 'Saving reconnects immediately. Secrets already in the credential store appear as ${NAME} references; their values are never shown.',
      exampleStdio: 'Local command example',
      exampleHttp: 'Remote HTTP example',
      jsonLabel: 'MCP JSON configuration',
      previewTitle: 'Result',
      previewEmpty: 'Servers to be saved appear here once you enter JSON.',
      previewing: 'Parsing…',
      secretsMoved: 'These literal values will be stored in DSH credentials; the configuration keeps references only: {refs}',
      refConfigured: '{ref}: configured ({source})',
      refProvided: '{ref}: a new value will be saved',
      refMissing: '{ref}: not configured — enter a value',
      refLabel: 'Value for {ref}',
      refPlaceholder: 'Stored in DSH credentials',
      refFixed: '{ref}: provided by the launch environment and cannot be changed here',
      security: 'stdio servers run the given command on this computer with your user permissions. Only add servers you trust. Keys, tokens and similar fields are moved into DSH credentials automatically.',
      save: 'Save and connect',
      saving: 'Saving…',
      cancel: 'Cancel',
      transportStdio: 'Local command',
      transportHttp: 'HTTP',
      sourceFile: 'DSH credentials',
      sourceEnv: 'environment',
      reasonMissing: 'Missing credentials: {refs}. Edit the server to enter them, or set variables with these names in the environment that launches DSH, then reconnect.',
      reasonConfig: 'The configuration is invalid. Edit and save it again.',
      reasonCommand: 'The command was not found. Make sure the program is installed and on PATH (npx needs Node.js, uvx needs uv), or use its absolute path.',
      reasonUnauthorized: 'The server rejected authentication (401). Check the token, or authorize with OAuth.',
      reasonForbidden: 'The server denied access (403). Make sure the account or token has the required permissions.',
      reasonNetwork: 'Could not reach the server. Check the URL, network or proxy settings.',
      reasonTls: 'TLS certificate verification failed. Make sure the server certificate is valid.',
      reasonTimeout: 'The connection timed out. The server may still be starting; reconnect later.',
      reasonEndpoint: 'This URL is not a Streamable HTTP MCP endpoint (SSE endpoints are not supported).',
      reasonExited: 'The server process exited or closed the connection. Run the command in a terminal to see its error output.',
      reasonDuplicate: 'Another MCP server already uses this name. Choose a different name.',
      reasonBridge: 'The official DSH MCP client could not be loaded.',
      reasonUnknown: 'Connection failed. Check the configuration and reconnect.',
      'issue.empty': 'Enter JSON.',
      'issue.json': 'Invalid JSON: {value}',
      'issue.root': 'No mcpServers, servers or server map was found.',
      'issue.unnamed': 'The server has no name. Use {"mcpServers": {"name": {...}}}.',
      'issue.noServers': 'There are no servers.',
      'issue.inputs': 'VS Code inputs prompts are not supported. Replace ${input:…} with ${NAME} and enter the value below.',
      'issue.name': 'Invalid name {server}: use letters, digits, - and _, at most 32 characters.',
      'issue.serverObject': 'The configuration of {server} must be an object.',
      'issue.boolean': '{server}: {field} must be true or false.',
      'issue.transportMissing': '{server}: command or url is missing.',
      'issue.sse': '{server}: the SSE transport is not supported. Use a Streamable HTTP endpoint (type: "http") or connect through mcp-remote as a local command.',
      'issue.type': '{server}: unsupported transport {value}.',
      'issue.envFile': '{server}: envFile is not supported; put variables in env.',
      'issue.ignored': '{server}: these fields will be ignored: {fields}',
      'issue.timeout': '{server}: toolCallTimeoutMs must be an integer from 1000 to 3600000.',
      'issue.command': '{server}: command must not be empty.',
      'issue.stringArray': '{server}: {field} must be an array of strings.',
      'issue.stringMap': '{server}: {field} must be an object of string values.',
      'issue.string': '{server}: {field} must be a string.',
      'issue.url': '{server}: url must be a valid http(s) URL.',
      'issue.urlCredentials': '{server}: url must not contain a user name or password; use headers instead.',
      'issue.oauth': '{server}: oauth must be an object.',
      'issue.callbackPort': '{server}: oauth.callbackPort must be an integer from 1024 to 65535.',
      'issue.input': '{server}: {value} is not supported; use ${NAME} instead.',
      'issue.vscodeVariable': '{server}: the VS Code variable {value} is not supported.',
      'issue.variable': '{server}: invalid placeholder {value}; names may contain letters, digits and underscores only.',
      'issue.plaintext': '{server}: {fields} look like literal secrets under unrecognized names; consider ${NAME} references.',
      'issue.exists': 'A server named {server} already exists. Choose another name or edit the existing server.',
      'issue.conflict': '{server} is already used by plugin {value}. Choose another name.',
      'issue.notFound': 'Server {server} was not found; it may have been deleted.',
      'issue.editSingle': 'An edit must contain exactly one server.',
      'error.settings': 'DSH settings are unavailable. Reload the page and try again.',
      'error.conflict': 'The configuration changed elsewhere. Reload and try again.',
      'error.write': 'Could not save the configuration: {message}',
      'error.invalid': 'The configuration has errors. Fix them as indicated.',
      'error.unwritable': 'Credential {ref} cannot be written (it may come from the launch environment).',
      'error.notFound': 'The server was not found. Reload the page.',
      'error.oauthUnsupported': 'Only HTTP servers support OAuth authorization.',
      'error.missing': 'Missing credentials: {refs}.',
      'error.config': 'The configuration is invalid.',
      'error.discovery': 'The server does not provide OAuth authorization information: {message}',
      'error.insecure': 'The authorization server must use HTTPS: {message}',
      'error.metadata': 'Invalid authorization server information: {message}',
      'error.no-client': 'The authorization server does not support dynamic client registration. Put a pre-registered client ID in oauth.clientId in the JSON.',
      'error.registration': 'Could not register the OAuth client: {message}',
      'error.port': 'Could not listen on the authorization callback port: {message}',
      'error.token': 'Could not obtain a token: {message}',
      'error.issuer': 'The authorization server identity does not match.',
      'error.authorization': '{message}',
      'error.denied': 'Authorization was denied.',
      'error.timeout': 'Authorization timed out. Start again.',
      'error.network': 'Could not reach DSH: {message}',
      'error.internal': 'The operation failed: {message}',
      'error.unknown': 'The operation failed: {message}',
    };
    const DICTIONARIES = { zh, en };

    const format = (template, params) => String(template).replace(/\{(\w+)\}/g, (match, key) => params && params[key] !== undefined ? String(params[key]) : match);
    function fallbackTranslator() {
      const english = !String(globalThis.navigator?.language ?? 'zh').toLowerCase().startsWith('zh');
      return (key, params) => format((english ? en : zh)[key] ?? zh[key] ?? key, params);
    }
    /** Use the host translator when the slot provides one; a key it does not know falls back to the bundled text. */
    function translatorFrom(t) {
      const fallback = fallbackTranslator();
      if (typeof t !== 'function') return fallback;
      return (key, params) => {
        let value;
        try { value = t(key, params); } catch { value = undefined; }
        return typeof value === 'string' && value !== key ? value : fallback(key, params);
      };
    }

    class RequestError extends Error {
      constructor(code, details = {}) { super(code); this.code = code; this.details = details; }
    }
    async function readState(signal) {
      let response;
      try { response = await fetch(STATE_URL, { headers: { accept: 'application/json' }, cache: 'no-store', signal }); }
      catch (error) { if (signal?.aborted) throw error; throw new RequestError('network', { message: error?.message }); }
      if (!response.ok) throw new RequestError('network', { message: `HTTP ${response.status}` });
      return response.json();
    }
    async function act(body) {
      let response;
      try {
        response = await fetch(ACTION_URL, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
      } catch (error) { throw new RequestError('network', { message: error?.message }); }
      if (!response.ok) throw new RequestError('network', { message: `HTTP ${response.status}` });
      const value = await response.json();
      if (!value || value.ok !== true) throw new RequestError(value?.error?.code ?? 'unknown', value?.error ?? {});
      return value;
    }

    function issueText(t, issue) {
      return t(`issue.${issue.code}`, { ...issue, fields: Array.isArray(issue.fields) ? issue.fields.join(', ') : issue.fields });
    }
    function errorText(t, error) {
      const details = error?.details ?? {};
      const code = error?.code ?? 'unknown';
      const params = { message: details.message ?? '', ref: details.ref ?? '', refs: (details.refs ?? []).join(', ') };
      const key = `error.${code}`;
      const text = t(key, params);
      return text === key ? t('error.unknown', { message: details.message || code }) : text;
    }
    const REASON_KEYS = {
      missing: 'reasonMissing', config: 'reasonConfig', command: 'reasonCommand', unauthorized: 'reasonUnauthorized', forbidden: 'reasonForbidden',
      network: 'reasonNetwork', tls: 'reasonTls', timeout: 'reasonTimeout', endpoint: 'reasonEndpoint', exited: 'reasonExited',
      duplicate: 'reasonDuplicate', bridge: 'reasonBridge',
    };
    function reasonText(t, server) {
      return t(REASON_KEYS[server.reason] ?? 'reasonUnknown', { refs: (server.missing ?? []).join(', ') });
    }
    /** One server row's dot, status text and whether a warning callout applies. */
    function statusView(t, server) {
      switch (server.state) {
        case 'connected': return { dot: 'done', text: t('statusConnected', { count: server.tools ?? 0 }) };
        case 'reconnecting': return { dot: 'warning', text: t('statusReconnecting'), callout: true };
        case 'disabled': return { dot: 'idle', text: t('statusDisabled') };
        case 'failed': return { dot: 'error', text: t('statusFailed'), callout: true };
        default: return { dot: 'ongoing', text: t('statusConnecting') };
      }
    }
    /** Custom HTTP rows offer OAuth only when it is configured, needed, in progress or already granted. */
    function showsCustomOAuth(server) {
      const oauth = server.oauth ?? {};
      return Boolean(oauth.eligible && (server.oauthConfigured || oauth.authorized || oauth.pending || oauth.error || server.reason === 'unauthorized'));
    }
    function hasBlockingIssues(analysis) {
      return !analysis || analysis.errors.length > 0 || analysis.servers.length === 0 || analysis.servers.some(server => server.errors.length > 0);
    }
    function initialText(state, target) {
      const server = state?.custom.find(item => item.name === target);
      return server ? JSON.stringify({ mcpServers: { [server.name]: server.definition } }, null, 2) : '';
    }

    // Host page patterns (Plugin Manager page, Button, Switch and StateDot) copied under this plugin's prefix;
    // only --dsw-alias-* theme tokens are shared with the host.
    const FOCUS = 'outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px';
    const MONO = 'font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace)';
    const CSS = `
.cjm-page{box-sizing:border-box;height:100%;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;align-items:center;gap:32px;padding:0 clamp(24px,4vw,48px) 48px;overflow:auto}
.cjm-page>*{box-sizing:border-box;width:100%;max-width:960px}
.cjm-head{box-sizing:border-box;display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:16px;padding-top:28px}
[data-platform=darwin] .cjm-head{padding-top:calc(28px + var(--dsh-frame-top-clearance,0px))}
.cjm-heading{min-width:0;max-width:100%;display:flex;flex-direction:column}
.cjm-title{margin:0;font-size:20px;font-weight:500;line-height:28px}
.cjm-intro{margin:4px 0 0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.cjm-crumb{display:inline-flex;align-items:center;gap:6px;align-self:flex-start;margin:0 0 10px;padding:0;border:0;background:none;font:inherit;font-size:12.5px;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.cjm-crumb:hover{color:var(--dsw-alias-label-primary)}
.cjm-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:28px;padding:0 10px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;white-space:nowrap;cursor:pointer}
.cjm-btn:disabled{cursor:not-allowed;opacity:.4}
.cjm-outline{border:.5px solid var(--dsw-alias-border-l3)}
.cjm-outline:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.cjm-primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.cjm-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.cjm-btn-danger{color:var(--dsw-alias-state-error-primary);border:.5px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 30%,transparent)}
.cjm-btn-danger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger,var(--dsw-alias-interactive-bg-hover))}
.cjm-btn svg{flex:none}
.cjm-group{display:flex;flex-direction:column;gap:12px}
.cjm-group-title{margin:0;font-size:14px;font-weight:500;line-height:22px}
.cjm-panel{box-sizing:border-box;padding:0 20px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-xl);background:var(--dsw-alias-bg-layer-1)}
.cjm-panel>.cjm-empty{padding:18px 0}
.cjm-rows{display:flex;flex-direction:column;margin:0;padding:0;list-style:none}
.cjm-row{display:flex;flex-direction:column;gap:8px;padding:14px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.cjm-row:last-child{border-bottom:0}
.cjm-line{display:flex;align-items:center;gap:16px;min-width:0}
.cjm-icon-box{display:inline-flex;flex:none;align-items:center;justify-content:center;width:40px;height:40px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);color:var(--dsw-alias-label-secondary)}
.cjm-main{display:flex;flex:1;flex-direction:column;gap:2px;min-width:0}
.cjm-name-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0}
.cjm-name{font-size:13.5px;font-weight:500;line-height:20px;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.cjm-row[data-state=disabled] .cjm-name{color:var(--dsw-alias-label-secondary)}
.cjm-tag{display:inline-flex;align-items:center;height:18px;padding:0 7px;border:.5px solid var(--dsw-alias-border-l3);border-radius:999px;color:var(--dsw-alias-label-secondary);font-size:10px;line-height:1}
.cjm-tag-ok{color:var(--dsw-alias-state-success-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 40%,transparent)}
.cjm-summary{${MONO};font-size:11.5px;line-height:16px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cjm-state{display:inline-flex;flex:none;align-items:center;gap:6px;font-size:12.5px;line-height:18px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.cjm-row[data-state=failed] .cjm-state{color:var(--dsw-alias-state-error-primary)}
.cjm-dot{position:relative;display:inline-block;flex:none;width:12px;height:12px}
.cjm-dot::after{content:"";position:absolute;inset:20%;border-radius:50%;background:currentColor}
.cjm-dot[data-state=done]{color:var(--dsw-alias-state-success-primary)}
.cjm-dot[data-state=warning]{color:var(--dsw-alias-state-warn-primary);animation:cjm-blink 1.6s ease-in-out infinite}
.cjm-dot[data-state=error]{color:var(--dsw-alias-state-error-primary);animation:cjm-blink 1s ease-in-out infinite}
.cjm-dot[data-state=idle]{color:var(--dsw-alias-state-idle-primary,var(--dsw-alias-label-tertiary))}
.cjm-dot[data-state=ongoing]{color:var(--dsw-alias-label-tertiary)}
.cjm-dot[data-state=ongoing]::after{inset:8%;background:none;border:1.5px solid currentColor;border-right-color:transparent;animation:cjm-spin 1s linear infinite}
@keyframes cjm-blink{0%,100%{opacity:1}50%{opacity:.15}}
@keyframes cjm-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.cjm-dot,.cjm-dot::after{animation:none!important}}
.cjm-tools{display:flex;flex:none;align-items:center;gap:4px}
.cjm-icon{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-caption);cursor:pointer}
.cjm-icon:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.cjm-icon:disabled{opacity:.5;cursor:default}
.cjm-icon-danger{color:var(--dsw-alias-state-error-primary)}
.cjm-icon-danger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger,var(--dsw-alias-interactive-bg-hover));color:var(--dsw-alias-state-error-primary)}
.cjm-switch{box-sizing:border-box;position:relative;flex:0 0 auto;width:36px;height:20px;margin-left:8px;padding:2px;border:0;border-radius:999px;background:var(--dsw-alias-border-l3);cursor:pointer}
.cjm-switch[aria-checked=true]{background:var(--dsw-alias-brand-primary,var(--dsw-alias-state-business-primary))}
.cjm-switch:disabled{cursor:default;opacity:.5}
.cjm-thumb{display:block;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-primary-foreground);transition:transform .12s ease}
.cjm-switch[aria-checked=false] .cjm-thumb{background:var(--dsw-alias-switch-thumb)}
.cjm-switch[aria-checked=true] .cjm-thumb{transform:translate(16px)}
@media (prefers-reduced-motion:reduce){.cjm-thumb{transition:none}}
.cjm-btn:focus-visible,.cjm-icon:focus-visible,.cjm-switch:focus-visible,.cjm-crumb:focus-visible,.cjm-link:focus-visible,.cjm-textarea:focus-visible,.cjm-input:focus-visible{${FOCUS}}
.cjm-callout{box-sizing:border-box;display:flex;align-items:flex-start;gap:8px;margin:0 0 0 56px;padding:10px 12px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.cjm-callout.cjm-flush{margin:0}
.cjm-callout>svg{flex:none;margin-top:2px;color:var(--dsw-alias-state-warn-primary)}
.cjm-callout-body{display:flex;flex-direction:column;gap:4px;min-width:0}
.cjm-callout-title{color:var(--dsw-alias-label-primary)}
.cjm-detail{${MONO};font-size:11.5px;line-height:16px;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-tertiary);max-height:120px;overflow:auto}
.cjm-oauth{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-left:56px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.cjm-link{padding:0;border:0;background:none;font:inherit;color:var(--dsw-alias-link,var(--dsw-alias-state-business-primary));text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.cjm-empty,.cjm-status{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
.cjm-error{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere;white-space:pre-wrap}
.cjm-field{display:flex;flex-direction:column;gap:6px;font-size:12.5px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.cjm-textarea{box-sizing:border-box;width:100%;min-height:280px;resize:vertical;padding:12px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);${MONO};font-size:12.5px;line-height:19px;tab-size:2}
.cjm-input{box-sizing:border-box;width:100%;max-width:420px;height:32px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
.cjm-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.cjm-preview{display:flex;flex-direction:column;gap:8px}
.cjm-preview-item{display:flex;flex-direction:column;gap:6px;padding:12px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg)}
.cjm-messages{display:flex;flex-direction:column;gap:2px;margin:0;padding-left:18px;font-size:12px;line-height:18px}
.cjm-msg-error{color:var(--dsw-alias-state-error-primary)}
.cjm-msg-warn{color:var(--dsw-alias-state-warn-label,var(--dsw-alias-label-secondary))}
.cjm-msg-info{color:var(--dsw-alias-label-secondary)}
`;

    const svg = (size, ...children) => h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
      strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: 'false' }, ...children);
    function McpGlyph({ size = 18 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': true, focusable: 'false' },
        ...ICON_PATHS.map((d, index) => h('path', { key: index, d })));
    }
    const GearIcon = () => svg(15, h('circle', { cx: 12, cy: 12, r: 3 }), h('path', { d: 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z' }));
    const RefreshIcon = () => svg(15, h('path', { d: 'M20 11a8 8 0 0 0-14.3-4.9L4 8' }), h('path', { d: 'M4 4v4h4' }), h('path', { d: 'M4 13a8 8 0 0 0 14.3 4.9L20 16' }), h('path', { d: 'M20 20v-4h-4' }));
    const TrashIcon = () => svg(15, h('path', { d: 'M4 7h16' }), h('path', { d: 'M10 11v6M14 11v6' }), h('path', { d: 'M6 7l1 13h10l1-13' }), h('path', { d: 'M9 7V4h6v3' }));
    const WarningIcon = () => svg(14, h('path', { d: 'M12 3 2 20h20L12 3Z' }), h('path', { d: 'M12 10v4' }), h('path', { d: 'M12 17.5v.01' }));
    const PlusIcon = () => svg(13, h('path', { d: 'M12 5v14M5 12h14' }));
    const BackIcon = () => svg(13, h('path', { d: 'M15 18l-6-6 6-6' }));
    const TerminalIcon = () => svg(18, h('path', { d: 'M4 6l6 6-6 6' }), h('path', { d: 'M12 18h8' }));
    const GlobeIcon = () => svg(18, h('circle', { cx: 12, cy: 12, r: 9 }), h('path', { d: 'M3 12h18' }), h('path', { d: 'M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18' }));

    function Switch({ checked, label, disabled, onChange }) {
      return h('button', { type: 'button', role: 'switch', className: 'cjm-switch', 'aria-checked': checked ? 'true' : 'false', 'aria-label': label, title: label,
        disabled, onClick: () => onChange(!checked) }, h('span', { className: 'cjm-thumb', 'aria-hidden': true }));
    }
    function IconButton({ label, onClick, disabled, danger, children }) {
      return h('button', { type: 'button', className: danger ? 'cjm-icon cjm-icon-danger' : 'cjm-icon', 'aria-label': label, title: label, disabled, onClick }, children);
    }
    function Callout({ title, detail, flush, children }) {
      return h('div', { className: flush ? 'cjm-callout cjm-flush' : 'cjm-callout', role: 'status' }, h(WarningIcon),
        h('div', { className: 'cjm-callout-body' }, h('span', { className: 'cjm-callout-title' }, title),
          detail ? h('span', { className: 'cjm-detail' }, detail) : null, children ?? null));
    }
    const transportText = (t, transport) => transport === 'stdio' ? t('transportStdio') : transport === 'streamable-http' ? t('transportHttp') : null;
    const rowIcon = transport => h('span', { className: 'cjm-icon-box', 'aria-hidden': true }, transport === 'stdio' ? h(TerminalIcon) : transport === 'streamable-http' ? h(GlobeIcon) : h(McpGlyph, { size: 18 }));

    function OAuthControls({ t, server, kind, busy, run }) {
      const [copied, setCopied] = React.useState(false);
      const oauth = server.oauth ?? {};
      if (!oauth.eligible) return null;
      const target = { kind, name: server.name };
      const start = () => run({ action: 'oauthStart', ...target }, { open: true });
      if (oauth.pending) {
        const copy = () => {
          void globalThis.navigator?.clipboard?.writeText(oauth.url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => {});
        };
        return h('div', { className: 'cjm-oauth' }, h('span', null, t('oauthPending')),
          oauth.url ? h('a', { className: 'cjm-link', href: oauth.url, target: '_blank', rel: 'noopener noreferrer' }, t('oauthOpen')) : null,
          oauth.url ? h('button', { type: 'button', className: 'cjm-link', onClick: copy }, copied ? t('oauthCopied') : t('oauthCopy')) : null,
          h('button', { type: 'button', className: 'cjm-btn cjm-outline', disabled: busy, onClick: () => run({ action: 'oauthCancel', ...target }) }, t('oauthCancel')));
      }
      if (oauth.authorized) {
        const expires = oauth.expiresAt && !oauth.refreshable ? t('oauthExpires', { time: new Date(oauth.expiresAt).toLocaleString() }) : '';
        return h('div', { className: 'cjm-oauth' }, h('span', { className: 'cjm-tag cjm-tag-ok' }, t('oauthAuthorized')), expires ? h('span', null, expires) : null,
          h('button', { type: 'button', className: 'cjm-btn cjm-outline', disabled: busy, onClick: start }, t('oauthReauthorize')),
          h('button', { type: 'button', className: 'cjm-btn cjm-btn-danger', disabled: busy, onClick: () => run({ action: 'oauthRevoke', ...target }) }, t('oauthRevoke')));
      }
      const needed = server.reason === 'unauthorized';
      return h('div', { className: 'cjm-oauth' },
        needed && kind === 'plugin' ? h('span', null, t('oauthNeeded')) : null,
        oauth.error ? h('span', { className: 'cjm-msg-error' }, t('oauthFailed', { message: errorText(t, { code: oauth.code, details: { message: oauth.error } }) })) : null,
        h('button', { type: 'button', className: needed || kind === 'plugin' ? 'cjm-btn cjm-primary' : 'cjm-btn cjm-outline', disabled: busy, onClick: start },
          oauth.error ? t('oauthReauthorize') : t('oauthAuthorize')));
    }

    function CustomRow({ t, server, writable, busy, run, onEdit, confirming, setConfirming, now }) {
      const view = statusView(t, server);
      const transport = transportText(t, server.transport);
      const issues = (server.issues ?? []).map(issue => issueText(t, issue));
      const seconds = server.retryAt ? Math.max(1, Math.round((server.retryAt - now) / 1000)) : 0;
      const locked = busy || !writable;
      return h('li', { className: 'cjm-row', 'data-server': server.name, 'data-state': server.state },
        h('div', { className: 'cjm-line' }, rowIcon(server.transport),
          h('div', { className: 'cjm-main' },
            h('div', { className: 'cjm-name-row' }, h('span', { className: 'cjm-name' }, server.name), transport ? h('span', { className: 'cjm-tag' }, transport) : null),
            server.summary ? h('span', { className: 'cjm-summary', title: server.summary }, server.summary) : null),
          h('span', { className: 'cjm-state' }, h('span', { className: 'cjm-dot', 'data-state': view.dot, 'aria-hidden': true }), view.text),
          h('div', { className: 'cjm-tools' },
            h(IconButton, { label: t('edit', { name: server.name }), disabled: locked, onClick: () => onEdit(server.name) }, h(GearIcon)),
            h(IconButton, { label: t('reconnect', { name: server.name }), disabled: busy || !server.enabled, onClick: () => run({ action: 'reconnect', name: server.name }) }, h(RefreshIcon)),
            confirming === server.name
              ? h('button', { type: 'button', className: 'cjm-btn cjm-btn-danger', disabled: locked, autoFocus: true,
                onClick: () => { setConfirming(null); void run({ action: 'remove', name: server.name }); } }, t('confirmRemove'))
              : h(IconButton, { label: t('remove', { name: server.name }), danger: true, disabled: locked, onClick: () => setConfirming(server.name) }, h(TrashIcon)),
            h(Switch, { checked: server.enabled, label: t('enable', { name: server.name }), disabled: locked, onChange: enabled => run({ action: 'toggle', name: server.name, enabled }) }))),
        view.callout ? h(Callout, { title: server.state === 'reconnecting' ? t('statusReconnecting') : reasonText(t, server), detail: server.error ?? issues.join('\n') },
          seconds && server.state === 'failed' ? h('span', null, t('retryAt', { seconds })) : null) : null,
        showsCustomOAuth(server) ? h(OAuthControls, { t, server, kind: 'custom', busy, run }) : null);
    }

    function PluginRow({ t, server, busy, run }) {
      const view = statusView(t, server);
      const transport = transportText(t, server.transport);
      const meta = [server.module ? t('fromPlugin', { module: server.module }) : null, server.summary].filter(Boolean).join(' · ');
      return h('li', { className: 'cjm-row', 'data-server': server.name, 'data-state': server.state },
        h('div', { className: 'cjm-line' }, rowIcon(server.transport),
          h('div', { className: 'cjm-main' },
            h('div', { className: 'cjm-name-row' }, h('span', { className: 'cjm-name' }, server.name), transport ? h('span', { className: 'cjm-tag' }, transport) : null),
            meta ? h('span', { className: 'cjm-summary', title: meta }, meta) : null),
          h('span', { className: 'cjm-state' }, h('span', { className: 'cjm-dot', 'data-state': view.dot, 'aria-hidden': true }), view.text)),
        h(OAuthControls, { t, server, kind: 'plugin', busy, run }));
    }

    /** One group's rows on a shared panel; the panel stays, holding a single line, while the group is empty. */
    function Panel({ rows, empty }) {
      return h('div', { className: 'cjm-panel' }, rows.length ? h('ul', { className: 'cjm-rows' }, ...rows) : h('p', { className: 'cjm-empty' }, empty));
    }

    function ListView({ t, state, busy, run, onAdd, onEdit, failure, now, confirming, setConfirming }) {
      const writable = state.writable !== false;
      return h(React.Fragment, null,
        h('header', { className: 'cjm-head' },
          h('div', { className: 'cjm-heading' }, h('h1', { className: 'cjm-title' }, t('title')), h('p', { className: 'cjm-intro' }, t('intro'))),
          h('button', { type: 'button', className: 'cjm-btn cjm-primary', disabled: !writable, onClick: onAdd }, h(PlusIcon), t('add'))),
        // Successful actions show in the rows themselves; only a failed action needs a line here.
        failure ? h('p', { className: 'cjm-error', role: 'alert' }, failure) : null,
        writable ? null : h(Callout, { title: t('readOnly'), flush: true }),
        h('section', { className: 'cjm-group', 'data-group': 'custom' },
          h('h2', { className: 'cjm-group-title' }, t('customTitle')),
          h(Panel, { empty: t('customEmpty'),
            rows: state.custom.map(server => h(CustomRow, { key: server.name, t, server, writable, busy, run, onEdit, confirming, setConfirming, now })) })),
        h('section', { className: 'cjm-group', 'data-group': 'plugins' },
          h('h2', { className: 'cjm-group-title' }, t('pluginTitle')),
          h(Panel, { empty: t('pluginEmpty'),
            rows: state.plugins.map(server => h(PluginRow, { key: `${server.name}\n${server.entry ?? ''}`, t, server, busy, run })) })));
    }

    function PreviewView({ t, analysis, values, setValue }) {
      if (!analysis) return h('p', { className: 'cjm-empty' }, t('previewEmpty'));
      const documentErrors = analysis.errors.filter(issue => issue.code !== 'empty');
      return h('div', { className: 'cjm-preview' },
        documentErrors.length ? h('ul', { className: 'cjm-messages' }, ...documentErrors.map((issue, index) => h('li', { key: index, className: 'cjm-msg-error' }, issueText(t, issue)))) : null,
        analysis.warnings.length ? h('ul', { className: 'cjm-messages' }, ...analysis.warnings.map((issue, index) => h('li', { key: index, className: 'cjm-msg-warn' }, issueText(t, issue)))) : null,
        ...analysis.servers.map(server => h('div', { key: server.name, className: 'cjm-preview-item', 'data-server': server.name },
          h('div', { className: 'cjm-name-row' }, h('span', { className: 'cjm-name' }, server.name),
            server.transport ? h('span', { className: 'cjm-tag' }, transportText(t, server.transport)) : null,
            server.enabled === false ? h('span', { className: 'cjm-tag' }, t('statusDisabled')) : null),
          server.summary ? h('span', { className: 'cjm-summary', title: server.summary }, server.summary) : null,
          server.errors.length || server.warnings.length || server.secrets.length ? h('ul', { className: 'cjm-messages' },
            ...server.errors.map((issue, index) => h('li', { key: `e${index}`, className: 'cjm-msg-error' }, issueText(t, issue))),
            ...server.warnings.map((issue, index) => h('li', { key: `w${index}`, className: 'cjm-msg-warn' }, issueText(t, issue))),
            server.secrets.length ? h('li', { key: 's', className: 'cjm-msg-info' }, t('secretsMoved', { refs: server.secrets.map(secret => secret.ref).join(', ') })) : null) : null,
          ...server.refs.filter(ref => ref.state !== 'extracted').map(ref => {
            if (!ref.writable) return h('span', { key: ref.ref, className: ref.state === 'missing' ? 'cjm-msg-error' : 'cjm-state' }, ref.state === 'missing' ? t('refFixed', { ref: ref.ref })
              : t('refConfigured', { ref: ref.ref, source: ENVIRONMENT_SOURCES.includes(ref.source) ? t('sourceEnv') : t('sourceFile') }));
            const label = ref.state === 'provided' ? t('refProvided', { ref: ref.ref })
              : ref.state === 'configured' ? t('refConfigured', { ref: ref.ref, source: t('sourceFile') }) : t('refMissing', { ref: ref.ref });
            return h('label', { key: ref.ref, className: 'cjm-field' }, label,
              h('input', { className: 'cjm-input', type: 'password', autoComplete: 'new-password', spellCheck: false, 'aria-label': t('refLabel', { ref: ref.ref }),
                placeholder: t('refPlaceholder'), value: values[ref.ref] ?? '', onChange: event => setValue(ref.ref, event.target.value) }));
          }))));
    }

    function EditorView({ t, mode, target, state, onDone, onCancel }) {
      const [text, setText] = React.useState(() => mode === 'edit' ? initialText(state, target) : '');
      const [values, setValues] = React.useState({});
      const [analysis, setAnalysis] = React.useState(null);
      const [pending, setPending] = React.useState(false);
      const [saving, setSaving] = React.useState(false);
      const [failure, setFailure] = React.useState('');
      const request = React.useRef(0);
      React.useEffect(() => {
        const id = ++request.current;
        if (!text.trim()) { setAnalysis(null); setPending(false); return undefined; }
        setPending(true);
        const timer = setTimeout(() => {
          act({ action: 'preview', text, mode, target, values })
            .then(result => { if (id === request.current) { setAnalysis(result.analysis); setFailure(''); } })
            .catch(error => { if (id === request.current) setFailure(errorText(t, error)); })
            .finally(() => { if (id === request.current) setPending(false); });
        }, 300);
        return () => clearTimeout(timer);
      }, [text, values, mode, target]);
      const setValue = (ref, value) => setValues(previous => ({ ...previous, [ref]: value }));
      async function save() {
        setSaving(true); setFailure('');
        try {
          const result = await act({ action: 'save', text, mode, target, values });
          onDone(result.saved ?? []);
        } catch (error) {
          if (error.code === 'invalid' && error.details?.analysis) setAnalysis(error.details.analysis);
          setFailure(errorText(t, error));
          setSaving(false);
        }
      }
      const insertTab = event => {
        if (event.key !== 'Tab' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
        event.preventDefault();
        const element = event.target, start = element.selectionStart, end = element.selectionEnd;
        setText(`${text.slice(0, start)}  ${text.slice(end)}`);
        requestAnimationFrame(() => { element.selectionStart = element.selectionEnd = start + 2; });
      };
      return h(React.Fragment, null,
        h('header', { className: 'cjm-head' },
          h('div', { className: 'cjm-heading' },
            h('button', { type: 'button', className: 'cjm-crumb', onClick: onCancel }, h(BackIcon), t('back')),
            h('h1', { className: 'cjm-title' }, mode === 'edit' ? t('editTitle', { name: target }) : t('addTitle')),
            h('p', { className: 'cjm-intro' }, mode === 'edit' ? t('editHelp') : t('editorHelp')))),
        h('section', { className: 'cjm-group' },
          mode === 'edit' ? null : h('div', { className: 'cjm-actions' },
            h('button', { type: 'button', className: 'cjm-btn cjm-outline', onClick: () => setText(EXAMPLE_STDIO) }, t('exampleStdio')),
            h('button', { type: 'button', className: 'cjm-btn cjm-outline', onClick: () => setText(EXAMPLE_HTTP) }, t('exampleHttp'))),
          h('textarea', { className: 'cjm-textarea', value: text, spellCheck: false, autoCapitalize: 'off', autoComplete: 'off', 'aria-label': t('jsonLabel'),
            placeholder: EXAMPLE_STDIO, onChange: event => setText(event.target.value), onKeyDown: insertTab })),
        h('section', { className: 'cjm-group' },
          h('h2', { className: 'cjm-group-title' }, t('previewTitle')),
          pending && !analysis ? h('p', { className: 'cjm-status' }, t('previewing')) : h(PreviewView, { t, analysis, values, setValue })),
        h(Callout, { title: t('security'), flush: true }),
        failure ? h('p', { className: 'cjm-error', role: 'alert' }, failure) : null,
        h('div', { className: 'cjm-actions' },
          h('button', { type: 'button', className: 'cjm-btn cjm-primary', disabled: hasBlockingIssues(analysis) || pending || saving, onClick: () => { void save(); } }, saving ? t('saving') : t('save')),
          h('button', { type: 'button', className: 'cjm-btn cjm-outline', disabled: saving, onClick: onCancel }, t('cancel'))));
    }

    /** Desktop routes https links opened by the page to the system browser; the pending row also keeps the link. */
    function openExternal(url) {
      try { globalThis.open?.(url, '_blank', 'noopener,noreferrer'); } catch { /* the pending row shows the link */ }
    }

    function ConnectorsPage(props) {
      const t = React.useMemo(() => translatorFrom(props.t), [props.t]);
      const [state, setState] = React.useState(null);
      const [loadError, setLoadError] = React.useState('');
      const [view, setView] = React.useState({ mode: 'list' });
      const [busy, setBusy] = React.useState(false);
      const [failure, setFailure] = React.useState('');
      const [confirming, setConfirmingState] = React.useState(null);
      const [now, setNow] = React.useState(() => Date.now());
      const [attempt, setAttempt] = React.useState(0);
      const live = React.useRef(true);
      const refreshRef = React.useRef(() => Promise.resolve());
      const confirmTimer = React.useRef(undefined);
      const setConfirming = name => {
        clearTimeout(confirmTimer.current);
        setConfirmingState(name);
        if (name) confirmTimer.current = setTimeout(() => { if (live.current) setConfirmingState(null); }, 4000);
      };
      React.useEffect(() => {
        live.current = true;
        let timer, controller;
        const fast = value => value && [...value.custom, ...value.plugins].some(server => server.state === 'connecting' || server.state === 'reconnecting' || server.oauth?.pending);
        const refresh = async () => {
          clearTimeout(timer);
          controller?.abort();
          const current = controller = new AbortController();
          let next;
          try {
            next = await readState(current.signal);
            if (!live.current || current.signal.aborted) return;
            setState(next); setLoadError(''); setNow(Date.now());
          } catch (error) {
            if (!live.current || current.signal.aborted) return;
            setLoadError(errorText(t, error));
          }
          const hidden = globalThis.document?.visibilityState === 'hidden';
          timer = setTimeout(refresh, hidden ? 10000 : fast(next) ? 1000 : 3000);
        };
        refreshRef.current = refresh;
        void refresh();
        const onVisible = () => { if (globalThis.document?.visibilityState === 'visible') void refresh(); };
        globalThis.document?.addEventListener?.('visibilitychange', onVisible);
        return () => {
          live.current = false;
          clearTimeout(timer);
          clearTimeout(confirmTimer.current);
          controller?.abort();
          globalThis.document?.removeEventListener?.('visibilitychange', onVisible);
        };
      }, [attempt]);
      async function run(body, options = {}) {
        setBusy(true); setFailure('');
        try {
          const result = await act(body);
          if (options.open && result.url) openExternal(result.url);
        } catch (error) { if (live.current) setFailure(errorText(t, error)); }
        finally {
          if (live.current) setBusy(false);
          await refreshRef.current();
        }
      }
      let content;
      if (view.mode !== 'list' && state) {
        content = h(EditorView, { key: `${view.mode}:${view.target ?? ''}`, t, mode: view.mode, target: view.target, state,
          onCancel: () => setView({ mode: 'list' }),
          onDone: () => { setView({ mode: 'list' }); void refreshRef.current(); } });
      } else if (state) {
        content = h(ListView, { t, state, busy, run, failure, now, confirming, setConfirming,
          onAdd: () => { setFailure(''); setView({ mode: 'add' }); }, onEdit: name => { setFailure(''); setView({ mode: 'edit', target: name }); } });
      } else {
        content = h('header', { className: 'cjm-head' }, h('div', { className: 'cjm-heading' }, h('h1', { className: 'cjm-title' }, t('title')),
          loadError ? h('p', { className: 'cjm-error', role: 'alert' }, t('loadFailed', { message: loadError })) : h('p', { className: 'cjm-intro', role: 'status' }, t('loading')),
          loadError ? h('div', { className: 'cjm-actions', style: { marginTop: 12 } },
            h('button', { type: 'button', className: 'cjm-btn cjm-outline', onClick: () => setAttempt(value => value + 1) }, t('retry'))) : null));
      }
      return h('div', { className: 'cjm-page', 'data-dsh-custom-json-mcp': '' }, h('style', null, CSS), content);
    }

    return {
      inject: ['slots', 'locale'],
      testing: { DICTIONARIES, translatorFrom, issueText, errorText, reasonText, statusView, showsCustomOAuth, hasBlockingIssues, initialText,
        ListView, PreviewView, CustomRow, PluginRow, ConnectorsPage, EditorView, McpGlyph },
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICTIONARIES), 'dsh-custom-json-mcp: dictionaries');
        const t = translatorFrom((key, params) => ctx.locale.bind(NS)(key, params));
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 10, label: () => t('nav'), locale: NS }, McpGlyph));
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, ConnectorsPage));
      },
    };
  },
});
