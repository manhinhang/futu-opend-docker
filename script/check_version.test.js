const { describe, it } = require('node:test')
const assert = require('node:assert')
const {
  parseVersions,
  getBetaVersion,
  getAllVersion,
  isValidVersion,
  validateVersionData,
  VersionFetchError
} = require('./check_version.js')

function createMockDocument (html) {
  const { JSDOM } = require('jsdom')
  return new JSDOM(html).window.document
}

describe('getBetaVersion', () => {
  it('should return null when no beta element exists', () => {
    const html = `
      <div class="version-number">
        <p class="version-name"><span class="version">Ver.9.6.5608</span></p>
      </div>
    `
    const doc = createMockDocument(html)
    assert.strictEqual(getBetaVersion(doc), null)
  })

  it('should extract beta version when new-icon exists', () => {
    const html = `
      <div class="version-number">
        <p class="version-name"><span class="new-icon">NEW</span><span class="version">Ver.9.7.5708</span></p>
      </div>
    `
    const doc = createMockDocument(html)
    assert.strictEqual(getBetaVersion(doc), '9.7.5708')
  })

  it('should return null if version span is missing', () => {
    const html = `
      <div class="version-number">
        <p class="version-name"><span class="new-icon">NEW</span></p>
      </div>
    `
    const doc = createMockDocument(html)
    assert.strictEqual(getBetaVersion(doc), null)
  })
})

describe('getAllVersion', () => {
  it('should extract all versions', () => {
    const html = `
      <div class="version-number">
        <p class="version-name"><span class="version">Ver.9.6.5608</span></p>
      </div>
      <div class="version-number">
        <p class="version-name"><span class="new-icon">NEW</span><span class="version">Ver.9.7.5708</span></p>
      </div>
    `
    const doc = createMockDocument(html)
    const versions = getAllVersion(doc)
    assert.deepStrictEqual(versions, ['9.6.5608', '9.7.5708'])
  })

  it('should return empty array when no versions exist', () => {
    const html = '<div></div>'
    const doc = createMockDocument(html)
    const versions = getAllVersion(doc)
    assert.deepStrictEqual(versions, [])
  })

  it('should filter out empty version strings', () => {
    const html = `
      <div class="version-number">
        <p class="version-name"><span class="version"></span></p>
      </div>
      <div class="version-number">
        <p class="version-name"><span class="version">Ver.9.6.5608</span></p>
      </div>
    `
    const doc = createMockDocument(html)
    const versions = getAllVersion(doc)
    assert.deepStrictEqual(versions, ['9.6.5608'])
  })
})

describe('parseVersions', () => {
  it('should parse versions correctly with beta', () => {
    const html = `
      <div class="version-number">
        <p class="version-name"><span class="version">Ver.9.6.5608</span></p>
      </div>
      <div class="version-number">
        <p class="version-name"><span class="new-icon">NEW</span><span class="version">Ver.9.7.5708</span></p>
      </div>
    `
    const doc = createMockDocument(html)
    const result = parseVersions(doc)
    assert.deepStrictEqual(result, {
      betaVersion: '9.7.5708',
      stableVersion: '9.6.5608'
    })
  })

  it('should handle no beta version', () => {
    const html = `
      <div class="version-number">
        <p class="version-name"><span class="version">Ver.9.6.5608</span></p>
      </div>
    `
    const doc = createMockDocument(html)
    const result = parseVersions(doc)
    assert.deepStrictEqual(result, {
      betaVersion: null,
      stableVersion: '9.6.5608'
    })
  })

  it('should throw when no versions found', () => {
    const html = '<div></div>'
    const doc = createMockDocument(html)
    assert.throws(() => parseVersions(doc), VersionFetchError)
    assert.throws(() => parseVersions(doc), /No versions found/)
  })
})

describe('isValidVersion', () => {
  it('should return true for valid semver-like versions', () => {
    assert.strictEqual(isValidVersion('9.6.5608'), true)
    assert.strictEqual(isValidVersion('1.0.0'), true)
    assert.strictEqual(isValidVersion('10.20.30'), true)
  })

  it('should return false for invalid versions', () => {
    assert.strictEqual(isValidVersion(''), false)
    assert.strictEqual(isValidVersion('invalid'), false)
    assert.strictEqual(isValidVersion('1.2'), false)
    assert.strictEqual(isValidVersion('1.2.3.4'), false)
    assert.strictEqual(isValidVersion(null), false)
    assert.strictEqual(isValidVersion(undefined), false)
    assert.strictEqual(isValidVersion(123), false)
  })
})

describe('validateVersionData', () => {
  it('should pass for valid data', () => {
    const data = { betaVersion: '9.7.5708', stableVersion: '9.6.5608' }
    assert.strictEqual(validateVersionData(data), true)
  })

  it('should pass for null beta version', () => {
    const data = { betaVersion: null, stableVersion: '9.6.5608' }
    assert.strictEqual(validateVersionData(data), true)
  })

  it('should throw for invalid stable version', () => {
    const data = { betaVersion: null, stableVersion: 'invalid' }
    assert.throws(() => validateVersionData(data), /Invalid stable version/)
  })

  it('should throw for invalid beta version', () => {
    const data = { betaVersion: 'invalid', stableVersion: '9.6.5608' }
    assert.throws(() => validateVersionData(data), /Invalid beta version/)
  })
})

describe('VersionFetchError', () => {
  it('should create error with cause', () => {
    const cause = new Error('Network error')
    const error = new VersionFetchError('Fetch failed', cause)
    assert.strictEqual(error.name, 'VersionFetchError')
    assert.strictEqual(error.message, 'Fetch failed')
    assert.strictEqual(error.cause, cause)
  })
})
