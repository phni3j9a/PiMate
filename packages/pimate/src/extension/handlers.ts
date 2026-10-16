import { getSupportedThinkingLevels } from "@earendil-works/pi-ai/compat";
import {
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
	resolveModelScopeWithDiagnostics,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { ModelRef } from "@pimate/protocol";
import type { Handlers } from "./dispatch.ts";
import { RcError } from "./dispatch.ts";
import type { Hub } from "./hub.ts";
import { rpc } from "./subagents/registry.ts";
import { normalizeBranch } from "./transcript.ts";
import { normalizeTree } from "./tree.ts";

const ref = (m: ModelRef): ModelRef => ({ provider: m.provider, id: m.id });

/**
 * Pi's scoped models. The live session set (`--models`, unsaved `/scoped-models`) wins unless `enabledModels` on
 * disk changed since this Pi loaded it (saved from the phone or another Pi): a running Pi does not reload it.
 */
async function scopedModels(pi: ExtensionAPI, ctx: ExtensionContext): Promise<ModelRef[]> {
	const disk = SettingsManager.create(ctx.cwd, getAgentDir()).getEnabledModels();
	if (JSON.stringify(disk ?? []) === JSON.stringify(pi.getSettings().enabledModels ?? []))
		return ctx.scopedModels.map((s) => ref(s.model));
	if (!disk?.length) return [];
	// shortcut: duck-typed ModelRuntime (the resolver only calls getAvailable); use resolveModelScopeFromModels if Pi exports it.
	const runtime = { getAvailable: async () => ctx.modelRegistry.getAvailable() };
	const { scopedModels } = await resolveModelScopeWithDiagnostics(disk, runtime as never);
	return scopedModels.map((s) => ref(s.model));
}

export function createHandlers(h: Hub): Handlers {
	const ready = () => {
		if (!h.pi || !h.ctx?.hasUI) throw new RcError("not_ready");
		return { pi: h.pi, ctx: h.ctx };
	};
	return {
		hello: () => ({ snapshot: h.snapshot() }),
		history: () => ({ session: h.session, items: normalizeBranch(ready().ctx.sessionManager.getBranch()) }),
		session_tree: () => normalizeTree(ready().ctx.sessionManager),
		set_label: (p) => {
			const { pi, ctx } = ready();
			if (!ctx.sessionManager.getEntry(p.entryId)) throw new RcError("not_found", "ラベルの対象が見つかりません");
			pi.setLabel(p.entryId, p.label?.trim() || undefined);
			return {};
		},
		prompt: (p) => {
			if (/^\s*\/pimate(?::\S*)?(?:\s|$)/i.test(p.text)) throw new RcError("unsupported", "/pimate is PC TUI only");
			// Pi exposes duplicate command names as `/pimate:1`, `/pimate:2`; those are rejected above too.
			const { pi, ctx } = ready();
			if (p.images?.length && !ctx.model?.input.includes("image"))
				throw new RcError("unsupported", "このモデルは画像を扱えません。画像対応モデルを選んでください");
			const content = p.images?.length
				? [
						...(p.text ? [{ type: "text" as const, text: p.text }] : []),
						...p.images.map(({ mimeType, data }) => ({ type: "image" as const, mimeType, data })),
					]
				: p.text;
			const deliverAs = p.deliverAs ?? (ctx.isIdle() ? undefined : "followUp");
			pi.sendUserMessage(content, {
				...(deliverAs ? { deliverAs } : {}),
				expandPromptTemplates: p.expandTemplates ?? false,
			});
			return { deliveredAs: deliverAs ?? "prompt" };
		},
		abort: () => {
			const { ctx } = ready();
			ctx.abort();
			return {};
		},
		ui_respond: (p) => {
			ready();
			const pending = h.pendingUI.get(p.requestId);
			if (!pending) throw new RcError("no_such_request");
			if (!p.cancelled) {
				if (pending.request.kind === "confirm" ? typeof p.confirmed !== "boolean" : typeof p.value !== "string")
					throw new RcError("bad_request", "Answer does not match dialog kind");
				if (pending.request.kind === "select" && !pending.request.options?.includes(p.value!))
					throw new RcError("bad_request", "Unknown option");
			}
			pending.resolve(p);
			return {};
		},
		set_thinking: (p) => {
			const { pi } = ready();
			pi.setThinkingLevel(p.level);
			return { thinking: pi.getThinkingLevel() };
		},
		set_model: async (p) => {
			const { pi, ctx } = ready();
			const model = ctx.modelRegistry.find(p.provider, p.id);
			if (!model) throw new RcError("not_found", "Model not found");
			if (!(await pi.setModel(model)))
				throw new RcError("unsupported", "Model could not be selected (check credentials)");
			return { model: { provider: model.provider, id: model.id } };
		},
		compact: (p) => {
			ready().ctx.compact({
				customInstructions: p.instructions,
				onComplete: () => h.emit({ type: "compact_done" }),
				onError: (e) => h.emit({ type: "compact_error", error: e.message }),
			});
			return {};
		},
		session_op: (p) => {
			const { pi, ctx } = ready();
			if (!ctx.isIdle() || h.treeNavigating) throw new RcError("busy");
			if (p.op === "tree") {
				if (!ctx.sessionManager.getEntry(p.arg!)) throw new RcError("not_found", "移動先が見つかりません");
				h.treeNavigating = true;
			}
			try {
				const command = p.op === "tree" ? { ...p, expectSessionId: ctx.sessionManager.getSessionId() } : p;
				pi.sendUserMessage(`/pimate-session ${JSON.stringify(command)}`, { expandPromptTemplates: true });
			} catch (error) {
				h.treeNavigating = false;
				throw error;
			}
			return {};
		},
		models: async () => {
			const { pi, ctx } = ready();
			return {
				scoped: await scopedModels(pi, ctx),
				models: ctx.modelRegistry.getAvailable().map((model) => ({
					provider: model.provider,
					id: model.id,
					name: model.name,
					contextWindow: model.contextWindow,
					thinkingLevels: getSupportedThinkingLevels(model),
				})),
				current: ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : null,
			};
		},
		set_scoped_models: async (p) => {
			const { pi, ctx } = ready();
			const available = ctx.modelRegistry.getAvailable().map((m) => `${m.provider}/${m.id}`);
			const ids = [...new Set(p.models.map((m) => `${m.provider}/${m.id}`))];
			if (ids.some((id) => !available.includes(id))) throw new RcError("not_found", "Model not found");
			// Same as Pi's /scoped-models: all models enabled is saved as no filter.
			const all = available.every((id) => ids.includes(id));
			const settings = SettingsManager.create(ctx.cwd, getAgentDir());
			settings.setEnabledModels(ids.length && !all ? ids : undefined);
			await settings.flush();
			return { scoped: await scopedModels(pi, ctx) };
		},
		sessions: async (p) => {
			const { ctx } = ready();
			const sessions = await SessionManager.list(ctx.cwd, ctx.sessionManager.getSessionDir());
			return {
				sessions: sessions
					.sort((a, b) => b.modified.getTime() - a.modified.getTime())
					.slice(0, p.limit)
					.map((s) => ({
						id: s.id,
						path: s.path,
						name: s.name,
						firstMessage: s.firstMessage,
						messageCount: s.messageCount,
						created: s.created.getTime(),
						modified: s.modified.getTime(),
						current: s.id === ctx.sessionManager.getSessionId(),
					})),
			};
		},
		shutdown: () => {
			ready().ctx.shutdown();
			return {};
		},
		commands: () => ({
			commands: ready()
				.pi.getCommands()
				.map((c) => ({ name: c.name, description: c.description, source: c.source })),
		}),
		subagent_transcript: (p) => {
			ready();
			if (!h.subagents) throw new RcError("not_ready");
			return h.subagents.transcript(p);
		},
		subagent_control: (p) => {
			ready();
			if (!h.subagents) throw new RcError("not_ready");
			return h.subagents.control(p);
		},
		subagents_rpc: async (p) => ({ reply: await rpc(ready().pi, p.method, p.params ?? {}, p.timeoutMs) }),
	};
}
