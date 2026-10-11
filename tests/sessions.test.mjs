import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { scanSessions, pickCurrent, deriveState, sourceKind, inWorkspace } from '../lib/sessions.js'
const { makeDemo } = createRequire(import.meta.url)('../scripts/demo-data.js')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ccp-t-'))
const now = Date.parse('2026-10-11T00:00:00Z')
const at = off => new Date(now - off).toISOString()
const A = (off, content, extra = {}) => ({ type: 'assistant', timestamp: at(off), message: { content }, ...extra })
const U = (off, content, extra = {}) => ({ type: 'user', timestamp: at(off), message: { content }, ...extra })

test('source detection: entrypoint', () => {
  assert.equal(sourceKind('claude-vscode'), 'ide'); assert.equal(sourceKind('cli'), 'cli')
  assert.equal(sourceKind('sdk-cli'), 'sdk'); assert.equal(sourceKind('sdk-py'), 'sdk'); assert.equal(sourceKind(null), 'unknown')
})

test('state: pending tool -> tool; after 30s flagged as "maybe awaiting confirmation"', () => {
  const objs = [U(60000, 'hi'), A(5000, [{ type: 'tool_use', id: 't', name: 'Bash' }])]
  let r = deriveState(objs, now, now); assert.equal(r.state, 'tool'); assert.equal(r.tool, 'Bash'); assert.equal(r.maybeWaiting, false)
  r = deriveState([A(45000, [{ type: 'tool_use', id: 't', name: 'Edit' }])], now, now); assert.equal(r.maybeWaiting, true)
  r = deriveState([A(40 * 60000, [{ type: 'tool_use', id: 't', name: 'Bash' }])], now, now); assert.equal(r.state, 'idle', '30 minutes of inactivity counts as abandoned')
})

test('state: tool result just returned -> thinking; plain-text ending -> idle; within a few seconds of writing still counts as thinking', () => {
  assert.equal(deriveState([A(20000, [{ type: 'tool_use', id: 't', name: 'Bash' }]), U(8000, [{ type: 'tool_result', tool_use_id: 't' }], { toolUseResult: {} })], now, now).state, 'thinking')
  assert.equal(deriveState([A(60000, [{ type: 'text', text: 'done' }])], now, now).state, 'idle')
  assert.equal(deriveState([A(2000, [{ type: 'text', text: 'ok' }])], now, now).state, 'thinking')
})

test('state: interrupts, system end, and metadata lines do not interfere', () => {
  assert.equal(deriveState([U(5000, '[Request interrupted by user]')], now, now).state, 'idle')
  assert.equal(deriveState([A(60000, [{ type: 'text', text: 'x' }]), { type: 'system', subtype: 'stop_hook_summary', timestamp: at(50000) }], now, now).state, 'idle')
  // mode / ai-title / last-prompt are appended after each turn; the last "meaningful" entry is still the tool_use above
  const objs = [A(3000, [{ type: 'tool_use', id: 't', name: 'Read' }]), { type: 'mode' }, { type: 'ai-title', aiTitle: 'x' }, { type: 'last-prompt' }, { type: 'attachment' }]
  assert.equal(deriveState(objs, now, now).state, 'tool')
  assert.equal(deriveState([], now, now).state, 'unknown')
})

test('state: ignore sidechain (subagent) records', () => {
  const objs = [U(30000, 'hi'), A(20000, [{ type: 'text', text: 'main answer' }]), A(1000, [{ type: 'tool_use', id: 's', name: 'Bash' }], { isSidechain: true })]
  assert.equal(deriveState(objs, now, now).state, 'idle')
})

test('scan fake data directory: 3 sessions, sources and states', () => {
  const d = makeDemo(path.join(tmp(), 'h'))
  const s = scanSessions({ claudeDir: d.claudeDir })
  assert.equal(s.length, 3)
  const web = s.find(x => x.name === 'web-app'), api = s.find(x => x.name === 'api-server'), data = s.find(x => x.name === 'data-scripts')
  assert.equal(web.source, 'ide'); assert.equal(web.state, 'tool'); assert.equal(web.running, true); assert.equal(web.title, 'Add dark mode toggle')
  assert.equal(api.source, 'cli'); assert.equal(api.running, false); assert.equal(data.source, 'sdk')
  assert.equal(web.gitBranch, 'feature/dark-mode')
})

test('scan: nonexistent directory returns empty; sessions older than 24h do not appear', () => {
  assert.deepEqual(scanSessions({ claudeDir: '/nonexistent/xyz' }), [])
  const d = makeDemo(path.join(tmp(), 'h'))
  assert.equal(scanSessions({ claudeDir: d.claudeDir, windowMs: 60 * 60000 }).length, 1, 'only web-app is within 1 hour')
})

test('pick current session: pinned > sticky > running in workspace > running > recent in workspace > recent', () => {
  const S = (id, o) => ({ id, cwd: '/w/' + id, running: false, updatedAt: 0, ...o })
  const list = [S('a', { running: true, updatedAt: 3 }), S('b', { running: true, updatedAt: 2, cwd: '/proj/b' }), S('c', { updatedAt: 1, cwd: '/proj/c' })]
  assert.equal(pickCurrent(list, { workspaceDirs: ['/proj'] }).id, 'b', 'running in workspace takes priority')
  assert.equal(pickCurrent(list, {}).id, 'a')
  assert.equal(pickCurrent(list, { pinnedId: 'c' }).id, 'c')
  assert.equal(pickCurrent(list, { stickyId: 'a', workspaceDirs: [] }).id, 'a')
  assert.equal(pickCurrent(list, { stickyId: 'a', workspaceDirs: ['/proj'] }).id, 'b', 'sticky one is outside the workspace while a workspace one is running -> yield')
  assert.equal(pickCurrent([S('x', { cwd: '/proj/x' }), S('y', {})], { workspaceDirs: ['/proj'] }).id, 'x')
  assert.equal(pickCurrent([], {}), null)
  assert.equal(inWorkspace({ cwd: '/proj/b/' }, ['/proj']), true); assert.equal(inWorkspace({ cwd: '/projX' }, ['/proj']), false)
})
