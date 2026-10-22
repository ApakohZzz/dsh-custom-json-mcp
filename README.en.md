# Connectors (Custom MCP)

[中文](README.md) · English

Adds a **Connectors** page to the DSH sidebar: paste standard MCP JSON to add, disable, reconnect or delete MCP servers at any time, and see each server's connection status and tool count. Plugin version **1.0.1**, for **DSH 0.2.1-rc.2**.

DSH's official `@deepseek-ai/dsh-mcp-client` handles the MCP protocol, tool registration and process cleanup. This plugin mounts one official client instance per server and provides the management page. Tools are registered as `mcp__<server>__<tool>` and become available from the next model request after the server connects.

## Installation

In DeepSeek Harness open **Plugins → Add plugin** and enter the repository URL:

```text
https://github.com/ApakohZzz/dsh-custom-json-mcp
```

`github:ApakohZzz/dsh-custom-json-mcp` works too; append a tag such as `#v1.0.1` to pin a release. For DSH Web run:

```sh
dsh plugin --profile web add https://github.com/ApakohZzz/dsh-custom-json-mcp
```

Enable the plugin and **Connectors** appears in the sidebar. After upgrading to a new version, restart DSH when the host asks.

## The page

![The Connectors page: custom and plugin-registered groups, shown empty](pictures/connectors-page.png)

- **Add MCP server** opens the editor: paste JSON and see parsed servers, errors and the secrets that will move into the credential store as you type. Several servers can be added at once.
- **Custom MCP servers** are the ones added here. Each row has edit (gear), reconnect, delete (confirm twice) and an enable switch. A connected server shows a green dot and the number of active tools; a failed connection shows a blinking red dot and a warning callout with the cause and a suggested fix.
- **MCP servers from plugins** lists connections mounted by other plugins (such as Tencent Cloud MCP) read-only. HTTP servers offer **Authorize with OAuth**. Each group sits on its own panel, which shows a short notice when the group is empty.

The gear opens the editor prefilled with the server's JSON; saving reconnects it. Secrets already in the credential store appear only as `${NAME}` references:

![Editing a server: the JSON editor and its live result](pictures/edit-json.png)

The screenshots show the Chinese interface; the page follows the DSH display language.

## Supported JSON

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:/Users/me/Documents"]
    },
    "remote": {
      "type": "http",
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer ${MY_MCP_TOKEN}" }
    }
  }
}
```

- The root may be `mcpServers` (Claude Desktop, Cursor, Windsurf, Claude Code `.mcp.json`), `servers` (VS Code `mcp.json`), `mcp.servers` (VS Code settings) or a bare name → server map. JSONC comments and trailing commas are accepted.
- Local commands use `command`, `args`, `env` and `cwd`; remote servers use `type: "http"`, `"streamable-http"` or `"streamableHttp"`, `url` (`httpUrl` and `serverUrl` are accepted too) and `headers`.
- Optional fields: `disabled` / `enabled`, `toolCallTimeoutMs` (1000–3600000), and for HTTP servers `oauth.clientId`, `oauth.clientSecret`, `oauth.scope` (or `scopes`) and `oauth.callbackPort`.
- Server names may contain letters, digits, `-` and `_`, up to 32 characters, and must not collide with MCP servers of other plugins.
- Not supported: the SSE transport (use a Streamable HTTP endpoint, or connect through `mcp-remote` as a local command), `envFile`, VS Code `inputs` and `${input:…}`, and editor variables such as `${workspaceFolder}`. Unsupported fields are reported individually or marked as ignored; nothing is dropped silently.

## Credentials

- `${NAME}`, `${env:NAME}` and `${NAME:-default}` resolve through DSH credentials (stored values first, then the environment that launched DSH); `${userHome}` and `${pathSeparator}` are available too. Missing credentials can be entered directly in the editor.
- Pasted literal secrets move into the DSH credential store on save, leaving `${MCP_<SERVER>_<FIELD>}` references in the configuration: `env` and `headers` values whose names contain KEY / TOKEN / SECRET / PASSWORD / AUTH and similar, arguments like `--api-key xxx` or `--token=xxx`, `mcp-remote` style `--header "Authorization: Bearer xxx"`, and URL query parameters such as `?api_key=`. Deleting a server also removes these generated credentials.
- DSH removes inherited environment variables whose names contain KEY / TOKEN / SECRET / PASSWORD when it starts stdio servers, so secrets a server needs must be listed in `env` (references are fine).
- The editor never displays stored secrets.

## OAuth authorization

HTTP servers without an `Authorization` header can be authorized with **Authorize with OAuth**. Following the MCP authorization specification, the plugin discovers the authorization server (RFC 9728 / RFC 8414), registers a client dynamically when needed (RFC 7591) and completes the authorization in your system browser with PKCE and the `resource` parameter, using a loopback redirect `http://127.0.0.1:<port>/callback`. Tokens are stored as DSH credential records and refreshed before they expire; the server reconnects automatically after authorization.

