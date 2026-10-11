'use strict'
/** English is the default; Simplified Chinese when the editor UI language is zh-*. Params use {name}. */
const en = {
  'tab.overview': 'Overview', 'tab.tasks': 'Tasks', 'tab.session': 'Session',
  'hdr.updated': 'Updated {t}',
  'quota.title': 'Quota', 'quota.five_hour': '5h', 'quota.seven_day': '7d',
  'quota.line': 'line {n}', 'quota.resets': 'resets in {t}', 'quota.atLine': 'at line',
  'quota.ok': '✅ Within limits', 'quota.okLine': '✅ {n} pts below your line', 'quota.warn': '⚠️ Getting close', 'quota.crit': '⛔ Almost out', 'quota.over': '⛔ Over your line',
  'quota.read': 'read {t}', 'quota.stale': 'stale',
  'quota.paceTip': 'Even-pace marker: where you would be if you used the window evenly', 'quota.lineTip': 'Your personal limit line',
  'quota.setupText': 'Quota is not set up. Choose how to read your 5-hour and weekly limits.', 'quota.setupBtn': 'Set up quota',
  'quota.hint.noToken': 'No Claude Code login found. Run `claude` and use /login.',
  'quota.hint.expired': 'Login looks expired. Run `claude` and use /login again.',
  'quota.hint.rateLimited': 'Usage endpoint is rate-limited; retrying later.',
  'quota.hint.network': 'Could not reach the usage endpoint.',
  'quota.hint.fileMissing': 'Quota file not found: {path}',
  'quota.hint.fileStale': 'Quota file has not been updated for {t}.',
  'quota.hint.noData': 'The quota source returned no 5h / 7d numbers.',
  'quota.hint.unknown': 'Could not read quota.',
  'session.title': 'Current session', 'session.none': 'No Claude Code session found yet.<br>Start one and it will show up here.',
  'state.thinking': 'Thinking', 'state.tool': 'Running {tool}', 'state.idle': 'Idle', 'state.unknown': 'Unknown',
  'state.maybeWaiting': 'may be waiting for your approval',
  'tool.Bash': 'a command', 'tool.Edit': 'an edit', 'tool.Write': 'a file write', 'tool.MultiEdit': 'an edit', 'tool.NotebookEdit': 'a notebook edit',
  'tool.Read': 'a file read', 'tool.Glob': 'a file search', 'tool.Grep': 'a code search', 'tool.WebSearch': 'a web search', 'tool.WebFetch': 'a page fetch',
  'tool.Agent': 'a subagent', 'tool.Task': 'a subagent', 'tool.TodoWrite': 'a plan update',
  'src.ide': 'IDE', 'src.cli': 'Terminal', 'src.sdk': 'SDK', 'src.unknown': 'Other',
  'turn.running': 'This turn {t}', 'turn.ended': 'Last turn ended {hhmm}', 'turn.started': 'Turn started {hhmm}',
  'turn.tools': '{n} tool calls', 'turn.agents': '{n} subagents',
  'ctx.title': 'Context', 'ctx.sub': 'cache read {r} · cache write {w} · new input {i}',
  'detail.model': 'Model', 'detail.thisSession': 'This session', 'detail.cumulative': 'Cumulative input', 'detail.tools': 'Tools',
  'detail.thisSessionVal': 'output {o} (thinking {th}) · {m} replies · {p} turn(s)',
  'detail.cumulativeVal': 'cache write {w} · cache read {r} · new input {i}',
  'detail.toolsVal': '{n} calls{agents}{since}', 'detail.agents': ' · {n} subagents', 'detail.since': ' · started {hhmm}',
  'detail.openRaw': 'Open raw transcript file', 'detail.openRawTip': 'Open this session\'s raw JSONL transcript in the editor',
  'pin.cancel': '📌 Unpin', 'pin.cancelTip': 'Pinned to this session. Click to follow the most active session again.', 'pin.tip': 'Click to pin this session',
  'tasks.none': 'No tasks yet.<br>Claude Code\'s own to-do list (TodoWrite) shows up here, plus any progress files you configure.',
  'tasks.summary': 'Tasks ({n})', 'tasks.progress': 'Progress', 'tasks.steps': '{d}/{n} steps', 'tasks.active': '▶ In progress', 'tasks.done': '✅ Done',
  'tasks.footer': 'By steps: done counts 1, in progress counts 0.5. If the plan changes, the total changes too.',
  'tasks.doneGroup': 'Done ({n})', 'tasks.fold': 'Click to collapse', 'tasks.unfold': 'Click to expand',
  'tasks.started': 'started {hhmm}', 'tasks.updated': 'updated {t}',
  'sub.title': 'Subagents ({n})', 'sub.titleActive': 'Subagents ({n}, {a} active)',
  'others.title': 'Other sessions (last 24h: {n})',
  'time.now': 'just now', 'time.ago': '{t} ago', 'time.unknown': '—',
  'sb.tooltipHint': 'Click to open the panel', 'sb.quotaOff': 'quota off',
  'cmd.installOk': 'Statusline helper installed. Quota numbers appear after your next Claude Code terminal session renders its status line.',
  'cmd.installAlready': 'The statusline helper is already installed.',
  'cmd.installConfirm': 'Install the statusline helper? It edits {file} (a backup is saved next to it) and keeps your existing status line working.',
  'cmd.uninstallOk': 'Statusline helper removed and your previous status line restored.',
  'cmd.install': 'Install', 'cmd.cancel': 'Cancel',
  'setup.prompt': 'Claude Code Panel can show your 5-hour and weekly limits. Where should the numbers come from?',
  'setup.api': 'Anthropic usage API (network)', 'setup.file': 'A local file / statusline helper', 'setup.off': 'Not now',
  'setup.apiNote': 'This reads your Claude Code login token and calls Anthropic\'s usage endpoint about every 5 minutes. Nothing else leaves your machine.'
}

