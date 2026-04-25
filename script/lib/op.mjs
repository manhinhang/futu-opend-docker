// 1Password CLI helper for the e2e test.
// Reads credentials via `op read` so plaintext never lands in this repo.
// Vault and item IDs come from env: FUTU_OP_VAULT, FUTU_OP_ITEM.

import { execFileSync } from 'node:child_process'

class OpCliError extends Error {
  constructor (message, { cause } = {}) {
    super(message)
    this.name = 'OpCliError'
    if (cause) this.cause = cause
  }
}

function runOp (args) {
  try {
    return execFileSync('op', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trimEnd()
  } catch (err) {
    const stderr = (err.stderr || '').toString().trim()
    throw new OpCliError(
      `op ${args.join(' ')} failed: ${stderr || err.message}`,
      { cause: err }
    )
  }
}

export function assertOpReady () {
  try {
    execFileSync('op', ['--version'], { stdio: 'ignore' })
  } catch (err) {
    throw new OpCliError(
      'op CLI is not installed or not on PATH. Install: https://developer.1password.com/docs/cli/get-started',
      { cause: err }
    )
  }
  try {
    runOp(['whoami'])
  } catch (err) {
    throw new OpCliError(
      'op CLI is installed but not signed in. Run `eval $(op signin)` and retry.',
      { cause: err }
    )
  }
}

export function readFutuCredentials ({ vault, item } = {}) {
  vault = vault ?? process.env.FUTU_OP_VAULT
  item = item ?? process.env.FUTU_OP_ITEM
  if (!vault || !item) {
    throw new OpCliError(
      'FUTU_OP_VAULT and FUTU_OP_ITEM env vars must be set ' +
      '(or pass { vault, item } explicitly).'
    )
  }

  const username = runOp(['read', `op://${vault}/${item}/username`])
  const password = runOp(['read', `op://${vault}/${item}/password`])

  if (!username) throw new OpCliError('op returned empty username')
  if (!password) throw new OpCliError('op returned empty password')

  return { username, password }
}
