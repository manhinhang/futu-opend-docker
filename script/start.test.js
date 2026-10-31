const { describe, it } = require('node:test')
const assert = require('node:assert')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const PROJECT_DIR = path.resolve(__dirname, '..')
const START_SH = path.join(PROJECT_DIR, 'script', 'start.sh')
const XML_TEMPLATE = path.join(PROJECT_DIR, 'FutuOpenD.xml')

// Runs start.sh against a sandbox: the real XML template is the input, and
// /bin/FutuOpenD is replaced by a stub that records the argv it was launched
// with instead of starting a trading gateway.
function runStartSh (env = {}) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'futu-start-'))
  const binStub = path.join(sandbox, 'FutuOpenD')
  const argvFile = path.join(sandbox, 'argv')
  const xmlPath = path.join(sandbox, 'FutuOpenD.xml')

  fs.writeFileSync(binStub, `#!/bin/bash\nprintf '%s\\n' "$@" > ${argvFile}\n`, { mode: 0o755 })

  const result = spawnSync('bash', [START_SH], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      FUTU_OPEND_BIN: binStub,
      FUTU_OPEND_XML_SRC: XML_TEMPLATE,
      FUTU_OPEND_XML_PATH: xmlPath,
      FUTU_OPEND_IP: '0.0.0.0',
      FUTU_OPEND_PORT: '11111',
      FUTU_OPEND_TELNET_PORT: '22222',
      ...env
    }
  })

  const argv = fs.existsSync(argvFile)
    ? fs.readFileSync(argvFile, 'utf8').split('\n').filter(Boolean)
    : null
  const xml = fs.existsSync(xmlPath) ? fs.readFileSync(xmlPath, 'utf8') : null
  fs.rmSync(sandbox, { recursive: true, force: true })

  return { status: result.status, stdout: result.stdout, stderr: result.stderr, argv, xml }
}

// MD5 of 'hunter2' — a throwaway value, never a real credential.
const PWD_MD5 = '2ab96390c7dbe3439de74d0c9b0b1767'

describe('start.sh password login (default)', () => {
  it('templates the account and hash into the config, without remember flags', () => {
    const run = runStartSh({ FUTU_ACCOUNT_ID: '12345678', FUTU_ACCOUNT_PWD_MD5: PWD_MD5 })

    assert.strictEqual(run.status, 0)
    assert.match(run.stdout, /FUTU_OPEND_LOGIN_MODE: password/)
    assert.match(run.xml, /<login_account>12345678<\/login_account>/)
    assert.match(run.xml, new RegExp(`<login_pwd_md5>${PWD_MD5}</login_pwd_md5>`))
    assert.deepStrictEqual(run.argv.filter((arg) => arg.startsWith('-login')), [])
  })

  it('hashes the deprecated plaintext password and warns', () => {
    const run = runStartSh({ FUTU_ACCOUNT_ID: '12345678', FUTU_ACCOUNT_PWD: 'hunter2' })

    assert.strictEqual(run.status, 0)
    assert.match(run.stderr, /FUTU_ACCOUNT_PWD is deprecated/)
    assert.match(run.xml, new RegExp(`<login_pwd_md5>${PWD_MD5}</login_pwd_md5>`))
  })
})