const zh = {
  'tab.overview': '总览', 'tab.tasks': '任务', 'tab.session': '会话',
  'hdr.updated': '更新 {t}',
  'quota.title': '额度', 'quota.five_hour': '5h', 'quota.seven_day': '周',
  'quota.line': '线 {n}', 'quota.resets': '{t}后重置', 'quota.atLine': '已到线',
  'quota.ok': '✅ 额度充足', 'quota.okLine': '✅ 离你的线还有 {n} 点', 'quota.warn': '⚠️ 快到了', 'quota.crit': '⛔ 快用完了', 'quota.over': '⛔ 已超过你设的线',
  'quota.read': '读数 {t}', 'quota.stale': '已过期',
  'quota.paceTip': '匀速刻度：如果均匀使用这个窗口，此刻应该在的位置', 'quota.lineTip': '你自己设的限额线',
  'quota.setupText': '还没设置额度来源。选一种方式来读取 5 小时和周额度。', 'quota.setupBtn': '设置额度',
  'quota.hint.noToken': '没找到 Claude Code 登录。在终端运行 claude，输入 /login。',
  'quota.hint.expired': '登录可能已过期。在终端运行 claude，输入 /login 重新登录。',
  'quota.hint.rateLimited': '额度接口被限流，稍后自动重试。',
  'quota.hint.network': '连不上额度接口。',
  'quota.hint.fileMissing': '找不到额度文件：{path}',
  'quota.hint.fileStale': '额度文件已 {t} 没更新。',
  'quota.hint.noData': '额度来源里没有 5h / 周 的数字。',
  'quota.hint.unknown': '读不到额度。',
  'session.title': '当前会话', 'session.none': '还没有 Claude Code 会话记录。<br>开一个会话后这里就会出现。',
  'state.thinking': '思考中', 'state.tool': '正在执行{tool}', 'state.idle': '空闲', 'state.unknown': '未知',
  'state.maybeWaiting': '可能在等你确认',
  'tool.Bash': '命令', 'tool.Edit': '编辑', 'tool.Write': '写文件', 'tool.MultiEdit': '编辑', 'tool.NotebookEdit': '笔记本编辑',
  'tool.Read': '读文件', 'tool.Glob': '找文件', 'tool.Grep': '搜代码', 'tool.WebSearch': '联网搜索', 'tool.WebFetch': '抓网页',
  'tool.Agent': '子 agent', 'tool.Task': '子 agent', 'tool.TodoWrite': '更新计划',
  'src.ide': 'IDE', 'src.cli': '终端', 'src.sdk': 'SDK', 'src.unknown': '其他',
  'turn.running': '本轮 {t}', 'turn.ended': '上一轮 {hhmm} 结束', 'turn.started': '本轮 {hhmm} 开始',
  'turn.tools': '{n} 次工具', 'turn.agents': '{n} 个子 agent',
  'ctx.title': '上下文', 'ctx.sub': '缓存读 {r} · 缓存写 {w} · 新输入 {i}',
  'detail.model': '模型', 'detail.thisSession': '本会话', 'detail.cumulative': '累计喂入', 'detail.tools': '工具',
  'detail.thisSessionVal': '输出 {o}（思考 {th}）· {m} 条回复 · {p} 轮',
  'detail.cumulativeVal': '缓存写 {w} · 缓存读 {r} · 新输入 {i}',
  'detail.toolsVal': '{n} 次{agents}{since}', 'detail.agents': ' · 子 agent {n}', 'detail.since': ' · 会话开始于 {hhmm}',
  'detail.openRaw': '打开原始记录文件', 'detail.openRawTip': '在编辑器里打开这个会话的原始 JSONL 记录',
  'pin.cancel': '📌 取消固定', 'pin.cancelTip': '已固定在这个会话，点一下恢复自动跟随最活跃的会话。', 'pin.tip': '点击固定显示这个会话',
  'tasks.none': '还没有任务。<br>Claude Code 自带的待办清单（TodoWrite）会显示在这里，也可以配置自己的进度文件。',
  'tasks.summary': '任务（{n}）', 'tasks.progress': '完成进度', 'tasks.steps': '{d}/{n} 步', 'tasks.active': '▶ 进行中', 'tasks.done': '✅ 已完成',
  'tasks.footer': '按步骤算：完成 1、进行中 0.5。计划变了步数会跟着变。',
  'tasks.doneGroup': '已完成（{n}）', 'tasks.fold': '点击收起', 'tasks.unfold': '点击展开',
  'tasks.started': '始于 {hhmm}', 'tasks.updated': '更新 {t}',
  'sub.title': '子 agent（{n}）', 'sub.titleActive': '子 agent（{n}，活跃 {a}）',
  'others.title': '其他会话（24h 内 {n} 个）',
  'time.now': '刚刚', 'time.ago': '{t}前', 'time.unknown': '—',
  'sb.tooltipHint': '点击打开面板', 'sb.quotaOff': '额度未开',
  'cmd.installOk': '状态栏助手已安装。下次在终端里用 Claude Code 渲染状态栏后，额度数字就会出现。',
  'cmd.installAlready': '状态栏助手已经装过了。',
  'cmd.installConfirm': '安装状态栏助手？它会修改 {file}（旁边保存备份），并保留你原来的状态栏。',
  'cmd.uninstallOk': '状态栏助手已移除，已恢复你原来的状态栏。',
  'cmd.install': '安装', 'cmd.cancel': '取消',
  'setup.prompt': 'Claude Code Panel 可以显示 5 小时和周额度。数字从哪里来？',
  'setup.api': 'Anthropic 额度接口（联网）', 'setup.file': '本地文件 / 状态栏助手', 'setup.off': '暂时不要',
  'setup.apiNote': '会读取你的 Claude Code 登录令牌，大约每 5 分钟请求一次 Anthropic 的额度接口，除此之外不会有任何数据离开你的电脑。'
}

function pick(language) {
  return typeof language === 'string' && language.toLowerCase().startsWith('zh') ? { lang: 'zh', dict: zh } : { lang: 'en', dict: en }
}

function makeT(language) {
  const { dict } = pick(language)
  return (key, params) => {
    let s = dict[key] != null ? dict[key] : (en[key] != null ? en[key] : key)
    if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? String(params[k]) : m))
    return s
  }
}

module.exports = { en, zh, pick, makeT }
