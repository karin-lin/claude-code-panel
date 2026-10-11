'use strict'
/** snapshot.js — assembles all data sources into one snapshot (no dependency on the vscode module, usable from scripts and tests). */
const path = require('node:path')
const { claudeDir } = require('./util')
const { scanSessions, pickCurrent } = require('./sessions')
const { TranscriptReader, listSubagents, peekTodos } = require('./transcript')
const { QuotaProvider } = require('./quota')
const { buildPlans } = require('./progress')
const { makeT, pick } = require('./i18n')

function createCollector(deps = {}) {
  const readers = new Map()
  const quota = new QuotaProvider(deps)
  let busy = null
  let lastPickedId = null

  async function collect(cfg = {}, nowMs = Date.now()) {
    const dir = claudeDir(cfg.claudeDir)
    const q = await quota.read({ ...(cfg.quota || {}), claudeDir: dir }, nowMs)
    const sessions = scanSessions({ claudeDir: dir }, nowMs)
    const shown = sessions.slice(0, 12)
    const session = pickCurrent(sessions, { pinnedId: cfg.pinnedId, stickyId: lastPickedId, workspaceDirs: cfg.workspaceDirs })
    lastPickedId = session ? session.id : null
    let stats = null, subagents = []
    if (session) {
      let r = readers.get(session.file)
      if (!r) {
        r = new TranscriptReader(session.file)
        readers.set(session.file, r)
        while (readers.size > 6) readers.delete(readers.keys().next().value)
      }
      try { stats = await r.update() } catch { stats = null }
      try { subagents = await listSubagents(session.file, nowMs) } catch { subagents = [] }
    }
    const plans = buildPlans({ sessions: shown, currentId: session && session.id, currentStats: stats, peek: peekTodos, fileEntries: [...(cfg.progressFiles || []), path.join(dir, 'cc-panel', 'progress')] }, nowMs)
    const { lang, dict } = pick(cfg.language)
    return {
      now: nowMs, lang, t: dict,
      quota: q,
      sessions: shown.map(s => ({ ...s, file: s.id === (session && session.id) ? s.file : undefined })),
      pinnedId: cfg.pinnedId || null,
      contextWindow: Number(cfg.contextWindow) || 200000,
      plans,
      current: session ? { session, stats, subagents, plan: (plans.find(p => p.sessionId === session.id && !String(p.key).startsWith('file:')) || plans.find(p => p.sessionId === session.id) || {}).plan || null } : null
    }
  }

  return {
    collect(cfg, nowMs) {
      if (busy) return busy
      busy = collect(cfg, nowMs).finally(() => { busy = null })
      return busy
    },
    makeT
  }
}

module.exports = { createCollector }
