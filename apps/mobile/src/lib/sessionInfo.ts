/** Session and model presentation helpers for the sheets and the composer (pure, no React Native imports). */
import type { ContextInfo, ModelInfo, ModelRef, ThinkingLevel, TranscriptItem } from "@pimate/protocol";
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
