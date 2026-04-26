// Wrappers around `docker` and `docker compose` used by the e2e test.

import { execFile, execFileSync, spawn } from 'node:child_process'
import net from 'node:net'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

export const CONTAINER_NAME = 'futu-opend'

export function dockerAvailable () {
  try {
    execFileSync('docker', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export async function composeUp ({ composeFile, envFile, projectDir }) {
  await execFileP('docker', [
    'compose', '-f', composeFile, '--env-file', envFile,
    'up', '-d', '--build', '--force-recreate'
  ], { cwd: projectDir, maxBuffer: 16 * 1024 * 1024 })
}

export async function composeDown ({ composeFile, envFile, projectDir }) {
  // Propagate errors so callers can surface them (e.g. via debug logging).
  // Callers that want best-effort cleanup should wrap in try/catch.
  await execFileP('docker', [
    'compose', '-f', composeFile, '--env-file', envFile,
    'down', '-v', '--remove-orphans'
  ], { cwd: projectDir, maxBuffer: 16 * 1024 * 1024 })
}

export async function inspectHealth (container = CONTAINER_NAME) {
  try {
    const { stdout } = await execFileP('docker', [
      'inspect',
      '--format',
      '{{.State.Health.Status}}',
      container
    ])
    return stdout.trim()
  } catch {
    return 'missing'
  }
}

export async function inspectExitCode (container = CONTAINER_NAME) {
  try {
    const { stdout } = await execFileP('docker', [
      'inspect',
      '--format',
      '{{.State.ExitCode}}',
      container
    ])
    return Number.parseInt(stdout.trim(), 10)
  } catch {
    return null
  }
}

export async function pgrepFutuOpend (container = CONTAINER_NAME) {
  try {
    await execFileP('docker', ['exec', container, 'pgrep', 'FutuOpenD'])
    return true
  } catch {
    return false
  }
}

export async function getLogs (container = CONTAINER_NAME) {
  const { stdout, stderr } = await execFileP(
    'docker',
    ['logs', container],
    { maxBuffer: 16 * 1024 * 1024 }
  )
  return stdout + stderr
}

export async function waitForHealthy (container, timeoutMs, onTick) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const status = await inspectHealth(container)
    if (status === 'healthy') return status
    if (status === 'missing') {
      throw new Error(`container ${container} disappeared during startup`)
    }
    if (onTick) onTick(status)
    const exit = await inspectExitCode(container)
    if (exit !== null && exit !== 0 && status !== 'starting') {
      const logs = await getLogs(container).catch(() => '')
      throw new Error(
        `container ${container} exited early with code ${exit}.\n` +
        `--- last logs ---\n${logs.slice(-2000)}`
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  throw new Error(`container ${container} did not become healthy within ${timeoutMs}ms`)
}

// Tail container logs into a callback. Returns a stop() function.
// CR chars are stripped per line — OpenD uses mid-line `\r` (terminal
// cursor-rewrite style) on some log lines, e.g. `\r>>>\rWebSocket监听地址…`,
// which would otherwise break substring regex matches like /\>>>WebSocket监听地址/.
// Listener errors are caught so a bad regex in `onLine` doesn't crash the
// whole tail process; pass an `onError` callback to surface them (e.g. via
// a debug logger). When `onError` itself throws, the throw is swallowed.
export function tailLogs (container, onLine, onError) {
  const child = spawn('docker', ['logs', '-f', container], { stdio: ['ignore', 'pipe', 'pipe'] })
  let buf = ''
  function consume (chunk) {
    buf += chunk.toString()
    let nl
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).replace(/\r/g, '')
      buf = buf.slice(nl + 1)
      try {
        onLine(line)
      } catch (err) {
        if (onError) {
          try { onError(err, line) } catch { /* swallow */ }
        }
      }
    }
  }
  child.stdout.on('data', consume)
  child.stderr.on('data', consume)
  return () => {
    try { child.kill('SIGTERM') } catch { /* ignore */ }
  }
}

// Send a command to FutuOpenD's telnet control port (default 22222).
// `docker attach` to PID 1 silently drops input on this image — telnet
// is the supported automation entrypoint per README.md ("Method 2: telnet").
// CRLF line termination is required; bare LF gets eaten.
export function sendTelnetCommand (line, {
  host = '127.0.0.1',
  port = 22222,
  readForMs = 1500
} = {}) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, host)
    let buf = ''
    let settled = false
    function settle (err) {
      if (settled) return
      settled = true
      try { sock.end() } catch { /* ignore */ }
      try { sock.destroy() } catch { /* ignore */ }
      err ? reject(err) : resolve(buf)
    }
    sock.once('connect', () => {
      sock.write((line.endsWith('\r\n') ? line : line + '\r\n'))
    })
    sock.on('data', (chunk) => { buf += chunk.toString('utf8') })
    sock.once('error', settle)
    sock.once('end', () => settle(null))
    setTimeout(() => settle(null), readForMs)
  })
}
