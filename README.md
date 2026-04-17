# pi-statusline

A [pi](https://github.com/mariozechner/pi-coding-agent) extension that renders a Claude Code-style statusline showing model, directory, git status, and a context-window bar.

## Display

```
🦙 qwen3.6-35b-a3b | 💭high | 📁my-project | 🔀main (2 files uncommitted, synced) | t#14 · 42m | ⏱ 8s | ██████▄░░░ 63.2% of 128k tokens
↳ can you refactor the middleware to use async handlers and add tests
```

Line 1 sections (separated by `|`):

1. **Provider glyph + model** — accent-colored; provider → emoji (`🦙` LM Studio/Ollama, `🤖` Anthropic, `⚫` OpenAI, `⚡` Groq, `✨` Gemini, `🧬` Qwen, `🧠` fallback)
2. **Thinking level** — `💭high|medium|low|xhigh`, hidden when `off`
3. **Directory** — `📁<basename>` of `ctx.cwd`
4. **Git** — `🔀<branch> (N files uncommitted, <sync-status>)`, skipped when not in a repo
5. **Turn counter + session time** — `t#<completed-turns> · <elapsed>`
6. **Live turn/tool indicator** — while a model turn is running: `⏱ <elapsed>` (updated every second). When a tool is executing: `🔧<toolName>`. Hidden when idle.
7. **Context bar** — 10-block usage bar plus `N.N% of Kk tokens`. Color shifts to **orange** at >80% and **red** at >95%. Uses pi's `getContextUsage()` when a turn has completed, otherwise a 20k-token baseline estimate with `~` prefix.

Line 2 (only when placement is `belowEditor` or `aboveEditor`):

- **Last user message** — `↳ <text>` preview, whitespace-collapsed, truncated to terminal width. Hidden when there's no user message yet.

The statusline refreshes on `session_start`, `agent_start`, `agent_end`, `turn_end`, `tool_execution_start`, `tool_execution_end`, `model_select`, and `message_end`. While a turn is active a 1s ticker redraws to keep the `⏱` timer live.

## Install

```bash
pi install git:github.com/Acelogic/pi-statusline
```

Or add to `~/.pi/agent/settings.json`:

```json
{
  "packages": ["git:github.com/Acelogic/pi-statusline"]
}
```

## Update

```bash
pi update git:github.com/Acelogic/pi-statusline
```

Then `/reload` inside pi.

## Configuration

Environment variables (all optional):

- `PI_STATUSLINE_PLACEMENT` — where the statusline renders. One of:
  - `belowEditor` (default) — own line right under pi's input box
  - `aboveEditor` — own line above chat
  - `footer` — legacy behavior, crammed onto pi's shared extension-status row alongside `Claude Memories`, `LM Studio Active`, etc.
- `PI_STATUSLINE_COLOR` — accent color, one of: `gray`, `orange`, `blue` (default), `teal`, `green`, `lavender`, `rose`, `gold`, `slate`, `cyan`
- `PI_STATUSLINE_BASELINE_TOKENS` — baseline tokens used for the bar before the first turn completes (default `20000`)
- `PI_STATUSLINE_GIT_CACHE_MS` — how long git status is cached before re-running (default `1500`; set to `0` to disable caching)
- `PI_STATUSLINE_SHOW_GIT` — set to `false`/`0`/`off` to hide the git section entirely
- `PI_STATUSLINE_PCT_DECIMALS` — decimal places on the context percentage (default `1`, set to `0` for integer-only like `35%`, max `4`)
- `PI_STATUSLINE_WARN_PCT` — context percentage at which the bar turns orange (default `80`)
- `PI_STATUSLINE_DANGER_PCT` — context percentage at which the bar turns red (default `95`)
- `PI_STATUSLINE_TICK_MS` — live-timer refresh interval in ms while a turn runs (default `1000`, min `250`)
- `PI_STATUSLINE_SHOW_LAST_MSG` — set to `false`/`0`/`off` to hide the second (last-user-message) line

## Notes

- Uses ANSI 256-color escape codes in `ctx.ui.setStatus`. pi's `sanitizeStatusText` only strips whitespace, so color codes pass through to the footer.
- Git shelling-out is cached to keep per-turn overhead low. Caching is invalidated on a 1.5s clock.
- pi's existing footer remains visible above this line; to fully replace pi's footer, use `setFooter` instead (not done here to avoid losing pi's built-in token/cost summary).
