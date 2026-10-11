## English

First release. A side panel and status bar for Claude Code in VS Code and Cursor.

- Three tabs: Overview, Tasks, Session. One-line status bar.
- Quota (5h / weekly), current activity, task progress, context and token usage, subagents.
- Task progress from Claude Code's built-in to-do list and your own progress files.
- Quota source is your choice: a local file, or Anthropic's usage endpoint (off until you opt in).
- English and Simplified Chinese UI. Reads local files only, no telemetry.

**Install:** download the `.vsix` below, then run one of

```
code --install-extension claude-code-panel-0.1.0.vsix
cursor --install-extension claude-code-panel-0.1.0.vsix
```

and reload the window.

**Known limits:** it relies on Claude Code's local transcript format, which is not a stable public interface. Tested on macOS with Cursor; VS Code, Windows and Linux have had less testing.

## 中文

首个版本。在 VS Code 和 Cursor 里给 Claude Code 加的侧边面板和状态栏。

- 三个标签页：总览、任务、会话；状态栏一行显示。
- 额度（5 小时 / 周）、实时动作、任务进度、上下文与 token 用量、子 agent。
- 任务进度来自 Claude Code 自带的待办清单和你自己的进度文件。
- 额度来源自选：本地文件，或 Anthropic 额度接口（你选了才启用）。
- 中英文界面。只读本地文件，无遥测。

**安装：** 下载下面的 `.vsix`，运行上面两条命令之一，然后重载窗口。

**已知局限：** 依赖 Claude Code 本地会话记录的格式，这不是稳定的公开接口。在 macOS + Cursor 上测试过，VS Code、Windows、Linux 测试较少。
