const jsdom = require('jsdom')
const { JSDOM } = jsdom
const fs = require('fs')
const path = require('path')

const url = 'https://www.futunn.com/en/download/OpenAPI'

async function loadDocument () {
  const dom = await JSDOM.fromURL(url)
  return dom.window.document
}

function getBetaVersion (document) {
  const betaElement = document.querySelector(
    'div.version-number > p.version-name > span.new-icon'
  )
  if (!betaElement) return null
  return betaElement.parentNode
    .querySelector('span.version')
    .textContent.replace('Ver.', '')
    .trim()
}

function getAllVersion (document) {
  return Array.prototype.map.call(
    document.querySelectorAll(
      'div.version-number > p.version-name > span.version'
    ),
    (x) => x.textContent.replace('Ver.', '').trim()
  )
}

async function main () {
  const document = await loadDocument()
  const betaVersion = getBetaVersion(document)
  const allVersion = getAllVersion(document)
  const stableVersionList = allVersion.filter((x) => x !== betaVersion)
  const stableVersion = stableVersionList[0]
  console.log('beta version: ' + betaVersion)
  console.log('stable version list: ' + stableVersionList)
  console.log('stable version: ' + stableVersion)
  const data = {
    betaVersion,
    stableVersion
  }
  console.log(data)

  const outputFilePath = path.join(__dirname, '..', 'opend_version.json')
  const jsonString = JSON.stringify(data, null, 2) + '\n'
  fs.writeFileSync(outputFilePath, jsonString, 'utf8')
  console.log(`Version data written to ${outputFilePath}`)
}

main()
