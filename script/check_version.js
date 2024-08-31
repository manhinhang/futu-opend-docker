const jsdom = require("jsdom");
const { JSDOM } = jsdom;
const fs = require("fs");
const path = require("path");

const url = "https://www.futunn.com/en/download/OpenAPI"


async function load_document() {
    const dom = await JSDOM.fromURL(url);
    return dom.window.document;
}

function get_beta_version(document) {
    return document.querySelector("ul[data-type='opend'] > li.clearfix > div.version-number > p.version-name > span.new-icon").parentNode.querySelector("span").textContent.replace("Ver.", "")
}

function get_all_version(document) {
    return Array.prototype.map.call(document.querySelectorAll("ul[data-type='opend'] > li.clearfix > div.version-number > p.version-name > span:nth-child(1)"), (x) => x.textContent.replace("Ver.", ""))
}

async function main() {
    const document = await load_document();
    const beta_version = get_beta_version(document);
    const all_version = get_all_version(document);
    const stable_version_list = all_version.filter((x) => x !== beta_version);
    const stable_version = stable_version_list[0];
    console.log("beta version: " + beta_version);
    console.log("stable version list: " + stable_version_list);
    console.log("stable version: " + stable_version);
    const data = {
        beta_version: beta_version,
        stable_version: stable_version
    }
    console.log(data);

    const outputFilePath = path.join(__dirname, "..", "opend_version.json");
    fs.writeFileSync(outputFilePath, JSON.stringify(data, null, 2), "utf8");
    console.log(`Version data written to ${outputFilePath}`);
}

main();