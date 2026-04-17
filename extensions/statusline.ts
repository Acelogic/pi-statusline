import { execFileSync } from "node:child_process";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const STATUS_ID = "pi-statusline";

const RESET = "\x1b[0m";
const GRAY = "\x1b[38;5;245m";
const BAR_EMPTY = "\x1b[38;5;238m";
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

function buildContextBar(
	tokens: number,
	contextWindow: number,
	accent: string,
	estimated: boolean,
): string {
	const safeWindow = Math.max(contextWindow, 1);
	let pct = Math.floor((tokens * 100) / safeWindow);
	if (pct < 0) pct = 0;
	if (pct > 100) pct = 100;

	const width = 10;
	let bar = "";
	for (let i = 0; i < width; i++) {
		const progress = pct - i * 10;
		if (progress >= 8) bar += `${accent}█${RESET}`;
		else if (progress >= 3) bar += `${accent}▄${RESET}`;
		else bar += `${BAR_EMPTY}░${RESET}`;
	}
	const maxK = Math.max(1, Math.round(safeWindow / 1000));
	const prefix = estimated ? "~" : "";
	return `${bar} ${GRAY}${prefix}${pct}% of ${maxK}k tokens${RESET}`;
}

function render(ctx: ExtensionContext): void {
	const accent = getAccent();
	const modelLabel = ctx.model?.id ?? "no model";
	const dir = path.basename(ctx.cwd) || ctx.cwd || "?";

	const usage = ctx.getContextUsage();
	const baseline = envInt("PI_STATUSLINE_BASELINE_TOKENS", 20000);
	const window = usage?.contextWindow ?? ctx.model?.contextWindow ?? 200_000;
	const tokens = usage?.tokens ?? baseline;
	const estimated = usage?.tokens == null;
	const ctxStr = buildContextBar(tokens, window, accent, estimated);

	let out = `${accent}${modelLabel}${RESET}${GRAY} | 📁${dir}${RESET}`;
	if (envBool("PI_STATUSLINE_SHOW_GIT", true)) {
		const gitInfo = readGitInfo(ctx.cwd);
		if (gitInfo) out += `${GRAY} | ${formatGit(gitInfo)}${RESET}`;
	}
	out += `${GRAY} | ${ctxStr}`;

	ctx.ui.setStatus(STATUS_ID, out);
}

export default function statuslineExtension(pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => render(ctx));
	pi.on("model_select", async (_event, ctx) => render(ctx));
	pi.on("turn_end", async (_event, ctx) => render(ctx));
	pi.on("message_end", async (_event, ctx) => render(ctx));
}
