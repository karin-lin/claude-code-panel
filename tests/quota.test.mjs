import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { normalizeLimits, evaluate, readFileSource, ApiSource, QuotaProvider } from '../lib/quota.js'

const H = 3600000, D = 86400000
const now = Date.parse('2026-10-11T00:00:00Z')

test('normalizeLimits: several input shapes are accepted', () => {
  const a = normalizeLimits({ five_hour: { util: 31, resets_at: '2026-10-11T02:00:00.123456+00:00' }, seven_day: { util: 50, resets_at: '2026-10-14T00:00:00Z' }, fetched_at: '2026-10-10T23:59:00Z' })
  assert.equal(a.five_hour.util, 31); assert.equal(a.five_hour.resetsAt, Date.parse('2026-10-11T02:00:00.123Z')); assert.equal(a.fetchedAt, Date.parse('2026-10-10T23:59:00Z'))
  const b = normalizeLimits({ rate_limits: { five_hour: { used_percentage: 12.5, resets_at: 1791680000 }, seven_day: { used_percentage: 3, resets_at: 1792000000 } } })
  assert.equal(b.five_hour.util, 12.5); assert.equal(b.five_hour.resetsAt, 1791680000000)
  const c = normalizeLimits({ five_hour: { utilization: 7 } }); assert.equal(c.five_hour.util, 7); assert.equal(c.seven_day, null)
  assert.equal(normalizeLimits({}), null); assert.equal(normalizeLimits(null), null); assert.equal(normalizeLimits({ five_hour: { util: 'abc' } }), null)
})

test('evaluate: level, pace marker, custom line, window already reset', () => {
  const lim = { five_hour: { util: 50, resetsAt: now + 2.5 * H }, seven_day: { util: 85, resetsAt: now + 3.5 * D } }
  let r = evaluate(lim, {}, now)
  assert.equal(Math.round(r.windows[0].pace), 50); assert.equal(Math.round(r.windows[1].pace), 50)
  assert.equal(r.windows[0].level, 'ok'); assert.equal(r.windows[1].level, 'warn'); assert.equal(r.level, 'warn'); assert.equal(r.distance, null)
  assert.equal(evaluate({ five_hour: { util: 96, resetsAt: now + H } }, {}, now).level, 'crit')
  r = evaluate(lim, { lines: { five_hour: 65, seven_day: 70 } }, now)
  assert.equal(r.windows[1].level, 'crit', '85 >= line 70'); assert.equal(r.distance, -15)
  r = evaluate({ five_hour: { util: 62, resetsAt: now + H } }, { lines: { five_hour: 65 } }, now)
  assert.equal(r.windows[0].level, 'warn', '3 points below the line -> warn')
  r = evaluate({ five_hour: { util: 99, resetsAt: now - 1000 } }, {}, now)
  assert.equal(r.windows[0].util, 0, 'window already reset, reading treated as 0')
})

test('file source: missing / no data / stale / ok', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccp-t-')), f = path.join(dir, 'l.json')
  assert.equal(readFileSource(f, now, 900000).reason, 'fileMissing')
  fs.writeFileSync(f, '{"hello":1}'); assert.equal(readFileSource(f, Date.now(), 900000).reason, 'noData')
  fs.writeFileSync(f, JSON.stringify({ five_hour: { util: 10 }, fetched_at: new Date(Date.now() - 3600000).toISOString() }))
  const stale = readFileSource(f, Date.now(), 900000); assert.equal(stale.ok, true); assert.equal(stale.stale, true); assert.equal(stale.reason, 'fileStale')
  fs.writeFileSync(f, JSON.stringify({ five_hour: { util: 10 } })); const fresh = readFileSource(f, Date.now(), 900000); assert.equal(fresh.stale, false)
  fs.rmSync(dir, { recursive: true, force: true })
})

const okJson = { five_hour: { utilization: 20, resets_at: '2026-10-11T03:00:00Z' }, seven_day: { utilization: 40, resets_at: '2026-10-15T00:00:00Z' } }
const resp = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body })
const token = { accessToken: 'tok', expiresAt: now + 3600000 }

