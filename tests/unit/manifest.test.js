const test = require("node:test")
const assert = require("node:assert/strict")
const manifest = require("../../manifest.json")

test("the plugin id is the permanent, namespaced marketplace id users bind in Hyprland", () => {
  assert.equal(manifest.id, "io.github.germangomez182.hone")
})

test("the README binds the panel with the manifest id", () => {
  const readme = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "..", "README.md"), "utf8")
  assert.ok(readme.includes('{ panel = "' + manifest.id + '" }'))
})

test("hone is an overlay that stays loaded so the hotkey opens it instantly", () => {
  assert.deepEqual(manifest.kinds, ["overlay"])
  assert.equal(manifest.keepLoaded, true)
})
