import { execFileSync } from "node:child_process";
import * as path from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
	SessionMessageEntry,
} from "@mariozechner/pi-coding-agent";

const STATUS_ID = "pi-statusline";

const RESET = "\x1b[0m";
const GRAY = "\x1b[38;5;245m";
const BAR_EMPTY = "\x1b[38;5;238m";
const WARN_ACCENT = "\x1b[38;5;208m"; // orange
const DANGER_ACCENT = "\x1b[38;5;196m"; // bright red
const ACCENTS: Record<string, string> = {
	gray: GRAY,
	orange: "\x1b[38;5;173m",
	blue: "\x1b[38;5;74m",
	teal: "\x1b[38;5;66m",
	green: "\x1b[38;5;71m",
	lavender: "\x1b[38;5;139m",
	rose: "\x1b[38;5;132m",
	gold: "\x1b[38;5;136m",
	slate: "\x1b[38;5;60m",
	cyan: "\x1b[38;5;37m",
};

const PROVIDER_GLYPHS: Record<string, string> = {
	"lm-studio": "🦙",
	ollama: "🦙",
	anthropic: "🤖",
	openai: "⚫",
	google: "🟢",
	gemini: "✨",
	groq: "⚡",
	mistral: "🌬",
	cohere: "🔷",
	xai: "🅧",
	"qwen-cli": "🧬",
};

function getAccent(): string {
	const name = (process.env.PI_STATUSLINE_COLOR ?? "blue").trim().toLowerCase();
	return ACCENTS[name] ?? GRAY;
}

function envInt(name: string, defaultValue: number): number {
	const raw = process.env[name]?.trim();
	if (!raw) return defaultValue;
	const n = Number.parseInt(raw, 10);
	return Number.isFinite(n) && n >= 0 ? n : defaultValue;
}

function envBool(name: string, defaultValue: boolean): boolean {
	const raw = process.env[name]?.trim().toLowerCase();
	if (!raw) return defaultValue;
	if (["0", "false", "no", "off"].includes(raw)) return false;
	if (["1", "true", "yes", "on"].includes(raw)) return true;
	return defaultValue;
}

function runGit(cwd: string, args: string[], timeoutMs: number): string | null {
	try {
		const out = execFileSync("git", ["-C", cwd, "--no-optional-locks", ...args], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			timeout: timeoutMs,
		});
		return out.trim();
	} catch {
		return null;
	}
}

type GitInfo = { branch: string; fileCount: number; sync: string };

type GitCacheEntry = { at: number; info: GitInfo | null };
const gitCache = new Map<string, GitCacheEntry>();

function readGitInfo(cwd: string): GitInfo | null {
	const cacheMs = envInt("PI_STATUSLINE_GIT_CACHE_MS", 1500);
	const now = Date.now();
	if (cacheMs > 0) {
		const hit = gitCache.get(cwd);
		if (hit && now - hit.at < cacheMs) return hit.info;
	}

	const branch = runGit(cwd, ["branch", "--show-current"], 400);
	if (!branch) {
		gitCache.set(cwd, { at: now, info: null });
		return null;
	}

	const status = runGit(cwd, ["status", "--porcelain", "-uall"], 400) ?? "";
	const fileCount = status.length === 0 ? 0 : status.split("\n").filter(Boolean).length;

	let sync = "no upstream";
	const counts = runGit(cwd, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], 400);
	if (counts) {
		const [aheadStr, behindStr] = counts.split("\t");
		const ahead = Number.parseInt(aheadStr ?? "0", 10) || 0;
		const behind = Number.parseInt(behindStr ?? "0", 10) || 0;
		if (ahead === 0 && behind === 0) sync = "synced";
		else if (ahead > 0 && behind === 0) sync = `${ahead} ahead`;
		else if (behind > 0 && ahead === 0) sync = `${behind} behind`;
		else sync = `${ahead} ahead, ${behind} behind`;
	}

	const info: GitInfo = { branch, fileCount, sync };
	gitCache.set(cwd, { at: now, info });
	return info;
}

function formatGit(info: GitInfo): string {
	const { branch, fileCount, sync } = info;
	const noun = fileCount === 1 ? "file" : "files";
	return `🔀${branch} (${fileCount} ${noun} uncommitted, ${sync})`;
}

