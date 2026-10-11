'use strict'
/**
 * sessions.js — no hooks needed: directly scans <claudeDir>/projects/**\/*.jsonl (session transcripts written by Claude Code itself).
 *  - find cwd / entrypoint / version in the head; find the title and "what it did last" in the tail
 *  - source from entrypoint: claude-vscode=IDE, cli=terminal, sdk-*=SDK / headless
 *  - running state is inferred from the last meaningful record (see deriveState)
 */
const fs = require('node:fs')
const path = require('node:path')
const { readHead, readTail, MIN, HOUR, DAY } = require('./util')

const TAIL_BYTES = 128 * 1024
const HEAD_BYTES = 64 * 1024
const MESSAGE_TYPES = new Set(['user', 'assistant', 'system'])

function sourceKind(entrypoint) {
  if (!entrypoint) return 'unknown'
  if (entrypoint === 'claude-vscode' || entrypoint.includes('vscode') || entrypoint.includes('jetbrains') || entrypoint.includes('ide')) return 'ide'
  if (entrypoint === 'cli') return 'cli'
  if (entrypoint.startsWith('sdk')) return 'sdk'
  return 'unknown'
}

function ts(o) { const t = o && o.timestamp ? Date.parse(o.timestamp) : NaN; return Number.isFinite(t) ? t : null }

function isToolResultLine(o) {
  const c = o && o.message && o.message.content
  return Array.isArray(c) && c.some(b => b && b.type === 'tool_result')
}

function userText(o) {
  const c = o && o.message && o.message.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) return c.filter(b => b && b.type === 'text').map(b => b.text || '').join(' ')
  return ''
}

/**
 * Pure function: objs = records parsed from the file tail (chronological). Returns
 * { state: 'tool'|'thinking'|'idle'|'unknown', tool, pendingSince, maybeWaiting, turnStartedAt, turnEndedAt, lastAt }
 */
