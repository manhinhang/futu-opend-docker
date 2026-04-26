// Sync FutuOpenD stableVersion across docs and .env in lockstep with
// opend_version.json. Invoked by the daily Check Futu OpenD Version
// workflow after check_version.js writes the JSON, so the same auto-merge
// PR carries both the source-of-truth bump and every downstream literal.
//
// If you run this manually and abort mid-way, your working tree may be
// partially rewritten — re-run or `git checkout` to recover.

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const VERSION_FILE = path.join(ROOT, 'opend_version.json')

const TARGET_FILES = [
  'README.md',
  'CLAUDE.md',
  'AGENTS.md',
  'docs/E2E.md',
  '.env'
]

const MARKER = '<!-- futu-opend-version -->'
const SEMVER = '\\d+\\.\\d+\\.\\d+'
const STABLE_VERSION_RE = /^\d+\.\d+\.\d+$/
const BUILD_ARG_RE = new RegExp(`FUTU_OPEND_VER=${SEMVER}`, 'g')
const TARBALL_RE = new RegExp(`Futu_OpenD_${SEMVER}_`, 'g')
const BARE_SEMVER_RE = new RegExp(SEMVER, 'g')

function applyVersionUpdates (content, stableVersion) {
  return content
    .split('\n')
    .map((line) => {
      let next = line
        .replace(BUILD_ARG_RE, `FUTU_OPEND_VER=${stableVersion}`)
        .replace(TARBALL_RE, `Futu_OpenD_${stableVersion}_`)
      if (next.includes(MARKER)) {
        next = next.replace(BARE_SEMVER_RE, stableVersion)
      }
      return next
    })
    .join('\n')
}

function readStableVersion (versionFile = VERSION_FILE) {
  const raw = fs.readFileSync(versionFile, 'utf8')
  const data = JSON.parse(raw)
  if (typeof data.stableVersion !== 'string' || !STABLE_VERSION_RE.test(data.stableVersion)) {
    throw new Error(
      `opend_version.json stableVersion must match X.Y.Z (got ${JSON.stringify(data.stableVersion)})`
    )
  }
  return data.stableVersion
}

function syncFile (relPath, stableVersion, root = ROOT) {
  const absPath = path.join(root, relPath)
  const current = fs.readFileSync(absPath, 'utf8')
  const next = applyVersionUpdates(current, stableVersion)
  if (next === current) return false
  fs.writeFileSync(absPath, next, 'utf8')
  return true
}

function main () {
  const stableVersion = readStableVersion()
  console.log(
    JSON.stringify({
      level: 'info',
      message: 'Sync starting',
      stableVersion
    })
  )

  let filesChanged = 0
  for (const relPath of TARGET_FILES) {
    const changed = syncFile(relPath, stableVersion)
    if (changed) {
      filesChanged += 1
      console.log(
        JSON.stringify({ level: 'info', message: 'Updated', path: relPath })
      )
    }
  }

  console.log(
    JSON.stringify({
      level: 'info',
      message: 'Sync complete',
      filesChanged,
      stableVersion
    })
  )
}

module.exports = {
  applyVersionUpdates,
  readStableVersion,
  syncFile,
  main,
  TARGET_FILES,
  MARKER
}

if (require.main === module) {
  try {
    main()
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'Sync failed',
        error: err.message
      })
    )
    process.exit(1)
  }
}
