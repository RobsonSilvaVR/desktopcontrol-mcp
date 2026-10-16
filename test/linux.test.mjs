import test from 'node:test'
import assert from 'node:assert/strict'
import { createLinuxBackend, hotkeySpec, keyName } from '../backends/linux.mjs'

test('traduz teclas e atalhos para nomes do xdotool', () => {
  assert.equal(keyName('Enter'), 'Return')
  assert.equal(keyName('F1'), 'F1')
  assert.equal(hotkeySpec('CmdOrCtrl+Shift+A'), 'ctrl+shift+A')
})

test('click ativa a janela, move relativo à janela e clica', async () => {
  const calls = []
  const run = async (cmd, args) => {
    calls.push([cmd, ...args].join(' '))
    const sub = args[0]
    if (sub === 'search') return '100\n'
    if (sub === 'getwindowname') return 'Exemplo\n'
    if (sub === 'getwindowpid') return '1\n'
    if (sub === 'getwindowgeometry') return 'WINDOW=100\nX=0\nY=0\nWIDTH=800\nHEIGHT=600\n'
    if (sub === 'getactivewindow') return '100\n'
    return ''
  }
  run.fake = true
  const b = createLinuxBackend(run)
  await b.click({ app: 'Exemplo', x: 10, y: 20 })
  assert.ok(calls.includes('xdotool windowactivate --sync 100'))
  assert.ok(calls.includes('xdotool mousemove --window 100 10 20 click --repeat 1 1'))
})
