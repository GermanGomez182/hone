// Builds the prompt sent to the agent CLI. The user's text is fenced in
// <text> tags so pasted content is treated as data, not instructions. The
// output language is stated right after the text: buried in the system
// prompt, models kept rewriting in the input's language. The free
// instruction rides along in the user message, which reaches the CLI on
// stdin, so nothing the user types ever lands on a command line.

var AUTO_LANGUAGE = "auto"
var CLOSING_TAG = /<\/text\s*>/gi
var NEUTRALIZED_CLOSING_TAG = "</ text>"

function system(template, actionPrompt) {
  return template + "\n\n" + actionPrompt
}

function userMessage(userText, language, instruction) {
  var parts = ["<text>\n" + String(userText).replace(CLOSING_TAG, NEUTRALIZED_CLOSING_TAG) + "\n</text>"]
  var extra = String(instruction || "").trim()
  if (extra.length > 0) parts.push("Additional instruction from the user: " + extra)
  parts.push(languageDirective(language))
  return parts.join("\n\n")
}

function languageDirective(language) {
  if (language === AUTO_LANGUAGE) return "Write the result in the same language as the text. Do not translate it."
  return "Write the result in " + language + ". If the text is in another language, translate it into " + language + "."
}

function combined(systemText, userText) {
  return systemText + "\n\n" + userText
}

if (typeof module !== "undefined") {
  module.exports = {
    system: system,
    userMessage: userMessage,
    combined: combined
  }
}
