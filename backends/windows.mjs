import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'orca', 'runtime.ps1')
const TIMEOUT_MS = 30000

export function createWindowsBackend() {
  let child = null
  let ready = null
  let seq = 0
  const pending = new Map()

  function start() {
    child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', SCRIPT, '-Serve'],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
    )
    ready = new Promise((resolve, reject) => {
      const lines = createInterface({ input: child.stdout })
      lines.on('line', (line) => {
        let msg
        try {
          msg = JSON.parse(line)
        } catch {
          return
        }
        if (msg.ready) return resolve()
        const waiter = pending.get(msg.requestId)
        if (waiter) {
          pending.delete(msg.requestId)
          waiter(msg)
        }
      })
      child.once('error', reject)
      child.once('exit', (code) => {
        reject(new Error(`runtime.ps1 encerrou (${code})`))
        for (const w of pending.values()) w({ ok: false, error: 'runtime.ps1 encerrou' })
        pending.clear()
        child = null
      })
    })
    ready.catch(() => {})
  }

  async function call(tool, params = {}) {
    if (!child) start()
    await ready
    const requestId = ++seq
    const reply = new Promise((resolve) => {
      pending.set(requestId, resolve)
      setTimeout(() => {
        if (pending.delete(requestId)) resolve({ ok: false, error: `timeout em ${tool}` })
      }, TIMEOUT_MS)
    })
    child.stdin.write(JSON.stringify({ requestId, tool, ...params }) + '\n')
    const res = await reply
    if (!res.ok) throw new Error(res.error)
    return res
  }

  const target = (o) => ({ app: o.app, windowId: o.windowId, restoreWindow: o.restoreWindow ?? true })
  const shot = (res, wantImage) => {
    const s = res.snapshot
    return {
      window: s && { title: s.windowTitle, id: s.windowId, bounds: s.windowBounds },
      tree: s && s.treeLines && s.treeLines.join('\n'),
      screenshotPngBase64: wantImage && s ? s.screenshotPngBase64 : undefined
    }
  }

  return {
    name: 'windows',
    async listApps() {
      return (await call('list_apps')).apps.map((a) => ({ name: a.name, pid: a.pid }))
    },
    async listWindows(app) {
      return (await call('list_windows', { app })).windows
    },
    async screenshot(o) {
      return shot(await call('get_app_state', { ...target(o), noScreenshot: !o.image }), o.image)
    },
    async click(o) {
      const res = await call('click', {
        ...target(o),
        x: o.x,
        y: o.y,
        mouse_button: o.button ?? 'left',
        click_count: o.count ?? 1,
        modifiers: o.modifiers,
        noScreenshot: !o.image
      })
      return shot(res, o.image)
    },
    async typeText(o) {
      return shot(await call('type_text', { ...target(o), text: o.text, noScreenshot: !o.image }), o.image)
    },
    async pressKey(o) {
      return shot(await call('press_key', { ...target(o), key: o.key, noScreenshot: !o.image }), o.image)
    },
    async hotkey(o) {
      return shot(await call('hotkey', { ...target(o), key: o.key, noScreenshot: !o.image }), o.image)
    },
    async pasteText(o) {
      return shot(await call('paste_text', { ...target(o), text: o.text, noScreenshot: !o.image }), o.image)
    },
    async scroll(o) {
      return shot(
        await call('scroll', { ...target(o), x: o.x, y: o.y, direction: o.direction, pages: o.pages ?? 1, noScreenshot: !o.image }),
        o.image
      )
    },
    async drag(o) {
      return shot(
        await call('drag', {
          ...target(o),
          from_x: o.fromX,
          from_y: o.fromY,
          to_x: o.toX,
          to_y: o.toY,
          noScreenshot: !o.image
        }),
        o.image
      )
    },
    async javaPath(pid) {
      const out = await new Promise((resolve) => {
        const p = spawn('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${Number(pid)}).Path`], { windowsHide: true })
        let buf = ''
        p.stdout.on('data', (d) => (buf += d))
        p.on('close', () => resolve(buf.trim()))
      })
      return out
    },
    close() {
      if (child) child.stdin.end()
    }
  }
}
