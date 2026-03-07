const jsdom = require('jsdom')
const { JSDOM } = jsdom
const fs = require('fs')
const path = require('path')

const DEFAULT_URL = 'https://www.futunn.com/en/download/OpenAPI'
const DEFAULT_OUTPUT_PATH = path.join(__dirname, '..', 'opend_version.json')
const DEFAULT_TIMEOUT = 30000
const DEFAULT_RETRIES = 3
const DEFAULT_RETRY_DELAY = 1000

const VERSION_REGEX = /^\d+\.\d+\.\d+$/

class VersionFetchError extends Error {
  constructor (message, cause) {
    super(message)
    this.name = 'VersionFetchError'
    this.cause = cause
  }
}

function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isValidVersion (version) {
  return typeof version === 'string' && VERSION_REGEX.test(version)
}

function validateVersionData (data) {
  if (!isValidVersion(data.stableVersion)) {
    throw new VersionFetchError(
      `Invalid stable version: ${data.stableVersion}. Expected format: X.Y.Z`
    )
  }
  if (data.betaVersion !== null && !isValidVersion(data.betaVersion)) {
    throw new VersionFetchError(
      `Invalid beta version: ${data.betaVersion}. Expected format: X.Y.Z or null`
    )
  }
  return true
}

async function loadDocument (url = DEFAULT_URL, options = {}) {
  const {
    timeout = DEFAULT_TIMEOUT,
    retries = DEFAULT_RETRIES,
    retryDelay = DEFAULT_RETRY_DELAY
  } = options

  let lastError = null

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      const dom = await JSDOM.fromURL(url, {
        resources: 'usable',
        pretendToBeVisual: true,
        fetchOptions: {
          signal: controller.signal,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (compatible; FutuOpenD-VersionChecker/1.0)'
          }
        }
      })

      clearTimeout(timeoutId)
      return dom.window.document
    } catch (err) {
      lastError = err
      const isTimeout = err.name === 'AbortError'
      const errorMsg = isTimeout
        ? `Request timeout after ${timeout}ms`
        : err.message

      console.error(`Attempt ${attempt}/${retries} failed: ${errorMsg}`)

      if (attempt < retries) {
        console.log(`Retrying in ${retryDelay}ms...`)
        await sleep(retryDelay)
      }
    }
  }

  throw new VersionFetchError(
    `Failed to fetch document after ${retries} attempts: ${lastError?.message}`,
    lastError
  )
}

function extractInitialState (document) {
  const scripts = document.querySelectorAll('script')
  for (const script of scripts) {
    const text = script.textContent
    const prefix = 'window.__INITIAL_STATE__='
    const idx = text.indexOf(prefix)
    if (idx !== -1) {
      const jsonStr = text.slice(idx + prefix.length)
      try {
        return JSON.parse(jsonStr)
      } catch (e) {
        continue
      }
    }
  }
  return null
}

function parseOpenDReleases (initialState) {
  if (
    !initialState ||
    !initialState.download ||
    !initialState.download.openDRelease
  ) {
    return []
  }
  return initialState.download.openDRelease
}

function getBetaVersion (document, initialState) {
  // Try parsing from INITIAL_STATE first (more reliable)
  if (initialState) {
    const releases = parseOpenDReleases(initialState)
    const betaRelease = releases.find((r) => r.isBeta === 1)
    if (betaRelease) {
      return betaRelease.version
    }
  }

  // Fallback to DOM scraping
  const betaElement = document.querySelector(
    'div.version-number > p.version-name > span.new-icon'
  )
  if (!betaElement) return null
  const versionSpan = betaElement.parentNode.querySelector('span.version')
  if (!versionSpan) return null
  return versionSpan.textContent.replace('Ver.', '').trim()
}

function getAllVersion (document, initialState) {
  // Try parsing from INITIAL_STATE first (more reliable)
  if (initialState) {
    const releases = parseOpenDReleases(initialState)
    if (releases.length > 0) {
      return releases.map((r) => r.version)
    }
  }

  // Fallback to DOM scraping
  return Array.from(
    document.querySelectorAll(
      'div.version-number > p.version-name > span.version'
    ),
    (el) => el.textContent.replace('Ver.', '').trim()
  ).filter((v) => v)
}

function parseVersions (document) {
  const initialState = extractInitialState(document)

  const betaVersion = getBetaVersion(document, initialState)
  const allVersions = getAllVersion(document, initialState)

  if (allVersions.length === 0) {
    throw new VersionFetchError('No versions found on page')
  }

  const stableVersions = allVersions.filter((v) => v !== betaVersion)
  const stableVersion = stableVersions[0] || allVersions[0]

  return { betaVersion, stableVersion }
}

function writeVersionFile (data, outputPath = DEFAULT_OUTPUT_PATH) {
  const jsonString = JSON.stringify(data, null, 2) + '\n'
  fs.writeFileSync(outputPath, jsonString, 'utf8')
}

function logVersionInfo (data, outputPath) {
  console.log(
    JSON.stringify({
      level: 'info',
      message: 'Version data fetched',
      betaVersion: data.betaVersion,
      stableVersion: data.stableVersion,
      outputPath
    })
  )
}

async function main (options = {}) {
  const {
    url = DEFAULT_URL,
    outputPath = DEFAULT_OUTPUT_PATH,
    timeout = DEFAULT_TIMEOUT,
    retries = DEFAULT_RETRIES,
    validate = true
  } = options

  const document = await loadDocument(url, { timeout, retries })
  const data = parseVersions(document)

  if (validate) {
    validateVersionData(data)
  }

  writeVersionFile(data, outputPath)
  logVersionInfo(data, outputPath)

  return data
}

module.exports = {
  loadDocument,
  getBetaVersion,
  getAllVersion,
  parseVersions,
  writeVersionFile,
  logVersionInfo,
  validateVersionData,
  isValidVersion,
  main,
  VersionFetchError,
  DEFAULT_URL,
  DEFAULT_OUTPUT_PATH,
  DEFAULT_TIMEOUT,
  DEFAULT_RETRIES
}

if (require.main === module) {
  main().catch((err) => {
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'Failed to fetch version',
        error: err.message,
        cause: err.cause?.message
      })
    )
    process.exit(1)
  })
}
