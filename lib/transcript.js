'use strict'
/**
 * transcript.js — incrementally reads one session's transcript JSONL(~/.claude/projects/<proj>/<session>.jsonl).
 * Only reads newly appended bytes; the whole file is scanned only on first open (largest sessions ~25MB, streamed so the extension host does not stall).
 *
 * What it computes:
 *  - context: input + cache_read + cache_creation of the last assistant message = tokens actually put into context by this request
 *  - totals: cumulative for this session (deduped by message.id, since streaming writes one reply across several lines with repeated usage)
 *  - tools: counted by name (deduped by tool_use.id); Agent/Task are counted separately as subagents
 *  - turn: number of tools / subagents since the latest real user prompt
 *  - title / lastPrompt: ready-made ai-title / last-prompt lines in the transcript
 *  - todos / tasks: Claude Code's built-in todo list (latest full TodoWrite list; TaskCreate/TaskUpdate replayed, best effort)
 */
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { readJson } = require('./util')

const AGENT_TOOLS = new Set(['Agent', 'Task'])

function freshStats() {
  return {
    title: null, lastPrompt: null, model: null, version: null, gitBranch: null, cwd: null,
    context: { input: 0, cacheRead: 0, cacheCreate: 0, total: 0, at: null },
    totals: { input: 0, cacheRead: 0, cacheCreate: 0, output: 0, thinking: 0, assistantMessages: 0 },
    tools: { byName: {}, total: 0, agents: 0 },
    turn: { startedAt: null, endedAt: null, tools: 0, agents: 0, lastToolAt: null },
    todos: null, tasks: [], taskSeq: 0,
    prompts: 0, firstAt: null, lastAt: null, bytes: 0, mtime: null, missing: false
  }
}

function createCtx() { return { seenTools: new Set(), lastMsgId: null } }

function ts(obj) {
  const t = obj.timestamp ? Date.parse(obj.timestamp) : NaN
  return Number.isFinite(t) ? t : null
}

function isRealPrompt(obj) {
  if (obj.type !== 'user' || obj.toolUseResult || obj.isMeta) return false
  const m = obj.message
  if (!m || typeof m !== 'object') return false
  const c = m.content
  if (typeof c === 'string') return c.trim().length > 0
  if (Array.isArray(c)) return c.some(b => b && b.type === 'text') && !c.some(b => b && b.type === 'tool_result')
  return false
}

/** Pure function: merge one parsed JSON line into stats. ctx holds the dedup sets. */
function applyLine(stats, obj, ctx) {
  if (!obj || typeof obj !== 'object') return
  const t = ts(obj)
  if (t) { if (!stats.firstAt) stats.firstAt = t; stats.lastAt = t }
  if (obj.cwd && !stats.cwd) stats.cwd = obj.cwd
  if (obj.version) stats.version = obj.version
  if (obj.gitBranch) stats.gitBranch = obj.gitBranch

  switch (obj.type) {
    case 'ai-title':
      if (obj.aiTitle) stats.title = String(obj.aiTitle)
      return
    case 'last-prompt':
      if (obj.lastPrompt) stats.lastPrompt = String(obj.lastPrompt)
      return
    case 'system':
      if (obj.subtype === 'stop_hook_summary' && t) stats.turn.endedAt = t
      return
    case 'user':
      if (isRealPrompt(obj)) {
        stats.prompts += 1
        stats.turn = { startedAt: t, endedAt: null, tools: 0, agents: 0, lastToolAt: null }
      }
      return
    case 'assistant': {
      const m = obj.message
      if (!m || typeof m !== 'object') return
      if (m.model) stats.model = m.model
      const u = m.usage
      if (u && typeof u === 'object' && !obj.isSidechain) {
        const input = Number(u.input_tokens) || 0
        const cacheRead = Number(u.cache_read_input_tokens) || 0
        const cacheCreate = Number(u.cache_creation_input_tokens) || 0
        stats.context = { input, cacheRead, cacheCreate, total: input + cacheRead + cacheCreate, at: t }
        const id = m.id || obj.requestId || null
        if (!id || id !== ctx.lastMsgId) {
          ctx.lastMsgId = id
          stats.totals.input += input
          stats.totals.cacheRead += cacheRead
          stats.totals.cacheCreate += cacheCreate
          stats.totals.output += Number(u.output_tokens) || 0
          stats.totals.thinking += Number((u.output_tokens_details || {}).thinking_tokens) || 0
          stats.totals.assistantMessages += 1
        }
      }
      const c = m.content
      if (Array.isArray(c)) {
        for (const b of c) {
          if (!b || b.type !== 'tool_use') continue
          const key = b.id || `${b.name}@${t}`
          if (ctx.seenTools.has(key)) continue
          ctx.seenTools.add(key)
          const name = b.name || '?'
          stats.tools.byName[name] = (stats.tools.byName[name] || 0) + 1
          stats.tools.total += 1
          stats.turn.tools += 1
          stats.turn.lastToolAt = t
          if (AGENT_TOOLS.has(name)) { stats.tools.agents += 1; stats.turn.agents += 1 }
          trackPlanTool(stats, name, b.input, t)
        }
      }
      return
    }
    default:
      return
  }
}

