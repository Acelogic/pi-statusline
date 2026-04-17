# pi-statusline

A [pi](https://github.com/mariozechner/pi-coding-agent) extension that renders a Claude Code-style statusline showing model, directory, git status, and a context-window bar.

## Display

```
qwen3.6-35b-a3b | 📁my-project | 🔀main (2 files uncommitted, synced 4m ago) | ██████▄░░░ 63% of 128k tokens
```

Four sections separated by `|`:

1. **Model** — accent-colored; reads `ctx.model.id`
2. **Directory** — `📁<basename>` of `ctx.cwd`
3. **Git** — `🔀<branch> (N files uncommitted, <sync-status>)`, skipped when not in a repo
4. **Context bar** — 10-block usage bar plus `N% of Kk tokens`; uses pi's `getContextUsage()` when a turn has completed, otherwise a 20k-token baseline estimate with `~` prefix

The statusline refreshes on `session_start`, `model_select`, `turn_end`, and `message_end`.

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

- `PI_STATUSLINE_COLOR` — accent color, one of: `gray`, `orange`, `blue` (default), `teal`, `green`, `lavender`, `rose`, `gold`, `slate`, `cyan`
- `PI_STATUSLINE_BASELINE_TOKENS` — baseline tokens used for the bar before the first turn completes (default `20000`)
- `PI_STATUSLINE_GIT_CACHE_MS` — how long git status is cached before re-running (default `1500`; set to `0` to disable caching)
- `PI_STATUSLINE_SHOW_GIT` — set to `false`/`0`/`off` to hide the git section entirely
- `PI_STATUSLINE_PCT_DECIMALS` — decimal places on the context percentage (default `1`, set to `0` for integer-only like `35%`, max `4`)

## Notes

- Uses ANSI 256-color escape codes in `ctx.ui.setStatus`. pi's `sanitizeStatusText` only strips whitespace, so color codes pass through to the footer.
- Git shelling-out is cached to keep per-turn overhead low. Caching is invalidated on a 1.5s clock.
- pi's existing footer remains visible above this line; to fully replace pi's footer, use `setFooter` instead (not done here to avoid losing pi's built-in token/cost summary).
