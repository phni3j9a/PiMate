/**
 * PiMate PoC — Remote Control Extension
 *
 * 通常のPi TUI内で動き、Unixソケット経由でイベント配信と操作受付を行う最小実装。
 * 検証用であり、本実装ではない（認証なし・ローカルUnixソケットのみ、0600）。
 *
 * - 発見: $PIMATE_RUN_DIR (既定 $XDG_RUNTIME_DIR/pimate または /tmp/pimate-<uid>) に
 *   <instanceId>.json と <instanceId>.sock を置く。
 * - プロトコル: 改行区切りJSON。クライアント→ {id, cmd, ...} / サーバ→ {type:"response"|"event", ...}
 * - Piの /new /resume /reload ではextension runtimeが作り直されるため、
 *   ソケットとインスタンスIDは globalThis に保持し、現在の pi/ctx だけ差し替える。
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

type Json = Record<string, unknown>;

interface PendingUI {
	requestId: string;
	kind: "select" | "confirm" | "input" | "editor";
	title: string;
	message?: string;
	options?: string[];
	placeholder?: string;
	resolve: (v: { value?: string; confirmed?: boolean; cancelled?: boolean }) => void;
}

interface Hub {
	instanceId: string;
	startedAt: number;
	server?: net.Server;
	sockPath: string;
	metaPath: string;
	clients: Set<net.Socket>;
	pi?: ExtensionAPI;
	ctx?: ExtensionContext;
	session?: { id: string; file?: string; name?: string };
	status: "idle" | "running" | "waiting_input";
	pendingUI: Map<string, PendingUI>;
	patchedUI?: object;
	seq: number;
}

const G = globalThis as unknown as { __pimateHub?: Hub };

function runDir(): string {
	if (process.env.PIMATE_RUN_DIR) return process.env.PIMATE_RUN_DIR;
	if (process.env.XDG_RUNTIME_DIR) return path.join(process.env.XDG_RUNTIME_DIR, "pimate");
	return path.join(os.tmpdir(), `pimate-${process.getuid?.() ?? "u"}`);
}

function hub(): Hub {
	if (G.__pimateHub) return G.__pimateHub;
	const instanceId = process.env.PIMATE_INSTANCE_ID || randomUUID();
	const dir = runDir();
	G.__pimateHub = {
		instanceId,
		startedAt: Date.now(),
		sockPath: path.join(dir, `${instanceId}.sock`),
		metaPath: path.join(dir, `${instanceId}.json`),
		clients: new Set(),
		status: "idle",
		pendingUI: new Map(),
		seq: 0,
	};
	return G.__pimateHub;
}

function send(sock: net.Socket, msg: Json) {
	if (!sock.destroyed) sock.write(JSON.stringify(msg) + "\n");
}

function broadcast(event: Json) {
	const h = hub();
	const msg = { type: "event", seq: ++h.seq, instanceId: h.instanceId, sessionId: h.session?.id, ...event };
	for (const c of h.clients) send(c, msg);
}

function writeMeta() {
	const h = hub();
	const meta = {
		instanceId: h.instanceId,
		pid: process.pid,
		cwd: h.ctx?.cwd ?? process.cwd(),
		socket: h.sockPath,
		origin: process.env.PIMATE_ORIGIN ?? "pc", // "pc" | "mobile"
		abducoSession: process.env.PIMATE_ABDUCO_SESSION ?? null,
		startedAt: h.startedAt,
		session: h.session ?? null,
		status: h.status,
		protocol: 0,
	};
	const tmp = `${h.metaPath}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(meta, null, 2), { mode: 0o600 });
	fs.renameSync(tmp, h.metaPath);
}

function setStatus(s: Hub["status"]) {
	const h = hub();
	if (h.status === s) return;
	h.status = s;
	writeMeta();
	broadcast({ event: "status", status: s });
}

function snapshot(): Json {
	const h = hub();
	const ctx = h.ctx;
	let model: unknown = null;
	let thinking: unknown = null;
	try {
		model = ctx?.model ? { provider: ctx.model.provider, id: ctx.model.id } : null;
		thinking = h.pi?.getThinkingLevel();
	} catch {}
	return {
		instanceId: h.instanceId,
		pid: process.pid,
		cwd: ctx?.cwd,
		session: h.session,
		status: h.status,
		model,
		thinking,
		pendingUI: [...h.pendingUI.values()].map(({ resolve, ...rest }) => rest),
	};
}

/** 現在ブランチの会話をアプリ表示用に簡略化して返す（PoC用の粗い変換） */
function history(): Json[] {
	const ctx = hub().ctx;
	if (!ctx) return [];
	const out: Json[] = [];
	for (const e of ctx.sessionManager.getBranch() as any[]) {
		if (e.type !== "message") continue;
		const m = e.message;
		const text = Array.isArray(m.content)
			? m.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("")
			: typeof m.content === "string" ? m.content : "";
		const tools = Array.isArray(m.content) ? m.content.filter((c: any) => c.type === "toolCall").map((c: any) => c.name) : [];
		out.push({ entryId: e.id, role: m.role, text, tools, toolName: m.toolName });
	}
	return out;
}

