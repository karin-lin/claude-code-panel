'use strict'
/**
 * Claude Code Panel — side panel + status bar for Claude Code.
 * Reads local files only (Claude Code's own session transcripts, an optional quota file, optional progress files).
 * The one optional network feature (quota source "api") is off until the user opts in.
 */
const vscode = require('vscode')
const fs = require('node:fs')
const path = require('node:path')
const { createCollector } = require('./lib/snapshot')
const { statusBarText, tooltipMarkdown } = require('./lib/format')
const { makeT } = require('./lib/i18n')
const { claudeDir, readJson } = require('./lib/util')
const { HELPER_NAME, planInstall, planUninstall } = require('./lib/installer')
const { getHtml } = require('./webview/html')

const VIEW_ID = 'claudeCodePanel.view'

function activate(context) {
  const collector = createCollector()
  let pinnedId = null
  let latest = null
  let view = null
  let timer = null
  const t = makeT(vscode.env.language)

  const item = vscode.window.createStatusBarItem('claudeCodePanel.status', vscode.StatusBarAlignment.Left, 90)
  item.name = 'Claude Code Panel'
  item.command = 'claudeCodePanel.focus'
  item.text = '$(dashboard) Claude Code'
  item.show()
  context.subscriptions.push(item)

  function cfg() {
    const c = vscode.workspace.getConfiguration('claudeCodePanel')
    return {
      claudeDir: c.get('claudeDir'),
      pollSeconds: Math.max(2, Number(c.get('pollSeconds')) || 5),
      contextWindow: c.get('contextWindow'),
      progressFiles: c.get('progressFiles') || [],
      language: vscode.env.language,
      workspaceDirs: (vscode.workspace.workspaceFolders || []).map(f => f.uri.fsPath),
      pinnedId,
      quota: {
        source: c.get('quota.source'), file: c.get('quota.file'), intervalSec: c.get('quota.apiIntervalSeconds'),
        warnAt: c.get('quota.warnAt'), critAt: c.get('quota.critAt'), lines: c.get('quota.lines') || {}
      }
    }
  }

  function post() { if (view && latest) view.webview.postMessage(latest) }

  function paint() {
    if (!latest) return
    const r = statusBarText(t, latest)
    item.text = r.text
    item.tooltip = new vscode.MarkdownString(tooltipMarkdown(t, latest))
    item.backgroundColor = r.kind === 'crit' ? new vscode.ThemeColor('statusBarItem.errorBackground')
      : r.kind === 'warn' ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined
    post()
  }

  async function tick() {
    try { latest = await collector.collect(cfg()) } catch (e) { console.error('[claudeCodePanel] collect failed', e) }
    paint()
  }

  function schedule() {
    if (timer) clearInterval(timer)
    timer = setInterval(tick, cfg().pollSeconds * 1000)
  }
  context.subscriptions.push({ dispose: () => { if (timer) clearInterval(timer) } })

  // ── Status bar helper: install / uninstall (settings.json is only touched after the user clicks and confirms)──
  const settingsPath = () => path.join(claudeDir(cfg().claudeDir), 'settings.json')
  const helperDir = () => path.join(claudeDir(cfg().claudeDir), 'cc-panel')

  async function installHelper() {
    const sp = settingsPath()
    const settings = readJson(sp) || {}
    const dest = path.join(helperDir(), HELPER_NAME)
    const plan = planInstall(settings, dest)
    if (plan.already) { vscode.window.showInformationMessage(t('cmd.installAlready')); return }
    const ok = await vscode.window.showWarningMessage(t('cmd.installConfirm', { file: sp }), { modal: true }, t('cmd.install'))
    if (ok !== t('cmd.install')) return
    fs.mkdirSync(helperDir(), { recursive: true })
    fs.copyFileSync(path.join(__dirname, 'tools', HELPER_NAME), dest)
    fs.writeFileSync(path.join(helperDir(), 'original-statusline.json'), JSON.stringify(plan.original))
    if (fs.existsSync(sp)) fs.copyFileSync(sp, sp + '.cc-panel.bak')
    fs.writeFileSync(sp, JSON.stringify(plan.settings, null, 2) + '\n')
    await vscode.workspace.getConfiguration('claudeCodePanel').update('quota.source', 'file', vscode.ConfigurationTarget.Global)
    vscode.window.showInformationMessage(t('cmd.installOk'))
    tick()
  }

  async function uninstallHelper() {
    const sp = settingsPath()
    const settings = readJson(sp) || {}
    const original = readJson(path.join(helperDir(), 'original-statusline.json'))
    const plan = planUninstall(settings, original)
    if (plan.changed) {
      if (fs.existsSync(sp)) fs.copyFileSync(sp, sp + '.cc-panel.bak')
      fs.writeFileSync(sp, JSON.stringify(plan.settings, null, 2) + '\n')
    }
    vscode.window.showInformationMessage(t('cmd.uninstallOk'))
    tick()
  }

  async function quotaSetup() {
    const pick = await vscode.window.showInformationMessage(`${t('setup.prompt')}\n${t('setup.apiNote')}`, t('setup.api'), t('setup.file'), t('setup.off'))
    const conf = vscode.workspace.getConfiguration('claudeCodePanel')
    if (pick === t('setup.api')) await conf.update('quota.source', 'api', vscode.ConfigurationTarget.Global)
    else if (pick === t('setup.file')) await installHelper()
    else if (pick === t('setup.off')) await conf.update('quota.source', 'off', vscode.ConfigurationTarget.Global)
    tick()
  }

  const provider = {
    resolveWebviewView(wv) {
      view = wv
      wv.webview.options = { enableScripts: true, localResourceRoots: [] }
      wv.webview.html = getHtml(wv.webview, { lang: String(vscode.env.language || 'en').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en' })
      wv.webview.onDidReceiveMessage(async m => {
        if (!m || typeof m !== 'object') return
        if (m.type === 'ready') post()
        else if (m.type === 'pin') { pinnedId = m.id || null; await tick() }
        else if (m.type === 'refresh') await tick()
        else if (m.type === 'setup') quotaSetup()
        else if (m.type === 'open' && typeof m.path === 'string') {
          // Only allow opening .jsonl files under the Claude config directory
          try {
            const root = fs.realpathSync(claudeDir(cfg().claudeDir)), p = fs.realpathSync(m.path)
            if (p.startsWith(root + path.sep) && p.endsWith('.jsonl')) await vscode.window.showTextDocument(vscode.Uri.file(p), { preview: true })
          } catch {}
        }
      })
      wv.onDidChangeVisibility(() => { if (wv.visible) post() })
      wv.onDidDispose(() => { if (view === wv) view = null })
    }
  }
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(VIEW_ID, provider, { webviewOptions: { retainContextWhenHidden: true } }))
  const reg = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, fn))
  reg('claudeCodePanel.focus', () => vscode.commands.executeCommand(`${VIEW_ID}.focus`))
  reg('claudeCodePanel.refresh', tick)
  reg('claudeCodePanel.unpin', () => { pinnedId = null; return tick() })
  reg('claudeCodePanel.quotaSetup', quotaSetup)
  reg('claudeCodePanel.installStatuslineHelper', installHelper)
  reg('claudeCodePanel.uninstallStatuslineHelper', uninstallHelper)
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('claudeCodePanel')) { schedule(); tick() } }))

  schedule()
  tick().then(() => {
    // First run: quota source not chosen yet, ask once (non-intrusive: asked only once; afterwards use the command or the panel button to change it)
    if (cfg().quota.source === 'ask' && !context.globalState.get('quotaPrompted')) {
      context.globalState.update('quotaPrompted', true)
      quotaSetup()
    }
  })
}

function deactivate() {}

module.exports = { activate, deactivate }