function formatDuration(ms: number, compact: boolean): string {
	const totalSec = Math.max(0, Math.floor(ms / 1000));
	if (totalSec < 60) return `${totalSec}s`;
	const totalMin = Math.floor(totalSec / 60);
	const remSec = totalSec % 60;
	if (totalMin < 60) return compact ? `${totalMin}m${remSec}s` : `${totalMin}m`;
	const totalHr = Math.floor(totalMin / 60);
	const remMin = totalMin % 60;
	return `${totalHr}h${remMin}m`;
}

function buildContextBar(
	tokens: number,
	contextWindow: number,
	baseAccent: string,
	estimated: boolean,
): string {
	const safeWindow = Math.max(contextWindow, 1);
	let pct = (tokens * 100) / safeWindow;
	if (pct < 0) pct = 0;
	if (pct > 100) pct = 100;

	const warnThreshold = envInt("PI_STATUSLINE_WARN_PCT", 80);
	const dangerThreshold = envInt("PI_STATUSLINE_DANGER_PCT", 95);
	let accent = baseAccent;
	if (pct >= dangerThreshold) accent = DANGER_ACCENT;
	else if (pct >= warnThreshold) accent = WARN_ACCENT;

	const width = 10;
	let bar = "";
	for (let i = 0; i < width; i++) {
		const progress = pct - i * 10;
		if (progress >= 8) bar += `${accent}█${RESET}`;
		else if (progress >= 3) bar += `${accent}▄${RESET}`;
		else bar += `${BAR_EMPTY}░${RESET}`;
	}
	const decimals = envInt("PI_STATUSLINE_PCT_DECIMALS", 1);
	const pctStr = pct.toFixed(Math.min(4, decimals));
	const maxK = Math.max(1, Math.round(safeWindow / 1000));
	const prefix = estimated ? "~" : "";
	const pctColor = accent === baseAccent ? GRAY : accent;
	return `${bar} ${pctColor}${prefix}${pctStr}% of ${maxK}k tokens${RESET}`;
}

type Placement = "aboveEditor" | "belowEditor" | "footer";

function getPlacement(): Placement {
	const raw = process.env.PI_STATUSLINE_PLACEMENT?.trim().toLowerCase();
	if (raw === "above" || raw === "aboveeditor") return "aboveEditor";
	if (raw === "footer" || raw === "status") return "footer";
	return "belowEditor";
}

function getProviderGlyph(provider: string | undefined): string {
	if (!provider) return "🧠";
	return PROVIDER_GLYPHS[provider] ?? "🧠";
}

function extractMessageText(msg: SessionMessageEntry["message"]): string {
	const content = (msg as unknown as { content: unknown }).content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		const parts: string[] = [];
		for (const block of content) {
			if (block && typeof block === "object" && (block as { type?: string }).type === "text") {
				const text = (block as { text?: string }).text;
				if (typeof text === "string") parts.push(text);
			}
		}
		return parts.join(" ");
	}
	return "";
}

function getLastUserMessage(ctx: ExtensionContext): string | null {
	const entries = ctx.sessionManager.getEntries();
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (!entry || entry.type !== "message") continue;
		const msgEntry = entry as SessionMessageEntry;
		if (msgEntry.message?.role !== "user") continue;
		const text = extractMessageText(msgEntry.message).replace(/\s+/g, " ").trim();
		if (!text) continue;
		if (text.startsWith("[Request interrupted") || text.startsWith("[Request cancelled")) continue;
		return text;
	}
	return null;
}

function truncateDisplay(text: string, maxCols: number): string {
	if (maxCols <= 3) return text.slice(0, Math.max(0, maxCols));
	if (text.length <= maxCols) return text;
	return text.slice(0, maxCols - 1) + "…";
}

type RenderState = {
	pi: ExtensionAPI;
	turnStartAt: number | null;
	activeTool: string | null;
	turnCount: number;
	sessionStartAt: number;
};

