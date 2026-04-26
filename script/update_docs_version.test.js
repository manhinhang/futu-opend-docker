const { describe, it } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  applyVersionUpdates,
  readStableVersion,
  syncFile,
  MARKER
} = require('./update_docs_version.js')

const STABLE = '10.4.6408'

function makeTmpDir (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'update-docs-version-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

describe('applyVersionUpdates — pattern based', () => {
  it('rewrites FUTU_OPEND_VER assignments inside code blocks', () => {
    const input = [
      '```bash',
      'docker build --build-arg FUTU_OPEND_VER=10.2.6208 .',
      '```'
    ].join('\n')
    const out = applyVersionUpdates(input, STABLE)
    assert.match(out, new RegExp(`FUTU_OPEND_VER=${STABLE}`))
    assert.doesNotMatch(out, /10\.2\.6208/)
  })

  it('rewrites Futu_OpenD tarball filenames', () => {
    const input = 'bash script/download_futu_opend.sh Futu_OpenD_10.2.6208_Ubuntu18.04.tar.gz'
    const out = applyVersionUpdates(input, STABLE)
    assert.strictEqual(
      out,
      `bash script/download_futu_opend.sh Futu_OpenD_${STABLE}_Ubuntu18.04.tar.gz`
    )
  })

  it('rewrites multiple FUTU_OPEND_VER occurrences on a single line', () => {
    const input = 'set FUTU_OPEND_VER=10.2.6208 then unset FUTU_OPEND_VER=10.2.6208'
    const out = applyVersionUpdates(input, STABLE)
    assert.strictEqual(
      out,
      `set FUTU_OPEND_VER=${STABLE} then unset FUTU_OPEND_VER=${STABLE}`
    )
  })
})

describe('applyVersionUpdates — marker based', () => {
  it('rewrites bare semvers on lines containing the marker', () => {
    const input = `| Stable OpenD | 10.2.6208 | source | ${MARKER}`
    const out = applyVersionUpdates(input, STABLE)
    assert.strictEqual(out, `| Stable OpenD | ${STABLE} | source | ${MARKER}`)
  })

  it('rewrites every semver on a marked line in one pass', () => {
    const input = `from 9.9.9999 to 10.2.6208 ${MARKER}`
    const out = applyVersionUpdates(input, STABLE)
    assert.strictEqual(out, `from ${STABLE} to ${STABLE} ${MARKER}`)
  })

  it('leaves marked lines without a semver untouched', () => {
    const input = `Some prose with the ${MARKER} marker but no version`
    const out = applyVersionUpdates(input, STABLE)
    assert.strictEqual(out, input)
  })
})

describe('applyVersionUpdates — guards against false positives', () => {
  it('does not rewrite legacy semver in unmarked prose', () => {
    const input = '| Build-arg default | 9.3.5308 | Dockerfile (legacy) |'
    const out = applyVersionUpdates(input, STABLE)
    assert.strictEqual(out, input)
  })

  it('does not rewrite unrelated semvers like dependency versions', () => {
    const input = '"jsdom": "24.1.3"'
    const out = applyVersionUpdates(input, STABLE)
    assert.strictEqual(out, input)
  })

  it('preserves trailing newlines and whitespace', () => {
    const input = 'FUTU_OPEND_VER=10.2.6208\n\n'
    const out = applyVersionUpdates(input, STABLE)
    assert.strictEqual(out, `FUTU_OPEND_VER=${STABLE}\n\n`)
  })
})

describe('applyVersionUpdates — idempotency', () => {
  it('returns identical output when applied twice', () => {
    const input = [
      '```',
      'docker build --build-arg FUTU_OPEND_VER=10.2.6208 .',
      '```',
      `| Stable OpenD | 10.2.6208 | ${MARKER}`,
      '| Legacy        | 9.3.5308 |'
    ].join('\n')

    const once = applyVersionUpdates(input, STABLE)
    const twice = applyVersionUpdates(once, STABLE)
    assert.strictEqual(twice, once)
  })
})

describe('readStableVersion', () => {
  it('returns stableVersion for a valid X.Y.Z string', (t) => {
    const dir = makeTmpDir(t)
    const file = path.join(dir, 'opend_version.json')
    fs.writeFileSync(file, JSON.stringify({ betaVersion: null, stableVersion: STABLE }))
    assert.strictEqual(readStableVersion(file), STABLE)
  })

  it('rejects regex-replacement specials masquerading as a version', (t) => {
    const dir = makeTmpDir(t)
    const file = path.join(dir, 'opend_version.json')
    fs.writeFileSync(file, JSON.stringify({ stableVersion: '$&' }))
    assert.throws(() => readStableVersion(file), /must match X\.Y\.Z/)
  })

  it('rejects non-string stableVersion', (t) => {
    const dir = makeTmpDir(t)
    const file = path.join(dir, 'opend_version.json')
    fs.writeFileSync(file, JSON.stringify({ stableVersion: 10.4 }))
    assert.throws(() => readStableVersion(file), /must match X\.Y\.Z/)
  })

  it('rejects partial semver like 1.2', (t) => {
    const dir = makeTmpDir(t)
    const file = path.join(dir, 'opend_version.json')
    fs.writeFileSync(file, JSON.stringify({ stableVersion: '1.2' }))
    assert.throws(() => readStableVersion(file), /must match X\.Y\.Z/)
  })
})

describe('syncFile', () => {
  it('rewrites a target file and reports true when content changed', (t) => {
    const dir = makeTmpDir(t)
    fs.writeFileSync(
      path.join(dir, 'doc.md'),
      'docker build --build-arg FUTU_OPEND_VER=10.2.6208 .\n'
    )
    const changed = syncFile('doc.md', STABLE, dir)
    assert.strictEqual(changed, true)
    assert.strictEqual(
      fs.readFileSync(path.join(dir, 'doc.md'), 'utf8'),
      `docker build --build-arg FUTU_OPEND_VER=${STABLE} .\n`
    )
  })

  it('returns false and preserves mtime when content already matches stable', (t) => {
    const dir = makeTmpDir(t)
    const file = path.join(dir, 'doc.md')
    const body = `FUTU_OPEND_VER=${STABLE}\n`
    fs.writeFileSync(file, body)
    const beforeMtimeMs = fs.statSync(file).mtimeMs

    const changed = syncFile('doc.md', STABLE, dir)
    assert.strictEqual(changed, false)
    assert.strictEqual(fs.statSync(file).mtimeMs, beforeMtimeMs)
    assert.strictEqual(fs.readFileSync(file, 'utf8'), body)
  })
})
