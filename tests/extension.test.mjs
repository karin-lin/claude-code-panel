import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Module, { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
const require = createRequire(import.meta.url)
const { makeDemo } = require('../scripts/demo-data.js')

// A minimal fake vscode: records commands, status bar, webview and dialogs, and can answer dialogs programmatically
function fakeVscode(opts) {
  const calls = { commands: {}, messages: [], settings: {}, shown: [] }
  const item = { text: '', tooltip: null, show() {}, dispose() {} }
  const vs = {
    StatusBarAlignment: { Left: 1 }, ThemeColor: class { constructor(id) { this.id = id } }, MarkdownString: class { constructor(v) { this.value = v } },
    ConfigurationTarget: { Global: 1 }, Uri: { file: p => ({ fsPath: p }) },
    env: { language: opts.language || 'en' },
    window: {
      createStatusBarItem: () => item,
      registerWebviewViewProvider: (id, provider) => { calls.provider = provider; return { dispose() {} } },
      showTextDocument: async u => { calls.shown.push(u.fsPath) },
      showInformationMessage: async (msg, ...btns) => { calls.messages.push(msg); return opts.answer ? opts.answer(btns) : undefined },
      showWarningMessage: async (msg, o, ...btns) => { calls.messages.push(msg); return opts.confirm ? opts.confirm(btns) : undefined }
    },
    commands: { registerCommand: (id, fn) => { calls.commands[id] = fn; return { dispose() {} } }, executeCommand: async () => {} },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: '/home/dev/web-app' } }],
      getConfiguration: () => ({
        get: k => (k in calls.settings ? calls.settings[k] : opts.config[k]),
        update: async (k, v) => { calls.settings[k] = v }
      }),
      onDidChangeConfiguration: () => ({ dispose() {} })
    }
  }
  return { vs, calls, item }
}

function load(opts) {
  const f = fakeVscode(opts)
  const orig = Module._resolveFilename
  Module._resolveFilename = function (req, ...rest) { return req === 'vscode' ? 'vscode' : orig.call(this, req, ...rest) }
  Module._cache['vscode'] = { id: 'vscode', filename: 'vscode', loaded: true, exports: f.vs }
  for (const k of Object.keys(require.cache)) if (k.includes('claude-code-panel') && k.endsWith('extension.js')) delete require.cache[k]
  const ext = require('../extension.js')
  const subs = []
  ext.activate({ subscriptions: subs, globalState: { get: () => f.state, update: (k, v) => { f.state = v } } })
  return { ...f, subs, dispose: () => { for (const s of subs) if (s && s.dispose) s.dispose(); Module._resolveFilename = orig } }
}

const wait = ms => new Promise(r => setTimeout(r, ms))
const baseCfg = (d, extra) => ({ claudeDir: d.claudeDir, pollSeconds: 5, contextWindow: 200000, progressFiles: [], 'quota.source': 'file', 'quota.file': '', 'quota.apiIntervalSeconds': 300, 'quota.warnAt': 80, 'quota.critAt': 95, 'quota.lines': {}, ...extra })

