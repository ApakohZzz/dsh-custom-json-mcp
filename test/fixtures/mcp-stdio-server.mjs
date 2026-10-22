// Minimal newline-delimited JSON-RPC MCP server for stdio regression tests. Arguments: tool names.
// When FIXTURE_DIGEST is set, FIXTURE_TOKEN must hash to it: this proves a stored credential reached the child
// explicitly while keeping the plaintext out of the configuration under test.
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';

const expected = process.env.FIXTURE_DIGEST;
if (expected !== undefined && createHash('sha256').update(process.env.FIXTURE_TOKEN ?? '').digest('hex').slice(0, 16) !== expected) {
  process.stderr.write('fixture: missing or wrong FIXTURE_TOKEN\n');
  process.exit(3);
}
const tools = process.argv.slice(2).map(name => ({ name, description: `Fixture tool ${name}`, inputSchema: { type: 'object', properties: {}, additionalProperties: false } }));
const send = message => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
createInterface({ input: process.stdin }).on('line', line => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.id === undefined) return;
  switch (message.method) {
    case 'initialize': send({ id: message.id, result: { protocolVersion: message.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'cjm-stdio-fixture', version: '1.0.0' } } }); break;
    case 'tools/list': send({ id: message.id, result: { tools } }); break;
    case 'tools/call': send({ id: message.id, result: { content: [{ type: 'text', text: `stdio ${message.params?.name}` }] } }); break;
    case 'ping': send({ id: message.id, result: {} }); break;
    default: send({ id: message.id, error: { code: -32601, message: 'Unknown method' } });
  }
});
