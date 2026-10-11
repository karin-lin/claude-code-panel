'use strict'
/** format.js — pure functions: number/time formatting, status bar text, tooltip. The webview has a small same-named copy. */

function fmtTokens(n) {
  n = Number(n) || 0
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'k'
  return String(Math.round(n))
}

function fmtDuration(ms) {
  if (ms == null || !Number.isFinite(ms)) return '—'
  ms = Math.max(0, ms)
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24)
  if (d >= 1) return `${d}d${h % 24}h`
  if (h >= 1) return `${h}h${m % 60}m`
  if (m >= 1) return `${m}m`
  return `${Math.floor(ms / 1000)}s`
}

function fmtAgo(t, ms) {
  if (ms == null || !Number.isFinite(ms)) return t('time.unknown')
  return ms < 45000 ? t('time.now') : t('time.ago', { t: fmtDuration(ms) })
}

function pct(n) { return n == null ? '—' : `${Math.round(n)}%` }
function hhmm(ms) { if (!ms) return '—'; const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }

/** Actual usage exceeds the configured window -> the model window is larger, assume 1M (beyond that round up to 100k) */
function effectiveWindow(total, win) {
  win = Number(win) || 200000
  if (!(total > win)) return win
  return total > 1e6 ? Math.ceil(total / 1e5) * 1e5 : 1e6
}

function toolLabel(t, name) {
  const k = 'tool.' + name
  const s = t(k)
  return s === k ? name : s
}

function actionText(t, s) {
  if (!s) return ''
  if (!s.running) return t('state.idle')
  if (s.state === 'tool') return t('state.tool', { tool: toolLabel(t, s.tool) })
  return t('state.thinking')
}

/** Whole status bar line. kind: ok | warn | crit | stale | none */
function statusBarText(t, snap) {
  const parts = []
  let kind = 'none'
  const q = snap && snap.quota
  if (q && q.ok) {
    for (const w of q.windows) parts.push(`${t('quota.' + w.key)} ${pct(w.util)}`)
    kind = q.level === 'crit' ? 'crit' : q.level === 'warn' ? 'warn' : q.stale ? 'stale' : 'ok'
    if (q.stale) parts.push('⌛')
  }
  const cur = snap && snap.current
  if (cur && cur.plan && !cur.plan.finished) parts.push(`${cur.plan.percent}%`)
  const a = actionText(t, cur && cur.session)
  if (a) parts.push(a)
  return { text: `$(dashboard) ${parts.join(' · ') || 'Claude Code'}`, kind }
}

function tooltipMarkdown(t, snap) {
  const now = snap.now
  const L = ['**Claude Code Panel**', '']
  const q = snap.quota
  if (q && q.ok) {
    for (const w of q.windows) L.push(`${t('quota.' + w.key)} **${pct(w.util)}**${w.line != null ? ' · ' + t('quota.line', { n: w.line }) : ''}${w.resetsAt ? ' · ' + t('quota.resets', { t: fmtDuration(w.resetsAt - now) }) : ''}  `)
    L.push(t('quota.read', { t: fmtAgo(t, q.fetchedAt ? now - q.fetchedAt : null) }) + (q.stale ? ` · ${t('quota.stale')}` : ''))
  }
  const cur = snap.current
  if (cur && cur.session) {
    const s = cur.session, st = cur.stats
    L.push('', '---', '')
    L.push(`**${s.title || s.name}** · ${t('src.' + s.source)}  `)
    L.push(`${actionText(t, s)}${s.maybeWaiting ? ' · ' + t('state.maybeWaiting') : ''} · ${fmtAgo(t, now - s.updatedAt)}  `)
    if (cur.plan) L.push(`${cur.plan.title} ${cur.plan.percent}% (${t('tasks.steps', { d: cur.plan.done, n: cur.plan.total })})  `)
    if (st && st.context.total) {
      const win = effectiveWindow(st.context.total, snap.contextWindow)
      L.push(`${t('ctx.title')} ${fmtTokens(st.context.total)} / ${fmtTokens(win)} (${Math.round(st.context.total / win * 100)}%)  `)
    }
  }
  L.push('', t('sb.tooltipHint'))
  return L.join('\n')
}

module.exports = { fmtTokens, fmtDuration, fmtAgo, pct, hhmm, effectiveWindow, toolLabel, actionText, statusBarText, tooltipMarkdown }
