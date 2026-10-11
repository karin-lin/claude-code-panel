import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { normalizePlan, planFromTodos, readProgressFiles, buildPlans } from '../lib/progress.js'

const now = Date.now()
const iso = off => new Date(now - off).toISOString()

test('percentage: done 1, doing 0.5; bad state treated as todo; empty steps dropped', () => {
  const p = normalizePlan({ title: 't', steps: [{ name: 'a', state: 'done' }, { name: 'b', state: 'doing', note: 'n' }, { name: 'c' }, { name: 'd', state: 'bogus' }, { name: '' }] })
  assert.equal(p.total, 4); assert.equal(p.percent, 38); assert.equal(p.finished, false); assert.equal(p.steps[3].state, 'todo')
  assert.equal(normalizePlan({ steps: [] }), null); assert.equal(normalizePlan(null), null); assert.equal(normalizePlan({ steps: [{ name: '' }] }), null)
  assert.equal(normalizePlan({ steps: [{ name: 'a', state: 'done' }] }).finished, true)
})

test('planFromTodos: deleted items excluded; updatedAt taken from the list time', () => {
  const pl = planFromTodos({ at: 1000, items: [{ name: 'a', state: 'done' }, { name: 'x', state: 'deleted' }, { name: 'b', state: 'todo' }] }, 'T', 5)
  assert.equal(pl.total, 2); assert.equal(pl.percent, 50); assert.equal(pl.updatedAt, 1000); assert.equal(planFromTodos(null, 'T'), null)
})

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccp-t-'))
  const w = (n, o) => fs.writeFileSync(path.join(dir, n), JSON.stringify(o))
  return { dir, w }
}

test('progress files: attributed by sessionId / filename / cwd; older than 24h dropped; both directories and single files can be listed', () => {
  const { dir, w } = setup()
  w('abc.json', { title: 'A', sessionId: 's-1', updated: iso(1000), steps: [{ name: 'x', state: 'doing' }] })
  w('22222222-bbbb-4bbb-8bbb-222222222222.json', { updated: iso(1000), steps: [{ name: 'x', state: 'done' }] })
  w('cwdbound.json', { title: 'C', cwd: '/p/api', updated: iso(1000), steps: [{ name: 'x', state: 'todo' }] })
  w('old.json', { title: 'O', updated: iso(30 * 3600000), steps: [{ name: 'x', state: 'doing' }] })
  w('bad.json', { nope: true })
  const r = readProgressFiles([dir], now)
  assert.equal(r.length, 3)
  assert.equal(r.find(x => x.plan.title === 'A').sessionId, 's-1')
  assert.equal(r.find(x => x.sessionId === '22222222-bbbb-4bbb-8bbb-222222222222').plan.finished, true)
  assert.equal(readProgressFiles([path.join(dir, 'abc.json')], now).length, 1)
  assert.deepEqual(readProgressFiles(['/nonexistent'], now), [])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('merge: built-in todo list and progress file each get their own card; cwd maps to the most recent session; in-progress first', () => {
  const { dir, w } = setup()
  w('cwd.json', { title: 'Release', cwd: '/p/api', updated: iso(5000), steps: [{ name: 'a', state: 'doing' }] })
  w('free.json', { title: 'Standalone', updated: iso(9000), steps: [{ name: 'a', state: 'done' }, { name: 'b', state: 'todo' }] })
  const S = (id, cwd, o) => ({ id, file: '/f/' + id, cwd, name: path.basename(cwd), source: 'ide', title: 'T-' + id, running: false, mtimeMs: now, updatedAt: now, ...o })
  const sessions = [S('web', '/p/web'), S('api-old', '/p/api', { updatedAt: now - 99999 }), S('api-new', '/p/api')]
  const peek = f => (f === '/f/web' ? { at: now - 20000, items: [{ name: 'a', state: 'done' }, { name: 'b', state: 'done' }] } : null)
  const plans = buildPlans({ sessions, currentId: 'api-new', currentStats: { todos: { at: now - 3000, items: [{ name: 'x', state: 'doing' }] } }, peek, fileEntries: [dir] }, now)
  assert.deepEqual(plans.map(p => p.plan.title.replace(/^T-/, '')), ['api-new', 'Release', 'Standalone', 'web'].map(x => x === 'api-new' ? 'api-new' : x), 'in-progress (newest to oldest) first, completed last')
  assert.equal(plans.find(p => p.plan.title === 'Release').who.title, 'T-api-new', 'same cwd picks the most recently updated session')
  assert.equal(plans.find(p => p.plan.title === 'Standalone').sessionId, null)
  assert.equal(plans.filter(p => p.sessionId === 'api-new').length, 2, 'two cards for one session: built-in list + progress file')
  fs.rmSync(dir, { recursive: true, force: true })
})
