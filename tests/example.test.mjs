import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createCollector } from '../lib/snapshot.js'
import { createRequire } from 'node:module'
const { makeDemo } = createRequire(import.meta.url)('../scripts/demo-data.js')

test('examples/progress.js: writes a progress file; the panel picks it up and attaches it to the session by cwd', async () => {
  const d = makeDemo(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ccp-t-')), 'h'))
  const script = path.resolve('examples/progress.js')
  const run = (...a) => spawnSync('node', [script, ...a], { cwd: os.tmpdir(), env: { ...process.env, CLAUDE_CONFIG_DIR: d.claudeDir }, encoding: 'utf8' })
  // The script's cwd must match the fake session's cwd to attach: rewrite the cwd in the file to simulate running inside the project directory
  assert.match(run('plan', 'My job', 'one', 'two', 'three').stdout, /My job {2}17%/)
  assert.match(run('done', '1').stdout, /50%|42%/)
  const dir = path.join(d.claudeDir, 'cc-panel', 'progress'); const f = path.join(dir, fs.readdirSync(dir)[0])
  const j = JSON.parse(fs.readFileSync(f, 'utf8')); j.cwd = d.cwd.api; fs.writeFileSync(f, JSON.stringify(j))
  const s = await createCollector().collect({ claudeDir: d.claudeDir, workspaceDirs: [], quota: { source: 'off' } })
  const mine = s.plans.find(p => p.plan.title === 'My job')
  assert.ok(mine, 'default directory <claudeDir>/cc-panel/progress is scanned automatically'); assert.equal(mine.who.name, 'api-server')
  assert.match(run('finish').stdout, /100%/); assert.equal(run('clear').stdout.trim(), 'cleared'); assert.equal(fs.readdirSync(dir).length, 0)
  assert.notEqual(run('done', '1').status, 0, 'errors out instead of crashing when there is no plan')
})