const TODO_STATE = { pending: 'todo', in_progress: 'doing', completed: 'done', deleted: 'deleted', cancelled: 'deleted' }
function todoState(v) { return TODO_STATE[String(v || '').toLowerCase()] || 'todo' }

/** TodoWrite always carries the full list, so take the latest; TaskCreate/TaskUpdate are replayed in order (task IDs increment from 1, a best-effort inference). */
function trackPlanTool(stats, name, input, t) {
  if (!input || typeof input !== 'object') return
  if (name === 'TodoWrite' && Array.isArray(input.todos)) {
    stats.todos = { at: t, items: input.todos.map(x => ({ name: String((x && (x.content || x.subject)) || ''), state: todoState(x && x.status), note: String((x && x.activeForm) || '') })).filter(x => x.name) }
  } else if (name === 'TaskCreate') {
    stats.taskSeq += 1
    stats.tasks.push({ id: String(stats.taskSeq), name: String(input.subject || input.title || input.description || 'Task'), state: 'todo', note: String(input.activeForm || ''), at: t })
  } else if (name === 'TaskUpdate') {
    const task = stats.tasks.find(x => x.id === String(input.taskId))
    if (!task) return
    if (input.status) task.state = todoState(input.status)
    if (input.subject) task.name = String(input.subject)
    if (input.activeForm) task.note = String(input.activeForm)
    task.at = t
  }
}

class TranscriptReader {
  constructor(file) {
    this.file = file
    this.offset = 0
    this.rest = Buffer.alloc(0)
    this.stats = freshStats()
    this.ctx = createCtx()
    this.loading = null
  }

  reset() {
    this.offset = 0
    this.rest = Buffer.alloc(0)
    this.stats = freshStats()
    this.ctx = createCtx()
  }

  async update() {
    let st
    try { st = await fsp.stat(this.file) } catch { this.stats.missing = true; return this.stats }
    this.stats.missing = false
    this.stats.bytes = st.size
    this.stats.mtime = st.mtimeMs
    if (st.size < this.offset) this.reset()
    if (st.size === this.offset) return this.stats
    if (this.loading) return this.stats
    this.loading = this._read(st.size).finally(() => { this.loading = null })
    await this.loading
    return this.stats
  }

  _line(buf) {
    if (!buf.length) return
    let obj
    try { obj = JSON.parse(buf.toString('utf8')) } catch { return }
    applyLine(this.stats, obj, this.ctx)
  }

  _read(toSize) {
    return new Promise((resolve, reject) => {
      const stream = fs.createReadStream(this.file, { start: this.offset, end: toSize - 1, highWaterMark: 256 * 1024 })
      stream.on('data', chunk => {
        let buf = this.rest.length ? Buffer.concat([this.rest, chunk]) : chunk
        let from = 0
        for (;;) {
          const nl = buf.indexOf(0x0a, from)
          if (nl < 0) break
          this._line(buf.subarray(from, nl))
          from = nl + 1
        }
        this.rest = from < buf.length ? Buffer.from(buf.subarray(from)) : Buffer.alloc(0)
      })
      stream.on('end', () => { this.offset = toSize; resolve() })
      stream.on('error', reject)
    })
  }
}