function render(ctx: ExtensionContext, state: RenderState): void {
	const accent = getAccent();
	const glyph = getProviderGlyph(ctx.model?.provider);
	const modelLabel = ctx.model?.id ?? "no model";
	const dir = path.basename(ctx.cwd) || ctx.cwd || "?";

	const usage = ctx.getContextUsage();
	const baseline = envInt("PI_STATUSLINE_BASELINE_TOKENS", 20000);
	const window = usage?.contextWindow ?? ctx.model?.contextWindow ?? 200_000;
	const tokens = usage?.tokens ?? baseline;
	const estimated = usage?.tokens == null;
	const ctxStr = buildContextBar(tokens, window, accent, estimated);

	const parts: string[] = [];
	parts.push(`${accent}${glyph} ${modelLabel}${RESET}`);

	let thinking: string | undefined;
	try {
		thinking = state.pi.getThinkingLevel?.();
	} catch {
		thinking = undefined;
	}
	if (thinking && thinking !== "off") {
		parts.push(`${GRAY}💭${thinking}${RESET}`);
	}

	parts.push(`${GRAY}📁${dir}${RESET}`);

	if (envBool("PI_STATUSLINE_SHOW_GIT", true)) {
		const gitInfo = readGitInfo(ctx.cwd);
		if (gitInfo) parts.push(`${GRAY}${formatGit(gitInfo)}${RESET}`);
	}

	const sessionElapsed = formatDuration(Date.now() - state.sessionStartAt, false);
	parts.push(`${GRAY}t#${state.turnCount} · ${sessionElapsed}${RESET}`);

	if (state.activeTool) {
		parts.push(`${WARN_ACCENT}🔧${state.activeTool}${RESET}`);
	} else if (state.turnStartAt) {
		const turnElapsed = formatDuration(Date.now() - state.turnStartAt, true);
		parts.push(`${WARN_ACCENT}⏱ ${turnElapsed}${RESET}`);
	}

	parts.push(ctxStr);

	const statusLine = parts.join(`${GRAY} | ${RESET}`);
	const placement = getPlacement();
	const lines: string[] = [statusLine];

	if (placement !== "footer" && envBool("PI_STATUSLINE_SHOW_LAST_MSG", true)) {
		const lastMsg = getLastUserMessage(ctx);
		if (lastMsg) {
			const cols = Math.max(20, process.stdout.columns || 120);
			const prefix = "↳ ";
			const room = cols - prefix.length;
			lines.push(`${GRAY}${prefix}${truncateDisplay(lastMsg, room)}${RESET}`);
		}
	}

	if (placement === "footer") {
		ctx.ui.setWidget(STATUS_ID, undefined);
		ctx.ui.setStatus(STATUS_ID, statusLine);
	} else {
		ctx.ui.setStatus(STATUS_ID, "");
		ctx.ui.setWidget(STATUS_ID, lines, { placement });
	}
}

export default function statuslineExtension(pi: ExtensionAPI) {
	const state: RenderState = {
		pi,
		turnStartAt: null,
		activeTool: null,
		turnCount: 0,
		sessionStartAt: Date.now(),
	};
	let ticker: ReturnType<typeof setInterval> | null = null;
	let lastCtx: ExtensionContext | null = null;

	const stopTicker = () => {
		if (ticker) {
			clearInterval(ticker);
			ticker = null;
		}
	};

	const startTicker = () => {
		stopTicker();
		const ms = envInt("PI_STATUSLINE_TICK_MS", 1000);
		ticker = setInterval(() => {
			if (lastCtx) render(lastCtx, state);
		}, Math.max(250, ms));
	};

	const redraw = (ctx: ExtensionContext) => {
		lastCtx = ctx;
		render(ctx, state);
	};

	pi.on("session_start", async (_event, ctx) => {
		state.sessionStartAt = Date.now();
		state.turnCount = 0;
		state.turnStartAt = null;
		state.activeTool = null;
		stopTicker();
		redraw(ctx);
	});

	pi.on("session_shutdown", async () => {
		stopTicker();
	});

	pi.on("agent_start", async (_event, ctx) => {
		state.turnStartAt = Date.now();
		startTicker();
		redraw(ctx);
	});

	pi.on("agent_end", async (_event, ctx) => {
		state.turnStartAt = null;
		stopTicker();
		redraw(ctx);
	});

	pi.on("tool_execution_start", async (event, ctx) => {
		state.activeTool = (event as { toolName?: string }).toolName ?? null;
		redraw(ctx);
	});

	pi.on("tool_execution_end", async (_event, ctx) => {
		state.activeTool = null;
		redraw(ctx);
	});

	pi.on("turn_end", async (_event, ctx) => {
		state.turnCount += 1;
		redraw(ctx);
	});

	pi.on("model_select", async (_event, ctx) => redraw(ctx));
	pi.on("message_end", async (_event, ctx) => redraw(ctx));
}
