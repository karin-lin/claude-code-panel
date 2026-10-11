#!/usr/bin/env node
'use strict'
/**
 * Claude Code status line helper (optional).
 * Claude Code pipes a JSON blob to your status line command on stdin. When you are on a subscription it contains
 * `rate_limits` (5h / 7d usage). This helper saves that blob next to itself so the panel can read it, then prints a status line.
 *
 *   node statusline-helper.js            print a simple default status line
 *   node statusline-helper.js --chain    also run your previous status line command (saved in original-statusline.json) and print its output instead
 *
 * It makes no network requests.
 */
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

let raw = ''
try { raw = fs.readFileSync(0, 'utf8') } catch {}
let data = null
try { data = JSON.parse(raw) } catch {}

if (data && data.rate_limits) {
  try {
    const out = path.join(__dirname, 'rate-limits.json')
    const tmp = out + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify({
      updated: Date.now(),
      rate_limits: data.rate_limits,
      model: data.model && (data.model.display_name || data.model.id) || null,
      context_window: data.context_window || null
    }))
    fs.renameSync(tmp, out)
  } catch {}
}

if (process.argv.includes('--chain')) {
  try {
    const orig = JSON.parse(fs.readFileSync(path.join(__dirname, 'original-statusline.json'), 'utf8'))
    if (orig && orig.command) {
      const r = spawnSync(orig.command, { input: raw, shell: true, encoding: 'utf8', timeout: 4000 })
      process.stdout.write(r.stdout || '')
      process.exit(0)
    }
  } catch {}
}

const pct = x => (x && Number.isFinite(Number(x.used_percentage)) ? Math.round(Number(x.used_percentage)) + '%' : null)
const rl = (data && data.rate_limits) || {}
const parts = []
const model = data && data.model && (data.model.display_name || data.model.id)
if (model) parts.push(model)
if (pct(rl.five_hour)) parts.push('5h ' + pct(rl.five_hour))
if (pct(rl.seven_day)) parts.push('7d ' + pct(rl.seven_day))
process.stdout.write(parts.join(' · '))
