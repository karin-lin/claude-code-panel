#!/usr/bin/env node
'use strict'
/**
 * Example: write a progress file the panel understands. No dependencies, works with any tool or script.
 *
 *   node progress.js plan "Release 1.4" "Changelog" "Bump version" "Build" "Publish"
 *   node progress.js done 1 2          mark steps 1 and 2 done (the next todo step becomes "doing")
 *   node progress.js doing 3 "linux done, arm64 pending"
 *   node progress.js add "Announce"
 *   node progress.js finish | clear | show
 *
 * The file is keyed by the current directory, so the panel attaches it to the most recent Claude Code
 * session started in that directory. Files live in <claude dir>/cc-panel/progress/ which the panel scans automatically.
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')

const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
const dir = path.join(claudeDir, 'cc-panel', 'progress')
const key = crypto.createHash('sha1').update(process.cwd()).digest('hex').slice(0, 12)
const file = path.join(dir, `cwd-${key}.json`)

const load = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null } }
const save = d => { fs.mkdirSync(dir, { recursive: true }); d.cwd = process.cwd(); d.updated = new Date().toISOString(); fs.writeFileSync(file + '.tmp', JSON.stringify(d, null, 2)); fs.renameSync(file + '.tmp', file) }
const advance = d => { if (!d.steps.some(s => s.state === 'doing')) { const n = d.steps.find(s => s.state === 'todo'); if (n) n.state = 'doing' } }
const show = d => {
  const done = d.steps.filter(s => s.state === 'done').length, doing = d.steps.filter(s => s.state === 'doing').length
  console.log(`${d.title}  ${Math.round((done + doing * 0.5) / d.steps.length * 100)}%`)
  d.steps.forEach((s, i) => console.log(` ${i + 1}. [${{ done: 'x', doing: '~', todo: ' ' }[s.state]}] ${s.name}${s.note ? '  - ' + s.note : ''}`))
}

const [cmd, ...args] = process.argv.slice(2)
let d = load()
if (cmd === 'plan') {
  if (args.length < 2) { console.error('usage: progress.js plan "title" "step 1" "step 2" ...'); process.exit(2) }
  d = { title: args[0], started: new Date().toISOString(), steps: args.slice(1).map(name => ({ name, state: 'todo' })) }; advance(d)
} else if (cmd === 'clear') { try { fs.unlinkSync(file) } catch {} ; console.log('cleared'); process.exit(0) }
else if (!d) { console.error('no plan here yet; run "plan" first'); process.exit(1) }
else if (cmd === 'done') { for (const i of args.map(Number)) if (d.steps[i - 1]) d.steps[i - 1].state = 'done'; advance(d) }
else if (cmd === 'doing') { const i = Number(args[0]); if (!d.steps[i - 1]) process.exit(2); d.steps.forEach(s => { if (s.state === 'doing') s.state = 'todo' }); d.steps[i - 1].state = 'doing'; d.steps[i - 1].note = args[1] || '' }
else if (cmd === 'add') { d.steps.push({ name: args.join(' '), state: 'todo' }); advance(d) }
else if (cmd === 'finish') d.steps.forEach(s => { s.state = 'done' })
else if (cmd === 'show') { show(d); process.exit(0) }
else { console.error('commands: plan | done | doing | add | finish | clear | show'); process.exit(2) }
save(d); show(d)