test('activation: status bar text, 6 commands, webview messaging', async () => {
  const d = makeDemo(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ccp-t-')), 'h'))
  const x = load({ config: baseCfg(d) })
  await wait(400)
  assert.match(x.item.text, /5h 38% · 7d 24% · 63% · Running a command/)
  assert.deepEqual(Object.keys(x.calls.commands).sort(), ['claudeCodePanel.focus', 'claudeCodePanel.installStatuslineHelper', 'claudeCodePanel.quotaSetup', 'claudeCodePanel.refresh', 'claudeCodePanel.uninstallStatuslineHelper', 'claudeCodePanel.unpin'])
  let posted = null, handler = null
  const wv = { webview: { cspSource: 'x', options: null, html: '', postMessage: m => { posted = m; return Promise.resolve(true) }, onDidReceiveMessage: fn => { handler = fn } }, visible: true, onDidChangeVisibility() {}, onDidDispose() {} }
  x.calls.provider.resolveWebviewView(wv)
  assert.match(wv.webview.html, /lang="en"/); await handler({ type: 'ready' })
  assert.equal(posted.current.session.name, 'web-app')
  await handler({ type: 'pin', id: d.ids.data }); assert.equal(posted.current.session.name, 'data-scripts')
  await handler({ type: 'pin', id: null }); assert.equal(posted.current.session.name, 'web-app')
  x.dispose()
})

test('"open raw transcript" only allows .jsonl under the Claude directory', async () => {
  const d = makeDemo(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ccp-t-')), 'h'))
  const x = load({ config: baseCfg(d) }); await wait(200)
  let handler = null
  x.calls.provider.resolveWebviewView({ webview: { cspSource: 'x', options: null, html: '', postMessage: () => Promise.resolve(true), onDidReceiveMessage: fn => { handler = fn } }, visible: true, onDidChangeVisibility() {}, onDidDispose() {} })
  const good = path.join(d.claudeDir, 'projects', '-home-dev-web-app', d.ids.web + '.jsonl')
  await handler({ type: 'open', path: good })
  await handler({ type: 'open', path: '/etc/hosts' })
  await handler({ type: 'open', path: path.join(d.claudeDir, 'cc-panel', 'rate-limits.json') })
  await handler({ type: 'open', path: path.join(d.claudeDir, 'projects', '..', '..', '..', 'etc', 'hosts') })
  assert.deepEqual(x.calls.shown, [fs.realpathSync(good)]); x.dispose()
})

test('first run: quota source is ask -> asked only once, choosing API writes the setting', async () => {
  const d = makeDemo(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ccp-t-')), 'h'))
  const x = load({ language: 'zh-CN', config: baseCfg(d, { 'quota.source': 'ask' }), answer: btns => btns[0] })
  await wait(500)
  assert.equal(x.calls.messages.length, 1); assert.match(x.calls.messages[0], /额度/); assert.match(x.calls.messages[0], /不会有任何数据离开你的电脑/)
  assert.equal(x.calls.settings['quota.source'], 'api')
  x.dispose()
})

test('install helper: settings.json changed only after confirmation, original status bar kept with a backup; uninstall restores', async () => {
  const d = makeDemo(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ccp-t-')), 'h'))
  const sp = path.join(d.claudeDir, 'settings.json')
  const orig = { model: 'm', statusLine: { type: 'command', command: 'echo hi', padding: 1 } }
  fs.writeFileSync(sp, JSON.stringify(orig))
  let confirmWith = undefined
  const x = load({ config: baseCfg(d), confirm: btns => confirmWith === 'yes' ? btns[0] : undefined }); await wait(200)
  await x.calls.commands['claudeCodePanel.installStatuslineHelper']()
  assert.deepEqual(JSON.parse(fs.readFileSync(sp, 'utf8')), orig, 'must not change without confirmation')
  confirmWith = 'yes'
  await x.calls.commands['claudeCodePanel.installStatuslineHelper']()
  const now = JSON.parse(fs.readFileSync(sp, 'utf8'))
  assert.match(now.statusLine.command, /--chain/); assert.equal(now.model, 'm'); assert.equal(now.statusLine.padding, 1)
  assert.deepEqual(JSON.parse(fs.readFileSync(sp + '.cc-panel.bak', 'utf8')), orig)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(d.claudeDir, 'cc-panel', 'original-statusline.json'), 'utf8')), orig.statusLine)
  assert.equal(x.calls.settings['quota.source'], 'file')
  // the installed helper script really forwards to the original command
  const r = spawnSync('sh', ['-c', now.statusLine.command], { input: '{}', encoding: 'utf8' }); assert.equal(r.stdout.trim(), 'hi')
  await x.calls.commands['claudeCodePanel.uninstallStatuslineHelper']()
  assert.deepEqual(JSON.parse(fs.readFileSync(sp, 'utf8')), orig, 'fully restored after uninstall')
  x.dispose()
})
