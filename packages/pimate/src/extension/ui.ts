import { randomUUID } from "node:crypto";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { InstanceEvent, InstanceStatus, ParamsOf, UIRequest } from "@pimate/protocol";

export interface PendingUI {
	request: UIRequest;
	resolve: (answer: ParamsOf<"ui_respond">) => void;
	cancel: () => void;
}
export interface UIState {
	pendingUI: Map<string, PendingUI>;
	emit: (event: InstanceEvent) => void;
	setStatus: (status: InstanceStatus) => void;
	isIdle: () => boolean;
}
/** One completion path also handles synchronous throws and already-aborted callers. */
export function raceUI<T>(
	state: UIState,
	info: Omit<UIRequest, "requestId">,
	local: (signal: AbortSignal) => Promise<T>,
	remote: (answer: ParamsOf<"ui_respond">) => T,
	signal?: AbortSignal,
): Promise<T> {
	const request = { ...info, requestId: randomUUID() };
	const controller = new AbortController();
	return new Promise<T>((resolve, reject) => {
		let done = false;
		const finish = (by: "remote" | "tui" | "error", value?: T, error?: unknown) => {
			if (done) return;
			done = true;
			signal?.removeEventListener("abort", cancel);
			state.pendingUI.delete(request.requestId);
			controller.abort();
			state.emit({ type: "ui_request_end", requestId: request.requestId, by });
			if (!state.pendingUI.size) state.setStatus(state.isIdle() ? "idle" : "running");
			if (by === "error") reject(error);
			else resolve(value as T);
		};
		const answer = (r: ParamsOf<"ui_respond">, by: "remote" | "tui") => {
			try {
				finish(by, remote(r));
			} catch (e) {
				finish("error", undefined, e);
			}
		};
		const cancel = () => answer({ requestId: request.requestId, cancelled: true }, "tui");
		state.pendingUI.set(request.requestId, { request, resolve: (r) => answer(r, "remote"), cancel });
		state.setStatus("waiting_input");
		state.emit({ type: "ui_request", request });
		signal?.addEventListener("abort", cancel, { once: true });
		if (signal?.aborted) {
			cancel();
			return;
		}
		try {
			local(controller.signal).then(
				(v) => finish("tui", v),
				(e) => finish("error", undefined, e),
			);
		} catch (e) {
			finish("error", undefined, e);
		}
	});
}
const patched = Symbol.for("pimate.ui.patched");
export function patchUI(ctx: ExtensionContext, state: UIState): void {
	const ui = ctx.ui as ExtensionContext["ui"] & { [patched]?: boolean };
	if (ui[patched]) return;
	const { select, confirm, input, editor, notify } = ui;
	ui.select = (title, options, opts) =>
		raceUI(
			state,
			{ kind: "select", title, options },
			(signal) => select(title, options, { ...opts, signal }),
			(r) => (r.cancelled ? undefined : r.value),
			opts?.signal,
		);
	ui.confirm = (title, message, opts) =>
		raceUI(
			state,
			{ kind: "confirm", title, message },
			(signal) => confirm(title, message, { ...opts, signal }),
			(r) => !r.cancelled && !!r.confirmed,
			opts?.signal,
		);
	ui.input = (title, placeholder, opts) =>
		raceUI(
			state,
			{ kind: "input", title, placeholder },
			(signal) => input(title, placeholder, { ...opts, signal }),
			(r) => (r.cancelled ? undefined : r.value),
			opts?.signal,
		);
	// Pi's editor has no AbortSignal: the PC editor can remain open after a remote answer.
	ui.editor = (title, prefill) =>
		raceUI(
			state,
			{ kind: "editor", title, message: prefill, tuiStaysOpen: true },
			() => editor(title, prefill),
			(r) => (r.cancelled ? undefined : r.value),
		);
	ui.notify = (message, level) => {
		state.emit({ type: "notify", message, level: level ?? "info" });
		notify(message, level);
	};
	ui[patched] = true;
}
