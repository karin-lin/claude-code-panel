'use strict'
/**
 * demo-data.js — builds a fake Claude Code config directory (transcripts, subagents, quota file, progress file).
 * Used for screenshots, unit tests and end-to-end smoke tests. Project names and titles are all fictional.
 */
const fs = require('node:fs')
const path = require('node:path')

function makeDemo(root, nowMs = Date.now()) {
  fs.rmSync(root, { recursive: true, force: true })
  const claude = path.join(root, '.claude')
  const iso = off => new Date(nowMs - off).toISOString()
  const SEC = 1000, MIN = 60000, HOUR = 3600000

  const write = (file, lines, mtimeOffset) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, lines.map(l => JSON.stringify(l)).join('\n') + '\n')
    const t = new Date(nowMs - mtimeOffset)
    fs.utimesSync(file, t, t)
  }

  const ids = {
    web: '11111111-aaaa-4aaa-8aaa-111111111111',
    api: '22222222-bbbb-4bbb-8bbb-222222222222',
    data: '33333333-cccc-4ccc-8ccc-333333333333'
  }
  const cwd = { web: '/home/dev/web-app', api: '/home/dev/api-server', data: '/home/dev/data-scripts' }

  const base = (sid, key, entrypoint) => ({ sessionId: sid, cwd: cwd[key], entrypoint, version: '2.1.100', gitBranch: key === 'web' ? 'feature/dark-mode' : 'main', isSidechain: false })
  const prompt = (b, off, text) => ({ ...b, type: 'user', timestamp: iso(off), message: { role: 'user', content: text } })
  const usage = (ctx, out) => ({ input_tokens: 3, cache_read_input_tokens: Math.round(ctx * 0.9), cache_creation_input_tokens: Math.round(ctx * 0.1) - 3, output_tokens: out, output_tokens_details: { thinking_tokens: Math.round(out * 0.4) } })
  const asst = (b, off, id, ctx, out, content) => ({ ...b, type: 'assistant', timestamp: iso(off), message: { id, model: 'claude-sonnet-5-5', usage: usage(ctx, out), content } })
  const result = (b, off, toolId) => ({ ...b, type: 'user', timestamp: iso(off), toolUseResult: {}, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, content: 'ok' }] } })
  const tool = (id, name, input) => ({ type: 'tool_use', id, name, input: input || {} })
  const todos = items => tool('tu_todo_' + items.length + items.filter(x => x[1] === 'completed').length, 'TodoWrite', { todos: items.map(([content, status, activeForm]) => ({ content, status, activeForm: activeForm || content })) })

  // 1) Running IDE session: has TodoWrite (2 done + 1 doing + 1 todo), the last entry is a just-issued Bash (6s ago)
  const w = base(ids.web, 'web', 'claude-vscode')
  write(path.join(claude, 'projects', '-home-dev-web-app', ids.web + '.jsonl'), [
    prompt(w, 22 * MIN, 'Add a dark mode toggle to the settings page'),
    asst(w, 21 * MIN, 'm1', 52000, 800, [{ type: 'text', text: 'Let me plan this.' }, todos([['Read the current theme code', 'in_progress', 'Reading the theme code'], ['Add a toggle component', 'pending'], ['Persist the choice', 'pending'], ['Update tests', 'pending']])]),
    result(w, 20 * MIN, 'tu_todo_40'),
    asst(w, 14 * MIN, 'm2', 61000, 1200, [todos([['Read the current theme code', 'completed'], ['Add a toggle component', 'completed'], ['Persist the choice', 'in_progress', 'Persisting the choice to localStorage'], ['Update tests', 'pending']])]),
    result(w, 13 * MIN, 'tu_todo_42'),
    asst(w, 4 * MIN, 'm3', 74000, 900, [tool('tu_read1', 'Read', { file_path: 'src/theme.ts' }), tool('tu_edit1', 'Edit', { file_path: 'src/theme.ts' })]),
    result(w, 3 * MIN, 'tu_edit1'),
    asst(w, 6 * SEC, 'm4', 84000, 300, [tool('tu_bash1', 'Bash', { command: 'npm test' })]),
    { type: 'ai-title', aiTitle: 'Add dark mode toggle' }
  ].map(o => (o.type === 'ai-title' ? o : o)), 6 * SEC)
  // Subagents: one still writing, one finished long ago
  const sub = path.join(claude, 'projects', '-home-dev-web-app', ids.web, 'subagents')
  fs.mkdirSync(sub, { recursive: true })
  fs.writeFileSync(path.join(sub, 'agent-aaa.meta.json'), JSON.stringify({ agentType: 'general-purpose', description: 'Audit components using hard-coded colors', requestShape: 'background' }))
  fs.writeFileSync(path.join(sub, 'agent-aaa.jsonl'), '{}\n')
  fs.writeFileSync(path.join(sub, 'agent-bbb.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'Find the theme provider', requestShape: 'foreground' }))
  fs.writeFileSync(path.join(sub, 'agent-bbb.jsonl'), '{}\n')
  const old = new Date(nowMs - 25 * MIN)
  fs.utimesSync(path.join(sub, 'agent-bbb.jsonl'), old, old)
  fs.utimesSync(path.join(sub, 'agent-bbb.meta.json'), old, old)

  // 2) Terminal session: all items done, ended 3 hours ago
  const a = base(ids.api, 'api', 'cli')
  write(path.join(claude, 'projects', '-home-dev-api-server', ids.api + '.jsonl'), [
    prompt(a, 4 * HOUR, 'Fix the flaky login integration test'),
    asst(a, 3.8 * HOUR, 'a1', 40000, 700, [todos([['Reproduce the failure', 'completed'], ['Fix the race in the fixture', 'completed'], ['Run the suite 20 times', 'completed']])]),
    result(a, 3.7 * HOUR, 'tu_todo_33'),
    asst(a, 3.1 * HOUR, 'a2', 48000, 500, [{ type: 'text', text: 'Fixed. The fixture raced with the DB seed.' }]),
    { ...a, type: 'system', subtype: 'stop_hook_summary', timestamp: iso(3.1 * HOUR) },
    { type: 'ai-title', aiTitle: 'Fix flaky login test' },
    { type: 'mode', mode: 'default' }
  ], 3.1 * HOUR)

  // 3) Headless / SDK session: no list, from yesterday
  const d = base(ids.data, 'data', 'sdk-cli')
  write(path.join(claude, 'projects', '-home-dev-data-scripts', ids.data + '.jsonl'), [
    prompt(d, 9 * HOUR, 'Summarize last night\'s import job'),
    asst(d, 9 * HOUR - 20 * SEC, 'd1', 18000, 400, [{ type: 'text', text: 'The import processed 12,408 rows with no errors.' }]),
    { type: 'ai-title', aiTitle: 'Summarize import job' }
  ], 9 * HOUR)

  // Quota file (status bar helper output format): 5h 38%, weekly 24%
  fs.mkdirSync(path.join(claude, 'cc-panel'), { recursive: true })
  fs.writeFileSync(path.join(claude, 'cc-panel', 'rate-limits.json'), JSON.stringify({
    updated: nowMs - 40 * SEC,
    rate_limits: { five_hour: { used_percentage: 38, resets_at: Math.round((nowMs + 2 * HOUR + 10 * MIN) / 1000) }, seven_day: { used_percentage: 24, resets_at: Math.round((nowMs + 4 * 24 * HOUR) / 1000) } }
  }))

  // Own progress file: attached to the api-server session by cwd
  const prog = path.join(root, 'progress')
  fs.mkdirSync(prog, { recursive: true })
  fs.writeFileSync(path.join(prog, 'release.json'), JSON.stringify({
    title: 'Release 1.4', cwd: cwd.api, updated: iso(8 * MIN),
    steps: [{ name: 'Changelog', state: 'done' }, { name: 'Bump version', state: 'done' }, { name: 'Build artifacts', state: 'doing', note: 'linux-x64 done, waiting on arm64' }, { name: 'Publish', state: 'todo' }]
  }))

  return { root, claudeDir: claude, progressDir: prog, ids, cwd }
}

module.exports = { makeDemo }