/**
 * ctx.ui のダイアログをラップし、TUIとリモートの両方に出して先に答えた方を採用する。
 * runnerのuiContextは全Extensionで共有される1オブジェクトなので、ここを差し替えると
 * 他Extensionからの select/confirm/input/editor もリモートに届く。
 */
function patchUI(ctx: ExtensionContext) {
	const h = hub();
	const ui = ctx.ui as any;
	if (!ui || h.patchedUI === ui || ui.__pimatePatched) return;
	const orig = { select: ui.select, confirm: ui.confirm, input: ui.input, editor: ui.editor };

	const race = <T>(
		kind: PendingUI["kind"],
		info: Omit<PendingUI, "requestId" | "kind" | "resolve">,
		local: (signal: AbortSignal) => Promise<T>,
		fromRemote: (r: { value?: string; confirmed?: boolean; cancelled?: boolean }) => T,
		outerSignal?: AbortSignal,
	): Promise<T> => {
		const requestId = randomUUID();
		const ac = new AbortController();
		outerSignal?.addEventListener("abort", () => ac.abort(), { once: true });
		return new Promise<T>((resolve, reject) => {
			let done = false;
			const finish = (v: T, by: "tui" | "remote") => {
				if (done) return;
				done = true;
				h.pendingUI.delete(requestId);
				ac.abort();
				broadcast({ event: "ui_request_end", requestId, by });
				if (h.pendingUI.size === 0 && h.status === "waiting_input") setStatus(h.ctx?.isIdle() ? "idle" : "running");
				resolve(v);
			};
			h.pendingUI.set(requestId, { requestId, kind, ...info, resolve: (r) => finish(fromRemote(r), "remote") });
			broadcast({ event: "ui_request", requestId, kind, ...info });
			setStatus("waiting_input");
			local(ac.signal).then(
				(v) => finish(v, "tui"),
				(e) => {
					if (!done) {
						done = true;
						h.pendingUI.delete(requestId);
						reject(e);
					}
				},
			);
		});
	};

	ui.select = (title: string, options: string[], opts?: any) =>
		race("select", { title, options }, (signal) => orig.select(title, options, { ...opts, signal }), (r) => (r.cancelled ? undefined : r.value), opts?.signal);
	ui.confirm = (title: string, message: string, opts?: any) =>
		race("confirm", { title, message }, (signal) => orig.confirm(title, message, { ...opts, signal }), (r) => !r.cancelled && !!r.confirmed, opts?.signal);
	ui.input = (title: string, placeholder?: string, opts?: any) =>
		race("input", { title, placeholder }, (signal) => orig.input(title, placeholder, { ...opts, signal }), (r) => (r.cancelled ? undefined : r.value), opts?.signal);
	// editor() はsignalを受け取らないため、リモート回答時にTUI側を閉じられない（PoCで制限として記録）
	ui.editor = (title: string, prefill?: string) =>
		race("editor", { title, message: prefill }, () => orig.editor(title, prefill), (r) => (r.cancelled ? undefined : r.value));
	const origNotify = ui.notify;
	ui.notify = (message: string, type?: string) => {
		broadcast({ event: "notify", message, level: type ?? "info" });
		return origNotify(message, type);
	};
	ui.__pimatePatched = true;
	h.patchedUI = ui;
}

