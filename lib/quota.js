'use strict'
/**
 * quota.js — 5-hour / weekly quota. Three sources (user's choice):
 *   off   not shown
 *   file  read a JSON file (by default <claudeDir>/cc-panel/rate-limits.json written by the status bar helper, or point it at your own script's output)
 *   api   Anthropic quota endpoint (needs network, reads Claude Code's login token read-only and never refreshes it, every 5 minutes by default, backs off when rate limited)
 *
 * The file format is lenient; any of the following is accepted (see normalizeLimits):
 *   { "five_hour": { "util": 31, "resets_at": "2026-10-07T19:49:59Z" }, "seven_day": { ... } }
 *   { "rate_limits": { "five_hour": { "used_percentage": 31, "resets_at": 1791400000 }, ... } }   // Claude Code status bar JSON shape
 */
const fs = require('node:fs')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { expandHome, readJson, parseTime, claudeDir, MIN, HOUR, DAY } = require('./util')

const WINDOW_MS = { five_hour: 5 * HOUR, seven_day: 7 * DAY }
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const KEYCHAIN_SERVICE = 'Claude Code-credentials'

function pctOf(x) {
  if (!x || typeof x !== 'object') return null
  for (const k of ['util', 'utilization', 'used_percentage', 'used_percent', 'percent', 'pct']) {
    if (x[k] != null && Number.isFinite(Number(x[k]))) return Number(x[k])
  }
  return null
}

/** Any supported JSON -> { five_hour: {util, resetsAt}|null, seven_day: ... , fetchedAt } */
function normalizeLimits(obj) {
  if (!obj || typeof obj !== 'object') return null
  const src = obj.rate_limits && typeof obj.rate_limits === 'object' ? obj.rate_limits : obj
  const pick = x => { const util = pctOf(x); return util == null ? null : { util, resetsAt: parseTime(x.resets_at != null ? x.resets_at : x.reset_at) } }
  const five = pick(src.five_hour), seven = pick(src.seven_day)
  if (!five && !seven) return null
  return { five_hour: five, seven_day: seven, fetchedAt: parseTime(obj.fetched_at != null ? obj.fetched_at : (obj.updated != null ? obj.updated : obj.updated_at)) }
}

/**
 * Pure function: normalized readings -> window list for the panel.
 *  pace: where usage should be if consumed linearly over time (fraction of the window elapsed), used to draw the pace marker
 *  line: user-defined stop line (optional)
 */
function evaluate(limits, opts, nowMs) {
  const warnAt = Number(opts.warnAt) || 80, critAt = Number(opts.critAt) || 95
  const lines = opts.lines || {}
  const windows = []
  for (const key of ['five_hour', 'seven_day']) {
    const w = limits && limits[key]
    if (!w) continue
    let util = w.util
    if (w.resetsAt && nowMs >= w.resetsAt) util = 0 // window has reset, reading not refreshed yet
    const span = WINDOW_MS[key]
    const pace = w.resetsAt ? Math.max(0, Math.min(100, (1 - (w.resetsAt - nowMs) / span) * 100)) : null
    const line = Number.isFinite(Number(lines[key])) && Number(lines[key]) > 0 ? Number(lines[key]) : null
    let level = 'ok'
    if (line != null) level = util >= line ? 'crit' : (line - util <= 5 ? 'warn' : 'ok')
    else level = util >= critAt ? 'crit' : (util >= warnAt ? 'warn' : 'ok')
    windows.push({ key, util, line, pace, resetsAt: w.resetsAt, level })
  }
  const worst = windows.reduce((a, w) => (['ok', 'warn', 'crit'].indexOf(w.level) > ['ok', 'warn', 'crit'].indexOf(a) ? w.level : a), 'ok')
  const distances = windows.filter(w => w.line != null).map(w => w.line - w.util)
  return { windows, level: worst, distance: distances.length ? Math.min(...distances) : null }
}

// ── File source ──
function defaultLimitsFile(dir) { return path.join(dir, 'cc-panel', 'rate-limits.json') }

function readFileSource(file, nowMs, staleMs) {
  const f = expandHome(file)
  let st
  try { st = fs.statSync(f) } catch { return { ok: false, reason: 'fileMissing', path: f } }
  const limits = normalizeLimits(readJson(f))
  if (!limits) return { ok: false, reason: 'noData', path: f }
  const at = limits.fetchedAt || st.mtimeMs
  const stale = nowMs - at > staleMs
  return { ok: true, limits, fetchedAt: at, stale, reason: stale ? 'fileStale' : null, path: f, source: 'file' }
}