test('API source: success, throttled by interval, correct request headers', async () => {
  let calls = 0, seen
  const api = new ApiSource({ readOAuthImpl: async () => token, fetchImpl: async (url, opt) => { calls++; seen = { url, opt }; return resp(200, okJson) } })
  let r = await api.get({ dir: '/x', intervalSec: 300 }, now)
  assert.equal(r.ok, true); assert.equal(r.limits.five_hour.util, 20); assert.equal(calls, 1)
  assert.equal(seen.opt.headers.Authorization, 'Bearer tok'); assert.equal(seen.opt.headers['anthropic-beta'], 'oauth-2025-04-20')
  await api.get({ dir: '/x', intervalSec: 300 }, now + 60000); assert.equal(calls, 1, 'no further request within the interval')
  await api.get({ dir: '/x', intervalSec: 300 }, now + 301000); await new Promise(r => setTimeout(r, 5)); assert.equal(calls, 2)
})

test('API source: 429 doubles backoff; 401 -> expired; no token; network error; interval floor 120 seconds', async () => {
  let n = 0
  const api = new ApiSource({ readOAuthImpl: async () => token, fetchImpl: async () => { n++; return resp(429) } })
  let r = await api.get({ dir: '/x', intervalSec: 300 }, now); assert.equal(r.reason, 'rateLimited'); assert.equal(r.ok, false)
  assert.equal(api.nextAt - now, 600000, 'first backoff = interval x 2')
  await api.get({ dir: '/x' }, now + 700000); await new Promise(r => setTimeout(r, 5)); assert.equal(api.nextAt - (now + 700000), 1200000, 'doubles again')
  const a2 = new ApiSource({ readOAuthImpl: async () => token, fetchImpl: async () => resp(401) }); assert.equal((await a2.get({ dir: '/x' }, now)).reason, 'expired')
  const a3 = new ApiSource({ readOAuthImpl: async () => null, fetchImpl: async () => { throw new Error('should not call') } }); assert.equal((await a3.get({ dir: '/x' }, now)).reason, 'noToken')
  const a4 = new ApiSource({ readOAuthImpl: async () => ({ accessToken: 't', expiresAt: now - 1000 }), fetchImpl: async () => { throw new Error('should not call') } }); assert.equal((await a4.get({ dir: '/x' }, now)).reason, 'expired', 'expired token is neither used for a request nor refreshed')
  const a5 = new ApiSource({ readOAuthImpl: async () => token, fetchImpl: async () => { throw new Error('boom') } }); assert.equal((await a5.get({ dir: '/x' }, now)).reason, 'network')
  const a6 = new ApiSource({ readOAuthImpl: async () => token, fetchImpl: async () => resp(200, okJson) }); await a6.get({ dir: '/x', intervalSec: 1 }, now); assert.equal(a6.nextAt - now, 120000)
})

test('API source: after a failure keep the last good reading and attach the reason', async () => {
  let fail = false
  const api = new ApiSource({ readOAuthImpl: async () => token, fetchImpl: async () => (fail ? resp(429) : resp(200, okJson)) })
  await api.get({ dir: '/x', intervalSec: 120 }, now); fail = true
  await api.get({ dir: '/x', intervalSec: 120 }, now + 121000); await new Promise(r => setTimeout(r, 5))
  const r = await api.get({ dir: '/x', intervalSec: 120 }, now + 122000)
  assert.equal(r.ok, true); assert.equal(r.reason, 'rateLimited'); assert.equal(r.limits.five_hour.util, 20)
})

test('QuotaProvider: ask / off read nothing; file mode gets a full evaluation', async () => {
  const p = new QuotaProvider({ fetchImpl: async () => { throw new Error('no network expected') }, readOAuthImpl: async () => { throw new Error('no token read expected') } })
  assert.deepEqual(await p.read({ source: 'ask' }, now), { source: 'ask', ok: false, needsSetup: true })
  assert.equal((await p.read({ source: 'off' }, now)).needsSetup, false)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccp-t-')); fs.mkdirSync(path.join(dir, 'cc-panel'))
  fs.writeFileSync(path.join(dir, 'cc-panel', 'rate-limits.json'), JSON.stringify({ rate_limits: { five_hour: { used_percentage: 30, resets_at: Math.round((Date.now() + 2 * H) / 1000) } } }))
  const r = await p.read({ source: 'file', claudeDir: dir, lines: { five_hour: 65 } }, Date.now())
  assert.equal(r.ok, true); assert.equal(r.windows[0].util, 30); assert.equal(r.distance, 35)
  fs.rmSync(dir, { recursive: true, force: true })
})
