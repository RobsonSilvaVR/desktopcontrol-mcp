#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { createWindowsBackend } from './backends/windows.mjs'
import { createLinuxBackend } from './backends/linux.mjs'
import { createSwingClient } from './backends/swing.mjs'
import { launchApp } from './launcher.mjs'

if (process.argv.includes('--doctor')) await import('./doctor.mjs')

const backend = process.platform === 'win32' ? createWindowsBackend() : createLinuxBackend()
const swing = createSwingClient((pid) => backend.javaPath(pid))

// MCP_ALLOWED_APPS="java,notepad": só esses processos/nomes podem ser controlados; vazio = todos
const allowed = (process.env.MCP_ALLOWED_APPS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
async function guard(app) {
  if (!allowed.length) return
  const q = String(app).replace(/^pid:/i, '').toLowerCase()
  const apps = await backend.listApps()
  const hit = apps.find((a) => String(a.pid) === q || a.name.toLowerCase() === q.replace(/\.exe$/, ''))
  if (!hit || !allowed.includes(hit.name.toLowerCase().replace(/\.exe$/, ''))) throw new Error(`app não permitido por MCP_ALLOWED_APPS: ${app}`)
}

const text = (v) => ({ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v) })
const reply = (r) => {
  const { screenshotPngBase64, ...rest } = r ?? {}
  const content = [text(rest)]
  if (screenshotPngBase64) content.push({ type: 'image', data: screenshotPngBase64, mimeType: 'image/png' })
  return { content }
}
const wrap = (fn) => async (a) => {
  try {
    if (a.app) await guard(a.app)
    return await fn(a)
  } catch (e) {
    return { isError: true, content: [text(String(e.message ?? e))] }
  }
}

const server = new McpServer({ name: 'desktopcontrol-mcp', version: '0.1.0' })

const target = {
  app: z.string().describe('"pid:1234", nome do processo ou parte do título da janela'),
  windowId: z.number().optional().describe('id da janela (list_windows)'),
  restoreWindow: z.boolean().optional().describe('traz a janela ao foco antes (padrão true)'),
  image: z.boolean().optional().describe('devolve screenshot após a ação (padrão false)')
}
const xy = { x: z.number().describe('X em pixels dentro da janela'), y: z.number().describe('Y em pixels dentro da janela') }

server.registerTool('list_apps', { description: 'Lista apps com janela visível.' }, wrap(async () => reply({ apps: await backend.listApps() })))
server.registerTool(
  'list_windows',
  { description: 'Lista janelas de um app.', inputSchema: { app: z.string() } },
  wrap(async (a) => reply({ windows: await backend.listWindows(a.app) }))
)
server.registerTool(
  'screenshot',
  { description: 'Captura a janela (imagem) e, no Windows, a árvore de acessibilidade UIA. Apps Swing: use swing_tree.', inputSchema: { ...target, image: z.boolean().optional().default(true) } },
  wrap(async (a) => reply(await backend.screenshot(a)))
)
server.registerTool('click', { description: 'Clique em coordenadas da janela.', inputSchema: { ...target, ...xy, button: z.enum(['left', 'right', 'middle']).optional(), count: z.number().optional(), modifiers: z.string().optional().describe('ex.: "ctrl+shift"') } }, wrap(async (a) => reply(await backend.click(a))))
server.registerTool('type_text', { description: 'Digita texto literal no foco atual.', inputSchema: { ...target, text: z.string() } }, wrap(async (a) => reply(await backend.typeText(a))))
server.registerTool('press_key', { description: 'Tecla única: Return, Escape, Tab, setas, F1..F12, letra.', inputSchema: { ...target, key: z.string() } }, wrap(async (a) => reply(await backend.pressKey(a))))
server.registerTool('hotkey', { description: 'Combinação: "ctrl+a", "alt+F4".', inputSchema: { ...target, key: z.string() } }, wrap(async (a) => reply(await backend.hotkey(a))))
server.registerTool('paste_text', { description: 'Cola texto via área de transferência (restaura a anterior).', inputSchema: { ...target, text: z.string() } }, wrap(async (a) => reply(await backend.pasteText(a))))
server.registerTool('scroll', { description: 'Rola a roda do mouse.', inputSchema: { ...target, ...xy, direction: z.enum(['up', 'down', 'left', 'right']), pages: z.number().optional() } }, wrap(async (a) => reply(await backend.scroll(a))))
server.registerTool('drag', { description: 'Arrasta de um ponto a outro.', inputSchema: { ...target, fromX: z.number(), fromY: z.number(), toX: z.number(), toY: z.number() } }, wrap(async (a) => reply(await backend.drag(a))))

const pid = { pid: z.number().describe('PID da JVM Swing') }
const path = { path: z.string().describe('caminho do componente vindo de swing_tree (ex.: "0/1/3")') }
const swingTool = (name, description, schema, fn) =>
  server.registerTool(name, { description, inputSchema: schema }, async (a) => {
    try {
      if (allowed.length) await guard(`pid:${a.pid}`)
      return reply(await fn(a))
    } catch (e) {
      return { isError: true, content: [text(String(e.message ?? e))] }
    }
  })

swingTool('swing_tree', 'Árvore de componentes Swing da JVM (anexa o agente sozinho na 1ª chamada; precisa de JDK com Attach API). onlyText=true lista só componentes com texto (leitura de tela).', { ...pid, onlyText: z.boolean().optional() }, (a) => swing.tree(a.pid, a.onlyText))
swingTool('swing_click', 'Clica em componente (doClick em botões; eventos de mouse nos demais). Independe de foco/posição.', { ...pid, ...path }, (a) => swing.click(a.pid, a.path))
swingTool('swing_set_text', 'Define o texto de um JTextComponent.', { ...pid, ...path, text: z.string() }, (a) => swing.setText(a.pid, a.path, a.text))
swingTool('swing_focus', 'Dá foco a um componente.', { ...pid, ...path }, (a) => swing.focus(a.pid, a.path))
swingTool('swing_key', 'Injeta tecla na EDT do componente com foco, passando pelos KeyEventDispatchers do app: "F1", "ENTER", "ctrl+F4", "a".', { ...pid, key: z.string() }, (a) => swing.key(a.pid, a.key))
swingTool('swing_type', 'Digita texto no componente com foco via KeyEvents (sem foco de janela do SO).', { ...pid, text: z.string() }, (a) => swing.type(a.pid, a.text))
swingTool('swing_cells', 'Valores de JTable/JList (até 200 linhas).', { ...pid, ...path }, (a) => swing.cells(a.pid, a.path))

if (process.env.MCP_ENABLE_LAUNCH === '1') {
  server.registerTool(
    'launch_app',
    { description: 'Lança um programa (desligado por padrão; habilite com MCP_ENABLE_LAUNCH=1). Em Linux sem tela sobe um Xvfb.', inputSchema: { command: z.string(), args: z.array(z.string()).optional() } },
    async (a) => {
      try {
        if (allowed.length && !allowed.includes(String(a.command).split(/[\\/]/).pop().toLowerCase().replace(/\.exe$/, ''))) throw new Error(`comando não permitido por MCP_ALLOWED_APPS: ${a.command}`)
        return reply(await launchApp(a.command, a.args))
      } catch (e) {
        return { isError: true, content: [text(String(e.message ?? e))] }
      }
    }
  )
}

process.on('exit', () => backend.close())
await server.connect(new StdioServerTransport())
