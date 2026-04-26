// End-to-end test for the FutuOpenD Kubernetes example under k8s/.
//
// Two backends, selected via K8S_E2E_BACKEND:
//
//   `kind`     (default) — Spins up a kind cluster, side-loads the local
//              FutuOpenD image, applies k8s/. Validates **manifest
//              correctness** through durable signals:
//                - pod reaches Running with the main container Running
//                - init container exited 0
//                - logs contain `>>>API启用RSA: 是` (proves the secret-mounted
//                  futu.pem at defaultMode 0644 was readable by the futu UID)
//                - logs contain `>>>API监听地址` and `>>>Telnet监听地址`
//                  (proves the binary launched and bound its listeners)
//
//              **It does NOT assert successful Futu login.** Why: kind nodes
//              are docker containers on docker's bridge network; even with
//              hostNetwork the pod inherits the bridge-networked node
//              namespace, which CLAUDE.md flags as the cause of
//              `>>>登录失败,网络异常` ~45 s after a successful credential
//              check. After login fails, FutuOpenD exits → bash (PID 1)
//              exits → container restarts → CrashLoopBackOff. Live signals
//              (kubectl exec pgrep, port-forwarded TCP) become unreliable
//              under that cycling, so we only assert on durable log/status
//              evidence. Real-Futu integration is covered by
//              `npm run test:e2e` (docker compose) and the `existing` backend.
//
//   `existing` — Skips kind setup; uses the user's current `kubectl`
//              context. For real-host-network clusters (k3s on host,
//              microk8s, EKS, etc.). Asserts the FULL set including login,
//              live TCP probes through port-forward, WS handshake, no
//              `登录失败` markers.
//
// Local-only by design. Not wired into CI.
//
// Prerequisites (kind backend):
//   - kind on PATH (or KIND_BIN=/path/to/kind)
//   - kubectl on PATH
//   - docker daemon running
//   - ./futu.pem (mode 0644)
//   - The image present locally (kind side-loads from host docker)
//   - FUTU_ACCOUNT_ID / FUTU_ACCOUNT_PWD or .env.e2e
//
// Prerequisites (existing backend):
//   - kubectl on PATH with a context pointing at a real cluster
//   - The cluster must be able to access the image
//   - ./futu.pem, credentials as above
//
// Run: npm run test:k8s
//      K8S_E2E_BACKEND=existing npm run test:k8s

