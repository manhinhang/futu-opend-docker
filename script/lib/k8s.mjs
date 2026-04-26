// Wrappers around `kind` and `kubectl` used by the k8s e2e test.
// Mirrors script/lib/docker.mjs in shape so the two harnesses stay analogous.

import { execFile, execFileSync, spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

// Most read wrappers below catch errors and return a sentinel ("missing", null,
// []) so the caller can keep polling without writing try/catch at every site.
// That's fine for the happy path but hides the underlying cause when the
// harness times out (e.g. a stale kubeconfig produces "phase=missing,
// statuses=[]" indistinguishable from a genuinely missing pod). Gate a debug
// channel on E2E_DEBUG so failed runs can be re-run with the real reason
// surfaced on stderr.
const debugLog = process.env.E2E_DEBUG
  ? (msg) => process.stderr.write(`[k8s-lib:debug] ${msg}\n`)
  : () => {}

export function kindAvailable (kindBin = 'kind') {
  try {
    execFileSync(kindBin, ['version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export function kubectlAvailable () {
  // `kubectl --version` was dropped in newer releases; use `version --client`
  // which doesn't require a reachable apiserver.
  try {
    execFileSync('kubectl', ['version', '--client'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export async function createKindCluster ({ name, configFile, kindBin = 'kind' }) {
  await execFileP(kindBin, [
    'create', 'cluster',
    '--name', name,
    '--config', configFile
  ], { maxBuffer: 16 * 1024 * 1024 })
}

export async function deleteKindCluster ({ name, kindBin = 'kind' }) {
  await execFileP(kindBin, ['delete', 'cluster', '--name', name], { maxBuffer: 16 * 1024 * 1024 })
}

export async function clusterExists ({ name, kindBin = 'kind' }) {
  const { stdout } = await execFileP(kindBin, ['get', 'clusters'])
  return stdout.split('\n').map((s) => s.trim()).includes(name)
}

// Side-load a locally built/pulled image into the kind node so the kubelet
// doesn't need to pull from a registry. Critical for environments where the
// kind node has flaky egress to ghcr.io.
export async function kindLoadImage ({ image, clusterName, kindBin = 'kind' }) {
  await execFileP(kindBin, [
    'load', 'docker-image', image,
    '--name', clusterName
  ], { maxBuffer: 16 * 1024 * 1024 })
}

export async function dockerImageExists (image) {
  try {
    await execFileP('docker', ['image', 'inspect', image], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export async function kubectlCreateNamespace ({ namespace, context }) {
  // Idempotent — swallow "already exists" so the harness can be re-run.
  try {
    await execFileP('kubectl', [
      ...kubectlContextArgs(context),
      'create', 'namespace', namespace
    ])
  } catch (err) {
    if (!/AlreadyExists/.test(err.stderr ?? '')) throw err
  }
}

// Create (or replace) a generic Secret. Both files and literals are piped to
// `kubectl apply -f -` as a single Secret manifest on stdin — secret values
// never appear in argv (no /proc/<pid>/cmdline exposure on shared hosts).
//
// Args:
//   - fromFile:    { secretKey: filePath }   — file contents → data (base64)
//   - fromLiteral: { secretKey: stringValue } — string → stringData
export async function kubectlCreateSecretGeneric ({
  name,
  namespace,
  fromFile = {},
  fromLiteral = {},
  context
}) {
  const data = {}
  for (const [k, path] of Object.entries(fromFile)) {
    const buf = await fs.readFile(path)
    data[k] = buf.toString('base64')
  }
  const manifest = {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: { name, namespace },
    type: 'Opaque',
    ...(Object.keys(data).length ? { data } : {}),
    ...(Object.keys(fromLiteral).length ? { stringData: fromLiteral } : {})
  }

  // `kubectl apply` is idempotent (create-or-update), so we don't need a
  // separate delete step. Streaming via stdin keeps all values out of argv.
  await new Promise((resolve, reject) => {
    const child = spawn('kubectl', [
      ...kubectlContextArgs(context),
      '-n', namespace,
      'apply', '-f', '-'
    ], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (c) => { stderr += c.toString() })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`kubectl apply secret failed (exit ${code}):\n${stderr}`))
    })
    child.stdin.write(JSON.stringify(manifest))
    child.stdin.end()
  })
}

export async function kubectlApplyKustomize ({ kustomizeDir, context }) {
  await execFileP('kubectl', [
    ...kubectlContextArgs(context),
    'apply', '-k', kustomizeDir
  ], { maxBuffer: 16 * 1024 * 1024 })
}

export async function kubectlGetPodName ({ selector, namespace, context }) {
  try {
    const { stdout } = await execFileP('kubectl', [
      ...kubectlContextArgs(context),
      '-n', namespace,
      'get', 'pod', '-l', selector,
      '-o', 'jsonpath={.items[0].metadata.name}'
    ])
    return stdout.trim() || null
  } catch (err) {
    debugLog(`kubectlGetPodName(${selector}) failed: ${err.message}`)
    return null
  }
}

export async function kubectlGetPodPhase ({ selector, namespace, context }) {
  try {
    const { stdout } = await execFileP('kubectl', [
      ...kubectlContextArgs(context),
      '-n', namespace,
      'get', 'pod', '-l', selector,
      '-o', 'jsonpath={.items[0].status.phase}'
    ])
    return stdout.trim() || 'missing'
  } catch (err) {
    debugLog(`kubectlGetPodPhase(${selector}) failed: ${err.message}`)
    return 'missing'
  }
}

// Returns a JSON-parsed array of container statuses for the pod matching
// `selector`. Each entry has fields like .ready, .restartCount, .state.
export async function kubectlGetContainerStatuses ({ selector, namespace, context }) {
  try {
    const { stdout } = await execFileP('kubectl', [
      ...kubectlContextArgs(context),
      '-n', namespace,
      'get', 'pod', '-l', selector,
      '-o', 'jsonpath={.items[0].status.containerStatuses}'
    ])
    if (!stdout.trim()) return []
    return JSON.parse(stdout)
  } catch (err) {
    debugLog(`kubectlGetContainerStatuses(${selector}) failed: ${err.message}`)
    return []
  }
}

// Snapshot the init container's terminated exit code (or null if the
// container is still running / status missing). Single jsonpath read against
// the pod, no JSON parse needed on this side.
//
// `initContainer` is interpolated into a jsonpath string filter. We restrict
// it to the kubernetes DNS-1123 label charset (the only legal shape for a
// container name anyway) so a stray quote can't corrupt the jsonpath.
export async function kubectlGetInitContainerExitCode ({
  selector,
  initContainer,
  namespace,
  context
}) {
  if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(initContainer)) {
    throw new Error(
      `invalid init container name: ${JSON.stringify(initContainer)} ` +
      '(must match DNS-1123 label rules)'
    )
  }
  try {
    const { stdout } = await execFileP('kubectl', [
      ...kubectlContextArgs(context),
      '-n', namespace,
      'get', 'pod', '-l', selector,
      '-o', `jsonpath={.items[0].status.initContainerStatuses[?(@.name=="${initContainer}")].state.terminated.exitCode}`
    ])
    const code = stdout.trim()
    return code === '' ? null : Number.parseInt(code, 10)
  } catch (err) {
    debugLog(`kubectlGetInitContainerExitCode(${initContainer}) failed: ${err.message}`)
    return null
  }
}

export async function kubectlExec ({
  selector,
  namespace,
  container,
  cmd,
  context
}) {
  const podName = await kubectlGetPodName({ selector, namespace, context })
  if (!podName) throw new Error(`no pod matching selector ${selector} in ${namespace}`)
  const args = [
    ...kubectlContextArgs(context),
    '-n', namespace,
    'exec', podName
  ]
  if (container) args.push('-c', container)
  args.push('--', ...cmd)
  return execFileP('kubectl', args, { maxBuffer: 16 * 1024 * 1024 })
}

export async function kubectlLogs ({
  selector,
  namespace,
  container,
  context,
  previous = false,
  tail = 0
}) {
  const podName = await kubectlGetPodName({ selector, namespace, context })
  if (!podName) return ''
  const args = [
    ...kubectlContextArgs(context),
    '-n', namespace,
    'logs', podName
  ]
  if (container) args.push('-c', container)
  if (previous) args.push('--previous')
  if (tail > 0) args.push(`--tail=${tail}`)
  try {
    const { stdout, stderr } = await execFileP('kubectl', args, { maxBuffer: 16 * 1024 * 1024 })
    return stdout + stderr
  } catch (err) {
    debugLog(`kubectlLogs failed: ${err.message}`)
    return (err.stdout ?? '') + (err.stderr ?? '')
  }
}

// Streams kubectl logs into onLine, similar to docker.mjs::tailLogs.
// CR-stripped per line for the same OpenD `\r` cursor-rewrite quirk.
//
// Cap the inter-line buffer at MAX_LINE_BYTES — if a stalled stream or a
// pathologically long line never produces a `\n`, we'd otherwise keep
// concatenating chunks until the process OOMs.
const MAX_LINE_BYTES = 1 * 1024 * 1024
export function tailKubectlLogs ({
  selector,
  namespace,
  container,
  context,
  onLine,
  onError
}) {
  let child = null
  let stopped = false
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
    // Cap unbounded growth on stalled streams (no newline ever arrives).
    // Keep the trailing window so a delayed newline still emits something
    // useful, just truncated.
    if (buf.length > MAX_LINE_BYTES) {
      buf = buf.slice(-MAX_LINE_BYTES)
    }
  }

  // kubectl logs -f against `-l <selector>` only follows existing pods at
  // start time; we also use --max-log-requests=1 since we only have one pod.
  // If the first attempt fails (pod not yet scheduled), retry until stopped.
  async function start () {
    while (!stopped) {
      const podName = await kubectlGetPodName({ selector, namespace, context })
      if (!podName) {
        await new Promise((r) => setTimeout(r, 1000))
        continue
      }
      const args = [
        ...kubectlContextArgs(context),
        '-n', namespace,
        'logs', '-f', podName
      ]
      if (container) args.push('-c', container)
      child = spawn('kubectl', args, { stdio: ['ignore', 'pipe', 'pipe'] })
      child.stdout.on('data', consume)
      child.stderr.on('data', consume)
      await new Promise((r) => child.once('exit', r))
      child = null
      // Re-attach on container restart so we keep tailing the new instance.
      if (!stopped) await new Promise((r) => setTimeout(r, 500))
    }
  }
  start().catch((err) => { if (onError) try { onError(err, '') } catch { /* swallow */ } })

  return () => {
    stopped = true
    if (child) {
      try { child.kill('SIGTERM') } catch { /* ignore */ }
    }
  }
}

// Spawn kubectl port-forward and return { stop, ready } where `ready`
// resolves once kubectl reports a "Forwarding from 127.0.0.1:<port> -> ..."
// line for every requested host port. With hostNetwork pods, port-forward
// still works because it goes through the kube API server, not the pod's
// network namespace.
//
// `target` is a kubectl resource reference like `deployment/futu-opend` or a
// pod name — `-l <selector>` is NOT a supported flag for port-forward.
//
// Verifies the bound host port matches the requested one. kubectl falls back
// to a random free port when the requested port is already in use on the
// host (e.g. a real OpenD running outside the cluster); without this check
// downstream `tcpProbe(API_PORT)` would silently connect to nothing.
const FORWARDING_LINE_RE = /Forwarding from \S+?:(\d+) ->/g

function parseRequestedHostPort (spec) {
  // spec shapes: number (1234), "1234" (same on both sides), "host:remote"
  if (typeof spec === 'number') return spec
  const str = String(spec)
  const colon = str.indexOf(':')
  return Number.parseInt(colon >= 0 ? str.slice(0, colon) : str, 10)
}

export function startPortForward ({
  target,
  namespace,
  ports,
  context,
  readyTimeoutMs = 15_000
}) {
  const requestedHostPorts = ports.map(parseRequestedHostPort)
  const args = [
    ...kubectlContextArgs(context),
    '-n', namespace,
    'port-forward', target,
    ...ports.map((p) => (typeof p === 'string' ? p : `${p}:${p}`))
  ]
  const child = spawn('kubectl', args, { stdio: ['ignore', 'pipe', 'pipe'] })

  let stdoutBuf = ''
  let stderrBuf = ''
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(
        `port-forward did not become ready within ${readyTimeoutMs}ms\n` +
        `--- stdout ---\n${stdoutBuf}\n--- stderr ---\n${stderrBuf}`
      ))
    }, readyTimeoutMs)
    child.stdout.on('data', (chunk) => {
      stdoutBuf += chunk.toString()
      // kubectl emits "Forwarding from 127.0.0.1:N -> ..." and a matching
      // "[::1]:N -> ..." line per port, possibly across multiple chunks.
      // Dedupe via Set and fail eagerly on the first surprise port number.
      const boundPorts = new Set()
      FORWARDING_LINE_RE.lastIndex = 0
      let m
      while ((m = FORWARDING_LINE_RE.exec(stdoutBuf)) !== null) {
        boundPorts.add(Number.parseInt(m[1], 10))
      }
      const unexpected = [...boundPorts].filter((p) => !requestedHostPorts.includes(p))
      if (unexpected.length > 0) {
        clearTimeout(timer)
        reject(new Error(
          `port-forward bound to host port(s) we didn't request: ` +
          `unexpected=[${unexpected.join(', ')}], ` +
          `requested=[${requestedHostPorts.join(', ')}]. ` +
          `kubectl falls back to a random free port when the requested host ` +
          `port is already in use — likely something else is bound on the ` +
          `local machine.`
        ))
        return
      }
      if (requestedHostPorts.every((p) => boundPorts.has(p))) {
        clearTimeout(timer)
        resolve()
      }
    })
    child.stderr.on('data', (chunk) => {
      stderrBuf += chunk.toString()
    })
    child.once('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(
        `port-forward exited with code ${code} before becoming ready\n` +
        `--- stdout ---\n${stdoutBuf}\n--- stderr ---\n${stderrBuf}`
      ))
    })
  })

  function stop () {
    try { child.kill('SIGTERM') } catch { /* ignore */ }
  }
  return { stop, ready }
}

// Returns the user's current kubectl context name, or null if none is set.
// Used by the e2e harness to detect whether `K8S_E2E_BACKEND=existing` has
// a context to attach to.
export async function kubectlCurrentContext () {
  try {
    const { stdout } = await execFileP('kubectl', ['config', 'current-context'])
    const ctx = stdout.trim()
    return ctx || null
  } catch {
    return null
  }
}

export async function kubectlDescribePod ({ selector, namespace, context }) {
  try {
    const { stdout } = await execFileP('kubectl', [
      ...kubectlContextArgs(context),
      '-n', namespace,
      'describe', 'pod', '-l', selector
    ], { maxBuffer: 16 * 1024 * 1024 })
    return stdout
  } catch (err) {
    debugLog(`kubectlDescribePod failed: ${err.message}`)
    return (err.stdout ?? '') + (err.stderr ?? '')
  }
}

function kubectlContextArgs (context) {
  return context ? ['--context', context] : []
}
