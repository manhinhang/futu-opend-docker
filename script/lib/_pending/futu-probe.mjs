// Drives the futu-api npm SDK against a running OpenD container.
// Performs a real Futu OpenAPI handshake (the SDK's start() opens the
// WebSocket and runs the InitWebSocket / login dance), then issues a
// GetGlobalState round-trip — proof that login is end-to-end live.

const INIT_WAIT_MS = 30_000
const CALL_TIMEOUT_MS = 15_000

async function loadSdk () {
  const mod = await import('futu-api')
  return mod.default ?? mod
}

export async function probeOpenD ({
  host = '127.0.0.1',
  websocketPort = 33333,
  websocketKey = null
} = {}) {
  const Ftapi = await loadSdk()
  const client = new Ftapi()

  // The SDK fires `onlogin` once the WS handshake (Init cmd) completes.
  // ret === 0 means success in Futu's convention.
  const loginP = new Promise((resolve, reject) => {
    client.onlogin = (ret, msg) => {
      if (ret === 0) resolve({ ret, msg })
      else reject(new Error(`onlogin failed: ret=${ret} msg=${msg}`))
    }
    setTimeout(
      () => reject(new Error(`InitConnect (onlogin) timed out after ${INIT_WAIT_MS}ms`)),
      INIT_WAIT_MS
    )
  })

  // start(ip, port, ssl, key): creates the inner ftWebsocketBase, calls
  // setWsConfig + initWebSocket, and forwards onlogin from the inner socket.
  client.start(host, websocketPort, false, websocketKey)

  const initInfo = await loginP

  if (typeof client.GetGlobalState !== 'function') {
    throw new Error('futu-api SDK shape changed: GetGlobalState not found')
  }

  const stateRespP = client.GetGlobalState({ c2s: { userID: 0 } })
  const timeoutP = new Promise((_, reject) =>
    setTimeout(
      () => reject(new Error(`GetGlobalState timed out after ${CALL_TIMEOUT_MS}ms`)),
      CALL_TIMEOUT_MS
    )
  )
  const stateResp = await Promise.race([stateRespP, timeoutP])

  // Best-effort close.
  try {
    if (typeof client.stop === 'function') client.stop()
    if (client.websock && typeof client.websock.close === 'function') {
      client.websock.close()
    }
  } catch { /* ignore */ }

  return { initInfo, stateResp }
}
