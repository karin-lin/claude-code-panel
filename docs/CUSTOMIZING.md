# Customizing

The panel is built from three data sources. Two of them you can feed yourself with any script, which is how you adapt it to your own setup without touching the extension.

## 1. Quota file

Set `claudeCodePanel.quota.source` to `file`. By default the panel reads `<claude dir>/cc-panel/rate-limits.json` (the statusline helper writes it). Point `claudeCodePanel.quota.file` at any other file to use your own.

Any of these shapes works:

```jsonc
// shape A
{ "five_hour": { "util": 31, "resets_at": "2026-10-11T02:00:00Z" },
  "seven_day": { "util": 50, "resets_at": "2026-10-14T00:00:00Z" },
  "fetched_at": "2026-10-10T23:59:00Z" }

// shape B (what Claude Code pipes to a status line command)
{ "rate_limits": { "five_hour": { "used_percentage": 31, "resets_at": 1791680000 },
                   "seven_day": { "used_percentage": 50, "resets_at": 1792000000 } } }
```

- The percentage key can be `util`, `utilization`, `used_percentage`, `used_percent`, `percent` or `pct`.
- `resets_at` can be an ISO string, epoch seconds or epoch milliseconds.
- Freshness comes from `fetched_at` / `updated` / `updated_at`, or the file's modification time. A file untouched for 15 minutes is shown as stale.
- If a window's `resets_at` is already in the past, its usage is shown as 0 until the file is refreshed.

Write it from cron, a shell loop, or your own tool. The panel re-reads it every few seconds.

### Personal limit lines

If you want to stop yourself before the real limit, set `claudeCodePanel.quota.lines`:

```json
"claudeCodePanel.quota.lines": { "five_hour": 65, "seven_day": 70 }
```

Each bar gets a tick at your line, and the verdict becomes "N pts below your line" / "Over your line". Without lines, colors follow `warnAt` and `critAt`.

## 2. Progress files

Any tool can show progress in the Tasks tab by writing a JSON file into `<claude dir>/cc-panel/progress/` (scanned automatically) or into any file or folder listed in `claudeCodePanel.progressFiles`.

```json
{
  "title": "Release 1.4",
  "cwd": "/home/me/api-server",
  "updated": "2026-10-11T08:00:00Z",
  "steps": [
    { "name": "Changelog", "state": "done" },
    { "name": "Build artifacts", "state": "doing", "note": "linux done, arm64 pending" },
    { "name": "Publish", "state": "todo" }
  ]
}
```

- `state` is `todo`, `doing` or `done`. `note` shows under a step that is in progress.
- **Which session does it belong to?** In order: `sessionId` in the file, a file name that is a session UUID, then `cwd` (the most recently active session in that folder). With none of these it becomes its own card.
- Files not updated for 24 hours are ignored. Percentage = done steps / total steps, with a step in progress counting half.

[`examples/progress.js`](../examples/progress.js) is a dependency-free command line for this:

```
node progress.js plan "Release 1.4" "Changelog" "Build" "Publish"
node progress.js done 1
node progress.js doing 2 "arm64 pending"
node progress.js finish
```

### Having Claude keep it updated

Put an instruction in your project's `CLAUDE.md` so Claude registers multi-step work itself, for example:

```md
For any task with several steps, start by running `node /path/to/progress.js plan "<title>" "<step 1>" ...`
and run `node /path/to/progress.js done <n>` as each step finishes. Skip this for plain questions.
```

Claude Code's own to-do list (`TodoWrite`) is picked up automatically, so this is only needed if you want a separate, explicit plan.

## 3. Your own panel behaviour

Everything under `lib/` is plain Node with no editor dependency, and `scripts/demo-data.js` builds a fake Claude config directory for experimenting:

```
node scripts/render-harness.mjs out        # screenshots from fake data
CC_PANEL_LANG=zh-CN CC_PANEL_TAB=tasks node scripts/render-harness.mjs out
```

Set `claudeCodePanel.claudeDir` to that fake directory to try the panel against it.
