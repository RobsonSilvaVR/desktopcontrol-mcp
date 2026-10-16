// Uso: node test/smoke.mjs <pid>   — roda o MCP por stdio e exercita as tools contra uma JVM Swing
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const pid = Number(process.argv[2])
const client = new Client({ name: 'smoke', version: '0' })
await client.connect(new StdioClientTransport({ command: 'node', args: ['server.mjs'] }))
const show = (n, r) => console.log(n, r.isError ? 'ERRO' : 'ok', r.content.map((c) => (c.type === 'text' ? c.text.slice(0, 400) : `[imagem ${c.data.length}b]`)).join(' | '))
console.log((await client.listTools()).tools.map((t) => t.name).join(', '))
show('list_windows', await client.callTool({ name: 'list_windows', arguments: { app: `pid:${pid}` } }))
show('swing_tree', await client.callTool({ name: 'swing_tree', arguments: { pid, onlyText: true } }))
await client.close()
