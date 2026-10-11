'use strict'
/** html.js — builds the webview HTML: CSS/JS are inlined, CSP uses a nonce; inline style attributes are never used (widths are set via JS through the CSSOM). */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

function getHtml(webview, opts = {}) {
  const nonce = opts.nonce || crypto.randomBytes(16).toString('base64')
  const css = fs.readFileSync(path.join(__dirname, 'panel.css'), 'utf8')
  const js = fs.readFileSync(path.join(__dirname, 'panel.js'), 'utf8')
  const cspSource = webview && webview.cspSource ? webview.cspSource : "'none'"
  const inject = opts.snapshot
    ? `<script nonce="${nonce}">${opts.tab ? `window.__TAB__=${JSON.stringify(opts.tab)};` : ''}window.__SNAPSHOT__=${JSON.stringify(opts.snapshot).replace(/</g, '\\u003c')}</script>`
    : ''
  const theme = opts.themeCss ? `<style nonce="${nonce}">${opts.themeCss}</style>` : ''
  return `<!doctype html>
<html lang="${opts.lang || 'en'}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src ${cspSource} data:;">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Claude Code Panel</title>
<style nonce="${nonce}">${css}</style>${theme}
</head>
<body>
<div id="app"><div class="empty">…</div></div>
${inject}
<script nonce="${nonce}">${js}</script>
</body>
</html>`
}

module.exports = { getHtml }
