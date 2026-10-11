import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { planInstall, planUninstall, isOurs, shQuote } from '../lib/installer.js'

const helper = '/home/u/.claude/cc-panel/statusline-helper.js'

test('install: no status bar -> set directly; other settings untouched', () => {
  const r = planInstall({ model: 'x', env: { A: '1' } }, helper)
  assert.equal(r.already, false); assert.equal(r.original, null); assert.equal(r.settings.model, 'x'); assert.deepEqual(r.settings.env, { A: '1' })
  assert.match(r.settings.statusLine.command, /statusline-helper\.js/); assert.doesNotMatch(r.settings.statusLine.command, /--chain/)
})

test('install: existing status bar -> --chain keeps the original command and padding / refreshInterval', () => {
  const orig = { type: 'command', command: 'my-status --fancy "x $HOME"', padding: 2, refreshInterval: 5 }
  const r = planInstall({ statusLine: orig }, helper)
  assert.match(r.settings.statusLine.command, /--chain$/); assert.equal(r.settings.statusLine.padding, 2); assert.equal(r.settings.statusLine.refreshInterval, 5)
  assert.deepEqual(r.original, orig); assert.equal(r.settings.statusLine.command.includes('my-status'), false, 'original command is kept in a side file, not spliced into the command line')
})

test('install: already installed -> already; original object not mutated', () => {
  const first = planInstall({}, helper).settings
  assert.equal(planInstall(first, helper).already, true)
  const input = { statusLine: { command: 'a' } }; planInstall(input, helper); assert.deepEqual(input, { statusLine: { command: 'a' } })
})

test('uninstall: restore the original status bar; remove if there was none; do not touch what we did not install', () => {
  const orig = { type: 'command', command: 'my-status' }
  const inst = planInstall({ statusLine: orig }, helper).settings
  assert.deepEqual(planUninstall(inst, orig).settings.statusLine, orig)
  const inst2 = planInstall({ a: 1 }, helper).settings
  const u = planUninstall(inst2, null); assert.equal(u.settings.statusLine, undefined); assert.equal(u.settings.a, 1)
  const theirs = { statusLine: { command: 'something-else' } }; assert.equal(planUninstall(theirs, null).changed, false)
  assert.equal(isOurs({ command: 'node x/cc-panel/statusline-helper.js' }), true); assert.equal(isOurs(null), false)
  assert.match(shQuote("/a b/it's"), /^'/)
})

test('helper script: writes rate-limits.json and prints the default status bar; --chain forwards to the original command', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccp-t-'))
  fs.copyFileSync(path.resolve('tools/statusline-helper.js'), path.join(dir, 'statusline-helper.js'))
  const input = JSON.stringify({ model: { display_name: 'Sonnet' }, rate_limits: { five_hour: { used_percentage: 41.6, resets_at: 1791680000 }, seven_day: { used_percentage: 9, resets_at: 1792000000 } } })
  let r = spawnSync('node', [path.join(dir, 'statusline-helper.js')], { input, encoding: 'utf8' })
  assert.equal(r.stdout, 'Sonnet · 5h 42% · 7d 9%')
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'rate-limits.json'), 'utf8'))
  assert.equal(saved.rate_limits.five_hour.used_percentage, 41.6); assert.ok(saved.updated > 0)
  fs.writeFileSync(path.join(dir, 'original-statusline.json'), JSON.stringify({ command: 'cat' }))
  r = spawnSync('node', [path.join(dir, 'statusline-helper.js'), '--chain'], { input: 'orig-output', encoding: 'utf8' })
  assert.equal(r.stdout, 'orig-output', 'original command receives the same stdin, output printed as-is')
  r = spawnSync('node', [path.join(dir, 'statusline-helper.js')], { input: 'not json', encoding: 'utf8' }); assert.equal(r.status, 0, 'bad input does not error')
  fs.rmSync(dir, { recursive: true, force: true })
})
