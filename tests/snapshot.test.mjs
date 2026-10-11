import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createCollector } from '../lib/snapshot.js'
import { getHtml } from '../webview/html.js'
const { makeDemo } = createRequire(import.meta.url)('../scripts/demo-data.js')

test('end to end: fake data directory -> full snapshot', async () => {
  const d = makeDemo(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ccp-t-')), 'h'))
  const c = createCollector({ fetchImpl: async () => { throw new Error('no network expected') } })
  const s = await c.collect({ claudeDir: d.claudeDir, workspaceDirs: ['/home/dev/web-app'], progressFiles: [d.progressDir], quota: { source: 'file' }, language: 'zh-CN' })
  assert.equal(s.lang, 'zh'); assert.equal(s.t['tab.tasks'], '任务')
  assert.equal(s.current.session.name, 'web-app'); assert.equal(s.current.session.running, true); assert.equal(s.current.plan.percent, 63)
  assert.equal(s.current.stats.context.total, 84000); assert.equal(s.current.stats.tools.total, 5)
  assert.equal(s.current.subagents.filter(a => a.active).length, 1)
  assert.equal(s.quota.ok, true); assert.equal(s.quota.windows.length, 2)
  assert.equal(s.plans.length, 3); assert.equal(s.plans.filter(p => !p.plan.finished).length, 2)
  assert.equal(s.sessions.filter(x => x.file).length, 1, 'only the current session carries a file path, for "open raw transcript"')
  const again = await c.collect({ claudeDir: d.claudeDir, workspaceDirs: ['/home/dev/web-app'], quota: { source: 'off' } })
  assert.equal(again.quota.ok, false)
})

test('pinned session; no crash when there is no Claude directory', async () => {
  const d = makeDemo(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ccp-t-')), 'h'))
  const s = await createCollector().collect({ claudeDir: d.claudeDir, pinnedId: d.ids.data, quota: { source: 'off' } })
  assert.equal(s.current.session.name, 'data-scripts'); assert.equal(s.pinnedId, d.ids.data)
  const empty = await createCollector().collect({ claudeDir: '/nonexistent/abc', quota: { source: 'ask' } })
  assert.equal(empty.current, null); assert.equal(empty.quota.needsSetup, true); assert.deepEqual(empty.plans, [])
})

test('webview HTML: CSP has a nonce, no inline style attributes, snapshot embedded safely', () => {
  const html = getHtml({ cspSource: 'vscode-webview://x' }, { nonce: 'N0NCE', snapshot: { evil: '</script><b>' }, lang: 'en' })
  assert.match(html, /Content-Security-Policy/); assert.match(html, /script-src 'nonce-N0NCE'/); assert.doesNotMatch(html, /\sstyle="/)
  assert.ok(!html.includes('</script><b>'), '</script> in the snapshot must be escaped')
})
