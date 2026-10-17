/** Session and model presentation helpers for the sheets and the composer (pure, no React Native imports). */
import type {
	ContextInfo,
	ModelInfo,
	ModelRef,
	SubscriptionQuota,
	ThinkingLevel,
	TranscriptItem,
} from "@pimate/protocol";
import { tokens } from "./format";

export interface SessionStats {
	messages: number;
	tokens: number;
	cost: number;
}

/** Totals over the transcript the phone has (user + assistant messages, assistant usage). */
export function sessionStats(items: readonly TranscriptItem[]): SessionStats {
	let messages = 0;
	let total = 0;
	let cost = 0;
	for (const item of items) {
		if (item.kind === "user") messages++;
		else if (item.kind === "assistant") {
			messages++;
			const u = item.usage;
			if (u) {
				total += u.input + u.output + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
				cost += u.cost ?? 0;
			}
		}
	}
	return { messages, tokens: total, cost };
}

export function formatCost(cost: number): string {
	return `$${cost < 0.01 && cost > 0 ? cost.toFixed(3) : cost.toFixed(2)}`;
}

export const findModel = (models: readonly ModelInfo[] | null | undefined, ref: ModelRef | null | undefined) =>
	ref ? models?.find((m) => m.provider === ref.provider && m.id === ref.id) : undefined;

/** "Claude Opus 5.5" -> "Opus 5.5" (the composer label is short; the sheet shows the full name). */
export function shortModelName(name: string): string {
	return name.replace(/^Claude\s+/i, "").trim() || name;
}

const THINKING_SHORT: Partial<Record<ThinkingLevel, string>> = { minimal: "min", medium: "med" };
export const thinkingShort = (level: ThinkingLevel) => THINKING_SHORT[level] ?? level;

/** Composer label: "Opus 5.5 · high". Thinking is left out when off or when the model has no levels. */
export function modelLabel(
	ref: ModelRef | null,
	thinking: ThinkingLevel | null,
	models: readonly ModelInfo[] | null | undefined,
): string | null {
	if (!ref) return null;
	const info = findModel(models, ref);
	const name = info ? shortModelName(info.name) : ref.id;
	const levels = info?.thinkingLevels;
	const showThinking = thinking && thinking !== "off" && (!levels || levels.length > 1);
	return showThinking ? `${name} · ${thinking}` : name;
}

export type ModelScope = "favorites" | "all";
const sameModel = (a: ModelRef, b: ModelRef) => a.provider === b.provider && a.id === b.id;
export const isFavorite = (scoped: readonly ModelRef[] | undefined, m: ModelRef) =>
	!!scoped?.some((s) => sameModel(s, m));

/** Like Pi's /model: the favorites (scoped models) first when there are any, else all models. */
export const defaultScope = (scoped: readonly ModelRef[] | undefined): ModelScope =>
	scoped?.length ? "favorites" : "all";

export function scopeModels(models: readonly ModelInfo[], scoped: readonly ModelRef[] | undefined, scope: ModelScope) {
	return scope === "all" ? models : models.filter((m) => isFavorite(scoped, m));
}

/** Favorites after starring / unstarring `m`, keeping Pi's order (Ctrl+P cycles in this order). */
export function toggleFavorite(scoped: readonly ModelRef[] | undefined, m: ModelRef): ModelRef[] {
	const base = scoped ?? [];
	return isFavorite(base, m) ? base.filter((s) => !sameModel(s, m)) : [...base, { provider: m.provider, id: m.id }];
}

/** Models grouped by provider, keeping the RC order inside each group; `query` filters name / id / provider. */
export function groupModels(models: readonly ModelInfo[], query = ""): { provider: string; models: ModelInfo[] }[] {
	const q = query.trim().toLowerCase();
	const groups = new Map<string, ModelInfo[]>();
	for (const m of models) {
		if (q && !`${m.provider}/${m.id} ${m.name}`.toLowerCase().includes(q)) continue;
		const list = groups.get(m.provider) ?? [];
		list.push(m);
		groups.set(m.provider, list);
	}
	return [...groups].map(([provider, list]) => ({ provider, models: list }));
}

const PROVIDER_NAMES: Record<string, string> = {
	anthropic: "Anthropic",
	openai: "OpenAI",
	google: "Google",
	"openai-codex": "OpenAI Codex",
	openrouter: "OpenRouter",
	xai: "xAI",
	mistral: "Mistral",
	groq: "Groq",
};
export const providerName = (provider: string) => PROVIDER_NAMES[provider] ?? provider;

/** "82K / 200K · 41%"; null when Pi does not know the usage yet. */
export function contextLine(context: ContextInfo | null): string | null {
	if (!context) return null;
	const window = tokens(context.contextWindow).toUpperCase();
	if (context.tokens === null) return `? / ${window}`;
	const pct = context.percent === null ? "" : ` · ${Math.round(context.percent)}%`;
	return `${tokens(context.tokens).toUpperCase()} / ${window}${pct}`;
}

const QUOTA_NAMES: Record<SubscriptionQuota["source"], string> = { codex: "Codex", claude: "Claude" };

/** 300 -> 5時間, 10080 -> 週間. */
export function quotaWindowLabel(minutes: number): string {
	if (minutes === 7 * 24 * 60) return "週間";
	if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)}日`;
	if (minutes % 60 === 0) return `${minutes / 60}時間`;
	return `${minutes}分`;
}

const pad = (n: number) => String(n).padStart(2, "0");
/** "14:05" today, otherwise "10/24 10:53" (phone's time zone). */
export function clockTime(at: number, now: number): string {
	const d = new Date(at);
	const time = `${d.getHours()}:${pad(d.getMinutes())}`;
	return d.toDateString() === new Date(now).toDateString() ? time : `${d.getMonth() + 1}/${d.getDate()} ${time}`;
}

export interface QuotaGroup {
	source: SubscriptionQuota["source"];
	name: string;
	observed: string;
	/** `percent` is null once the reset time has passed: the old figure no longer applies. */
	windows: { key: string; label: string; percent: number | null; reset: string }[];
}

export function quotaGroups(quotas: readonly SubscriptionQuota[], now: number): QuotaGroup[] {
	return [...quotas]
		.sort((a, b) => a.source.localeCompare(b.source))
		.map((q) => ({
			source: q.source,
			name: QUOTA_NAMES[q.source] ?? q.source,
			observed: `${clockTime(q.observedAt, now)} 取得`,
			windows: q.windows.map((w) => {
				const passed = w.resetsAt !== undefined && w.resetsAt <= now;
				return {
					key: `${w.minutes}`,
					label: quotaWindowLabel(w.minutes),
					percent: passed ? null : Math.round(w.usedPercent),
					reset:
						w.resetsAt === undefined
							? "リセット日時不明"
							: passed
								? "リセット済み・次の応答で更新"
								: `${clockTime(w.resetsAt, now)} にリセット`,
				};
			}),
		}));
}
