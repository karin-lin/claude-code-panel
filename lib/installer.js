'use strict'
/** installer.js — install / uninstall the status bar helper: pure functions compute the new settings; file I/O lives in extension.js. */
const HELPER_NAME = 'statusline-helper.js'

function shQuote(p) {
  return process.platform === 'win32' ? `"${p}"` : `'${String(p).replace(/'/g, `'\\''`)}'`
}

function isOurs(statusLine) {
  return !!(statusLine && typeof statusLine.command === 'string' && statusLine.command.includes(HELPER_NAME) && statusLine.command.includes('cc-panel'))
}

/** Returns { already, settings, original }. If a status bar already exists, keep it via --chain. */
function planInstall(settings, helperPath) {
  const next = JSON.parse(JSON.stringify(settings || {}))
  const cur = next.statusLine
  if (isOurs(cur)) return { already: true, settings: next, original: null }
  const hasOrig = !!(cur && typeof cur.command === 'string' && cur.command.trim())
  const sl = { type: 'command', command: `node ${shQuote(helperPath)}${hasOrig ? ' --chain' : ''}` }
  if (hasOrig) for (const k of ['padding', 'refreshInterval']) if (cur[k] != null) sl[k] = cur[k]
  next.statusLine = sl
  return { already: false, settings: next, original: hasOrig ? cur : null }
}

function planUninstall(settings, original) {
  const next = JSON.parse(JSON.stringify(settings || {}))
  if (!isOurs(next.statusLine)) return { changed: false, settings: next }
  if (original && original.command) next.statusLine = original
  else delete next.statusLine
  return { changed: true, settings: next }
}

module.exports = { HELPER_NAME, shQuote, isOurs, planInstall, planUninstall }