function deriveState(objs, mtimeMs, nowMs) {
  // Only real conversation messages count; metadata lines such as mode / last-prompt / ai-title are appended after each turn and must not be treated as the "last entry"
  const meaningful = objs.filter(o => o && MESSAGE_TYPES.has(o.type) && !o.isSidechain)
  const last = meaningful[meaningful.length - 1]
  let turnStartedAt = null
  for (let i = meaningful.length - 1; i >= 0; i--) {
    const o = meaningful[i]
    if (o.type === 'user' && !o.toolUseResult && !o.isMeta && !isToolResultLine(o) && userText(o).trim()) { turnStartedAt = ts(o); break }
  }
  const out = { state: 'unknown', tool: null, pendingSince: null, maybeWaiting: false, turnStartedAt, turnEndedAt: null, lastAt: last ? (ts(last) || mtimeMs) : mtimeMs }
  if (!last) return out
  const at = ts(last) || mtimeMs
  const age = nowMs - at
  if (last.type === 'system') { out.state = 'idle'; out.turnEndedAt = at; return out }
  if (last.type === 'assistant') {
    const blocks = last.message && Array.isArray(last.message.content) ? last.message.content : []
    const uses = blocks.filter(b => b && b.type === 'tool_use')
    if (uses.length) {
      if (age > 30 * MIN) { out.state = 'idle'; out.turnEndedAt = at; return out }
      out.state = 'tool'; out.tool = uses[uses.length - 1].name; out.pendingSince = at; out.maybeWaiting = age > 30000
      return out
    }
    // Plain text: within a few seconds of writing another block may follow, otherwise the turn is over
    if (age < 4000) { out.state = 'thinking'; return out }
    out.state = 'idle'; out.turnEndedAt = at; return out
  }
  if (last.type === 'user') {
    if (/^\s*\[Request interrupted/.test(userText(last))) { out.state = 'idle'; out.turnEndedAt = at; return out }
    if (age > 10 * MIN) { out.state = 'idle'; out.turnEndedAt = at; return out }
    out.state = 'thinking'; return out
  }
  return out
}

const headCache = new Map()
function headInfo(file) {
  const hit = headCache.get(file)
  if (hit) return hit
  const text = readHead(file, HEAD_BYTES) || ''
  const info = { cwd: null, entrypoint: null, version: null, gitBranch: null }
  for (const line of text.split('\n')) {
    if (!line.includes('"cwd"') && !line.includes('"entrypoint"')) continue
    let o; try { o = JSON.parse(line) } catch { continue }
    if (!info.cwd && o.cwd) info.cwd = o.cwd
    if (!info.entrypoint && o.entrypoint) info.entrypoint = o.entrypoint
    if (!info.version && o.version) info.version = o.version
    if (!info.gitBranch && o.gitBranch) info.gitBranch = o.gitBranch
    if (info.cwd && info.entrypoint) break
  }
  if (info.cwd || info.entrypoint) headCache.set(file, info)
  if (headCache.size > 400) headCache.delete(headCache.keys().next().value)
  return info
}

const tailCache = new Map()
function tailInfo(file, mtimeMs, size, nowMs) {
  const key = `${size}:${mtimeMs}`
  const hit = tailCache.get(file)
  let base
  if (hit && hit.key === key) base = hit.base
  else {
    const tail = readTail(file, TAIL_BYTES)
    const objs = []
    let title = null, lastPrompt = null
    if (tail) {
      const lines = tail.text.split('\n')
      if (tail.partialStart) lines.shift()
      for (const l of lines) {
        if (!l) continue
        let o; try { o = JSON.parse(l) } catch { continue }
        if (o.type === 'ai-title' && o.aiTitle) title = String(o.aiTitle)
        else if (o.type === 'last-prompt' && o.lastPrompt) lastPrompt = String(o.lastPrompt)
        objs.push(o)
      }
    }
    base = { objs, title, lastPrompt }
    tailCache.set(file, { key, base })
    if (tailCache.size > 200) tailCache.delete(tailCache.keys().next().value)
  }
  return { ...deriveState(base.objs, mtimeMs, nowMs), title: base.title, lastPrompt: base.lastPrompt }
}

/** Scan sessions modified within the last windowMs (stat only, contents are not read unless the cache is invalidated). */
function scanSessions({ claudeDir, windowMs = DAY, max = 40 } = {}, nowMs = Date.now()) {
  const root = path.join(claudeDir, 'projects')
  let projects = []
  try { projects = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()) } catch { return [] }
  const found = []
  let scanned = 0
  for (const d of projects) {
    let names = []
    try { names = fs.readdirSync(path.join(root, d.name)) } catch { continue }
    for (const n of names) {
      if (!n.endsWith('.jsonl')) continue
      if (++scanned > 8000) break
      const file = path.join(root, d.name, n)
      let st; try { st = fs.statSync(file) } catch { continue }
      if (nowMs - st.mtimeMs > windowMs) continue
      found.push({ file, id: n.slice(0, -6), mtimeMs: st.mtimeMs, size: st.size, projectDir: d.name })
    }
  }
  found.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return found.slice(0, max).map(f => {
    const h = headInfo(f.file)
    const t = tailInfo(f.file, f.mtimeMs, f.size, nowMs)
    const running = t.state === 'tool' || t.state === 'thinking'
    return {
      id: f.id, file: f.file, mtimeMs: f.mtimeMs, projectDir: f.projectDir,
      cwd: h.cwd, name: h.cwd ? (path.basename(h.cwd.replace(/[\\/]+$/, '')) || h.cwd) : f.projectDir,
      entrypoint: h.entrypoint, source: sourceKind(h.entrypoint), version: h.version, gitBranch: h.gitBranch,
      title: t.title || (t.lastPrompt ? t.lastPrompt.slice(0, 60) : null),
      state: t.state, tool: t.tool, maybeWaiting: t.maybeWaiting, running,
      turnStartedAt: t.turnStartedAt, turnEndedAt: t.turnEndedAt, updatedAt: Math.max(f.mtimeMs, t.lastAt || 0)
    }
  })
}

const norm = p => (p || '').replace(/[\\/]+$/, '')
function inWorkspace(s, dirs) {
  const c = norm(s.cwd)
  return !!c && (dirs || []).some(d => { const w = norm(d); return c === w || c.startsWith(w + '/') || c.startsWith(w + '\\') })
}

/**
 * Pinned first; next, stick to the previously selected one if it is still running (avoid flipping between sessions);
 * otherwise running in the current workspace -> any running -> most recent in the current workspace -> most recent globally.
 */
function pickCurrent (sessions, { pinnedId = null, stickyId = null, workspaceDirs = [] } = {}) {
  if (!sessions || !sessions.length) return null
  if (pinnedId) { const p = sessions.find(s => s.id === pinnedId); if (p) return p }
  const running = sessions.filter(s => s.running)
  const ws = s => inWorkspace(s, workspaceDirs)
  if (stickyId) {
    const st = running.find(s => s.id === stickyId)
    if (st && (ws(st) || !running.some(ws))) return st
  }
  return running.find(ws) || running[0] || sessions.find(ws) || sessions[0]
}

module.exports = { scanSessions, pickCurrent, deriveState, sourceKind, inWorkspace }
