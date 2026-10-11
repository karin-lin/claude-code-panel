'use strict'
/**
 * progress.js — task progress from three sources, merged by priority into one task card per session:
 *   1. Claude Code's built-in todo list: TodoWrite in the transcript (full replay for the current session, tail read for others), TaskCreate/TaskUpdate (best effort)
 *   2. your own progress files (optional): list files or directories in ccPanel.progressFiles; JSON format in docs/CUSTOMIZING.md
 *      { "title": "...", "sessionId": "optional", "cwd": "optional", "updated": "ISO time", "steps": [ { "name": "...", "state": "todo|doing|done", "note": "optional" } ] }
 *   Without sessionId, match by cwd to the most recent session in that directory; otherwise it becomes its own card.
 * Percentage = done steps / total steps, in-progress counts as 0.5; it only shows which step we are on and does not predict duration.
 */
const fs = require('node:fs')
const path = require('node:path')
const { expandHome, readJson, parseTime, DAY } = require('./util')

const STATES = new Set(['todo', 'doing', 'done'])

function normalizePlan(raw, nowMs = Date.now()) {
  if (!raw || !Array.isArray(raw.steps) || !raw.steps.length) return null
  const steps = raw.steps
    .map(s => ({ name: String((s && s.name) || ''), state: STATES.has(s && s.state) ? s.state : 'todo', note: s && s.note ? String(s.note) : '' }))
    .filter(s => s.name)
  if (!steps.length) return null
  const done = steps.filter(s => s.state === 'done').length
  const doing = steps.filter(s => s.state === 'doing').length
  return {
    title: String(raw.title || ''), steps, done, doing, total: steps.length,
    percent: Math.round((done + doing * 0.5) / steps.length * 100),
    finished: done === steps.length,
    startedAt: parseTime(raw.started), updatedAt: parseTime(raw.updated)
  }
}

/** Items extracted from the TodoWrite / Task tools: { at, items:[{name,state,note}] } -> plan */
function planFromTodos(todos, title, fallbackAt) {
  if (!todos || !Array.isArray(todos.items) || !todos.items.length) return null
  const items = todos.items.filter(x => x.state !== 'deleted')
  const plan = normalizePlan({ title, steps: items, updated: todos.at || fallbackAt })
  if (plan) plan.updatedAt = todos.at || fallbackAt || null
  return plan
}

function listProgressFiles(entries) {
  const files = []
  for (const e of entries || []) {
    const p = expandHome(String(e))
    let st; try { st = fs.statSync(p) } catch { continue }
    if (st.isDirectory()) {
      let names = []; try { names = fs.readdirSync(p) } catch {}
      for (const n of names) if (n.endsWith('.json') && !n.startsWith('.')) files.push(path.join(p, n))
    } else files.push(p)
  }
  return files
}

/** Read progress files -> [{ sessionId?, cwd?, plan, file }], updated within the last 24h */
function readProgressFiles(entries, nowMs = Date.now()) {
  const out = []
  for (const file of listProgressFiles(entries)) {
    const raw = readJson(file)
    const plan = normalizePlan(raw, nowMs)
    if (!plan) continue
    let mtime = null; try { mtime = fs.statSync(file).mtimeMs } catch {}
    plan.updatedAt = plan.updatedAt || mtime
    if (plan.updatedAt != null && nowMs - plan.updatedAt > DAY) continue
    const sid = (raw && raw.sessionId) || (path.basename(file, '.json').match(/^[0-9a-f-]{20,}$/i) ? path.basename(file, '.json') : null)
    out.push({ sessionId: sid, cwd: raw && raw.cwd ? String(raw.cwd) : null, plan, file })
  }
  return out
}

/**
 * Merge: sessions (already scanned, with title/cwd) + full stats of the current session + progress files.
 * Returns [{ key, sessionId|null, who, plan }], in-progress first (newest to oldest), completed last.
 */
function buildPlans({ sessions, currentId, currentStats, peek, fileEntries }, nowMs = Date.now()) {
  const byId = new Map(sessions.map(s => [s.id, s]))
  const out = new Map()
  const whoOf = s => s ? { source: s.source, name: s.name, title: s.title || null, running: s.running } : { source: 'unknown', name: '', title: null, running: false }
  for (const s of sessions) {
    let todos = null
    if (s.id === currentId && currentStats) todos = currentStats.todos || (currentStats.tasks && currentStats.tasks.length ? { at: currentStats.tasks[currentStats.tasks.length - 1].at, items: currentStats.tasks } : null)
    else if (peek) todos = peek(s.file)
    const plan = planFromTodos(todos, s.title || s.name, s.mtimeMs)
    if (plan && (nowMs - (plan.updatedAt || s.mtimeMs) < DAY)) out.set(s.id, { key: s.id, sessionId: s.id, who: whoOf(s), plan })
  }
  for (const f of readProgressFiles(fileEntries, nowMs)) {
    let s = f.sessionId ? byId.get(f.sessionId) : null
    if (!s && f.cwd) s = sessions.filter(x => x.cwd === f.cwd).sort((a, b) => b.updatedAt - a.updatedAt)[0] || null
    if (!f.plan.title) f.plan.title = (s && (s.title || s.name)) || path.basename(f.file, '.json')
    // the built-in list and the progress file are two sources, each gets its own card, neither overrides the other
    const key = 'file:' + f.file
    out.set(key, { key, sessionId: s ? s.id : null, who: whoOf(s), plan: f.plan })
  }
  return [...out.values()].sort((a, b) => (a.plan.finished - b.plan.finished) || ((b.plan.updatedAt || 0) - (a.plan.updatedAt || 0)))
}

module.exports = { normalizePlan, planFromTodos, readProgressFiles, buildPlans }
