const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const root = path.join(__dirname, "..", "..")
const english = require("../../i18n/en.json")

function sources() {
  return fs.readdirSync(root).filter((name) => /\.(qml|js)$/.test(name))
    .map((name) => fs.readFileSync(path.join(root, name), "utf8"))
}

function referencedKeys() {
  const keys = new Set()
  for (const source of sources()) {
    for (const match of source.matchAll(/strings\.t\("([^"]+)"/g)) keys.add(match[1])
    for (const match of source.matchAll(/key: "(error\.[A-Za-z]+)"/g)) keys.add(match[1])
    for (const match of source.matchAll(/problem\("(error\.[A-Za-z]+)"\)/g)) keys.add(match[1])
  }
  return [...keys]
}

test("every string the plugin uses has an English entry", () => {
  const keys = referencedKeys()
  assert.ok(keys.length > 10, "expected to find the plugin's string keys")
  assert.deepEqual(keys.filter((key) => !(key in english)), [])
})

test("translations only contain keys that exist in English", () => {
  for (const file of fs.readdirSync(path.join(root, "i18n"))) {
    const catalog = require(path.join(root, "i18n", file))
    assert.deepEqual(Object.keys(catalog).filter((key) => !(key in english)), [], file)
  }
})

test("translations keep the same placeholders as English", () => {
  for (const file of fs.readdirSync(path.join(root, "i18n"))) {
    const catalog = require(path.join(root, "i18n", file))
    for (const key of Object.keys(catalog)) {
      const placeholders = (text) => (text.match(/%\d/g) || []).sort().join()
      assert.equal(placeholders(catalog[key]), placeholders(english[key]), file + " " + key)
    }
  }
})
