import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ParamsOf } from "@pimate/protocol";
import { validateRequest } from "./dispatch.ts";
import { createHandlers } from "./handlers.ts";
import { getHub } from "./hub.ts";
import { SubagentRegistry } from "./subagents/registry.ts";
import { findMessageEntry, normalizeMessage } from "./transcript.ts";
import { patchUI } from "./ui.ts";
import { registerWriteDiff } from "./write-diff.ts";

export default function pimate(pi: ExtensionAPI): void {
	const h = getHub();
	// Pi recreates extension runtimes on /new, /resume and /reload. The process hub survives,
	// but old bus and lifecycle subscriptions must not.
	for (const off of h.subscriptions) off();
	h.subagents?.dispose();
	h.subscriptions = registerWriteDiff(pi);
	h.handlers = createHandlers(h);
	if (h.trust) h.subscriptions.push(pi.on("project_trust", () => ({ trusted: h.trust! })));
	const rebuildSubagents = (ctx: ExtensionContext) => {
		h.subagents?.dispose();
		h.subagents = new SubagentRegistry(h);
		h.writeMeta();
		void h.subagents.start(ctx.sessionManager.getBranch());
	};
	const messages: { message: unknown; ctx: ExtensionContext; sessionId: string }[] = [];
	const flushMessages = () => {
		for (const { message, ctx, sessionId } of messages.splice(0)) {
			if (h.session?.id !== sessionId) continue;
			const entry = findMessageEntry(ctx.sessionManager.getBranch(), message);
			const item = normalizeMessage(message, entry?.id ?? `live-${randomUUID()}`);
			if (item) h.emit({ type: "message_end", item });
			if (item?.kind === "assistant") h.emitContext();
		}
	};
	h.subscriptions.push(
		pi.on("session_start", async (event, ctx) => {
			if (!ctx.hasUI) return;
			// The previous ctx is already disposed here; replace it before anything can emit.
			h.pi = pi;
			h.pcPrompt = null;
			// An earlier extension's session_start may already have started a run (agent_start seen before ours).
			h.agentActive = !ctx.isIdle();
			h.ctx = ctx;
			for (const pending of h.pendingUI.values()) pending.cancel();
			h.session = {
				id: ctx.sessionManager.getSessionId(),
				file: ctx.sessionManager.getSessionFile(),
				name: ctx.sessionManager.getSessionName(),
			};
			await h.start();
			patchUI(ctx, h);
			if (h.abducoSession) {
				ctx.ui.setWidget("pimate-redraw", (tui) => {
					h.tui = tui;
					return { render: () => [], invalidate() {} };
				});
				if (!h.winchInstalled) {
					h.winchInstalled = true;
					process.on("SIGWINCH", () => {
						setTimeout(() => h.tui?.requestRender(true), 50).unref();
					});
				}
			}
			h.status = ctx.isIdle() ? "idle" : "running";
			h.writeMeta();
			h.emit({ type: "session_changed", reason: event.reason, session: h.session });
			h.emitContext();
			rebuildSubagents(ctx);
		}),
	);
	pi.registerCommand("pimate-session", {
		description: "PiMate internal session operation",
		handler: async (args, ctx) => {
			let p: ParamsOf<"session_op">;
			try {
				p = validateRequest({ id: "internal", method: "session_op", params: JSON.parse(args) })
					.params as ParamsOf<"session_op">;
			} catch {
				ctx.ui.notify("Invalid PiMate session operation", "error");
				return;
			}
			try {
				let r: { cancelled: boolean } | undefined;
				if (p.op === "new") r = await ctx.newSession();
				else if (p.op === "switch") r = await ctx.switchSession(p.arg!);
				else if (p.op === "fork") r = await ctx.fork(p.arg!);
				else await ctx.reload();
				h.emit({ type: "session_op_done", op: p.op, cancelled: r?.cancelled ?? false });
			} catch (e) {
				h.emit({ type: "session_op_done", op: p.op, cancelled: true, error: String(e) });
			}
		},
	});
	h.subscriptions.push(
		pi.on("session_tree", (_event, ctx) => {
			if (!ctx.hasUI) return;
			h.ctx = ctx;
			rebuildSubagents(ctx);
		}),
		pi.on("session_shutdown", (e) => {
			h.subagents?.dispose();
			if (e.reason === "quit" && h.ctx?.hasUI) h.stop();
		}),
		pi.on("session_info_changed", (e) => {
			if (h.session) h.session.name = e.name;
			h.writeMeta();
			h.emit({ type: "session_info", name: e.name });
		}),
		pi.on("agent_start", () => {
			h.agentActive = true;
			h.setStatus(h.pendingUI.size ? "waiting_input" : "running");
			h.emit({ type: "agent_start" });
		}),
		pi.on("agent_settled", (e) => {
			h.agentActive = false;
			flushMessages();
			h.setStatus(h.pendingUI.size ? "waiting_input" : "idle");
			h.emit({ type: "agent_settled", aborted: e.aborted });
		}),
		pi.on("input", (e) => {
			h.emit({ type: "user_input", text: e.text, source: e.source });
		}),
		pi.on("message_start", (e) => {
			flushMessages();
			if (e.message.role === "assistant") h.streaming = { text: "", thinking: "" };
		}),
		pi.on("message_update", (e) => {
			const a = e.assistantMessageEvent;
			if (a.type === "text_delta" || a.type === "thinking_delta") h.emit({ type: a.type, delta: a.delta });
		}),
		pi.on("message_end", (e, ctx) => {
			// Pi emits this hook BEFORE persisting the message. Wait until the
			// current event finishes so live/history share the persisted entryId.
			messages.push({ message: e.message, ctx, sessionId: ctx.sessionManager.getSessionId() });
			setImmediate(flushMessages).unref();
		}),
		pi.on("turn_end", flushMessages),
		pi.on("tool_execution_start", (e) => {
			h.subagents?.toolStart(e.toolCallId);
			flushMessages();
			h.emit({
				type: "tool_start",
				toolCallId: e.toolCallId,
				toolName: e.toolName,
				args: e.args,
				parentToolCallId: e.parentToolCallId,
			});
		}),
		pi.on("tool_execution_update", (e) => {
			h.subagents?.tool(e.toolCallId, e.partialResult.details, true);
			h.emit({ type: "tool_update", toolCallId: e.toolCallId, toolName: e.toolName, partial: e.partialResult });
		}),
		pi.on("tool_execution_end", (e) => {
			h.subagents?.tool(e.toolCallId, e.result.details, false, e.isError);
			h.emit({
				type: "tool_end",
				toolCallId: e.toolCallId,
				toolName: e.toolName,
				isError: e.isError,
				durationMs: e.durationMs,
			});
		}),
		pi.on("session_compact", () => h.emitContext()),
		pi.on("model_select", (e) => {
			h.emit({ type: "model", model: { provider: e.model.provider, id: e.model.id } });
			h.emitContext();
		}),
		pi.on("thinking_level_select", (e) => {
			h.emit({ type: "thinking", level: e.level });
		}),
		pi.on("ui_prompt_start", (e) => {
			if (![...h.pendingUI.values()].some((p) => p.request.kind === e.kind && p.request.title === e.title))
				h.pcPrompt = { kind: e.kind, title: e.title };
			h.emit({ type: "ui_prompt", phase: "start", kind: e.kind, title: e.title });
		}),
		pi.on("ui_prompt_end", (e) => {
			if (h.pcPrompt?.kind === e.kind) h.pcPrompt = null;
			h.emit({ type: "ui_prompt", phase: "end", kind: e.kind, title: e.title });
		}),
	);
	h.subscriptions.push(
		pi.events.on("subagents:rpc:v1:ready", (data) => h.subagents?.bus("subagents:rpc:v1:ready", data)),
	);
	for (const channel of [
		"subagent:async-started",
		"subagent:async-complete",
		"subagent:process-terminal",
		"subagent:foreground-complete",
		"subagent:control-event",
		"subagent:control-intercom",
		"subagent:steering-notice",
		"subagent:child-status",
		"subagent:result-intercom",
	]) {
		h.subscriptions.push(
			pi.events.on(channel, (data) => {
				h.emit({ type: "bus", channel, data });
				h.subagents?.bus(channel, data);
			}),
		);
	}
}