import { describe, before, after, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import net from 'node:net'

import {
  kindAvailable,
  kubectlAvailable,
  createKindCluster,
  deleteKindCluster,
  clusterExists,
  kindLoadImage,
  dockerImageExists,
  kubectlCreateNamespace,
  kubectlCreateSecretGeneric,
  kubectlApplyKustomize,
  kubectlGetPodPhase,
  kubectlGetContainerStatuses,
  kubectlGetInitContainerExitCode,
  kubectlExec,
  kubectlLogs,
  tailKubectlLogs,
  startPortForward,
  kubectlDescribePod,
  kubectlCurrentContext
} from './lib/k8s.mjs'
import { dockerAvailable } from './lib/docker.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT_DIR = resolve(HERE, '..')
const K8S_DIR = resolve(PROJECT_DIR, 'k8s')
const KIND_CONFIG = resolve(K8S_DIR, 'kind-config.yaml')
const PEM_FILE = resolve(PROJECT_DIR, 'futu.pem')
const ENV_FILE = resolve(PROJECT_DIR, '.env.e2e')

const BACKEND = (process.env.K8S_E2E_BACKEND ?? 'kind').toLowerCase()
if (!['kind', 'existing'].includes(BACKEND)) {
  throw new Error(`K8S_E2E_BACKEND must be "kind" or "existing", got "${BACKEND}"`)
}

const KIND_BIN = process.env.KIND_BIN ?? 'kind'
const CLUSTER_NAME = 'futu-opend-verify'
const NAMESPACE = 'futu-opend'
const SELECTOR = 'app=futu-opend'
const CONTAINER = 'futu-opend'
const INIT_CONTAINER = 'init-data-perms'
const SECRET_NAME = 'futu-credentials'
const IMAGE = process.env.K8S_E2E_IMAGE ?? 'ghcr.io/manhinhang/futu-opend-docker:ubuntu-stable'

let CONTEXT = null

const API_PORT = 11111
const TELNET_PORT = 22222
const WS_PORT = 33333
const SMS_DROP_FILE = '/tmp/futu-sms-code'

const TIMEOUTS = {
  ready: 480_000,
  podRunning: 240_000,
  tcpProbe: 1_500,
  wsHandshake: 5_000,
  smsDrop: 5 * 60 * 1000
}

const TWO_FA_RE = /(input_phone_verify_code|verify code|短信验证码|手机验证码)/i
const RSA_OK_RE = />>>API启用RSA: 是/
const API_LISTEN_RE = />>>API监听地址/
const TELNET_LISTEN_RE = />>>Telnet监听地址/
const READY_MARKER_RE = />>>WebSocket监听地址/
const LOGIN_FAIL_RE = />>>登录失败/

const debugLog = process.env.E2E_DEBUG
  ? (msg) => output.write(`[k8s-e2e:debug] ${msg}\n`)
  : () => {}

function preflight () {
  if (!kubectlAvailable()) {
    throw new Error('kubectl is not installed or not on PATH')
  }
  if (!existsSync(PEM_FILE)) {
    throw new Error(
      `Missing RSA key at ${PEM_FILE}. Generate with:\n` +
      '  openssl genrsa -out futu.pem 1024 && chmod 0644 futu.pem'
    )
  }
  if (BACKEND === 'kind') {
    if (!dockerAvailable()) {
      throw new Error('docker is not installed or not on PATH (kind backend needs it)')
    }
    if (!kindAvailable(KIND_BIN)) {
      throw new Error(
        `kind is not available at "${KIND_BIN}". ` +
        'Install with `go install sigs.k8s.io/kind@latest`, ' +
        'then set KIND_BIN=$HOME/go/bin/kind or add it to PATH.'
      )
    }
    if (!existsSync(KIND_CONFIG)) {
      throw new Error(`Missing ${KIND_CONFIG}. Re-run from a clean checkout — this file is committed.`)
    }
  }
}

// Minimal `.env`-style parser: ignores blank lines and `# …` comments,
// strips a single layer of matching surrounding quotes (so users who write
// FOO="bar" — the safer shape for compose env-files — don't end up with
// quote characters inside their password).
function parseEnvFile (text) {
  const map = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (!m) continue
    let value = m[2]
    const quoted = value.match(/^(['"])(.*)\1$/)
    if (quoted) value = quoted[2]
    map[m[1]] = value
  }
  return map
}

function readCredentials () {
  if (existsSync(ENV_FILE)) {
    const map = parseEnvFile(readFileSync(ENV_FILE, 'utf8'))
    if (map.FUTU_ACCOUNT_ID && map.FUTU_ACCOUNT_PWD) {
      output.write(`[k8s-e2e] credentials sourced from ${ENV_FILE}\n`)
      return { accountId: map.FUTU_ACCOUNT_ID, accountPwd: map.FUTU_ACCOUNT_PWD }
    }
  }
  const id = process.env.FUTU_ACCOUNT_ID
  const pwd = process.env.FUTU_ACCOUNT_PWD
  const missing = []
  if (!id) missing.push('FUTU_ACCOUNT_ID')
  if (!pwd) missing.push('FUTU_ACCOUNT_PWD')
  if (missing.length > 0) {
    throw new Error(
      `Missing env var(s): ${missing.join(', ')}. ` +
      'Set them in the shell or pre-populate .env.e2e.'
    )
  }
  if (/[\r\n]/.test(id) || /[\r\n]/.test(pwd)) {
    throw new Error('FUTU_ACCOUNT_ID/FUTU_ACCOUNT_PWD contain newline(s) — strip them.')
  }
  output.write(
    `[k8s-e2e] credentials from env: id length=${id.length}, pwd length=${pwd.length}\n`
  )
  return { accountId: id, accountPwd: pwd }
}

async function readSmsCodeFromDrop () {
  const deadline = Date.now() + TIMEOUTS.smsDrop
  output.write(
    '\n' +
    '╔══════════════════════════════════════════════════════════════════════╗\n' +
    '║  FutuOpenD is asking for an SMS verification code.                   ║\n' +
    '║  Check your phone, then write the code (digits only) to:             ║\n' +
    `║    ${SMS_DROP_FILE.padEnd(64)}    ║\n` +
    '║  Example: echo 123456 > /tmp/futu-sms-code                           ║\n' +
    '╚══════════════════════════════════════════════════════════════════════╝\n'
  )
  while (Date.now() < deadline) {
    if (existsSync(SMS_DROP_FILE)) {
      const code = readFileSync(SMS_DROP_FILE, 'utf8').trim()
      try { unlinkSync(SMS_DROP_FILE) } catch (err) { debugLog(`unlink ${SMS_DROP_FILE} failed: ${err.message}`) }
      if (!/^\d{4,8}$/.test(code)) {
        throw new Error(`Invalid SMS code format in ${SMS_DROP_FILE}: "${code}"`)
      }
      return code
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`No SMS code dropped at ${SMS_DROP_FILE} within ${TIMEOUTS.smsDrop}ms`)
}

async function promptAndSendSmsCode () {
  let code
  if (input.isTTY) {
    const rl = createInterface({ input, output })
    try {
      code = (await rl.question('Enter SMS code: ')).trim()
    } finally {
      rl.close()
    }
    if (!/^\d{4,8}$/.test(code)) {
      throw new Error(`Invalid SMS code format: "${code}"`)
    }
  } else {
    code = await readSmsCodeFromDrop()
  }
  const reply = await sendTelnetCommand({
    line: `input_phone_verify_code -code=${code}`,
    host: '127.0.0.1',
    port: TELNET_PORT
  })
  output.write(`[k8s-e2e] SMS code sent via telnet (got ${reply.length} bytes back)\n`)
}

function sendTelnetCommand ({ line, host, port, readForMs = 1500 }) {
  return new Promise((resolveOk, reject) => {
    const sock = net.connect(port, host)
    let buf = ''
    let settled = false
    function settle (err) {
      if (settled) return
      settled = true
      try { sock.end() } catch { /* ignore */ }
      try { sock.destroy() } catch { /* ignore */ }
      err ? reject(err) : resolveOk(buf)
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

function tcpProbe (port, host = '127.0.0.1', timeoutMs = TIMEOUTS.tcpProbe) {
  return new Promise((resolveOk) => {
    const sock = net.connect(port, host)
    const timer = setTimeout(() => { sock.destroy(); resolveOk(false) }, timeoutMs)
    sock.once('connect', () => { clearTimeout(timer); sock.end(); resolveOk(true) })
    sock.once('error', () => { clearTimeout(timer); resolveOk(false) })
  })
}

async function waitForPodRunning (timeoutMs = TIMEOUTS.podRunning) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const phase = await kubectlGetPodPhase({ selector: SELECTOR, namespace: NAMESPACE, context: CONTEXT })
    if (phase === 'Running') {
      const statuses = await kubectlGetContainerStatuses({
        selector: SELECTOR, namespace: NAMESPACE, context: CONTEXT
      })
      const main = statuses.find((s) => s.name === CONTAINER)
      if (main?.state?.running) return phase
      // On kind we may catch the pod between restarts (CrashLoopBackOff cycle).
      // Treat "container terminated with exitCode>0 but pod is Running and
      // about to restart" as transient on kind, not fatal.
      if (BACKEND !== 'kind' && main?.state?.terminated?.exitCode > 0) {
        const desc = await kubectlDescribePod({ selector: SELECTOR, namespace: NAMESPACE, context: CONTEXT })
        const logs = await kubectlLogs({
          selector: SELECTOR, namespace: NAMESPACE, container: CONTAINER, context: CONTEXT, previous: true
        })
        throw new Error(
          `pod entered Running but main container terminated (exit=${main.state.terminated.exitCode}).\n` +
          `--- describe ---\n${desc.slice(-1500)}\n--- last logs ---\n${logs.slice(-1500)}`
        )
      }
    }
    if (phase === 'Failed' || phase === 'Unknown') {
      const desc = await kubectlDescribePod({ selector: SELECTOR, namespace: NAMESPACE, context: CONTEXT })
      throw new Error(`pod entered phase ${phase}\n${desc.slice(-1500)}`)
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  const desc = await kubectlDescribePod({ selector: SELECTOR, namespace: NAMESPACE, context: CONTEXT })
  throw new Error(`pod did not reach Running within ${timeoutMs}ms\n${desc.slice(-1500)}`)
}

// Kind ready loop — log markers only. No port-forward, no SMS handler.
async function waitForKindReady (timeoutMs) {
  const deadline = Date.now() + timeoutMs

  let rsaOk = false
  let apiListenSeen = false
  let telnetListenSeen = false

  const stopTail = tailKubectlLogs({
    selector: SELECTOR,
    namespace: NAMESPACE,
    container: CONTAINER,
    context: CONTEXT,
    onLine: (line) => {
      if (RSA_OK_RE.test(line)) rsaOk = true
      if (API_LISTEN_RE.test(line)) apiListenSeen = true
      if (TELNET_LISTEN_RE.test(line)) telnetListenSeen = true
    },
    onError: (err, line) =>
      debugLog(`tailKubectlLogs listener threw on "${line.slice(0, 60)}…": ${err.message}`)
  })

  try {
    while (Date.now() < deadline) {
      if (rsaOk && apiListenSeen && telnetListenSeen) {
        return { rsaOk, apiListenSeen, telnetListenSeen }
      }
      output.write(
        `[k8s-e2e]   rsa=${rsaOk} api-listen=${apiListenSeen} telnet-listen=${telnetListenSeen}\n`
      )
      await new Promise((r) => setTimeout(r, 2000))
    }
    throw new Error(
      `kind manifest markers not all surfaced within ${timeoutMs}ms ` +
      `(rsa=${rsaOk}, api-listen=${apiListenSeen}, telnet-listen=${telnetListenSeen})`
    )
  } finally {
    stopTail()
  }
}

// Tail the existing-backend pod's logs and update mutable observation flags.
// Returns { state, stop } — `state` is the live observation object the poll
// loop reads each tick; `stop()` ends the tail.
//
// `state.smsError` is set if the prompt/send fails. The poll loop in
// `waitForExistingReady` reads it and throws — without this, a failed SMS
// path would log and reset `twoFaPending`, then re-fire the moment the next
// 2FA log line arrived, looping against Futu's rate limit.
function installExistingTail () {
  const state = {
    twoFaSent: false,
    twoFaPending: false,
    smsHandlerP: null,
    smsError: null,
    readyMarkerSeen: false,
    loginFailLine: null
  }
  const stop = tailKubectlLogs({
    selector: SELECTOR,
    namespace: NAMESPACE,
    container: CONTAINER,
    context: CONTEXT,
    onLine: (line) => {
      if (READY_MARKER_RE.test(line)) state.readyMarkerSeen = true
      if (LOGIN_FAIL_RE.test(line)) state.loginFailLine = line
      // Don't re-arm after an SMS failure: surfacing one error is more
      // useful than retrying into a rate-limit cliff.
      if (!state.twoFaPending && !state.twoFaSent && !state.smsError && TWO_FA_RE.test(line)) {
        state.twoFaPending = true
        state.smsHandlerP = promptAndSendSmsCode()
          .then(() => { state.twoFaSent = true })
          .catch((err) => {
            state.smsError = err
            output.write(`[k8s-e2e] SMS handler failed: ${err.message}\n`)
          })
          .finally(() => { state.twoFaPending = false; state.smsHandlerP = null })
      }
    },
    onError: (err, line) =>
      debugLog(`tailKubectlLogs listener threw on "${line.slice(0, 60)}…": ${err.message}`)
  })
  return { state, stop }
}

// Existing-cluster ready loop — log marker + live TCP probes + SMS handler.
async function waitForExistingReady (timeoutMs) {
  const deadline = Date.now() + timeoutMs
  const { state, stop: stopTail } = installExistingTail()
  try {
    while (Date.now() < deadline) {
      const phase = await kubectlGetPodPhase({ selector: SELECTOR, namespace: NAMESPACE, context: CONTEXT })
      if (phase === 'Failed' || phase === 'missing') {
        const logs = await kubectlLogs({
          selector: SELECTOR, namespace: NAMESPACE, container: CONTAINER, context: CONTEXT
        })
        throw new Error(`pod phase=${phase}.\n--- last logs ---\n${logs.slice(-2000)}`)
      }
      if (state.loginFailLine) {
        const logs = await kubectlLogs({
          selector: SELECTOR, namespace: NAMESPACE, container: CONTAINER, context: CONTEXT
        })
        throw new Error(
          `OpenD login failed: ${state.loginFailLine.trim()}\n--- last logs ---\n${logs.slice(-1500)}`
        )
      }
      if (state.smsError) {
        throw new Error(`SMS 2FA handling failed: ${state.smsError.message}`)
      }

      const apiUp = await tcpProbe(API_PORT)
      const wsUp = apiUp && (await tcpProbe(WS_PORT))

      if (state.readyMarkerSeen && apiUp && wsUp) {
        if (state.smsHandlerP) await state.smsHandlerP
        return { phase, twoFaSent: state.twoFaSent }
      }

      if (!state.twoFaPending) {
        output.write(`[k8s-e2e]   phase=${phase} api=${apiUp} ws=${wsUp} ws-marker=${state.readyMarkerSeen}\n`)
      }
      await new Promise((r) => setTimeout(r, 2000))
    }
    throw new Error(`pod did not become ready within ${timeoutMs}ms`)
  } finally {
    stopTail()
  }
}

function wsHandshake (host, port, { timeoutMs = TIMEOUTS.wsHandshake } = {}) {
  return new Promise((resolveOk, reject) => {
    const sock = net.connect(port, host)
    let buf = ''
    const timer = setTimeout(() => {
      sock.destroy()
      reject(new Error(`WS handshake timeout after ${timeoutMs}ms`))
    }, timeoutMs)
    sock.once('connect', () => {
      sock.write([
        'GET / HTTP/1.1',
        `Host: ${host}:${port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Version: 13',
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
        '',
        ''
      ].join('\r\n'))
    })
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8')
      if (buf.includes('\r\n\r\n')) {
        clearTimeout(timer)
        sock.destroy()
        resolveOk(buf)
      }
    })
    sock.once('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

const ctx = {
  reachedRunning: false,
  initContainerExitCode: null,
  twoFaSent: false,
  portForwardStop: null,
  clusterCreated: false,
  kindMarkers: { rsa: false, apiListen: false, telnetListen: false }
}

async function captureInitContainerStatus () {
  // Snapshot the init container's terminated state. On a healthy run the
  // init container has exited 0 and the kubelet keeps the status around.
  ctx.initContainerExitCode = await kubectlGetInitContainerExitCode({
    selector: SELECTOR,
    initContainer: INIT_CONTAINER,
    namespace: NAMESPACE,
    context: CONTEXT
  })
}

async function setupCluster () {
  preflight()
  const creds = readCredentials()

  if (BACKEND === 'kind') {
    if (!(await dockerImageExists(IMAGE))) {
      throw new Error(
        `Image ${IMAGE} not found locally. Build it first:\n` +
        '  docker build -t ' + IMAGE + ' \\\n' +
        '    --build-arg FUTU_OPEND_VER=$(jq -r .stableVersion opend_version.json) \\\n' +
        '    --target final-ubuntu-target .\n' +
        'Or override with K8S_E2E_IMAGE=<other-tag>.'
      )
    }

    if (await clusterExists({ name: CLUSTER_NAME, kindBin: KIND_BIN })) {
      output.write(`[k8s-e2e] kind cluster "${CLUSTER_NAME}" already exists — reusing\n`)
    } else {
      output.write(`[k8s-e2e] creating kind cluster "${CLUSTER_NAME}"…\n`)
      await createKindCluster({ name: CLUSTER_NAME, configFile: KIND_CONFIG, kindBin: KIND_BIN })
      ctx.clusterCreated = true
    }
    CONTEXT = `kind-${CLUSTER_NAME}`

    output.write(`[k8s-e2e] loading image ${IMAGE} into kind…\n`)
    await kindLoadImage({ image: IMAGE, clusterName: CLUSTER_NAME, kindBin: KIND_BIN })
  } else {
    const current = await kubectlCurrentContext()
    if (!current) {
      throw new Error(
        'K8S_E2E_BACKEND=existing but no kubectl context is set.\n' +
        'Run `kubectl config use-context <name>` first.'
      )
    }
    CONTEXT = current
    output.write(`[k8s-e2e] using existing kubectl context "${CONTEXT}"\n`)
    output.write(`[k8s-e2e] image must be reachable from this cluster: ${IMAGE}\n`)
  }

  output.write(`[k8s-e2e] creating namespace and secret…\n`)
  await kubectlCreateNamespace({ namespace: NAMESPACE, context: CONTEXT })
  await kubectlCreateSecretGeneric({
    name: SECRET_NAME,
    namespace: NAMESPACE,
    context: CONTEXT,
    // Both files and literals are piped to `kubectl apply -f -` on stdin
    // by the helper, so neither argv nor /proc/<pid>/cmdline ever sees the
    // password.
    fromFile: { 'futu.pem': PEM_FILE },
    fromLiteral: {
      FUTU_ACCOUNT_ID: creds.accountId,
      FUTU_ACCOUNT_PWD: creds.accountPwd
    }
  })

  output.write(`[k8s-e2e] kubectl apply -k k8s/…\n`)
  await kubectlApplyKustomize({ kustomizeDir: K8S_DIR, context: CONTEXT })

  output.write(`[k8s-e2e] waiting for pod to enter Running…\n`)
  await waitForPodRunning()
  ctx.reachedRunning = true

  // Snapshot init container exit code while the pod's status is fresh.
  await captureInitContainerStatus()

  if (BACKEND === 'kind') {
    output.write(`[k8s-e2e] waiting for manifest markers in logs (kind backend)…\n`)
    const markers = await waitForKindReady(TIMEOUTS.ready)
    ctx.kindMarkers = {
      rsa: markers.rsaOk,
      apiListen: markers.apiListenSeen,
      telnetListen: markers.telnetListenSeen
    }
    output.write(
      `[k8s-e2e] kind ready (rsa=${ctx.kindMarkers.rsa}, ` +
      `api-listen=${ctx.kindMarkers.apiListen}, telnet-listen=${ctx.kindMarkers.telnetListen})\n`
    )
  } else {
    output.write(`[k8s-e2e] starting port-forward (${API_PORT}, ${TELNET_PORT}, ${WS_PORT})…\n`)
    const pf = startPortForward({
      target: 'deployment/futu-opend',
      namespace: NAMESPACE,
      ports: [API_PORT, TELNET_PORT, WS_PORT],
      context: CONTEXT
    })
    ctx.portForwardStop = pf.stop
    await pf.ready

    output.write(`[k8s-e2e] waiting for OpenD to become ready (existing backend)…\n`)
    const ready = await waitForExistingReady(TIMEOUTS.ready)
    ctx.twoFaSent = ready.twoFaSent
    output.write(`[k8s-e2e] existing ready (phase=${ready.phase}, 2FA handled=${ctx.twoFaSent})\n`)
  }
}

async function fullCleanup () {
  if (ctx.portForwardStop) {
    try { ctx.portForwardStop() } catch (err) { debugLog(`port-forward stop failed: ${err.message}`) }
    ctx.portForwardStop = null
  }
  if (BACKEND === 'kind' && ctx.clusterCreated) {
    try {
      await deleteKindCluster({ name: CLUSTER_NAME, kindBin: KIND_BIN })
    } catch (err) {
      debugLog(`kind delete failed: ${err.message}`)
    }
  } else {
    debugLog(BACKEND === 'existing'
      ? 'leaving existing cluster in place (run `kubectl delete -k k8s/` to clean up)'
      : `leaving cluster ${CLUSTER_NAME} in place (we did not create it)`)
  }
}

let signalCleanupArmed = false
function armSignalCleanup () {
  if (signalCleanupArmed) return
  signalCleanupArmed = true
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.once(sig, () => {
      fullCleanup().finally(() => process.exit(130))
    })
  }
}

describe(`FutuOpenD k8s example e2e (backend=${BACKEND})`, () => {
  before(async () => {
    armSignalCleanup()
    await setupCluster()
  })

  after(async () => {
    await fullCleanup()
  })

  // --- common assertions ---

  it('pod reached Running phase with main container Running', () => {
    assert.equal(ctx.reachedRunning, true, 'waitForPodRunning never confirmed Running')
  })

  it('init container exited 0 (PVC chown succeeded)', () => {
    assert.equal(
      ctx.initContainerExitCode, 0,
      `initContainerExitCode=${ctx.initContainerExitCode} (expected 0; null means status not captured)`
    )
  })

  // --- kind-only assertions: durable log signals ---

  it('logs show RSA was enabled (secret 0644 readable by futu UID)', { skip: BACKEND !== 'kind' }, () => {
    assert.equal(ctx.kindMarkers.rsa, true, 'expected `>>>API启用RSA: 是` in logs')
  })

  it('logs show API listener bound', { skip: BACKEND !== 'kind' }, () => {
    assert.equal(ctx.kindMarkers.apiListen, true, 'expected `>>>API监听地址` in logs')
  })

  it('logs show Telnet listener bound', { skip: BACKEND !== 'kind' }, () => {
    assert.equal(ctx.kindMarkers.telnetListen, true, 'expected `>>>Telnet监听地址` in logs')
  })

  // --- existing-only assertions: live signals ---

  it('FutuOpenD process is running inside the pod', { skip: BACKEND !== 'existing' }, async () => {
    await kubectlExec({
      selector: SELECTOR,
      namespace: NAMESPACE,
      container: CONTAINER,
      context: CONTEXT,
      cmd: ['pgrep', 'FutuOpenD']
    })
  })

  it('TCP API port is reachable through the port-forward', { skip: BACKEND !== 'existing' }, async () => {
    await new Promise((resolveOk, reject) => {
      const sock = net.connect(API_PORT, '127.0.0.1')
      const timer = setTimeout(() => {
        sock.destroy()
        reject(new Error(`TCP connect to 127.0.0.1:${API_PORT} timed out`))
      }, 5000)
      sock.once('connect', () => {
        clearTimeout(timer)
        sock.end()
        resolveOk()
      })
      sock.once('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
    })
  })

  it('logs do not contain a login-failure marker', { skip: BACKEND !== 'existing' }, async () => {
    const logs = await kubectlLogs({
      selector: SELECTOR, namespace: NAMESPACE, container: CONTAINER, context: CONTEXT
    })
    const failurePatterns = [
      /login\s*fail/i,
      /password\s*error/i,
      /密码错误/,
      /登录失败/,
      /verify\s*code\s*error/i
    ]
    for (const re of failurePatterns) {
      assert.ok(!re.test(logs), `log matched failure pattern ${re}: ${logs.match(re)?.[0]}`)
    }
  })

  it('WebSocket handshake completes with HTTP 101', { skip: BACKEND !== 'existing' }, async () => {
    const response = await wsHandshake('127.0.0.1', WS_PORT)
    assert.match(response, /^HTTP\/1\.1 101 /, `expected 101 Switching Protocols, got: ${response.split('\r\n')[0]}`)
    assert.match(response, /Upgrade: WebSocket/i)
    assert.match(response, /Sec-WebSocket-Accept:/i)
  })

  it('pod still Running after API exercise', { skip: BACKEND !== 'existing' }, async () => {
    const phase = await kubectlGetPodPhase({ selector: SELECTOR, namespace: NAMESPACE, context: CONTEXT })
    assert.equal(phase, 'Running')
  })
})
