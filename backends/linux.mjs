import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, readlink } from 'node:fs/promises'

const KEYS = {
  return: 'Return', enter: 'Return', tab: 'Tab', escape: 'Escape', esc: 'Escape',
  backspace: 'BackSpace', delete: 'Delete', space: 'space', left: 'Left', right: 'Right',
  up: 'Up', down: 'Down', home: 'Home', end: 'End', insert: 'Insert',
  pageup: 'Prior', page_up: 'Prior', pagedown: 'Next', page_down: 'Next'
}
const MODS = { cmdorctrl: 'ctrl', commandorcontrol: 'ctrl', control: 'ctrl', option: 'alt', cmd: 'super', command: 'super', win: 'super', meta: 'super' }

export const keyName = (k) => KEYS[String(k).toLowerCase()] ?? String(k)
export const hotkeySpec = (spec) =>
  String(spec)
    .split('+')
    .map((p, i, a) => (i < a.length - 1 ? (MODS[p.trim().toLowerCase()] ?? p.trim().toLowerCase()) : keyName(p.trim())))
    .join('+')

const BUTTON = { left: 1, middle: 2, right: 3 }
const WHEEL = { up: 4, down: 5, left: 6, right: 7 }

const defaultRun = (cmd, args, opts = {}) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { encoding: opts.binary ? 'buffer' : 'utf8', maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(new Error(`${cmd} ${args.join(' ')}: ${stderr || err.message}`)) : resolve(stdout)
    )
  })

export function createLinuxBackend(run = defaultRun) {
  const xdo = (...a) => run('xdotool', a)

  async function windows() {
    if (!process.env.DISPLAY && !run.fake && existsSync('/tmp/.X11-unix/X99')) process.env.DISPLAY = ':99'
    if (!process.env.DISPLAY && !run.fake) throw new Error('DISPLAY ausente: requer sessão X11 (use Xvfb em servidor sem tela; Wayland não é suportado)')
    const ids = (await xdo('search', '--onlyvisible', '--name', '')).split('\n').filter(Boolean)
    const out = []
    for (const id of ids) {
      try {
        const [title, pid, geo] = await Promise.all([
          xdo('getwindowname', id),
          xdo('getwindowpid', id),
          xdo('getwindowgeometry', '--shell', id)
        ])
        const g = Object.fromEntries(geo.trim().split('\n').map((l) => l.split('=')))
        let name = ''
        try {
          name = (await readFile(`/proc/${pid.trim()}/comm`, 'utf8')).trim()
        } catch {}
        out.push({ id: Number(id), title: title.trim(), pid: Number(pid), name, x: +g.X, y: +g.Y, width: +g.WIDTH, height: +g.HEIGHT })
      } catch {}
    }
    return out
  }

  async function pick(app, windowId) {
    const q = String(app ?? '').replace(/^pid:/i, '')
    const all = await windows()
    const w = all.find((x) => (windowId ? x.id === Number(windowId) : String(x.pid) === q || x.name === q || x.title.toLowerCase().includes(q.toLowerCase())))
    if (!w) throw new Error(`appNotFound("${app}")`)
    return w
  }

  async function focus(w, o) {
    if (o.restoreWindow ?? true) {
      try {
        await xdo('windowactivate', '--sync', String(w.id))
      } catch {
        // sem gerenciador de janelas (ex.: Xvfb puro) não há _NET_ACTIVE_WINDOW; foca direto no X
        await xdo('windowfocus', String(w.id))
        return
      }
    }
    const active = (await xdo('getactivewindow')).trim()
    if (active !== String(w.id)) throw new Error('window_not_focused')
  }

  async function capture(w) {
    for (const [cmd, args] of [['maim', ['-i', String(w.id)]], ['import', ['-window', String(w.id), 'png:-']]]) {
      try {
        return (await run(cmd, args, { binary: true })).toString('base64')
      } catch {}
    }
    throw new Error('sem captura: instale maim ou imagemagick (import)')
  }

  async function after(w, o) {
    const fresh = (await windows()).find((x) => x.id === w.id) ?? w
    return {
      window: { title: fresh.title, id: fresh.id, bounds: { x: fresh.x, y: fresh.y, width: fresh.width, height: fresh.height } },
      screenshotPngBase64: o.image ? await capture(fresh) : undefined
    }
  }

  const at = (w, o) => ['mousemove', '--window', String(w.id), String(Math.round(o.x)), String(Math.round(o.y))]

  return {
    name: 'linux',
    async listApps() {
      const seen = new Map()
      for (const w of await windows()) seen.set(w.pid, { name: w.name, pid: w.pid })
      return [...seen.values()]
    },
    async listWindows(app) {
      const q = String(app ?? '').replace(/^pid:/i, '')
      return (await windows()).filter((w) => !q || String(w.pid) === q || w.name === q)
    },
    async screenshot(o) {
      const w = await pick(o.app, o.windowId)
      return after(w, { ...o, image: o.image })
    },
    async click(o) {
      const w = await pick(o.app, o.windowId)
      await focus(w, o)
      const mods = (o.modifiers ?? '').split('+').filter(Boolean).map((m) => MODS[m.toLowerCase()] ?? m.toLowerCase())
      for (const m of mods) await xdo('keydown', m)
      try {
        await xdo(...at(w, o), 'click', '--repeat', String(o.count ?? 1), String(BUTTON[o.button ?? 'left']))
      } finally {
        for (const m of mods) await xdo('keyup', m)
      }
      return after(w, o)
    },
    async typeText(o) {
      const w = await pick(o.app, o.windowId)
      await focus(w, o)
      await xdo('type', '--delay', '12', '--', o.text)
      return after(w, o)
    },
    async pressKey(o) {
      const w = await pick(o.app, o.windowId)
      await focus(w, o)
      await xdo('key', keyName(o.key))
      return after(w, o)
    },
    async hotkey(o) {
      const w = await pick(o.app, o.windowId)
      await focus(w, o)
      await xdo('key', hotkeySpec(o.key))
      return after(w, o)
    },
    async pasteText(o) {
      const w = await pick(o.app, o.windowId)
      await focus(w, o)
      await new Promise((resolve, reject) => {
        const p = execFile('xclip', ['-selection', 'clipboard'], (e) => (e ? reject(e) : resolve()))
        p.stdin.end(o.text)
      })
      await xdo('key', 'ctrl+v')
      return after(w, o)
    },
    async scroll(o) {
      const w = await pick(o.app, o.windowId)
      await focus(w, o)
      await xdo(...at(w, o), 'click', '--repeat', String(o.pages ?? 1), String(WHEEL[o.direction]))
      return after(w, o)
    },
    async drag(o) {
      const w = await pick(o.app, o.windowId)
      await focus(w, o)
      await xdo(...at(w, { x: o.fromX, y: o.fromY }), 'mousedown', '1')
      await xdo(...at(w, { x: o.toX, y: o.toY }), 'mouseup', '1')
      return after(w, o)
    },
    async javaPath(pid) {
      return readlink(`/proc/${Number(pid)}/exe`)
    },
    close() {}
  }
}
