const test = require("node:test")
const assert = require("node:assert/strict")
const manifest = require("../../manifest.json")

test("the plugin id stays stable because users bind it in Hyprland", () => {
  assert.equal(manifest.id, "hone")
})

test("hone is an overlay that stays loaded so the hotkey opens it instantly", () => {
  assert.deepEqual(manifest.kinds, ["overlay"])
  assert.equal(manifest.keepLoaded, true)
})
