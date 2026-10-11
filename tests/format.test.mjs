import test from 'node:test'
import assert from 'node:assert/strict'
import { statusBarText, tooltipMarkdown, fmtTokens, fmtDuration, fmtAgo, effectiveWindow, actionText } from '../lib/format.js'
import { makeT } from '../lib/i18n.js'

const t = makeT('en')
const now = Date.parse('2026-10-11T00:00:00Z')
const quota = (o = {}) => ({ ok: true, level: 'ok', stale: false, fetchedAt: now - 60000, windows: [{ key: 'five_hour', util: 38, line: null, resetsAt: now + 2 * 3600000 }, { key: 'seven_day', util: 24, line: null, resetsAt: now + 4 * 86400000 }], ...o })
const sess = (o = {}) => ({ id: 's', source: 'ide', name: 'web', title: 'Add toggle', state: 'tool', tool: 'Bash', running: true, updatedAt: now - 3000, ...o })

test('status bar: quota + progress + action', () => {
  const r = statusBarText(t, { quota: quota(), current: { session: sess(), plan: { percent: 63, finished: false } } })
  assert.equal(r.text, '$(dashboard) 5h 38% · 7d 24% · 63% · Running a command'); assert.equal(r.kind, 'ok')
})
test('status bar: completed tasks show no percentage; idle; Chinese', () => {
  const r = statusBarText(t, { quota: quota(), current: { session: sess({ running: false, state: 'idle' }), plan: { percent: 100, finished: true } } })
  assert.equal(r.text, '$(dashboard) 5h 38% · 7d 24% · Idle')
  assert.match(statusBarText(makeT('zh-CN'), { quota: quota(), current: { session: sess() } }).text, /周 24% · 正在执行命令/)
})
test('status bar: level and stale', () => {
  assert.equal(statusBarText(t, { quota: quota({ level: 'crit' }) }).kind, 'crit'); assert.equal(statusBarText(t, { quota: quota({ level: 'warn' }) }).kind, 'warn')
  const s = statusBarText(t, { quota: quota({ stale: true }) }); assert.equal(s.kind, 'stale'); assert.match(s.text, /⌛/)
  const none = statusBarText(t, { quota: { ok: false, needsSetup: true } }); assert.equal(none.kind, 'none'); assert.equal(none.text, '$(dashboard) Claude Code')
})
test('tooltip', () => {
  const st = { context: { total: 55400 } }
  const md = tooltipMarkdown(t, { now, quota: quota(), contextWindow: 200000, current: { session: sess({ maybeWaiting: true }), stats: st, plan: { title: 'Add toggle', percent: 63, done: 2, total: 4 } } })
  assert.match(md, /5h \*\*38%\*\* · resets in 2h0m/); assert.match(md, /may be waiting for your approval/); assert.match(md, /Context 55\.4k \/ 200k \(28%\)/); assert.match(md, /2\/4 steps/)
})
test('formatting and automatic window enlargement', () => {
  assert.equal(fmtTokens(55400), '55.4k'); assert.equal(fmtTokens(2100000), '2.1M'); assert.equal(fmtTokens(999), '999')
  assert.equal(fmtDuration(4 * 3600000 + 9 * 60000), '4h9m'); assert.equal(fmtDuration(3 * 86400000 + 5 * 3600000), '3d5h'); assert.equal(fmtDuration(5000), '5s')
  assert.equal(fmtAgo(t, 10000), 'just now'); assert.equal(fmtAgo(t, 90000), '1m ago'); assert.equal(fmtAgo(t, null), '—')
  assert.equal(effectiveWindow(55000, 200000), 200000); assert.equal(effectiveWindow(214000, 200000), 1000000); assert.equal(effectiveWindow(1230000, 200000), 1300000)
  assert.equal(actionText(t, sess({ tool: 'MyCustomTool' })), 'Running MyCustomTool', 'untranslated tool names are shown as-is')
})
