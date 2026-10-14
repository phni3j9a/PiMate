import { randomUUID } from "node:crypto";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai/compat";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { Handlers } from "./dispatch.ts";
import { RcError } from "./dispatch.ts";
import type { Hub } from "./hub.ts";
import { normalizeBranch } from "./transcript.ts";

export function createHandlers(h: Hub): Handlers {
	const ready = () => {
		if (!h.pi || !h.ctx?.hasUI) throw new RcError("not_ready");
		return { pi: h.pi, ctx: h.ctx };
	};
	return {
		hello: () => ({ snapshot: h.snapshot() }),
		history: () => ({ session: h.session, items: normalizeBranch(ready().ctx.sessionManager.getBranch()) }),
		prompt: (p) => {
			const { pi, ctx } = ready();
			const deliverAs = p.deliverAs ?? (ctx.isIdle() ? undefined : "followUp");
			pi.sendUserMessage(p.text, {
				...(deliverAs ? { deliverAs } : {}),
				expandPromptTemplates: p.expandTemplates ?? false,
			});
			return { deliveredAs: deliverAs ?? "prompt" };
		},
		abort: () => {
			const { ctx } = ready();
			h.abortRequested = !ctx.isIdle();
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
			if (!ctx.isIdle()) throw new RcError("busy");
			pi.sendUserMessage(`/pimate-session ${JSON.stringify(p)}`, { expandPromptTemplates: true });
			return {};
		},
		models: () => {
			const { ctx } = ready();
			return {
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
		subagents_rpc: (p) => {
			const { pi } = ready();
			const requestId = randomUUID();
			return new Promise((resolve, reject) => {
				const timer = setTimeout(() => {
					off();
					reject(new RcError("timeout", "pi-subagents RPC timed out"));
				}, p.timeoutMs ?? 15000);
				const off = pi.events.on(`subagents:rpc:v1:reply:${requestId}`, (reply) => {
					clearTimeout(timer);
					off();
					resolve({ reply });
				});
				try {
					pi.events.emit("subagents:rpc:v1:request", {
						version: 1,
						requestId,
						method: p.method,
						params: p.params ?? {},
					});
				} catch (e) {
					clearTimeout(timer);
					off();
					reject(e);
				}
			});
		},
	};
}
