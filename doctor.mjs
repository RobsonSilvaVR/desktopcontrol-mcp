import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const win = process.platform === 'win32'
const has = (cmd) => {
  try {
    execFileSync(win ? 'where' : 'which', [cmd], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
const results = []
const check = (name, ok, fix) => results.push({ name, ok, fix })

check('Node >= 18', Number(process.versions.node.split('.')[0]) >= 18, 'instale Node 18+')
if (win) {
  check('PowerShell', has('powershell.exe'), 'PowerShell 5.1 é necessário (vem com o Windows)')
} else {
  const hasScreen = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)
  const missing = ['xdotool', 'xclip'].filter((c) => !has(c))
  if (!has('maim') && !has('import')) missing.push('maim')
  if (process.env.WAYLAND_DISPLAY && !process.env.DISPLAY) check('Sessão X11', false, 'Wayland puro não é suportado: use uma sessão X11 ou Xvfb')
  if (!hasScreen) {
    const wm = ['openbox', 'fluxbox', 'matchbox-window-manager', 'icewm'].some(has)
    check('Tela virtual (Xvfb + gerenciador de janelas)', has('Xvfb') && wm, 'sem tela: sudo apt install xvfb openbox (e use launch_app com MCP_ENABLE_LAUNCH=1)')
  }
  check('xdotool, xclip e maim/imagemagick', missing.length === 0, `sudo apt install ${missing.join(' ')}`)
}
const javaHome = process.env.JAVA_HOME
check(
  'JDK para anexar em apps Swing (opcional)',
  has('java') || Boolean(javaHome),
  'sem Java no PATH/JAVA_HOME; sem isso inicie o app com -javaagent:<caminho>/swing/swing-agent.jar'
)
if (javaHome) check('JAVA_HOME/lib/tools.jar (só JDK 8; opcional)', existsSync(join(javaHome, 'lib', 'tools.jar')) || existsSync(join(javaHome, 'bin', win ? 'java.exe' : 'java')), 'JDK 8 precisa do tools.jar')

for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FALTA'} ${r.name}${r.ok ? '' : `  ->  ${r.fix}`}`)
process.exit(results.every((r) => r.ok) ? 0 : 1)