function handle(sock: net.Socket, req: Json) {
	const h = hub();
	const reply = (ok: boolean, data: Json = {}) => send(sock, { type: "response", id: req.id, ok, ...data });
	const pi = h.pi;
	// 誤送信防止: 送信先のインスタンス・セッションをクライアントが明示し、ずれていたら拒否する
	if (req.expectInstanceId && req.expectInstanceId !== h.instanceId) return reply(false, { error: "instance_mismatch" });
	if (req.expectSessionId && req.expectSessionId !== h.session?.id)
		return reply(false, { error: "session_changed", session: h.session });
	try {
		switch (req.cmd) {
			case "hello":
				return reply(true, { state: snapshot() });
			case "history":
				return reply(true, { session: h.session, messages: history() });
			case "prompt": {
				if (!pi || !h.ctx) return reply(false, { error: "not_ready" });
				const busy = !h.ctx.isIdle();
				const deliverAs = (req.deliverAs as "steer" | "followUp" | undefined) ?? (busy ? "followUp" : undefined);
				// expand=true でExtensionコマンド・スキル・プロンプトテンプレートを展開する（組み込みコマンドは対象外）
				pi.sendUserMessage(String(req.text ?? ""), { ...(deliverAs ? { deliverAs } : {}), ...(req.expand ? { expandPromptTemplates: true } : {}) });
				return reply(true, { deliveredAs: deliverAs ?? "prompt" });
			}
			case "abort":
				h.ctx?.abort();
				return reply(true);
			case "ui_response": {
				const p = h.pendingUI.get(String(req.requestId));
				if (!p) return reply(false, { error: "no_such_request" });
				p.resolve(req as any);
				return reply(true);
			}
			case "set_thinking":
				pi?.setThinkingLevel(req.level as any);
				return reply(true, { thinking: pi?.getThinkingLevel() });
			case "subagents_rpc": {
				// pi-subagentsの同一プロセス内RPC（pi.events）へ中継する。別プロセスからは直接呼べないためRC経由にする。
				if (!pi) return reply(false, { error: "not_ready" });
				const requestId = randomUUID();
				const timer = setTimeout(() => { off?.(); reply(false, { error: "subagents_rpc_timeout" }); }, Number(req.timeoutMs ?? 15000));
				const off = pi.events.on(`subagents:rpc:v1:reply:${requestId}`, (r: unknown) => {
					clearTimeout(timer);
					off?.();
					reply(true, { reply: r as Json });
				});
				pi.events.emit("subagents:rpc:v1:request", { version: 1, requestId, method: req.method, params: req.params ?? {} });
				return;
			}
			case "compact":
				h.ctx?.compact({
					onComplete: () => broadcast({ event: "compact_done" }),
					onError: (e) => broadcast({ event: "compact_error", error: e.message }),
				});
				return reply(true);
			case "session_op": {
				// /new /resume /fork /reload 相当はコマンド用ctxでしか呼べない。
				// RC自身のコマンドを sendUserMessage(expand) で起動し、そのハンドラ内で実行する（トランポリン）。
				if (!pi || !h.ctx) return reply(false, { error: "not_ready" });
				if (!h.ctx.isIdle()) return reply(false, { error: "busy" });
				const op = String(req.op ?? "");
				if (!["new", "switch", "fork", "reload"].includes(op)) return reply(false, { error: "bad_op" });
				pi.sendUserMessage(`/pimate-session ${op} ${String(req.arg ?? "")}`.trim(), { expandPromptTemplates: true });
				return reply(true);
			}
			case "commands":
				return reply(true, { commands: pi?.getCommands().map((c: any) => ({ name: c.name, description: c.description, source: c.source })) });
			default:
				return reply(false, { error: "unknown_cmd" });
		}
	} catch (e) {
		return reply(false, { error: String((e as Error)?.message ?? e) });
	}
}

function ensureServer() {
	const h = hub();
	if (h.server) return;
	fs.mkdirSync(path.dirname(h.sockPath), { recursive: true, mode: 0o700 });
	try {
		fs.unlinkSync(h.sockPath);
	} catch {}
	const server = net.createServer((sock) => {
		h.clients.add(sock);
		let buf = "";
		sock.setEncoding("utf8");
		sock.on("data", (d) => {
			buf += d;
			let i: number;
			while ((i = buf.indexOf("\n")) >= 0) {
				const line = buf.slice(0, i);
				buf = buf.slice(i + 1);
				if (!line.trim()) continue;
				try {
					handle(sock, JSON.parse(line));
				} catch {
					send(sock, { type: "response", ok: false, error: "bad_json" });
				}
			}
		});
		const drop = () => h.clients.delete(sock);
		sock.on("close", drop);
		sock.on("error", drop);
	});
	server.listen(h.sockPath, () => fs.chmodSync(h.sockPath, 0o600));
	server.unref(); // Piの終了を妨げない
	h.server = server;
	const cleanup = () => {
		try { fs.unlinkSync(h.sockPath); } catch {}
		try { fs.unlinkSync(h.metaPath); } catch {}
	};
	process.once("exit", cleanup);
}

function shutdownServer() {
	const h = hub();
	for (const c of h.clients) c.destroy();
	h.clients.clear();
	h.server?.close();
	h.server = undefined;
	try { fs.unlinkSync(h.sockPath); } catch {}
	try { fs.unlinkSync(h.metaPath); } catch {}
}

