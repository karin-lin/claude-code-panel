(function () {
  'use strict'
  const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null
  const app = document.getElementById('app')
  let snap = null
  let receivedAt = 0
  const saved = (vscode && vscode.getState && vscode.getState()) || {}
  let curTab = saved.tab || window.__TAB__ || 'overview'
  const fold = Object.assign({}, saved.fold || {})
  const persist = patch => { if (vscode && vscode.setState) vscode.setState(Object.assign({}, vscode.getState() || {}, patch)) }

  // ── helpers ──
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const T = (key, params) => {
    let s = snap && snap.t && snap.t[key] != null ? snap.t[key] : key
    if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? String(params[k]) : m))
    return s
  }
  const clamp = n => Math.max(0, Math.min(100, Number(n) || 0))
  const fmtTokens = n => { n = Number(n) || 0; if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'k'; return String(Math.round(n)) }
  const fmtDuration = ms => { if (ms == null || !isFinite(ms)) return '—'; ms = Math.max(0, ms); const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24); if (d >= 1) return `${d}d${h % 24}h`; if (h >= 1) return `${h}h${m % 60}m`; if (m >= 1) return `${m}m`; return `${Math.floor(ms / 1000)}s` }
  const fmtAgo = ms => (ms == null || !isFinite(ms)) ? T('time.unknown') : ms < 45000 ? T('time.now') : T('time.ago', { t: fmtDuration(ms) })
  const pct = n => n == null ? '—' : `${Math.round(n)}%`
  const hhmm = ms => { if (!ms) return '—'; const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
  const hhmmss = ms => `${hhmm(ms)}:${String(new Date(ms).getSeconds()).padStart(2, '0')}`
  const effectiveWindow = (total, win) => { win = Number(win) || 200000; if (total <= win) return win; return total > 1e6 ? Math.ceil(total / 1e5) * 1e5 : 1e6 }
  const now = () => snap.now + (Date.now() - receivedAt)
  const card = (title, body) => `<section class="card"><h2>${esc(title)}</h2>${body}</section>`
  const toolLabel = name => { const k = 'tool.' + name; const s = T(k); return s === k ? name : s }
  const isOpen = (key, dflt) => (key in fold ? fold[key] : dflt)

  function stateLabel(s) {
    if (!s.running) return T('state.idle')
    return s.state === 'tool' ? T('state.tool', { tool: toolLabel(s.tool) }) : T('state.thinking')
  }
  const dotClass = s => (s.running ? (s.maybeWaiting ? 'wait' : 'run') : '')

  // ── Quota ──
  function quotaCard(q) {
    if (!q || q.source === 'off') return ''
    if (q.needsSetup) return card(T('quota.title'), `<div class="empty">${T('quota.setupText')}</div><button class="btn primary" data-act="setup">${esc(T('quota.setupBtn'))}</button>`)
    if (!q.ok) return card(T('quota.title'), `<div class="verdict warn hintline">⚠️ ${esc(T('quota.hint.' + (q.reason || 'unknown'), { path: q.path || '' }))}</div><button class="btn primary" data-act="setup">${esc(T('quota.setupBtn'))}</button>`)
    const rows = q.windows.map(w => {
      const small = []
      if (w.line != null) small.push(T('quota.line', { n: w.line }))
      if (w.resetsAt) small.push(T('quota.resets', { t: `<span data-countdown="${w.resetsAt}"></span>` }))
      const cls = w.level === 'crit' ? 'bad' : w.level === 'warn' ? 'warn' : ''
      return `<div class="row"><span><span class="name">${esc(T('quota.' + w.key))}</span> <span class="tiny">${small.join(' · ')}</span></span><span class="val">${pct(w.util)}</span></div>
        <div class="bar"><div class="fill ${cls}" data-w="${clamp(w.util)}"></div>${w.pace != null ? `<div class="pace" data-l="${clamp(w.pace)}" title="${esc(T('quota.paceTip'))}"></div>` : ''}${w.line != null ? `<div class="mark" data-l="${clamp(w.line)}" title="${esc(T('quota.lineTip'))}"></div>` : ''}</div>`
    }).join('')
    let verdict, vcls = ''
    if (q.distance != null) { verdict = q.distance <= 0 ? T('quota.over') : T('quota.okLine', { n: Math.round(q.distance) }); vcls = q.level === 'crit' ? 'bad' : q.level === 'warn' ? 'warn' : '' }
    else { verdict = T('quota.' + q.level); vcls = q.level === 'crit' ? 'bad' : q.level === 'warn' ? 'warn' : '' }
    const hint = q.reason ? `<div class="verdict warn hintline">⚠️ ${esc(T('quota.hint.' + q.reason, { path: q.path || '', t: fmtDuration(now() - (q.fetchedAt || 0)) }))}</div>` : ''
    const foot = `${T('quota.read', { t: `<span data-ago="${q.fetchedAt || ''}"></span>` })}${q.stale ? ' ⚠️' + esc(T('quota.stale')) : ''}`
    return card(T('quota.title'), `${rows}${hint}<div class="verdict ${vcls}">${verdict}</div><div class="tiny foot1">${foot}</div>`)
  }

  // ── Current session ──
  const turnBits = (s, st) => {
    const started = s.turnStartedAt || (st && st.turn && st.turn.startedAt) || null
    const ended = s.turnEndedAt || (st && st.turn && st.turn.endedAt) || null
    const bits = []
    if (s.running && started) bits.push(T('turn.running', { t: `<b data-dur-from="${started}"></b>` }))
    else if (ended) bits.push(T('turn.ended', { hhmm: hhmm(ended) }))
    else if (started) bits.push(T('turn.started', { hhmm: hhmm(started) }))
    const t = st && st.turn
    if (t && (t.tools || t.agents)) bits.push(T('turn.tools', { n: t.tools }) + (t.agents ? ' · ' + T('turn.agents', { n: t.agents }) : ''))
    return bits
  }
  const actionRow = s => `<div class="action"><span class="dot ${dotClass(s)}"></span><span>${esc(stateLabel(s))}${s.running && s.maybeWaiting ? ` <span class="tiny">· ${esc(T('state.maybeWaiting'))}</span>` : ''}</span><span class="ago" data-ago="${s.updatedAt || ''}"></span></div>`
  const ctxBlock = (st, withSub) => {
    if (!(st && st.context && st.context.total)) return ''
    const win = effectiveWindow(st.context.total, snap.contextWindow)
    const p = Math.min(100, st.context.total / win * 100)
    return `<div class="row"><span><span class="name">${esc(T('ctx.title'))}</span> <span class="tiny">${fmtTokens(st.context.total)} / ${fmtTokens(win)}</span></span><span class="val">${Math.round(p)}%</span></div>
      <div class="bar"><div class="fill ${p >= 90 ? 'bad' : p >= 70 ? 'warn' : ''}" data-w="${p.toFixed(1)}"></div></div>`
      + (withSub ? `<div class="tiny">${esc(T('ctx.sub', { r: fmtTokens(st.context.cacheRead), w: fmtTokens(st.context.cacheCreate), i: fmtTokens(st.context.input) }))}</div>` : '')
  }
  const modelOf = st => (st && st.model ? st.model.replace(/^claude-/, '') : '')

  function sessionBrief(cur) {
    if (!cur || !cur.session) return card(T('session.title'), `<div class="empty">${T('session.none')}</div>`)
    const s = cur.session, st = cur.stats
    const title = s.title || s.name
    return card(T('session.title'), `<div class="title one" title="${esc(title)}">${esc(title)}</div><div class="tiny one-meta">${[T('src.' + s.source), s.name, modelOf(st)].filter(Boolean).map(esc).join(' · ')}</div>${actionRow(s)}<div class="tiny">${turnBits(s, st).join(' · ')}</div>${ctxBlock(st, false)}`)
  }

  function sessionDetail(cur) {
    if (!cur || !cur.session) return card(T('session.title'), `<div class="empty">${T('session.none')}</div>`)
    const s = cur.session, st = cur.stats
    const title = s.title || s.name
    const tags = [T('src.' + s.source), s.name, modelOf(st), s.gitBranch, s.version ? 'CC ' + s.version : ''].filter(Boolean)
    const pinned = snap.pinnedId === s.id
    const head = `<div class="row"><div class="title two" title="${esc(title)}">${esc(title)}</div>${pinned ? `<button class="btn" data-pin="" title="${esc(T('pin.cancelTip'))}">${esc(T('pin.cancel'))}</button>` : ''}</div>
      <div class="chips tags">${tags.map(x => `<span class="chip">${esc(x)}</span>`).join('')}</div>`
    let kv = ''
    if (st) {
      kv = `<dl class="kv">
        <dt>${esc(T('detail.model'))}</dt><dd>${esc(modelOf(st) || '—')}${s.version ? ` · Claude Code ${esc(s.version)}` : ''}</dd>
        <dt>${esc(T('detail.thisSession'))}</dt><dd>${esc(T('detail.thisSessionVal', { o: fmtTokens(st.totals.output), th: fmtTokens(st.totals.thinking), m: st.totals.assistantMessages, p: st.prompts }))}</dd>
        <dt>${esc(T('detail.cumulative'))}</dt><dd>${esc(T('detail.cumulativeVal', { w: fmtTokens(st.totals.cacheCreate), r: fmtTokens(st.totals.cacheRead), i: fmtTokens(st.totals.input) }))}</dd>
        <dt>${esc(T('detail.tools'))}</dt><dd>${esc(T('detail.toolsVal', { n: st.tools.total, agents: st.tools.agents ? T('detail.agents', { n: st.tools.agents }) : '', since: st.firstAt ? T('detail.since', { hhmm: hhmm(st.firstAt) }) : '' }))}</dd>
      </dl>`
    }
    const chips = st && st.tools.total ? `<div class="chips">${Object.entries(st.tools.byName).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, c]) => `<span class="chip">${esc(n)} ${c}</span>`).join('')}</div>` : ''
    const raw = s.file ? `<div class="foot"><a class="lnk" data-open="${esc(s.file)}" title="${esc(T('detail.openRawTip'))}">${esc(T('detail.openRaw'))}</a></div>` : ''
    return card(T('session.title'), `${head}${actionRow(s)}<div class="tiny">${turnBits(s, st).join(' · ')}</div>${ctxBlock(st, true)}${kv}${chips}${raw}`)
  }

  function subagentsCard(list) {
    if (!list || !list.length) return ''
    const rows = list.map(a => `<li><span class="dot ${a.active ? 'run' : ''}"></span><div class="main"><div class="ttl">${esc(a.description || a.agentType)}</div><div class="meta">${esc(a.agentType)}${a.shape ? ' · ' + esc(a.shape) : ''} · <span data-ago="${a.updatedAt || ''}"></span></div></div></li>`).join('')
    const active = list.filter(a => a.active).length
    return card(active ? T('sub.titleActive', { n: list.length, a: active }) : T('sub.title', { n: list.length }), `<ul class="list">${rows}</ul>`)
  }

  function sessionsCard(list, curId) {
    const others = (list || []).filter(x => x.id !== curId)
    if (!others.length) return ''
    const rows = others.map(x => `<li data-pin="${esc(x.id)}" title="${esc(T('pin.tip'))}"><span class="dot ${dotClass(x)}"></span><div class="main"><div class="ttl">${esc(x.title || x.name)}</div><div class="meta">${esc(T('src.' + x.source))} · ${esc(x.name)} · ${esc(stateLabel(x))} · <span data-ago="${x.updatedAt || ''}"></span></div></div></li>`).join('')
    return card(T('others.title', { n: others.length }), `<ul class="list">${rows}</ul>`)
  }

  // ── Tasks ──
  const MARK = { done: '✓', doing: '◐', todo: '○' }
  const stepRows = steps => steps.map(s => `<li><span class="stp ${s.state}">${MARK[s.state]}</span><div class="main"><div class="ttl">${esc(s.name)}</div>${s.state === 'doing' && s.note ? `<div class="meta">${esc(s.note)}</div>` : ''}</div></li>`).join('')
  const curLine = steps => {
    const s = steps.find(x => x.state === 'doing') || steps.find(x => x.state === 'todo') || steps[steps.length - 1]
    return s ? `<div class="curstep"><span class="stp ${s.state}">${MARK[s.state]}</span><span class="ttl">${esc(s.name)}</span>${s.state === 'doing' && s.note ? `<span class="tiny"> · ${esc(s.note)}</span>` : ''}</div>` : ''
  }
  const whoLine = w => w ? `<div class="who" title="${esc([T('src.' + w.source), w.name, w.title].filter(Boolean).join(' · '))}">${w.running ? '🟢' : '⚪'} ${esc([T('src.' + w.source), w.name].filter(Boolean).join(' · '))}${w.title ? ' · ' + esc(w.title) : ''}</div>` : ''

  function planCardFor(x) {
    const pl = x.plan
    const open = isOpen('plan:' + x.key, !pl.finished)
    const state = pl.finished ? T('tasks.done') : T('tasks.active')
    const sub = `${state} · ${T('tasks.steps', { d: pl.done, n: pl.total })}${pl.startedAt ? ' · ' + T('tasks.started', { hhmm: hhmm(pl.startedAt) }) : ''} · ${T('tasks.updated', { t: `<span data-ago="${pl.updatedAt || ''}"></span>` })}`
    return `<section class="card"><h2 class="fold" data-fold="plan:${esc(x.key)}" title="${esc(open ? T('tasks.fold') : T('tasks.unfold'))}"><span class="chev">${open ? '▾' : '▸'}</span>${esc(pl.title)}</h2>
      ${whoLine(x.who)}<div class="row"><span class="name">${esc(T('tasks.progress'))}</span><span class="val">${pl.percent}%</span></div><div class="bar"><div class="fill" data-w="${pl.percent}"></div></div>
      <div class="sub">${sub}</div>${open ? `<ul class="list">${stepRows(pl.steps)}</ul><div class="foot">${esc(T('tasks.footer'))}</div>` : curLine(pl.steps)}</section>`
  }

  function tasksView() {
    const OLD = 30 * 60000
    const isOld = x => x.plan.finished && x.plan.updatedAt != null && now() - x.plan.updatedAt > OLD
    const plans = snap.plans || []
    const live = plans.filter(x => !isOld(x)), old = plans.filter(isOld)
    let oldHtml = ''
    if (old.length) {
      const open = isOpen('donegroup', false)
      oldHtml = `<section class="card"><h2 class="fold" data-fold="donegroup"><span class="chev">${open ? '▾' : '▸'}</span>${esc(T('tasks.doneGroup', { n: old.length }))}</h2>${open ? '' : `<div class="tiny">${old.slice(0, 3).map(x => esc(x.plan.title)).join(' · ')}${old.length > 3 ? ' …' : ''}</div>`}</section>`
        + (open ? old.map(planCardFor).join('') : '')
    }
    const body = live.map(planCardFor).join('') + oldHtml
    return body || card(T('tab.tasks'), `<div class="empty">${T('tasks.none')}</div>`)
  }

  const activePlans = () => (snap.plans || []).filter(x => !x.plan.finished)
  function taskMini() {
    const list = activePlans()
    if (!list.length) return ''
    const items = list.map(x => `<li data-tab="tasks"><div class="main"><div class="row"><span class="ttl">▶ ${esc(x.plan.title)}</span><span class="val">${x.plan.percent}%</span></div><div class="bar thin"><div class="fill" data-w="${x.plan.percent}"></div></div><div class="meta">${esc([T('src.' + x.who.source), x.who.name].filter(Boolean).join(' · '))}</div></div></li>`).join('')
    return card(T('tasks.summary', { n: list.length }), `<ul class="list">${items}</ul>`)
  }

  // ── Render ──
  const TABS = ['overview', 'tasks', 'session']
  function tickTimes() {
    if (!snap) return
    const n = now()
    for (const el of app.querySelectorAll('[data-ago]')) { const t = Number(el.dataset.ago); el.textContent = t ? fmtAgo(n - t) : T('time.unknown') }
    for (const el of app.querySelectorAll('[data-dur-from]')) { const t = Number(el.dataset.durFrom); el.textContent = t ? fmtDuration(n - t) : '—' }
    for (const el of app.querySelectorAll('[data-countdown]')) { const t = Number(el.dataset.countdown); el.textContent = t ? fmtDuration(t - n) : '—' }
    const clock = document.getElementById('clock')
    if (clock) clock.textContent = T('hdr.updated', { t: hhmmss(snap.now) })
  }

  function render() {
    if (!snap) { app.innerHTML = '<div class="empty">…</div>'; return }
    const cur = snap.current
    const tab = TABS.includes(curTab) ? curTab : 'overview'
    const n = activePlans().length
    const tabs = `<div class="tabs">${TABS.map(k => `<button class="tab${k === tab ? ' on' : ''}" data-tab="${k}">${esc(T('tab.' + k))}${k === 'tasks' && n ? `<span class="badge">${n}</span>` : ''}</button>`).join('')}</div>`
    let body
    if (tab === 'tasks') body = tasksView()
    else if (tab === 'session') body = sessionDetail(cur) + subagentsCard(cur && cur.subagents) + sessionsCard(snap.sessions, cur && cur.session ? cur.session.id : null)
    else body = quotaCard(snap.quota) + sessionBrief(cur) + taskMini()
    app.innerHTML = `<div class="hdr"><h1>Claude Code</h1><span class="t" id="clock"></span></div>${tabs}<div class="grid">${body}</div>`
    for (const el of app.querySelectorAll('[data-w]')) el.style.width = el.dataset.w + '%'
    for (const el of app.querySelectorAll('[data-l]')) el.style.left = el.dataset.l + '%'
    tickTimes()
  }

  app.addEventListener('click', e => {
    const tabBtn = e.target.closest('[data-tab]')
    if (tabBtn) { curTab = tabBtn.dataset.tab; persist({ tab: curTab }); render(); return }
    const foldEl = e.target.closest('[data-fold]')
    if (foldEl) {
      const k = foldEl.dataset.fold
      const open = foldEl.querySelector('.chev') && foldEl.querySelector('.chev').textContent === '▾'
      fold[k] = !open; persist({ fold }); render(); return
    }
    const act = e.target.closest('[data-act]')
    if (act && vscode) { vscode.postMessage({ type: act.dataset.act }); return }
    const pin = e.target.closest('[data-pin]')
    if (pin) { if (vscode) vscode.postMessage({ type: 'pin', id: pin.dataset.pin || null }); return }
    const open = e.target.closest('[data-open]')
    if (open && vscode) vscode.postMessage({ type: 'open', path: open.dataset.open })
  })
  window.addEventListener('message', e => { snap = e.data; receivedAt = Date.now(); render() })
  setInterval(tickTimes, 1000)
  if (window.__SNAPSHOT__) { snap = window.__SNAPSHOT__; receivedAt = Date.now(); render() }
  else if (vscode) vscode.postMessage({ type: 'ready' })
})()