/** Subagents: <session>/subagents/agent-*.meta.json + the same-named .jsonl. Still being written within 90s = active. */
async function listSubagents(transcriptPath, nowMs = Date.now()) {
  const dir = path.join(transcriptPath.replace(/\.jsonl$/, ''), 'subagents')
  let names
  try { names = await fsp.readdir(dir) } catch { return [] }
  const out = []
  for (const n of names) {
    if (!n.endsWith('.meta.json')) continue
    const id = n.slice(0, -'.meta.json'.length)
    const meta = readJson(path.join(dir, n)) || {}
    let jl = null, ms = null
    try { jl = await fsp.stat(path.join(dir, id + '.jsonl')) } catch {}
    try { ms = (await fsp.stat(path.join(dir, n))).mtimeMs } catch {}
    const updatedAt = jl ? jl.mtimeMs : ms
    out.push({
      id,
      agentType: meta.agentType || '?',
      description: meta.description || '',
      shape: meta.requestShape || '',
      startedAt: ms,
      updatedAt,
      bytes: jl ? jl.size : 0,
      active: updatedAt != null && nowMs - updatedAt < 90000
    })
  }
  return out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 12)
}

// Read only the file tail to find the title: the ai-title line is rewritten every turn and is almost always within the last 96KB; cached by (path,size)
const TAIL_BYTES = 96 * 1024
const titleCache = new Map()
async function peekTitle(file) {
  if (!file) return null
  let st
  try { st = await fsp.stat(file) } catch { return null }
  const hit = titleCache.get(file)
  if (hit && hit.size === st.size) return hit.title
  let fh = null, title = null
  try {
    fh = await fsp.open(file, 'r')
    const len = Math.min(TAIL_BYTES, st.size)
    const buf = Buffer.alloc(len)
    await fh.read(buf, 0, len, st.size - len)
    const lines = buf.toString('utf8').split('\n')
    let fallback = null
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i]
      if (!title && l.includes('"ai-title"')) { try { const o = JSON.parse(l); if (o.type === 'ai-title' && o.aiTitle) title = String(o.aiTitle) } catch {} }
      if (!fallback && l.includes('"last-prompt"')) { try { const o = JSON.parse(l); if (o.type === 'last-prompt' && o.lastPrompt) fallback = String(o.lastPrompt).slice(0, 60) } catch {} }
      if (title) break
    }
    title = title || fallback
  } catch { title = null } finally { if (fh) await fh.close().catch(() => {}) }
  titleCache.set(file, { size: st.size, title })
  if (titleCache.size > 64) titleCache.delete(titleCache.keys().next().value)
  return title
}

// Non-current session: read only the last 2MB of the file to find the latest TodoWrite (no full-session replay)
const todoCache = new Map()
function peekTodos(file) {
  const { readTail } = require('./util')
  let st
  try { st = fs.statSync(file) } catch { return null }
  const hit = todoCache.get(file)
  if (hit && hit.size === st.size) return hit.value
  const tail = readTail(file, 2 * 1024 * 1024)
  let value = null
  if (tail) {
    const lines = tail.text.split('\n')
    for (let i = lines.length - 1; i >= 0 && !value; i--) {
      if (!lines[i].includes('"TodoWrite"')) continue
      let o; try { o = JSON.parse(lines[i]) } catch { continue }
      const blocks = o && o.message && Array.isArray(o.message.content) ? o.message.content : []
      for (const b of blocks) {
        if (b && b.type === 'tool_use' && b.name === 'TodoWrite') {
          const tmp = freshStats()
          trackPlanTool(tmp, 'TodoWrite', b.input, o.timestamp ? Date.parse(o.timestamp) : st.mtimeMs)
          value = tmp.todos
        }
      }
    }
  }
  todoCache.set(file, { size: st.size, value })
  if (todoCache.size > 64) todoCache.delete(todoCache.keys().next().value)
  return value
}

module.exports = { TranscriptReader, applyLine, freshStats, createCtx, listSubagents, peekTitle, peekTodos, trackPlanTool, isRealPrompt }
