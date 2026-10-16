import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Em Linux sem tela sobe um Xvfb próprio; os apps lançados depois aparecem nele. */
export async function ensureDisplay() {
  if (process.platform !== 'linux' || process.env.DISPLAY || process.env.WAYLAND_DISPLAY) return
  if (existsSync('/tmp/.X11-unix/X99')) {
    process.env.DISPLAY = ':99'
    return
  }
  const xvfb = spawn('Xvfb', [':99', '-screen', '0', '1280x800x24'], { detached: true, stdio: 'ignore' })
  await new Promise((resolve, reject) => {
    xvfb.once('spawn', resolve)
    xvfb.once('error', () => reject(new Error('sem tela e sem Xvfb: instale xvfb (apt install xvfb)')))
  })
  xvfb.unref()
  process.env.DISPLAY = ':99'
  await sleep(800)
  // sem gerenciador de janelas o X não entrega foco/teclado a apps Java
  for (const wm of ['openbox', 'fluxbox', 'matchbox-window-manager', 'icewm']) {
    const child = spawn(wm, [], { detached: true, stdio: 'ignore', env: process.env })
    const started = await new Promise((resolve) => {
      child.once('spawn', () => resolve(true))
      child.once('error', () => resolve(false))
    })
    if (started) {
      child.unref()
      await sleep(500)
      break
    }
  }
}

export async function launchApp(command, args = []) {
  await ensureDisplay()
  const child = spawn(command, args, { detached: true, stdio: 'ignore' })
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })
  child.unref()
  return { pid: child.pid }
}
