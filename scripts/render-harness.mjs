// Render the panel with fake data and screenshot it with headless Chrome (never touches real data).
// Usage: node scripts/render-harness.mjs [output dir]
//   Env vars:CC_PANEL_LANG=zh-CN|en  CC_PANEL_TAB=overview|tasks|session  CC_PANEL_W=320  CC_PANEL_H=900  CC_PANEL_SOURCE=file|ask|api-error
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const { createCollector } = require('../lib/snapshot.js')
const { getHtml } = require('../webview/html.js')
const { statusBarText, tooltipMarkdown } = require('../lib/format.js')
const { makeT } = require('../lib/i18n.js')
const { makeDemo } = require('./demo-data.js')

const out = path.resolve(process.argv[2] || 'screenshots')
fs.mkdirSync(out, { recursive: true })
const lang = process.env.CC_PANEL_LANG || 'en'
const W = Number(process.env.CC_PANEL_W) || 320
const H = Number(process.env.CC_PANEL_H) || 900
const demo = makeDemo(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ccp-demo-')), 'home'))
const source = process.env.CC_PANEL_SOURCE || 'file'
const snap = await createCollector().collect({
  claudeDir: demo.claudeDir, workspaceDirs: ['/home/dev/web-app'], progressFiles: [demo.progressDir], language: lang,
  quota: { source: source === 'api-error' ? 'file' : source, file: source === 'api-error' ? '/home/dev/.claude/cc-panel/rate-limits.json' : '' }
})
const t = makeT(lang)
console.log(statusBarText(t, snap).text)

const base = `:root{--vscode-font-family:-apple-system,"Segoe UI","PingFang SC",sans-serif} body{width:${W}px}`
const themes = {
  dark: base + `html{background:#181818} :root{--vscode-foreground:#cccccc;--vscode-descriptionForeground:#9d9d9d;--vscode-sideBar-background:#181818;--vscode-editorWidget-background:#202020;--vscode-widget-border:#313131;--vscode-charts-green:#89d185;--vscode-charts-yellow:#cca700;--vscode-charts-red:#f14c4c;--vscode-focusBorder:#0078d4}`,
  light: base + `html{background:#f8f8f8} :root{--vscode-foreground:#3b3b3b;--vscode-descriptionForeground:#717171;--vscode-sideBar-background:#f8f8f8;--vscode-editorWidget-background:#ffffff;--vscode-widget-border:#e5e5e5;--vscode-charts-green:#388a34;--vscode-charts-yellow:#bf8803;--vscode-charts-red:#e51400;--vscode-focusBorder:#005fb8}`
}
const CHROME = process.env.CHROME_BIN || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => fs.existsSync(p))
const only = process.env.CC_PANEL_THEME
for (const [name, themeCss] of Object.entries(themes)) {
  if (only && only !== name) continue
  const htmlPath = path.join(out, `panel-${name}.html`)
  fs.writeFileSync(htmlPath, getHtml({ cspSource: "'none'" }, { snapshot: snap, themeCss, tab: process.env.CC_PANEL_TAB, lang }))
  const png = path.join(out, `${process.env.CC_PANEL_NAME || 'panel'}-${name}.png`)
  if (!CHROME) { console.log('no Chrome found; wrote', htmlPath); continue }
  try { execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', `--screenshot=${png}`, `--window-size=${Math.max(W + 40, 520)},${H}`, 'file://' + htmlPath], { stdio: 'ignore', timeout: 30000 }); console.log('screenshot', png) } catch (e) { console.log('screenshot failed', e.message) }
}
