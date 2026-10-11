import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { en, zh, makeT, pick } from '../lib/i18n.js'

const params = s => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',')

test('zh/en dictionary keys and placeholders match', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort())
  for (const k of Object.keys(en)) assert.equal(params(en[k]), params(zh[k]), `placeholder mismatch: ${k}`)
})

test('every dictionary key used in code exists (except dynamically built prefixes)', () => {
  const files = ['webview/panel.js', 'extension.js', 'lib/format.js']
  const used = new Set()
  // only count calls to functions named t / T; do not treat things like config.get('quota.source') as UI text
  for (const f of files) for (const m of fs.readFileSync(f, 'utf8').matchAll(/(?<![\w.])[tT]\(\s*'([a-z]+\.[A-Za-z_.]+)'/g)) used.add(m[1])
  assert.ok(used.size > 40, 'should find many keys, actually ' + used.size)
  for (const k of used) if (!k.endsWith('.')) assert.ok(k in en, `missing dictionary key: ${k}`)
  // dynamically built key families: list the possible values from the code and check each
  const reasons = ['noToken', 'expired', 'rateLimited', 'network', 'fileMissing', 'fileStale', 'noData', 'unknown']
  const quotaSrc = fs.readFileSync('lib/quota.js', 'utf8')
  for (const r of reasons) assert.ok(('quota.hint.' + r) in en, `missing quota.hint.${r}`)
  for (const m of quotaSrc.matchAll(/(?:error|reason)\s*[:=]\s*'(\w+)'/g)) assert.ok(reasons.includes(m[1]), `quota.js contains an unregistered reason: ${m[1]}`)
  for (const k of ['five_hour', 'seven_day', 'ok', 'warn', 'crit']) assert.ok(('quota.' + k) in en, `missing quota.${k}`)
  for (const k of ['ide', 'cli', 'sdk', 'unknown']) assert.ok(('src.' + k) in en, `missing src.${k}`)
  for (const k of ['overview', 'tasks', 'session']) assert.ok(('tab.' + k) in en, `missing tab.${k}`)
})

test('makeT: language selection, placeholder substitution, missing-key fallback', () => {
  assert.equal(pick('zh-CN').lang, 'zh'); assert.equal(pick('en-US').lang, 'en'); assert.equal(pick(undefined).lang, 'en'); assert.equal(pick('ja').lang, 'en')
  assert.equal(makeT('en')('quota.resets', { t: '2h' }), 'resets in 2h'); assert.equal(makeT('zh-cn')('quota.resets', { t: '2h' }), '2h后重置')
  assert.equal(makeT('en')('no.such.key'), 'no.such.key'); assert.equal(makeT('en')('quota.resets'), 'resets in {t}')
})
