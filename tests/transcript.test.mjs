import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyLine, freshStats, createCtx, isRealPrompt, TranscriptReader, peekTitle, peekTodos } from '../lib/transcript.js'

const U = { input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 50, output_tokens: 10, output_tokens_details: { thinking_tokens: 4 } }
const A = (id, content, ts = '2026-10-07T15:40:01Z', extra = {}) => ({ type: 'assistant', timestamp: ts, message: { id, model: 'claude-sonnet-5-5', usage: U, content }, ...extra })
const tool = (id, name, input) => ({ type: 'tool_use', id, name, input: input || {} })

test('one reply written across several lines: usage counted once, context taken from the last one, tool_use deduped by id', () => {
  const st = freshStats(), ctx = createCtx()
  applyLine(st, { type: 'user', timestamp: '2026-10-07T15:39:00Z', message: { role: 'user', content: 'hi' } }, ctx)
  applyLine(st, A('msg_1', [{ type: 'text', text: 'x' }]), ctx)
  applyLine(st, A('msg_1', [tool('t1', 'Bash')], '2026-10-07T15:40:03Z'), ctx)
  applyLine(st, A('msg_1', [tool('t1', 'Bash')], '2026-10-07T15:40:03Z'), ctx)
  assert.equal(st.totals.assistantMessages, 1); assert.equal(st.totals.output, 10); assert.equal(st.totals.thinking, 4)
  assert.equal(st.context.total, 152); assert.equal(st.tools.total, 1); assert.equal(st.turn.tools, 1); assert.equal(st.prompts, 1)
  applyLine(st, { type: 'user', timestamp: '2026-10-07T15:41:00Z', message: { role: 'user', content: [{ type: 'text', text: 'next' }] } }, ctx)
  assert.equal(st.turn.tools, 0); assert.equal(st.prompts, 2)
  applyLine(st, A('msg_2', [tool('t2', 'Agent')], '2026-10-07T15:41:05Z'), ctx)
  assert.equal(st.tools.agents, 1); assert.equal(st.totals.output, 20)
})

test('sidechain usage does not change context, but tool_use is still counted', () => {
  const st = freshStats(), ctx = createCtx()
  applyLine(st, A('msg_s', [tool('ts', 'Read')], '2026-10-07T15:40:01Z', { isSidechain: true }), ctx)
  assert.equal(st.context.total, 0); assert.equal(st.tools.byName.Read, 1)
})

test('tool_result / isMeta lines do not start a new turn', () => {
  assert.equal(isRealPrompt({ type: 'user', toolUseResult: {}, message: { content: [{ type: 'tool_result' }] } }), false)
  assert.equal(isRealPrompt({ type: 'user', isMeta: true, message: { content: 'meta' } }), false)
  assert.equal(isRealPrompt({ type: 'user', message: { content: 'hi' } }), true)
})

test('TodoWrite: take the latest full list, state mapping', () => {
  const st = freshStats(), ctx = createCtx()
  applyLine(st, A('m1', [tool('a', 'TodoWrite', { todos: [{ content: 'one', status: 'in_progress', activeForm: 'Doing one' }, { content: 'two', status: 'pending' }] })]), ctx)
  assert.deepEqual(st.todos.items.map(x => x.state), ['doing', 'todo']); assert.equal(st.todos.items[0].note, 'Doing one')
  applyLine(st, A('m2', [tool('b', 'TodoWrite', { todos: [{ content: 'one', status: 'completed' }, { content: 'two', status: 'in_progress' }, { content: 'three', status: 'pending' }] })], '2026-10-07T15:50:00Z'), ctx)
  assert.deepEqual(st.todos.items.map(x => x.state), ['done', 'doing', 'todo'])
  applyLine(st, A('m3', [tool('c', 'TodoWrite', { todos: 'garbage' })]), ctx)
  assert.equal(st.todos.items.length, 3, 'bad data does not overwrite')
})

test('TaskCreate / TaskUpdate replay (IDs increment from 1, best effort)', () => {
  const st = freshStats(), ctx = createCtx()
  applyLine(st, A('m1', [tool('a', 'TaskCreate', { subject: 'Write parser' }), tool('b', 'TaskCreate', { subject: 'Add tests', activeForm: 'Adding tests' })]), ctx)
  applyLine(st, A('m2', [tool('c', 'TaskUpdate', { taskId: '1', status: 'completed' }), tool('d', 'TaskUpdate', { taskId: '2', status: 'in_progress' }), tool('e', 'TaskUpdate', { taskId: '9', status: 'completed' })]), ctx)
  assert.deepEqual(st.tasks.map(x => [x.name, x.state]), [['Write parser', 'done'], ['Add tests', 'doing']])
})

test('ai-title / last-prompt / stop_hook_summary / gitBranch', () => {
  const st = freshStats(), ctx = createCtx()
  applyLine(st, { type: 'ai-title', aiTitle: 'Title' }, ctx); applyLine(st, { type: 'last-prompt', lastPrompt: 'Q' }, ctx)
  applyLine(st, { type: 'user', timestamp: '2026-10-07T15:39:00Z', gitBranch: 'main', message: { content: 'hi' } }, ctx)
  applyLine(st, { type: 'system', subtype: 'stop_hook_summary', timestamp: '2026-10-07T15:45:00Z' }, ctx)
  assert.equal(st.title, 'Title'); assert.equal(st.lastPrompt, 'Q'); assert.equal(st.gitBranch, 'main'); assert.equal(st.turn.endedAt, Date.parse('2026-10-07T15:45:00Z'))
})

test('TranscriptReader incremental read: only new bytes, a partial line is kept for next time; peekTitle / peekTodos', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccp-t-')), file = path.join(dir, 's.jsonl')
  const line = o => JSON.stringify(o) + '\n'
  fs.writeFileSync(file, line({ type: 'user', timestamp: '2026-10-07T15:39:00Z', message: { content: 'hi' } }) + line(A('m1', [tool('a', 'Bash')])))
  const r = new TranscriptReader(file)
  let st = await r.update(); assert.equal(st.tools.total, 1)
  const full = line(A('m2', [tool('b', 'Read')]))
  fs.appendFileSync(file, full.slice(0, 20)); st = await r.update(); assert.equal(st.tools.total, 1, 'a partial line must not be counted')
  fs.appendFileSync(file, full.slice(20) + line(A('m3', [tool('c', 'TodoWrite', { todos: [{ content: 'x', status: 'pending' }] })])) + line({ type: 'ai-title', aiTitle: 'T2' }))
  st = await r.update(); assert.equal(st.tools.total, 3); assert.equal(st.title, 'T2'); assert.equal(st.todos.items.length, 1)
  assert.equal(await peekTitle(file), 'T2'); assert.equal(peekTodos(file).items[0].name, 'x')
  fs.rmSync(dir, { recursive: true, force: true })
})