describe('start.sh login-by-remember', () => {
  it('passes -login_account and -login_by_remember=1 to FutuOpenD', () => {
    const run = runStartSh({ FUTU_ACCOUNT_ID: '12345678', FUTU_OPEND_LOGIN_BY_REMEMBER: '1' })

    assert.strictEqual(run.status, 0)
    assert.match(run.stdout, /FUTU_OPEND_LOGIN_MODE: remember/)
    assert.ok(run.argv.includes('-login_account=12345678'))
    assert.ok(run.argv.includes('-login_by_remember=1'))
  })

  it('leaves no password material in the config', () => {
    const run = runStartSh({ FUTU_ACCOUNT_ID: '12345678', FUTU_OPEND_LOGIN_BY_REMEMBER: 'true' })

    assert.strictEqual(run.status, 0)
    assert.doesNotMatch(run.xml, /###FUTU_ACCOUNT_PWD_MD5###/)
    // The empty-string MD5 — what an unset password used to be hashed into.
    assert.doesNotMatch(run.xml, /d41d8cd98f00b204e9800998ecf8427e/)
    assert.match(run.xml, /<!-- <login_pwd_md5><\/login_pwd_md5> -->/)
    assert.match(run.xml, /<login_account>12345678<\/login_account>/)
  })

  it('ignores password env vars but still starts', () => {
    const run = runStartSh({
      FUTU_ACCOUNT_ID: '12345678',
      FUTU_ACCOUNT_PWD_MD5: PWD_MD5,
      FUTU_OPEND_LOGIN_BY_REMEMBER: '1'
    })

    assert.strictEqual(run.status, 0)
    assert.match(run.stderr, /password env vars are ignored/)
    assert.doesNotMatch(run.xml, new RegExp(PWD_MD5))
  })

  it('fails fast when FUTU_ACCOUNT_ID is missing', () => {
    const run = runStartSh({ FUTU_OPEND_LOGIN_BY_REMEMBER: '1' })

    assert.notStrictEqual(run.status, 0)
    assert.match(run.stderr, /requires FUTU_ACCOUNT_ID/)
    assert.strictEqual(run.argv, null)
  })

  it('rejects a value that is neither truthy nor falsy', () => {
    const run = runStartSh({ FUTU_ACCOUNT_ID: '12345678', FUTU_OPEND_LOGIN_BY_REMEMBER: 'maybe' })

    assert.notStrictEqual(run.status, 0)
    assert.match(run.stderr, /must be 1 or 0/)
    assert.strictEqual(run.argv, null)
  })

  it('treats 0 as plain password login', () => {
    const run = runStartSh({
      FUTU_ACCOUNT_ID: '12345678',
      FUTU_ACCOUNT_PWD_MD5: PWD_MD5,
      FUTU_OPEND_LOGIN_BY_REMEMBER: '0'
    })

    assert.strictEqual(run.status, 0)
    assert.match(run.stdout, /FUTU_OPEND_LOGIN_MODE: password/)
    assert.deepStrictEqual(run.argv.filter((arg) => arg.startsWith('-login')), [])
  })
})

describe('start.sh interactive login', () => {
  it('falls back to OpenD\'s prompt when no password is supplied', () => {
    const run = runStartSh({ FUTU_ACCOUNT_ID: '12345678' })

    assert.strictEqual(run.status, 0)
    assert.match(run.stdout, /FUTU_OPEND_LOGIN_MODE: interactive/)
    assert.match(run.xml, /<!-- <login_pwd_md5><\/login_pwd_md5> -->/)
    // The account still pre-fills the prompt.
    assert.match(run.xml, /<login_account>12345678<\/login_account>/)
    assert.deepStrictEqual(run.argv.filter((arg) => arg.startsWith('-login')), [])
  })

  it('comments out the account too when none is supplied', () => {
    const run = runStartSh({})

    assert.strictEqual(run.status, 0)
    assert.match(run.xml, /<!-- <login_account><\/login_account> -->/)
    assert.doesNotMatch(run.xml, /###FUTU_ACCOUNT_ID###/)
  })
})

describe('start.sh config templating', () => {
  it('still resolves ip, ports and the RSA key path', () => {
    const run = runStartSh({ FUTU_ACCOUNT_ID: '12345678', FUTU_ACCOUNT_PWD_MD5: PWD_MD5 })

    assert.match(run.xml, /<ip>0\.0\.0\.0<\/ip>/)
    assert.match(run.xml, /<api_port>11111<\/api_port>/)
    assert.match(run.xml, /<telnet_ip>0\.0\.0\.0<\/telnet_ip>/)
    assert.match(run.xml, /<telnet_port>22222<\/telnet_port>/)
    assert.match(run.xml, /<rsa_private_key>\/\.futu\/futu\.pem<\/rsa_private_key>/)
    assert.match(run.argv[0], /^-cfg_file=.*\/FutuOpenD\.xml$/)
  })

  it('enables websocket when a port is set', () => {
    const run = runStartSh({
      FUTU_ACCOUNT_ID: '12345678',
      FUTU_ACCOUNT_PWD_MD5: PWD_MD5,
      FUTU_OPEND_WEBSOCKET_PORT: '33333'
    })

    assert.strictEqual(run.status, 0)
    assert.match(run.xml, /<websocket_port>33333<\/websocket_port>/)
    assert.match(run.xml, /<websocket_ip>0\.0\.0\.0<\/websocket_ip>/)
  })
})