The full flow with Tencent Cloud Lighthouse's MCP service as an example:

1. When the server requires authentication, its row reports a failed connection (401) and offers **Authorize with OAuth**.

   ![A server row failing with 401 and the Authorize with OAuth button](pictures/oauth-required.png)

2. The authorization page opens in your system browser. The row also offers **Open authorization page** and **Copy link** in case the browser does not open by itself.

   ![Left: the authorization page in the browser; right: the Connectors page waiting for it](pictures/oauth-browser.png)

3. Once authorized, the server reconnects and shows Authorized plus its active tool count; you can authorize again or revoke at any time.

   ![Authorized, with 60 tools](pictures/oauth-authorized.png)

- If the authorization server does not support dynamic registration, set a pre-registered `oauth.clientId` (plus `oauth.clientSecret` and `oauth.callbackPort` if required) in the JSON.
- For servers registered by other plugins, this plugin only adds an `Authorization` header to that MCP connection and never changes the plugin's own configuration; revoking restores the original behaviour.
- Authorization servers must use HTTPS (loopback addresses excepted).

## Security

- Adding a stdio server means allowing its command to run on this computer with your user permissions. Only add servers you trust.
- Management actions are available only to the authenticated local DSH page (the host's Host/Origin checks and browser authentication). The model gets no tool to add or remove servers.
- Server definitions are written to the current profile's `cordis.patch.yml` through DSH Settings; secrets go to the DSH credential store.

## Known limitations

- Status relies on the official client's public behaviour: reconnect states come from its log lines and tool counts from the tool registry.
- Only MCP tools are bridged; resources are served by DSH's built-in MCP resource tools and prompt templates are not supported, as with the official client.
- A model request already in progress does not gain new tools midway; tool changes apply from the next request after a server connects or disconnects.

## Development

The plugin itself needs no build. The regression tests run pinned versions of the real Cordis, DSH Settings and the official MCP client against local stdio and HTTP test servers and a local OAuth authorization server. Their dependencies install into `dev/` only and never enter the plugin package.

```sh
npm ci --prefix dev --ignore-scripts
node tools/generate-icon.mjs --check
node tools/validate.mjs --check-source
node --test 'test/*.test.mjs'
```

`--check-source` downloads the pinned Boxicons originals and compares them byte for byte; omit it offline. For local debugging, do not add the repository directory itself: copy the files `npm pack` would include to a separate directory, run `npm install --omit=dev --ignore-scripts` there for the runtime dependencies, then add that absolute path in the plugin manager. Changes to distributed content must bump the `package.json` version.

## Source and license

This plugin's own code is [MIT](LICENSE). The icon uses the original `bx-mcp` glyph from [Boxicons](https://github.com/box-icons/boxicons-core); the original SVG bytes, pinned commit and SHA256 are recorded in [upstream.json](upstream.json), and the upstream [MIT license](upstream/LICENSE) is included. `icon.png` is derived deterministically by [`tools/generate-icon.mjs`](tools/generate-icon.mjs). MCP names and marks belong to their owners. The screenshots show this plugin in use; third-party pages and marks that appear in them, such as DeepSeek Harness and Tencent Cloud, belong to their respective owners. This is a community plugin, not affiliated with or endorsed by DeepSeek.