/**
 * abducoは再Attach時にSIGWINCHを送るが、端末サイズが前回と同じだとPi TUIは差分描画のため
 * 何も再描画せず画面が空白になる。空のwidget経由でTUIを取得し、SIGWINCHで強制再描画する。
 */
function installRedrawOnAttach(ctx: ExtensionContext) {
	if (!process.env.PIMATE_ABDUCO_SESSION || !ctx.hasUI) return;
	const g = globalThis as unknown as { __pimateTui?: { requestRender(force?: boolean): void }; __pimateWinch?: boolean };
	ctx.ui.setWidget("pimate-redraw", (tui) => {
		g.__pimateTui = tui;
		return { render: () => [], invalidate() {} };
	});
	if (g.__pimateWinch) return;
	g.__pimateWinch = true;
	process.on("SIGWINCH", () => setTimeout(() => g.__pimateTui?.requestRender(true), 50));
}

export default function (pi: ExtensionAPI) {
	const h = hub();

	pi.on("session_start", (event, ctx) => {
		h.pi = pi;
		h.ctx = ctx;
		h.session = {
			id: ctx.sessionManager.getSessionId(),
			file: ctx.sessionManager.getSessionFile(),
			name: ctx.sessionManager.getSessionName?.(),
		};
		ensureServer();
		patchUI(ctx);
		installRedrawOnAttach(ctx);
		h.status = ctx.isIdle() ? "idle" : "running";
		writeMeta();
		broadcast({ event: "session_changed", reason: event.reason, session: h.session });
	});

	pi.registerCommand("pimate-session", {
		description: "PiMate internal: session operation requested from the phone",
		handler: async (args, ctx) => {
			const [op, ...rest] = args.trim().split(/\s+/);
			const arg = rest.join(" ");
			let r: { cancelled: boolean } | undefined;
			if (op === "new") r = await ctx.newSession();
			else if (op === "switch") r = await ctx.switchSession(arg);
			else if (op === "fork") r = await ctx.fork(arg);
			else if (op === "reload") await ctx.reload();
			broadcast({ event: "session_op_done", op, cancelled: r?.cancelled ?? false });
		},
	});

	pi.on("session_shutdown", (event) => {
		if (event.reason === "quit") shutdownServer();
	});
	pi.on("session_info_changed", (event) => {
		if (h.session) h.session.name = event.name;
		writeMeta();
		broadcast({ event: "session_info", name: event.name });
	});

	pi.on("agent_start", () => setStatus("running"));
	pi.on("agent_settled", (e) => {
		setStatus(h.pendingUI.size ? "waiting_input" : "idle");
		broadcast({ event: "agent_settled", aborted: e.aborted });
	});
	pi.on("input", (e) => {
		broadcast({ event: "user_input", text: e.text, source: e.source });
	});
	pi.on("message_update", (e) => {
		const a = e.assistantMessageEvent as any;
		if (a.type === "text_delta" || a.type === "thinking_delta") broadcast({ event: a.type, delta: a.delta });
	});
	pi.on("message_end", (e) => {
		const m = e.message as any;
		const text = Array.isArray(m.content) ? m.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("") : "";
		broadcast({ event: "message_end", role: m.role, text });
	});
	pi.on("tool_execution_start", (e) => broadcast({ event: "tool_start", toolCallId: e.toolCallId, toolName: e.toolName, args: e.args, parent: e.parentToolCallId }));
	pi.on("tool_execution_update", (e) => broadcast({ event: "tool_update", toolCallId: e.toolCallId, toolName: e.toolName, details: (e.partialResult as any)?.details }));
	pi.on("tool_execution_end", (e) => broadcast({ event: "tool_end", toolCallId: e.toolCallId, toolName: e.toolName, isError: e.isError, durationMs: e.durationMs }));
	pi.on("model_select", (e) => broadcast({ event: "model", model: { provider: e.model.provider, id: e.model.id } }));
	pi.on("thinking_level_select", (e) => broadcast({ event: "thinking", level: e.level }));
	pi.on("ui_prompt_start", (e) => broadcast({ event: "ui_prompt_start", kind: e.kind, title: e.title }));
	pi.on("ui_prompt_end", (e) => broadcast({ event: "ui_prompt_end", kind: e.kind, title: e.title }));

	// 他Extension(pi-subagents等)のイベントバスも中継できるか確認する
	for (const ch of [
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
		try {
			pi.events.on(ch, (data: unknown) => broadcast({ event: "bus", channel: ch, data }));
		} catch {}
	}
}
