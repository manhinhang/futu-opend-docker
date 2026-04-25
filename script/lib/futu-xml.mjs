// Generate a temporary FutuOpenD.xml variant for the e2e test.
//
// The shipped FutuOpenD.xml has `<websocket_port>` commented out and
// `<websocket_ip>` defaults to 127.0.0.1. The e2e test asserts the WebSocket
// upgrade works against the published image, so we:
//   1. uncomment the port,
//   2. bind WS to 0.0.0.0 so docker port mapping can reach it from the host
//      (loopback inside the container is unreachable from outside).

import { readFileSync, writeFileSync } from 'node:fs'

export function buildE2eXml (sourceXmlPath, {
  websocketPort = 33333,
  websocketIp = '0.0.0.0'
} = {}) {
  const original = readFileSync(sourceXmlPath, 'utf8')

  let out = original.replace(
    /<!--\s*<websocket_port>\d+<\/websocket_port>\s*-->/,
    `<websocket_port>${websocketPort}</websocket_port>`
  )

  if (out === original) {
    throw new Error(
      `Could not find a commented <websocket_port> tag in ${sourceXmlPath}. ` +
      'Update buildE2eXml to match the current XML template.'
    )
  }

  // Insert <websocket_ip> if not already present.
  // The shipped XML has it commented out; we replace that comment.
  // If neither comment nor tag is present, inject before <websocket_port>.
  const ipPatterns = [
    /<!--\s*<websocket_ip>[^<]*<\/websocket_ip>\s*-->/,
    /<websocket_ip>[^<]*<\/websocket_ip>/
  ]
  let ipInjected = false
  for (const pat of ipPatterns) {
    const replaced = out.replace(pat, `<websocket_ip>${websocketIp}</websocket_ip>`)
    if (replaced !== out) {
      out = replaced
      ipInjected = true
      break
    }
  }
  if (!ipInjected) {
    out = out.replace(
      /(<websocket_port>\d+<\/websocket_port>)/,
      `<websocket_ip>${websocketIp}</websocket_ip>\n\t\t$1`
    )
  }

  return out
}

export function writeE2eXml (sourceXmlPath, destPath, options) {
  const content = buildE2eXml(sourceXmlPath, options)
  writeFileSync(destPath, content, 'utf8')
  return destPath
}
