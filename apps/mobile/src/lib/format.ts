/** Pure display helpers shared by the drawer, chat and settings. No React Native imports. */
import type { InstanceSummary, ModelRef, Usage } from "@pimate/protocol";

/** `/home/me/code/demo` -> `~/code/demo` (the PC's home dir is unknown to the phone, so match common layouts). */
export function tildePath(path: string): string {
	const m = /^(\/home\/[^/]+|\/Users\/[^/]+|\/root)(\/.*)?$/.exec(path);
	if (!m) return path;
	return `~${m[2] ?? ""}`;
}

export function basename(path: string): string {
	const trimmed = path.replace(/\/+$/, "");
	const i = trimmed.lastIndexOf("/");
	return (i >= 0 ? trimmed.slice(i + 1) : trimmed) || path;
}

/** Drawer / header title: the session name, otherwise the folder name. */
export function instanceTitle(instance: Pick<InstanceSummary, "cwd" | "session">): string {
	const name = instance.session?.name?.trim();
	return name || basename(instance.cwd);
}

/** Relative time for list rows: 今 / 5分 / 3時間 / 昨日 / 4日 / 10/3. */
export function relativeTime(timestamp: number, now: number): string {
	const diff = Math.max(0, now - timestamp);
	const min = Math.floor(diff / 60_000);
	if (min < 1) return "今";
	if (min < 60) return `${min}分`;
	const hours = Math.floor(min / 60);
	if (hours < 24) return `${hours}時間`;
	const days = Math.floor(hours / 24);
	if (days < 2) return "昨日";
	if (days < 7) return `${days}日`;
	const d = new Date(timestamp);
	return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** `1:04`, `12:30`, `1:02:03` */
export function elapsed(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	const ss = String(s).padStart(2, "0");
	return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** `12秒`, `1分5秒` for tool durations. */
export function seconds(ms: number): string {
	const total = Math.max(0, Math.round(ms / 1000));
	if (total < 60) return `${total}秒`;
	return `${Math.floor(total / 60)}分${total % 60}秒`;
}

export function tokens(n: number): string {
	if (n < 1000) return String(n);
	if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
	if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
	return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/** `gpt-6-luna · 6.2k in · 210 out · $0.04` — the meta line under a finished assistant message. */
export function usageLine(model: ModelRef | undefined, usage: Usage | undefined): string | null {
	const parts: string[] = [];
	if (model) parts.push(model.id);
	if (usage) {
		const input = usage.input + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
		parts.push(`${tokens(input)} in`, `${tokens(usage.output)} out`);
		if (usage.cost && usage.cost > 0)
			parts.push(`$${usage.cost < 0.01 ? usage.cost.toFixed(3) : usage.cost.toFixed(2)}`);
	}
	return parts.length ? parts.join(" · ") : null;
}

export function platformLabel(platform: string | undefined): string | null {
	if (!platform) return null;
	if (platform === "darwin") return "macOS";
	if (platform === "linux") return "Linux";
	if (platform === "win32") return "Windows";
	return platform;
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function firstLine(text: string): string {
	const line = text.trim().split("\n")[0] ?? "";
	return line.length > 200 ? `${line.slice(0, 200)}…` : line;
}

/** The short subject shown next to a tool name: a path, a command or a pattern. */
export function toolSubject(toolName: string, args: unknown): string {
	const a = record(args);
	const str = (key: string) => (typeof a[key] === "string" ? (a[key] as string) : undefined);
	const path = str("path") ?? str("file_path") ?? str("filePath");
	switch (toolName) {
		case "bash":
			return firstLine(str("command") ?? "");
		case "read":
		case "edit":
		case "write":
		case "ls":
			return path ?? "";
		case "grep":
		case "find": {
			const pattern = str("pattern") ?? "";
			return path ? `${pattern}  ${path}` : pattern;
		}
	}
	if (path) return path;
	for (const value of Object.values(a)) if (typeof value === "string" && value.trim()) return firstLine(value);
	return "";
}

/** Text of a tool result / partial result (`{ content: [{ type: "text", text }] }`). */
export function contentText(value: unknown): string {
	if (typeof value === "string") return value;
	const content = record(value).content;
	if (!Array.isArray(content)) return "";
	return content
		.map((c) => {
			const block = record(c);
			return block.type === "text" && typeof block.text === "string" ? block.text : "";
		})
		.join("");
}

export function lineCount(text: string): number {
	if (!text) return 0;
	return text.replace(/\n$/, "").split("\n").length;
}

/** The last `max` lines of a tool output, for the expanded tool row. */
export function tailLines(text: string, max: number): string {
	const lines = text.replace(/\s+$/, "").split("\n");
	if (lines.length <= max) return lines.join("\n");
	return ["…", ...lines.slice(-max)].join("\n");
}