// ── API source ──
function readOAuth(dir, platform = process.platform) {
  return new Promise(resolve => {
    const fromFile = () => {
      const j = readJson(path.join(dir, '.credentials.json'))
      resolve(j && j.claudeAiOauth ? j.claudeAiOauth : null)
    }
    if (platform !== 'darwin') return fromFile()
    execFile('/usr/bin/security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], { timeout: 5000 }, (err, out) => {
      if (err) return fromFile()
      try { resolve(JSON.parse(out).claudeAiOauth || null) } catch { resolve(null) }
    })
  })
}

class ApiSource {
  constructor({ fetchImpl = globalThis.fetch, readOAuthImpl = readOAuth } = {}) {
    this.fetch = fetchImpl
    this.readOAuth = readOAuthImpl
    this.last = null            // { limits, fetchedAt }
    this.nextAt = 0
    this.backoff = 0
    this.error = null
    this.inflight = null
  }

  /** Only request when due; otherwise return the last result. Never concurrent, never refresh the token. */
  async get({ dir, intervalSec = 300 }, nowMs = Date.now()) {
    if (nowMs >= this.nextAt && !this.inflight) {
      this.inflight = this._fetch(dir, nowMs, Math.max(120, Number(intervalSec) || 300) * 1000).finally(() => { this.inflight = null })
    }
    if (this.inflight && !this.last) await this.inflight
    return this.last
      ? { ok: true, limits: this.last.limits, fetchedAt: this.last.fetchedAt, stale: nowMs - this.last.fetchedAt > 20 * MIN, reason: this.error, source: 'api' }
      : { ok: false, reason: this.error || 'unknown', source: 'api' }
  }

  async _fetch(dir, nowMs, intervalMs) {
    try {
      const oauth = await this.readOAuth(dir)
      if (!oauth || (!oauth.accessToken && !oauth.refreshToken)) { this.error = 'noToken'; this.nextAt = nowMs + 5 * MIN; return }
      if (!oauth.accessToken || (oauth.expiresAt && oauth.expiresAt < nowMs + 30000)) { this.error = 'expired'; this.nextAt = nowMs + 2 * MIN; return } // expired: leave refreshing to Claude Code itself
      const res = await this.fetch(USAGE_URL, { headers: { Authorization: `Bearer ${oauth.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20', 'Content-Type': 'application/json', 'User-Agent': 'claude-code-panel' } })
      if (res.status === 429) { this.backoff = Math.min((this.backoff || intervalMs) * 2, 30 * MIN); this.error = 'rateLimited'; this.nextAt = nowMs + this.backoff; return }
      if (res.status === 401 || res.status === 403) { this.error = 'expired'; this.nextAt = nowMs + 5 * MIN; return }
      if (!res.ok) { this.error = 'unknown'; this.nextAt = nowMs + intervalMs; return }
      const limits = normalizeLimits(await res.json())
      if (!limits) { this.error = 'noData'; this.nextAt = nowMs + intervalMs; return }
      this.last = { limits, fetchedAt: nowMs }
      this.error = null; this.backoff = 0; this.nextAt = nowMs + intervalMs
    } catch {
      this.error = 'network'; this.nextAt = nowMs + 2 * MIN
    }
  }
}

/** Unified entry point.cfg: { source, file, claudeDir, warnAt, critAt, lines, intervalSec, staleSec } */
class QuotaProvider {
  constructor(deps) { this.api = new ApiSource(deps) }

  async read(cfg, nowMs = Date.now()) {
    const source = cfg.source || 'ask'
    if (source === 'off' || source === 'ask') return { source, ok: false, needsSetup: source === 'ask' }
    const dir = claudeDir(cfg.claudeDir)
    let r
    if (source === 'api') r = await this.api.get({ dir, intervalSec: cfg.intervalSec }, nowMs)
    else r = readFileSource(cfg.file && String(cfg.file).trim() ? cfg.file : defaultLimitsFile(dir), nowMs, (Number(cfg.staleSec) || 900) * 1000)
    if (!r.ok) return { source, ok: false, reason: r.reason, path: r.path }
    const ev = evaluate(r.limits, { warnAt: cfg.warnAt, critAt: cfg.critAt, lines: cfg.lines }, nowMs)
    return { source, ok: true, ...ev, fetchedAt: r.fetchedAt, stale: r.stale, reason: r.reason, path: r.path }
  }
}

module.exports = { normalizeLimits, evaluate, readFileSource, defaultLimitsFile, readOAuth, ApiSource, QuotaProvider, USAGE_URL, WINDOW_MS }
