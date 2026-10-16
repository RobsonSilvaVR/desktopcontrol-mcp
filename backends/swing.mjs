import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join, delimiter } from 'node:path'
import { fileURLToPath } from 'node:url'

const AGENT_JAR = join(dirname(fileURLToPath(import.meta.url)), '..', 'swing', 'swing-agent.jar')
const portFile = (pid) => join(process.env.MCP_SWING_TMPDIR ?? tmpdir(), `mcp-swing-${pid}.json`)

const escapeArg = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n')

async function readInfo(pid) {
  return JSON.parse(await readFile(portFile(pid), 'utf8'))
}

function send(info, cmd, args) {
  return new Promise((resolve, reject) => {
    const sock = createConnection({ host: '127.0.0.1', port: info.port })
    let buf = ''
    sock.setEncoding('utf8')
    sock.setTimeout(15000, () => sock.destroy(new Error('timeout falando com o agente Swing')))
    sock.on('data', (d) => {
      buf += d
      if (buf.includes('\n')) {
        sock.end()
        try {
          const res = JSON.parse(buf.trim())
          res.ok ? resolve(res) : reject(new Error(res.error))
        } catch (e) {
          reject(e)
        }
      }
    })
    sock.on('error', reject)
    sock.write([info.token, cmd, ...args.map(escapeArg)].join('\t') + '\n')
  })
}

function run(cmd, args) {
  return new Promise((resolve, reject) =>
    execFile(cmd, args, { timeout: 30000 }, (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout)))
  )
}

/** Tenta a JVM do próprio app (mesma versão e bitness) e, se falhar, o JAVA_HOME. JDK 8 precisa do tools.jar. */
async function attach(pid, javaExe) {
  const exeName = process.platform === 'win32' ? 'java.exe' : 'java'
  const candidates = [javaExe, process.env.JAVA_HOME && join(process.env.JAVA_HOME, 'bin', exeName)].filter(Boolean)
  const errors = []
  for (const exe of candidates) {
    const base = dirname(dirname(exe))
    const tools = join(basename(base) === 'jre' ? dirname(base) : base, 'lib', 'tools.jar')
    const cp = [existsSync(tools) ? tools : null, AGENT_JAR].filter(Boolean).join(delimiter)
    try {
      await run(exe, ['-cp', cp, 'mcp.Attach', String(pid), AGENT_JAR])
      return
    } catch (e) {
      errors.push(`${exe}: ${String(e.message).split(/\r?\n/)[0]}`)
    }
  }
  throw new Error(`não foi possível anexar o agente (${errors.join('; ')}). Inicie o app com -javaagent:${AGENT_JAR}`)
}

export function createSwingClient(javaPath) {
  async function info(pid) {
    try {
      return await readInfo(pid)
    } catch {}
    const exe = await javaPath(pid)
    if (!exe) throw new Error(`processo ${pid} não encontrado`)
    await attach(pid, exe)
    for (let i = 0; i < 20; i++) {
      try {
        return await readInfo(pid)
      } catch {
        await new Promise((r) => setTimeout(r, 250))
      }
    }
    throw new Error('agente não iniciou (a JVM alvo precisa ser um JDK com Attach API habilitada)')
  }
  const call = async (pid, cmd, ...args) => send(await info(pid), cmd, args)

  return {
    tree: (pid, onlyText) => call(pid, 'tree', onlyText ? 'text' : ''),
    click: (pid, path) => call(pid, 'click', path),
    setText: (pid, path, text) => call(pid, 'settext', path, text),
    focus: (pid, path) => call(pid, 'focus', path),
    key: (pid, spec) => call(pid, 'key', spec),
    type: (pid, text) => call(pid, 'type', text),
    cells: (pid, path) => call(pid, 'cells', path)
  }
}
