// Uso: node examples/swing-keys.mjs <pid> <tecla> [tecla...]
// Envia teclas a uma JVM Swing e imprime os textos visíveis depois de cada uma.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const [pid, ...keys] = process.argv.slice(2)
const client = new Client({ name: 'swing-keys', version: '0' })
await client.connect(new StdioClientTransport({ command: 'node', args: ['server.mjs'] }))
const call = async (name, args) => (await client.callTool({ name, arguments: { pid: Number(pid), ...args } })).content[0].text
for (const key of keys) {
  console.log(key, await call('swing_key', { key }))
  await new Promise((r) => setTimeout(r, 500))
  const nodes = JSON.parse(await call('swing_tree', { onlyText: true })).nodes
  console.log('  textos:', nodes.map((n) => n.t.trim()).filter(Boolean).join(' | '))
}
await client.close()
