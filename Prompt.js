// Builds the prompt sent to the agent CLI. The user's text is fenced in
// <text> tags so pasted content is treated as data, not instructions.

var AUTO_LANGUAGE = "auto"
var SAME_LANGUAGE = "the same language as the input text"
var CLOSING_TAG = /<\/text\s*>/gi
var NEUTRALIZED_CLOSING_TAG = "</ text>"

function languageName(language) {
  return language === AUTO_LANGUAGE ? SAME_LANGUAGE : language
}

function system(template, actionPrompt, instruction, language) {
  var text = template.replace(/\{language\}/g, languageName(language)) + "\n\n" + actionPrompt
  var extra = String(instruction || "").trim()
  if (extra.length > 0) text += "\n\nAdditional instruction from the user: " + extra
  return text
}

function wrapped(userText) {
  return "<text>\n" + String(userText).replace(CLOSING_TAG, NEUTRALIZED_CLOSING_TAG) + "\n</text>"
}

function combined(systemText, userText) {
  return systemText + "\n\n" + userText
}

if (typeof module !== "undefined") {
  module.exports = {
    system: system,
    wrapped: wrapped,
    combined: combined
  }
}
