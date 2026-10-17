#!/usr/bin/env node
/**
 * Dev-only fake PiMate Host for exercising the app UI without a PC-side Pi (not bundled into the app).
 *
 *   node apps/mobile/scripts/dev-fake-host.mjs [--port 47800] [--listen 127.0.0.1] [--address 127.0.0.1:47800]
 *
 * Implements POST /pair and the Host WebSocket protocol (packages/protocol/src/host.ts) with canned instances
 * (idle / running / waiting_input / phone-started) and a scripted turn: thinking, tool rows with live output,
 * streamed text, follow-ups, abort. No dependencies: a minimal RFC 6455 server is included.
 *
 * M2: folders/spawn, RC models/sessions/session_op/compact/set_model/set_thinking/ui_respond/shutdown,
 * snapshot context + pcPrompt.
 *
 * M3: tool results carry diffs like the real ones — edit `details.patch` (Pi's unified patch) and write
 * `details.pimate` (RC write_diff) — plus message timestamps, so turns fold and the Review screen has content.
 * The canned "--shout" history has a write without RC details (an older session's fallback).
 *
 * Dev controls (curl -X POST http://127.0.0.1:47800/_dev/<cmd>):
 *   turn?i=<instanceId>   run the scripted turn as if typed on the PC   (default: the first instance)
 *   ask?i=<id>&kind=select|confirm|input|editor   open a ui_request (instance goes waiting_input)
 *   answered?i=<id>       the oldest open question is answered on the PC (ui_request_end by tui)
 *   custom?i=<id>[&end=1] a TUI-only screen opens (ui_prompt start, "PC で操作が必要") / closes
 *   resume?i=<id>         simulate /resume on the PC (session_changed + new history)
 *   model?i=<id>          the model is changed on the PC (model + thinking events)
 *   gone?i=<id>           the instance exits (instance_gone)
 *   refuse-shutdown?on=1  RC shutdown answers with an error (on=0 to accept again)
 *   drop                  cut all WebSocket connections (simulated network loss)
 *   offline?s=20          cut connections and refuse new ones for s seconds
 *   revoke                close with 4403 and forget all tokens (app must re-pair)
 *   auth?complete=1       finish fake Codex auth; also expire, fail=1|0, saving=ms, refresh=1|0, old=1|0, oldHost=1|0, badurl=1|0
 *   pair                  print a fresh pairing link
 *   quota?source=claude|codex&p=85[&reset=60]  a newer PC-wide quota reaches every Pi (5h window, reset in s)
 *
 * M4 subagents: "認証まわりのレビュー" (~/work/api) starts with a pi-subagents background run of 3 reviewers that
 * progress every 3.5 s (activity, transcript via cursor; one finishes first) plus 以前の実行 (complete + failed).
 * subagent_control follows each run's/child's actions: steer (appends a user item), follow_up (delivered at the
 * next step), stop / stop_child (stopping → stopped), resume (new run with resumedFrom/resumedAs), abort_parent.
 *   sub?kind=parallel[&i=]  another background run of 3 reviewers (default: 認証まわりのレビュー)
 *   sub?kind=waiting[&i=]   a child asking the parent a question (default: API クライアントのリファクタ → 要対応)
 *   sub?kind=chain[&i=]     official-example chain scout → planner → worker, read-only (default: PiMate PoC;
 *                           the parent goes running while it lasts)
 *   sub?kind=answer[&i=]    waiting children continue (as if the parent answered)
 *   sub?kind=finish[&i=]    all active children run to completion
 *   sub?kind=hold           freeze / unfreeze subagent progress (for screenshots)
 *   sub?kind=reset[&i=]     subagents_reset with no runs
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ------------------------------------------------------------------ options & persisted state

const args = process.argv.slice(2);
const opt = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
let port = Number(opt("port", "47800"));
const listen = opt("listen", "127.0.0.1");
let address = opt("address", `${listen}:${port}`);
const statePath = opt("state", join(tmpdir(), "pimate-fake-host.json"));

let state = { hostId: randomUUID(), tokens: [] };
try {
	state = { ...state, ...JSON.parse(readFileSync(statePath, "utf8")) };
} catch {
	// first run
}
const saveState = () => writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 });
saveState();

const HOST_NAME = "fake-host";
let pairCode = randomBytes(18).toString("base64url");

function pairingLink() {
	const q = [
		["h", address],
		["c", pairCode],
		["n", HOST_NAME],
		["id", state.hostId],
	]
		.map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
		.join("&");
	return { pimate: `pimate://pair?${q}`, expoGo: `exp://127.0.0.1:8081/--/pair?${q}` };
}

function printLink() {
	const link = pairingLink();
	console.log(
		`\nPairing link (reusable while this fake host runs):\n  ${link.pimate}\nExpo Go deep link:\n  ${link.expoGo}\n`,
	);
	console.log(`adb shell am start -a android.intent.action.VIEW -d '${link.expoGo}'\n`);
}

// ------------------------------------------------------------------ canned instances

const now = Date.now();
const MIN = 60_000;
const MODEL = { provider: "openai", id: "gpt-6-luna" };
const ALL_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"];
/** Pi's scoped models (favorites), shared by all fake instances like the global enabledModels. */
let scoped = [
	{ provider: "anthropic", id: "claude-opus-5-5" },
	{ provider: "openai", id: "gpt-6-luna" },
];
const MODELS = [
	{
		provider: "anthropic",
		id: "claude-opus-5-5",
		name: "Claude Opus 5.5",
		contextWindow: 200_000,
		thinkingLevels: ALL_LEVELS,
	},
	{
		provider: "anthropic",
		id: "claude-sonnet-5",
		name: "Claude Sonnet 5",
		contextWindow: 200_000,
		thinkingLevels: ALL_LEVELS,
	},
	{
		provider: "anthropic",
		id: "claude-haiku-5",
		name: "Claude Haiku 5",
		contextWindow: 200_000,
		thinkingLevels: ["off"],
	},
	{
		provider: "openai",
		id: "gpt-6-luna",
		name: "GPT-6 Luna",
		contextWindow: 400_000,
		thinkingLevels: ["off", "low", "medium", "high"],
	},
	{
		provider: "openai",
		id: "gpt-6-mini",
		name: "GPT-6 mini",
		contextWindow: 400_000,
		thinkingLevels: ["off", "low", "medium", "high"],
	},
	{
		provider: "google",
		id: "gemini-3-pro",
		name: "Gemini 3 Pro",
		contextWindow: 1_000_000,
		thinkingLevels: ["off", "low", "high"],
	},
	{
		provider: "openrouter",
		id: "qwen/qwen4-coder",
		name: "Qwen4 Coder",
		contextWindow: 256_000,
		thinkingLevels: ["off"],
	},
];
const HOME = "/home/dev";
const findModelInfo = (ref) => MODELS.find((m) => m.provider === ref?.provider && m.id === ref?.id);

const instances = new Map();

function addInstance(
	id,
	{
		cwd,
		name,
		origin = "pc",
		status = "idle",
		updatedAgo = 0,
		history = [],
		pendingUI = [],
		model = MODEL,
		thinking = "off",
		tokens = 41_000,
	},
) {
	const sessionId = `sess-${id}`;
	const window = findModelInfo(model)?.contextWindow ?? 200_000;
	instances.set(id, {
		model,
		thinking,
		context: { tokens, contextWindow: window, percent: (tokens / window) * 100 },
		pcPrompt: null,
		// Saved sessions of this folder (the current one first); `items` of past ones are canned.
		sessions: [
			{ id: sessionId, path: `${HOME}/.pi/sessions/${sessionId}.jsonl`, name, created: now - 3 * 3600_000 },
			{
				id: `${sessionId}-old1`,
				path: `${HOME}/.pi/sessions/${sessionId}-old1.jsonl`,
				name: "依存パッケージの更新",
				created: now - 2 * 86_400_000,
			},
			{
				id: `${sessionId}-old2`,
				path: `${HOME}/.pi/sessions/${sessionId}-old2.jsonl`,
				name: undefined,
				first: "テストが落ちる原因を調べて",
				created: now - 9 * 86_400_000,
			},
		],
		summary: {
			instanceId: id,
			cwd,
			origin,
			abducoSession: origin === "mobile" ? `pimate-${id.slice(0, 8)}` : null,
			pcAttached: origin === "mobile" ? false : null,
			session: { id: sessionId, name },
			status,
			startedAt: now - 3 * 3600_000,
			updatedAt: now - updatedAgo,
		},
		seq: 100,
		items: history,
		pendingUI,
		streaming: { text: "", thinking: "" },
		turn: null,
		followUps: [],
	});
}

const README_CONTENT = "# demo\n\n挨拶を表示する CLI です。\n\n```sh\nnpx demo Alice\n```\n";

/** Pi's edit tool patch (jsdiff createTwoFilesPatch with FILE_HEADERS_ONLY, 4 lines of context). */
const GREET_PATCH = [
	"--- src/greet.ts",
	"+++ src/greet.ts",
	"@@ -1,7 +1,11 @@",
	" export interface Options {",
	" \tname: string;",
	"+\tshout?: boolean;",
	" }",
	" ",
	"-export function greet({ name }: Options): string {",
	'-\treturn "Hello, " + name;',
	"+export function greet({ name, shout }: Options): string {",
	'+\tconst text = "Hello, " + name;',
	"+\treturn shout ? text.toUpperCase() : text;",
	" }",
	"+",
	"+export const GREETING_VERSION = 2;",
	"",
].join("\n");

const TEST_CONTENT = [
	'import { expect, it } from "vitest";',
	'import { greet } from "./greet";',
	"",
	'it("shouts", () => {',
	'\texpect(greet({ name: "a", shout: true })).toBe("HELLO, A");',
	"});",
	"",
].join("\n");
/** The RC's write diff (details.pimate) for a file that did not exist. */
const TEST_PATCH = [
	"--- src/shout.test.ts",
	"+++ src/shout.test.ts",
	`@@ -0,0 +1,${TEST_CONTENT.split("\n").length - 1} @@`,
	...TEST_CONTENT.replace(/\n$/, "")
		.split("\n")
		.map((l) => `+${l}`),
	"",
].join("\n");

let entry = 0;
const eid = () => `e${(++entry).toString(16).padStart(6, "0")}`;

addInstance("6c1b2f0e-shout", {
	cwd: "/home/dev/code/demo",
	name: "--shout フラグを追加",
	updatedAgo: 0.5 * MIN,
	model: { provider: "anthropic", id: "claude-opus-5-5" },
	thinking: "high",
	tokens: 82_000,
	history: [
		{ kind: "user", entryId: eid(), text: "プロジェクトの構成を説明して", timestamp: Date.now() - 40 * MIN },
		{
			kind: "assistant",
			entryId: eid(),
			text: "",
			timestamp: Date.now() - 40 * MIN + 3_000,
			thinking: "まず README と src を確認する。",
			toolCalls: [{ id: "h-t1", name: "ls", args: { path: "src" } }],
			model: MODEL,
			stopReason: "toolUse",
		},
		{
			kind: "tool_result",
			entryId: eid(),
			toolCallId: "h-t1",
			toolName: "ls",
			text: "cli.ts\ngreet.ts\ngreet.test.ts\n",
			isError: false,
		},
		{
			kind: "assistant",
			entryId: eid(),
			text: "CLI のエントリは `src/cli.ts`、挨拶の生成は `src/greet.ts` にまとまっています。",
			timestamp: Date.now() - 40 * MIN + 9_000,
			toolCalls: [],
			model: MODEL,
			usage: { input: 6000, output: 210, cacheRead: 200, cost: 0.04 },
			stopReason: "stop",
		},
		{ kind: "user", entryId: eid(), text: "README に使い方を書いて", timestamp: Date.now() - 30 * MIN },
		{
			kind: "assistant",
			entryId: eid(),
			text: "",
			timestamp: Date.now() - 30 * MIN + 4_000,
			toolCalls: [{ id: "h-t2", name: "write", args: { path: "README.md", content: README_CONTENT } }],
			model: MODEL,
			stopReason: "toolUse",
		},
		// No details.pimate: written before the RC recorded write diffs.
		{
			kind: "tool_result",
			entryId: eid(),
			toolCallId: "h-t2",
			toolName: "write",
			text: `Successfully wrote ${README_CONTENT.length} bytes to README.md`,
			isError: false,
		},
		{
			kind: "assistant",
			entryId: eid(),
			text: "README.md に使い方を書きました。",
			timestamp: Date.now() - 30 * MIN + 11_000,
			toolCalls: [],
			model: MODEL,
			usage: { input: 6400, output: 160, cacheRead: 5800, cost: 0.02 },
			stopReason: "stop",
		},
	],
});
addInstance("9a4d7c21-login", {
	cwd: "/home/dev/work/web",
	name: "ログイン画面の改修",
	status: "waiting_input",
	updatedAgo: 0.2 * MIN,
	history: [
		{ kind: "user", entryId: eid(), text: "ログイン画面をメールリンク認証に対応させて" },
		{
			kind: "assistant",
			entryId: eid(),
			text: "現状の構成を確認しました。\n\n- `LoginForm.tsx` はパスワード入力のみ\n- 認証は `/api/session` に集約\n\n実装方針を選んでください。",
			toolCalls: [],
			model: MODEL,
			usage: { input: 9100, output: 380, cost: 0.03 },
			stopReason: "stop",
		},
	],
	pendingUI: [
		{
			requestId: "ui-1",
			kind: "select",
			title: "メールリンクの実装方式は？",
			options: ["既存の認証 API を拡張", "外部の Magic Link サービスを使う", "今回は UI の整理だけ"],
		},
	],
});
addInstance("3e8f0a55-api", { cwd: "/home/dev/work/api", name: "API クライアントのリファクタ", updatedAgo: 5 * MIN });
addInstance("7b2c9d10-readme", {
	cwd: "/home/dev/code/website",
	name: "README の整理",
	origin: "mobile",
	updatedAgo: 62 * MIN,
});
addInstance("1f5e6a77-poc", { cwd: "/home/dev/projects/PiMate", name: undefined, updatedAgo: 26 * 3600_000 });

// ------------------------------------------------------------------ minimal WebSocket server

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function encodeFrame(opcode, payload) {
	const len = payload.length;
	let header;
	if (len < 126) header = Buffer.from([0x80 | opcode, len]);
	else if (len < 65536) {
		header = Buffer.alloc(4);
		header[0] = 0x80 | opcode;
		header[1] = 126;
		header.writeUInt16BE(len, 2);
	} else {
		header = Buffer.alloc(10);
		header[0] = 0x80 | opcode;
		header[1] = 127;
		header.writeBigUInt64BE(BigInt(len), 2);
	}
	return Buffer.concat([header, payload]);
}

class Peer {
	constructor(socket) {
		this.socket = socket;
		this.buf = Buffer.alloc(0);
		this.authed = false;
		this.subs = new Set();
		this.open = true;
		socket.on("data", (d) => this.onData(d));
		socket.on("close", () => this.closed());
		socket.on("error", () => this.closed());
		this.authTimer = setTimeout(() => this.close(4408), 5000);
	}
	onData(chunk) {
		this.buf = Buffer.concat([this.buf, chunk]);
		while (this.buf.length >= 2) {
			const b0 = this.buf[0];
			const b1 = this.buf[1];
			const opcode = b0 & 0x0f;
			const masked = (b1 & 0x80) !== 0;
			let len = b1 & 0x7f;
			let off = 2;
			if (len === 126) {
				if (this.buf.length < 4) return;
				len = this.buf.readUInt16BE(2);
				off = 4;
			} else if (len === 127) {
				if (this.buf.length < 10) return;
				len = Number(this.buf.readBigUInt64BE(2));
				off = 10;
			}
			const maskLen = masked ? 4 : 0;
			if (this.buf.length < off + maskLen + len) return;
			const mask = masked ? this.buf.subarray(off, off + 4) : null;
			const payload = Buffer.from(this.buf.subarray(off + maskLen, off + maskLen + len));
			if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
			this.buf = this.buf.subarray(off + maskLen + len);
			if (opcode === 0x8) {
				this.write(0x8, payload.subarray(0, 2));
				this.socket.end();
				return;
			}
			if (opcode === 0x9) this.write(0xa, payload);
			else if (opcode === 0x1) this.onText(payload.toString("utf8"));
		}
	}
	write(opcode, payload) {
		if (this.open && !this.socket.destroyed) this.socket.write(encodeFrame(opcode, payload));
	}
	send(msg) {
		this.write(0x1, Buffer.from(JSON.stringify(msg)));
	}
	close(code) {
		const p = Buffer.alloc(2);
		p.writeUInt16BE(code, 0);
		this.write(0x8, p);
		this.socket.end();
		this.closed();
	}
	destroy() {
		this.socket.destroy();
		this.closed();
	}
	closed() {
		if (!this.open) return;
		this.open = false;
		clearTimeout(this.authTimer);
		peers.delete(this);
	}
	onText(text) {
		let msg;
		try {
			msg = JSON.parse(text);
		} catch {
			return this.close(4400);
		}
		if (!this.authed) {
			clearTimeout(this.authTimer);
			if (msg.type !== "auth") {
				this.send({ type: "auth_error", code: "bad_request" });
				return this.close(4400);
			}
			if (msg.protocol !== 1) {
				this.send({ type: "auth_error", code: "protocol_mismatch" });
				return this.close(4400);
			}
			if (!state.tokens.includes(msg.token)) {
				this.send({ type: "auth_error", code: "invalid_token" });
				return this.close(4401);
			}
			this.authed = true;
			log(`auth ok (${msg.app?.platform} ${msg.app?.version})`);
			this.send({
				type: "auth_ok",
				deviceId: "fake-device",
				host: {
					hostId: state.hostId,
					name: HOST_NAME,
					protocol: 1,
					version: "0.0.0-fake",
					platform: "linux",
					providerAuth: !authOptions.oldHost,
				},
			});
			this.send({ type: "instances", instances: summaries() });
			return;
		}
		switch (msg.type) {
			case "ping":
				return this.send({ type: "pong", t: msg.t });
			case "subscribe":
				return this.subscribe(msg.instanceId);
			case "unsubscribe":
				this.subs.delete(msg.instanceId);
				return;
			case "rc":
				return this.rc(msg.instanceId, msg.request);
			case "folders":
				return this.folders(msg);
			case "spawn":
				return this.spawn(msg);
			default:
				return this.close(4400);
		}
	}
	subscribe(id) {
		const inst = instances.get(id);
		if (!inst) return this.send({ type: "subscribe_error", instanceId: id, code: "not_found" });
		log(`subscribe ${id}`);
		this.subs.add(id);
		// Like the real Host: a short delay for hello + history over the RC socket.
		setTimeout(() => {
			if (!this.subs.has(id) || !instances.has(id)) return;
			this.send({
				type: "subscribed",
				instanceId: id,
				snapshot: snapshot(id),
				history: { session: inst.summary.session, items: inst.items },
			});
		}, 150);
	}
	rc(id, request) {
		const inst = instances.get(id);
		const reply = (response) => this.send({ type: "rc_result", instanceId: id, response });
		const fail = (code, message) => reply({ type: "response", id: request.id, ok: false, error: { code, message } });
		if (!inst) return fail("not_found");
		if (request.expectInstanceId && request.expectInstanceId !== id) return fail("instance_mismatch");
		if (request.expectSessionId && request.expectSessionId !== inst.summary.session?.id)
			return fail("session_changed", "Session changed");
		log(`rc ${request.method} ${id}`);
		setTimeout(async () => {
			if (request.method === "prompt") {
				const text = String(request.params?.text ?? "");
				const images = request.params?.images ?? [];
				if (inst.turn) {
					inst.followUps.push({ text, images });
					const deliveredAs = request.params?.deliverAs === "steer" ? "steer" : "followUp";
					reply({ type: "response", id: request.id, ok: true, result: { deliveredAs } });
				} else {
					reply({ type: "response", id: request.id, ok: true, result: { deliveredAs: "prompt" } });
					startTurn(id, text, "full", images);
				}
			} else if (request.method === "abort") {
				abortTurn(id);
				reply({ type: "response", id: request.id, ok: true, result: {} });
			} else if (request.method === "hello") {
				reply({ type: "response", id: request.id, ok: true, result: { snapshot: snapshot(id) } });
			} else {
				const handler = RC[request.method];
				if (!handler) return fail("unsupported", `fake host does not implement ${request.method}`);
				const out = await handler(id, request.params ?? {});
				if (out?.error) fail(out.error, out.message);
				else reply({ type: "response", id: request.id, ok: true, result: out?.result ?? {} });
			}
		}, 120);
	}
	folders(msg) {
		setTimeout(() => {
			const running = new Map();
			for (const i of instances.values()) running.set(i.summary.cwd, (running.get(i.summary.cwd) ?? 0) + 1);
			const known = [
				["/home/dev/code/demo", 0.5 * MIN, true],
				["/home/dev/work/web", 20 * MIN, true],
				["/home/dev/work/api", 2 * 86_400_000, true],
				["/home/dev/code/website", 3 * 86_400_000, false],
				["/home/dev/projects/PiMate", 5 * 86_400_000, true],
				["/home/dev/scratch/ocr-test", 12 * 86_400_000, undefined],
			];
			const folders = known.map(([path, ago, trusted]) => ({
				path,
				lastUsed: Date.now() - ago,
				running: running.get(path) ?? 0,
				...(trusted === undefined ? {} : { trusted }),
			}));
			this.send({ type: "folders_result", requestId: msg.requestId, home: HOME, folders });
		}, 300);
	}
	spawn(msg) {
		const p = msg.params ?? {};
		const done = (body) => this.send({ type: "spawn_result", requestId: msg.requestId, ...body });
		log(`spawn ${JSON.stringify(p)}`);
		const cwd = p.cwd === "~" ? HOME : String(p.cwd ?? "").replace(/^~\//, `${HOME}/`);
		if (!cwd.startsWith("/")) return done({ ok: false, code: "bad_request", message: "cwd must be absolute or ~/..." });
		if (cwd.includes("missing")) return done({ ok: false, code: "not_found", message: `${cwd} does not exist` });
		if (spawning) return done({ ok: false, code: "spawn_failed", message: "another spawn is in progress" });
		spawning = true;
		setTimeout(() => {
			spawning = false;
			const id = `${randomUUID().slice(0, 8)}-new`;
			const model = p.model ?? MODEL;
			addInstance(id, {
				cwd,
				name: undefined,
				origin: "mobile",
				model,
				thinking: p.thinking ?? (findModelInfo(model)?.thinkingLevels.includes("medium") ? "medium" : "off"),
				tokens: 0,
			});
			broadcastInstances();
			if (cwd.includes("fail-message")) {
				done({
					ok: true,
					instanceId: id,
					abducoSession: `pimate-${id.slice(0, 8)}`,
					messageError: "Error: prompt failed; not resent",
				});
				return;
			}
			done({ ok: true, instanceId: id, abducoSession: `pimate-${id.slice(0, 8)}` });
			if (p.message) setTimeout(() => startTurn(id, String(p.message), "short"), 200);
		}, 1500);
	}
}

const peers = new Set();
let refuseUntil = 0;
let refuseShutdown = false;
let spawning = false;

// ------------------------------------------------------------------ transient fake provider auth (no real credentials)

const authOptions = { old: false, oldHost: false, fail: false, refresh: false, badurl: false, saving: 200 };
const authStored = new Map([["anthropic", "oauth"]]);
const authFlows = new Map();
const authWaiters = new Map();
const authActive = (flow) => ["working", "input", "saving"].includes(flow?.status);
const authResult = (id) => ({ result: { flow: structuredClone(authFlows.get(id)) } });
function changeAuth(id, patch) {
	const flow = authFlows.get(id);
	authFlows.set(id, { ...flow, ...patch, revision: flow.revision + 1 });
	for (const finish of [...(authWaiters.get(id) ?? [])]) finish();
}
function saveAuth(id) {
	changeAuth(id, { status: "saving", prompt: undefined, authorization: undefined });
	const flowId = authFlows.get(id).id;
	setTimeout(() => {
		if (authFlows.get(id)?.id !== flowId) return;
		if (authOptions.fail) changeAuth(id, { status: "failed", error: "login_failed" });
		else {
			const flow = authFlows.get(id);
			authStored.set(flow.provider, flow.method);
			changeAuth(id, { status: "succeeded", refreshRequired: authOptions.refresh });
		}
	}, authOptions.saving).unref();
}
const AUTH_RC = {
	auth_list(id) {
		return {
			result: {
				providers: ["openai", "openai-codex", "anthropic"].map((provider) => ({
					id: provider,
					methods: provider === "openai-codex" ? ["oauth"] : ["oauth", "api_key"],
					stored: authStored.get(provider) ?? null,
					configured: authStored.has(provider),
				})),
				flow: authFlows.get(id),
			},
		};
	},
	auth_begin(id, { provider, method }) {
		if (
			authOptions.old ||
			!["openai", "openai-codex", "anthropic"].includes(provider) ||
			!["oauth", "api_key"].includes(method) ||
			(provider === "openai-codex" && method !== "oauth")
		)
			return { error: "unsupported" };
		if (authActive(authFlows.get(id))) return { error: "busy" };
		const flow = {
			id: randomUUID(),
			provider,
			method,
			revision: 0,
			expiresAt: Date.now() + 15 * MIN,
			status: method === "oauth" && provider === "openai-codex" ? "working" : "input",
		};
		if (method === "api_key") flow.prompt = { id: randomUUID(), kind: "api_key" };
		else if (provider === "openai-codex")
			flow.authorization = {
				url: "https://auth.openai.com/codex/device",
				userCode: "PIMATE-FAKE-NOT-A-REAL-DEVICE-CODE",
			};
		else {
			flow.authorization = {
				url:
					provider === "openai"
						? "https://auth.openai.com/api/accounts/authorize?client_id=pimate-fake&state=pimate-fake"
						: "https://claude.ai/oauth/authorize?client_id=pimate-fake&state=pimate-fake",
			};
			flow.prompt = { id: randomUUID(), kind: provider === "openai" ? "callback_url" : "code" };
		}
		if (authOptions.badurl && flow.authorization) flow.authorization.url = "https://example.invalid/not-auth";
		authFlows.set(id, flow);
		return authResult(id);
	},
	auth_wait(id, { flowId, afterRevision, waitMs = 25000 }) {
		const flow = authFlows.get(id);
		if (flow?.id !== flowId) return { error: "not_found" };
		if (Date.now() >= flow.expiresAt && authActive(flow) && flow.status !== "saving")
			changeAuth(id, { status: "expired", prompt: undefined, authorization: undefined });
		if (authFlows.get(id).revision !== afterRevision || !authActive(authFlows.get(id))) return authResult(id);
		const waits = authWaiters.get(id) ?? new Set();
		authWaiters.set(id, waits);
		if (waits.size >= 8) return { error: "busy" };
		return new Promise((resolve) => {
			const finish = () => {
				clearTimeout(timer);
				waits.delete(finish);
				resolve(authResult(id));
			};
			const timer = setTimeout(finish, Math.max(0, Math.min(25000, waitMs))).unref();
			waits.add(finish);
		});
	},
	auth_respond(id, { flowId, promptId, value }) {
		const flow = authFlows.get(id);
		if (flow?.id !== flowId || flow.status !== "input" || flow.prompt?.id !== promptId)
			return { error: "no_such_request" };
		if (typeof value !== "string" || !value.trim() || value.length > 8192) return { error: "bad_request" };
		// Deliberately discard input: fixtures keep metadata only, never keys/codes/callback URLs.
		saveAuth(id);
		return authResult(id);
	},
	auth_cancel(id, { flowId }) {
		const flow = authFlows.get(id);
		if (flow?.id !== flowId) return { error: "not_found" };
		if (flow.status === "saving") return { error: "busy" };
		if (authActive(flow)) changeAuth(id, { status: "cancelled", prompt: undefined, authorization: undefined });
		return authResult(id);
	},
	auth_logout(id, { provider }) {
		if (authActive(authFlows.get(id))) return { error: "busy" };
		authStored.delete(provider);
		return { result: { refreshRequired: authOptions.refresh } };
	},
};

// ------------------------------------------------------------------ M2 RC methods

function canned(text) {
	return [
		{ kind: "user", entryId: eid(), text },
		{
			kind: "assistant",
			entryId: eid(),
			text: "（過去のセッションの内容）",
			toolCalls: [],
			model: MODEL,
			usage: { input: 3000, output: 120, cost: 0.01 },
			stopReason: "stop",
		},
	];
}

function switchSession(id, reason, session, items) {
	const inst = instances.get(id);
	inst.summary.session = session;
	emit(id, { type: "session_changed", reason, session });
	inst.items = items;
	inst.pendingUI = [];
	inst.pcPrompt = null;
	const tokens = items.length ? 12_000 : 0;
	inst.context = { ...inst.context, tokens, percent: (tokens / inst.context.contextWindow) * 100 };
	emit(id, { type: "context", context: inst.context });
	broadcastInstances();
}

/** Each returns { result } or { error, message }. */
const RC = {
	...AUTH_RC,
	models(id) {
		return { result: { models: MODELS, current: instances.get(id).model, scoped } };
	},
	set_scoped_models(_id, params) {
		scoped = params.models.map((m) => ({ provider: m.provider, id: m.id }));
		return { result: { scoped } };
	},
	sessions(id) {
		const inst = instances.get(id);
		const current = inst.summary.session?.id;
		const sessions = inst.sessions.map((s, n) => ({
			id: s.id,
			path: s.path,
			...(s.name ? { name: s.name } : {}),
			firstMessage:
				s.first ?? (s.id === current ? (inst.items.find((i) => i.kind === "user")?.text ?? "") : "README を整えて"),
			messageCount: s.id === current ? inst.items.filter((i) => i.kind !== "tool_result").length : 6 + n * 5,
			created: s.created,
			modified: s.id === current ? Date.now() : s.created + 3600_000,
			current: s.id === current,
		}));
		return { result: { sessions } };
	},
	set_model(id, params) {
		const inst = instances.get(id);
		const info = findModelInfo(params);
		if (!info) return { error: "not_found", message: "model not found" };
		inst.model = { provider: info.provider, id: info.id };
		emit(id, { type: "model", model: inst.model });
		if (!info.thinkingLevels.includes(inst.thinking)) {
			inst.thinking = info.thinkingLevels.includes("medium") ? "medium" : "off";
			emit(id, { type: "thinking", level: inst.thinking });
		}
		const tokens = inst.context.tokens;
		inst.context = {
			tokens,
			contextWindow: info.contextWindow,
			percent: tokens === null ? null : (tokens / info.contextWindow) * 100,
		};
		emit(id, { type: "context", context: inst.context });
		return { result: { model: inst.model } };
	},
	set_thinking(id, params) {
		const inst = instances.get(id);
		const levels = findModelInfo(inst.model)?.thinkingLevels ?? ["off"];
		inst.thinking = levels.includes(params.level) ? params.level : levels.at(-1);
		emit(id, { type: "thinking", level: inst.thinking });
		return { result: { thinking: inst.thinking } };
	},
	ui_respond(id, params) {
		const inst = instances.get(id);
		const i = inst.pendingUI.findIndex((r) => r.requestId === params.requestId);
		if (i < 0) return { error: "no_such_request", message: "request already answered" };
		const [request] = inst.pendingUI.splice(i, 1);
		log(`ui_respond ${request.kind} ${JSON.stringify(params)}`);
		setTimeout(() => {
			emit(id, { type: "ui_request_end", requestId: request.requestId, by: "remote" });
			if (!inst.pendingUI.length) setStatus(id, inst.turn ? "running" : "idle");
		}, 80);
		return { result: {} };
	},
	compact(id) {
		const inst = instances.get(id);
		if (inst.turn) return { error: "busy", message: "agent is running" };
		setTimeout(() => {
			if (!instances.has(id)) return;
			inst.context = { ...inst.context, tokens: null, percent: null };
			emit(id, { type: "compact_done" });
			emit(id, { type: "context", context: inst.context });
		}, 1500);
		return { result: {} };
	},
	session_op(id, params) {
		const inst = instances.get(id);
		if (inst.turn) return { error: "busy", message: "agent is running" };
		const op = params.op;
		setTimeout(() => {
			if (!instances.has(id)) return;
			if (op === "new") {
				const session = { id: `sess-${Date.now()}`, name: undefined };
				inst.sessions.unshift({
					id: session.id,
					path: `${HOME}/.pi/sessions/${session.id}.jsonl`,
					created: Date.now(),
				});
				switchSession(id, "new", session, []);
			} else if (op === "switch") {
				const target = inst.sessions.find((s) => s.path === params.arg);
				if (!target) return emit(id, { type: "session_op_done", op, cancelled: false, error: "session not found" });
				switchSession(id, "resume", { id: target.id, name: target.name }, canned(target.first ?? "README を整えて"));
			} else if (op === "fork") {
				const at = inst.items.findIndex((x) => x.entryId === params.arg);
				if (at < 0) return emit(id, { type: "session_op_done", op, cancelled: false, error: "entry not found" });
				const session = { id: `sess-${Date.now()}`, name: inst.summary.session?.name };
				inst.sessions.unshift({
					id: session.id,
					path: `${HOME}/.pi/sessions/${session.id}.jsonl`,
					name: session.name,
					created: Date.now(),
				});
				switchSession(id, "fork", session, inst.items.slice(0, at));
			}
			emit(id, { type: "session_op_done", op, cancelled: false });
		}, 400);
		return { result: {} };
	},
	shutdown(id) {
		if (refuseShutdown) return { error: "shutdown_failed", message: "fake host: shutdown refused (refuse-shutdown)" };
		setTimeout(() => removeInstance(id), 500);
		return { result: {} };
	},
};

function removeInstance(id) {
	if (!instances.delete(id)) return;
	for (const p of peers) if (p.subs.has(id)) p.send({ type: "instance_gone", instanceId: id });
	broadcastInstances();
}

const ASK = {
	select: () => ({
		kind: "select",
		title: "メールリンクの実装方式は？",
		options: ["既存の認証 API を拡張", "外部の Magic Link サービスを使う", "今回は UI の整理だけ"],
	}),
	confirm: () => ({ kind: "confirm", title: "変更をコミットしますか？", message: "3 ファイルを変更しています。" }),
	input: () => ({ kind: "input", title: "コミットメッセージ", placeholder: "例: fix: ログインの不具合" }),
	editor: () => ({
		kind: "editor",
		title: "リリースノートを編集",
		message: "## v1.4.0\n\n- --shout フラグを追加\n- エラーメッセージを日本語に統一\n",
		tuiStaysOpen: true,
	}),
};

function log(...a) {
	console.log(new Date().toISOString().slice(11, 19), ...a);
}

function summaries() {
	return [...instances.values()].map((i) => i.summary);
}
function broadcastInstances() {
	for (const p of peers) if (p.authed) p.send({ type: "instances", instances: summaries() });
}
function snapshot(id) {
	const inst = instances.get(id);
	const s = inst.summary;
	return {
		protocol: 1,
		promptImages: true,
		providerAuth: !authOptions.old,
		instanceId: id,
		pid: 4242,
		cwd: s.cwd,
		origin: s.origin,
		abducoSession: s.abducoSession,
		startedAt: s.startedAt,
		session: s.session,
		status: s.status,
		model: inst.model,
		thinking: inst.thinking,
		pendingUI: inst.pendingUI,
		...(inst.pcPrompt ? { pcPrompt: inst.pcPrompt } : {}),
		context: inst.context,
		// Same shape as a real Codex / Claude response (Issue #53); `/_dev/auth?old=1` also hides it like an old RC.
		...(authOptions.old
			? {}
			: {
					quotas: [
						{
							source: "codex",
							windows: [
								{ minutes: 300, usedPercent: 12, resetsAt: Date.now() + 3 * 3_600_000 },
								{ minutes: 10080, usedPercent: 100, resetsAt: Date.now() + 5 * 86_400_000 },
							],
							observedAt: Date.now() - 60_000,
						},
						{
							source: "claude",
							windows: [
								{ minutes: 300, usedPercent: 35, resetsAt: Date.now() - 60_000 },
								{ minutes: 10080, usedPercent: 67, resetsAt: Date.now() + 3 * 86_400_000 },
							],
							observedAt: Date.now() - 2 * 3_600_000,
						},
					],
				}),
		...(inst.subagents
			? { subagents: { runs: inst.subagents.runs.map(publicRun), backends: clone(inst.subagents.backends) } }
			: {}),
		seq: inst.seq,
		streaming: { ...inst.streaming },
		piVersion: "1.2.0",
	};
}

function emit(id, event) {
	const inst = instances.get(id);
	if (!inst) return;
	inst.seq += 1;
	if (event.type === "text_delta") inst.streaming.text += event.delta;
	else if (event.type === "thinking_delta") inst.streaming.thinking += event.delta;
	else if (["message_end", "agent_settled", "session_changed"].includes(event.type))
		inst.streaming = { text: "", thinking: "" };
	if (event.type === "message_end") {
		const i = inst.items.findIndex((x) => x.entryId === event.item.entryId);
		if (i >= 0) inst.items[i] = event.item;
		else inst.items.push(event.item);
	}
	const msg = { type: "event", instanceId: id, sessionId: inst.summary.session?.id ?? null, seq: inst.seq, event };
	for (const p of peers) if (p.authed && p.subs.has(id)) p.send(msg);
}

function setStatus(id, status) {
	const inst = instances.get(id);
	if (!inst || inst.summary.status === status) return;
	inst.summary.status = status;
	inst.summary.updatedAt = Date.now();
	emit(id, { type: "status", status });
	broadcastInstances();
}

// ------------------------------------------------------------------ scripted turn

/** Each step runs after `ms`; text steps stream in chunks. */
function fullScript(prompt) {
	const toolCall = (id, name, args) => ({ id, name, args });
	const t = Date.now().toString(36);
	return [
		{ ms: 300, run: (id) => emit(id, { type: "agent_start" }) },
		{
			ms: 0,
			stream: "thinking",
			text: `「${prompt.slice(0, 40)}」への対応。まず greet.ts を読み、フラグの扱いを確認する。`,
		},
		{
			ms: 200,
			run: (id, turn) => assistantEnd(id, turn, "", [toolCall(`${t}-1`, "read", { path: "src/greet.ts" })], "toolUse"),
		},
		{ ms: 100, run: (id) => toolStart(id, `${t}-1`, "read", { path: "src/greet.ts" }) },
		{
			ms: 700,
			run: (id) =>
				toolEnd(
					id,
					`${t}-1`,
					"read",
					Array.from({ length: 42 }, (_, i) => `${i + 1}  export const line${i} = ${i};`).join("\n"),
				),
		},
		{
			ms: 300,
			run: (id, turn) =>
				assistantEnd(
					id,
					turn,
					"",
					[toolCall(`${t}-2`, "edit", { path: "src/greet.ts", oldText: "a", newText: "b" })],
					"toolUse",
				),
		},
		{ ms: 100, run: (id) => toolStart(id, `${t}-2`, "edit", { path: "src/greet.ts" }) },
		{
			ms: 900,
			run: (id) =>
				toolEnd(id, `${t}-2`, "edit", "Successfully replaced 1 block(s) in src/greet.ts.", false, {
					diff: "(display diff)",
					patch: GREET_PATCH,
				}),
		},
		{
			ms: 300,
			run: (id, turn) =>
				assistantEnd(
					id,
					turn,
					"",
					[toolCall(`${t}-w`, "write", { path: "src/shout.test.ts", content: TEST_CONTENT })],
					"toolUse",
				),
		},
		{ ms: 100, run: (id) => toolStart(id, `${t}-w`, "write", { path: "src/shout.test.ts", content: TEST_CONTENT }) },
		{
			ms: 500,
			run: (id) =>
				toolEnd(id, `${t}-w`, "write", `Successfully wrote ${TEST_CONTENT.length} bytes to src/shout.test.ts`, false, {
					pimate: { kind: "write_diff", existed: false, patch: TEST_PATCH },
				}),
		},
		{
			ms: 300,
			run: (id, turn) => assistantEnd(id, turn, "", [toolCall(`${t}-3`, "bash", { command: "npm test" })], "toolUse"),
		},
		{ ms: 100, run: (id) => toolStart(id, `${t}-3`, "bash", { command: "npm test" }) },
		{ ms: 1200, run: (id) => toolUpdate(id, `${t}-3`, "bash", "> vitest run\n") },
		{ ms: 1800, run: (id) => toolUpdate(id, `${t}-3`, "bash", "> vitest run\n ✓ src/greet.test.ts (3 tests)\n") },
		{
			ms: 2200,
			run: (id) =>
				toolUpdate(id, `${t}-3`, "bash", "> vitest run\n ✓ src/greet.test.ts (3 tests)\n ⠹ src/cli.test.ts\n"),
		},
		{
			ms: 3000,
			run: (id) =>
				toolEnd(
					id,
					`${t}-3`,
					"bash",
					"> vitest run\n ✓ src/greet.test.ts (3 tests)\n ✓ src/cli.test.ts (2 tests)\n\n Test Files  2 passed (2)\n      Tests  5 passed (5)\n",
				),
		},
		{
			ms: 300,
			stream: "text",
			text: "`src/greet.ts` に `--shout` フラグを追加しました。指定すると挨拶を大文字で出力します。\n\nテストを 2 件追加し、`npm test` はすべて通っています。",
		},
		{ ms: 200, run: (id, turn) => assistantEnd(id, turn, turn.text, [], "stop", true) },
	];
}

/** Reply to a phone prompt starting with "md" (full-width too, as typed by a Japanese IME): every Markdown block. */
const wantsMarkdown = (prompt) => /^md\b/i.test(prompt.normalize("NFKC"));
const MARKDOWN_SAMPLE = `## 変更の概要

\`--shout\` フラグを追加しました。**「大文字で出力」**する *だけ* の ~~小さな~~ 変更です。詳しくは [README](https://github.com/phni3j9a/PiMate) を参照。

### 手順

1. \`src/cli.ts\` に引数を追加
2. テストを追加
   - 正常系
   - 空文字

- [x] 実装
- [ ] リリースノート

> PC の Pi でも同じ結果になります。

| ファイル | 追加 | 削除 | 備考 |
|---|--:|--:|---|
| src/cli.ts | 12 | 3 | フラグの解析 |
| test/cli.test.ts | 24 | 0 | 正常系と空文字のテスト |

---

\`\`\`ts
export function greet(name: string, shout = false): string {
	const text = \`Hello, \${name}!\`;
	return shout ? text.toUpperCase() : text;
}
\`\`\``;

function shortScript(prompt = "") {
	return [
		{ ms: 300, run: (id) => emit(id, { type: "agent_start" }) },
		{
			ms: 200,
			stream: "text",
			text: wantsMarkdown(prompt) ? MARKDOWN_SAMPLE : "了解しました。README の使い方にも追記しておきます。",
		},
		{ ms: 200, run: (id, turn) => assistantEnd(id, turn, turn.text, [], "stop", true) },
	];
}

function assistantEnd(id, turn, text, toolCalls, stopReason, final = false) {
	const item = {
		kind: "assistant",
		entryId: eid(),
		text,
		thinking: turn.thinking || undefined,
		toolCalls,
		model: MODEL,
		usage: final ? { input: 6200, output: 210, cacheRead: 0, cost: 0.04 } : { input: 5800, output: 40 },
		stopReason,
		timestamp: Date.now(),
	};
	turn.thinking = "";
	turn.text = "";
	emit(id, { type: "message_end", item });
}
function toolStart(id, toolCallId, toolName, args) {
	emit(id, { type: "tool_start", toolCallId, toolName, args });
}
function toolUpdate(id, toolCallId, toolName, text) {
	emit(id, { type: "tool_update", toolCallId, toolName, partial: { content: [{ type: "text", text }] } });
}
function toolEnd(id, toolCallId, toolName, text, isError = false, details = undefined) {
	emit(id, { type: "tool_end", toolCallId, toolName, isError, durationMs: 1500 });
	emit(id, {
		type: "message_end",
		item: { kind: "tool_result", entryId: eid(), toolCallId, toolName, text, isError, details },
	});
}

function startTurn(id, prompt, kind, images = []) {
	const inst = instances.get(id);
	if (!inst) return;
	emit(id, { type: "user_input", text: prompt, source: "rpc" });
	emit(id, {
		type: "message_end",
		item: {
			kind: "user",
			entryId: eid(),
			text: prompt,
			...(images.length ? { images, imageCount: images.length } : {}),
			timestamp: Date.now(),
		},
	});
	setStatus(id, "running");
	const turn = {
		steps: kind === "full" && !wantsMarkdown(prompt) ? fullScript(prompt) : shortScript(prompt),
		timer: null,
		text: "",
		thinking: "",
	};
	inst.turn = turn;
	const next = () => {
		if (inst.turn !== turn) return;
		const step = turn.steps.shift();
		if (!step) return finishTurn(id, false);
		turn.timer = setTimeout(() => {
			if (inst.turn !== turn) return;
			if (step.run) {
				step.run(id, turn);
				next();
			} else streamText(id, turn, step.stream, step.text, next);
		}, step.ms);
	};
	next();
}

function streamText(id, turn, kind, text, done) {
	const chars = [...text];
	const tick = () => {
		if (instances.get(id)?.turn !== turn) return;
		if (!chars.length) return done();
		const chunk = chars.splice(0, 3).join("");
		if (kind === "text") turn.text += chunk;
		else turn.thinking += chunk;
		emit(id, { type: kind === "text" ? "text_delta" : "thinking_delta", delta: chunk });
		turn.timer = setTimeout(tick, 60);
	};
	tick();
}

function finishTurn(id, aborted) {
	const inst = instances.get(id);
	if (!inst) return;
	const follow = !aborted && inst.followUps.shift();
	if (follow) {
		inst.turn = null;
		startTurn(
			id,
			typeof follow === "string" ? follow : follow.text,
			"short",
			typeof follow === "string" ? [] : follow.images,
		);
		return;
	}
	inst.turn = null;
	inst.followUps = [];
	emit(id, { type: "agent_settled", aborted });
	setStatus(id, inst.pendingUI.length ? "waiting_input" : "idle");
}

function abortTurn(id) {
	const inst = instances.get(id);
	const turn = inst?.turn;
	if (!turn) return;
	clearTimeout(turn.timer);
	assistantEnd(id, turn, turn.text, [], "aborted");
	inst.turn = null;
	finishTurn(id, true);
}

// ------------------------------------------------------------------ subagents (M4)
//
// Runs as the RC would normalize them (packages/protocol/src/subagents.ts): `subagent_run` upserts, counts in the
// host list, `subagent_transcript` with a cursor, `subagent_control` gated by each run's/child's `actions`.

const SUB_TICK_MS = 3500;
/** Ticks per step of a running child (~10 s), so a run lasts minutes. */
const SUB_STEP_TICKS = 3;
let subHold = false;
const SUB_ACTIVE = new Set(["queued", "running", "waiting", "stopping"]);
const subTranscripts = new Map(); // `${runId}/${childId}` -> { task, items: [], pending: null, followUps: [] }
let subSeq = 0;

function subState(id) {
	const inst = instances.get(id);
	if (!inst) return null;
	inst.subagents ??= { runs: [], backends: [{ backend: "pi-subagents", version: "0.9.0", supported: true }] };
	return inst.subagents;
}

function subCounts(runs) {
	const c = { active: 0, waiting: 0, paused: 0, failed: 0 };
	for (const run of runs)
		for (const ch of run.children.length ? run.children : [{ state: run.state }]) {
			if (ch.state === "waiting") c.waiting++;
			if (SUB_ACTIVE.has(ch.state)) c.active++;
			else if (ch.state === "paused") c.paused++;
			else if (ch.state === "failed") c.failed++;
		}
	return c;
}

const clone = (v) => JSON.parse(JSON.stringify(v));

/** Strip internal fields (scripts) and broadcast the run + host-list counts. */
function publishRun(id, run) {
	run.updatedAt = Date.now();
	const states = run.children.map((c) => c.state);
	if (states.length) {
		if (states.some((s) => s === "stopping")) run.state = "stopping";
		else if (states.some((s) => s === "running" || s === "queued")) run.state = "running";
		else if (states.some((s) => s === "waiting")) run.state = "waiting";
		else if (states.some((s) => s === "paused")) run.state = "paused";
		else if (states.some((s) => s === "failed")) run.state = "failed";
		else if (states.every((s) => s === "stopped")) run.state = "stopped";
		else if (states.some((s) => s === "stopped")) run.state = "stopped";
		else run.state = "complete";
		if (!SUB_ACTIVE.has(run.state) && run.state !== "paused") run.endedAt ??= Date.now();
	}
	if (run.mode === "chain") {
		const current = run.children.findIndex((c) => SUB_ACTIVE.has(c.state));
		run.stage = { index: current < 0 ? run.children.length - 1 : current, count: run.children.length };
	}
	if (run.backend === "example" && !SUB_ACTIVE.has(run.state)) {
		run.actions = [];
		const inst = instances.get(id);
		if (inst?.summary.status === "running" && !inst.turn) setStatus(id, "idle");
	}
	emit(id, { type: "subagent_run", run: publicRun(run) });
	instances.get(id).summary.subagents = subCounts(subState(id).runs);
	broadcastInstances();
}

function publicRun(run) {
	const { script: _s, ...rest } = run;
	return clone({ ...rest, children: run.children.map(({ script: _c, ...c }) => c) });
}

function argText(name, args) {
	if (name === "bash") return args.command;
	if (name === "grep") return [args.pattern, args.path].filter(Boolean).join(" ");
	if (name === "find") return [JSON.stringify(args.pattern), args.path].filter(Boolean).join(" ");
	return args.path ?? "";
}

function subItem(key, item) {
	const t = subTranscripts.get(key);
	t.items.push({ entryId: eid(), timestamp: Date.now(), ...item });
}

function flushPending(key) {
	const t = subTranscripts.get(key);
	if (!t.pending) return;
	subItem(key, {
		kind: "tool_result",
		toolCallId: t.pending.id,
		toolName: t.pending.name,
		text: t.pending.result,
		isError: false,
	});
	t.pending = null;
}

/** One step of a running child: finish the pending tool, then start the next tool / say something / finish. */
function stepChild(run, child) {
	const key = `${run.id}/${child.id}`;
	const t = subTranscripts.get(key);
	flushPending(key);
	const follow = t.followUps.shift();
	if (follow) subItem(key, { kind: "user", text: follow });
	const step = child.script.shift();
	if (!step) {
		child.state = child.failWith ? "failed" : "complete";
		if (child.failWith) child.error = child.failWith;
		child.endedAt = Date.now();
		child.activity = undefined;
		child.actions = child.actions.filter((a) => a === "resume");
		if (run.backend === "pi-subagents") child.actions = ["resume"];
		return;
	}
	if (step.text) {
		subItem(key, {
			kind: "assistant",
			text: step.text,
			toolCalls: [],
			model: child.model,
			stopReason: "stop",
		});
		child.activity = undefined;
		return;
	}
	const call = { id: `${child.id}-t${++subSeq}`, name: step.tool, args: step.args };
	subItem(key, {
		kind: "assistant",
		text: "",
		...(step.think ? { thinking: step.think } : {}),
		toolCalls: [call],
		model: child.model,
		stopReason: "toolUse",
	});
	t.pending = { id: call.id, name: step.tool, result: step.result ?? "" };
	child.activity = { tool: step.tool, args: argText(step.tool, step.args), startedAt: Date.now() };
	child.usage = {
		input: (child.usage?.input ?? 0) + 3_200,
		output: (child.usage?.output ?? 0) + 140,
		costUsd: Math.round(((child.usage?.costUsd ?? 0) + 0.012) * 1000) / 1000,
	};
	if (step.ask) {
		child.state = "waiting";
		child.question = step.ask;
		child.activity = undefined;
	}
}

function tickRun(id, run) {
	let changed = false;
	const working = run.children.filter((c) => c.state === "running");
	for (const child of working) {
		child.wait = (child.wait ?? 0) + 1;
		if (child.wait < SUB_STEP_TICKS) continue;
		child.wait = 0;
		stepChild(run, child);
		changed = true;
	}
	if (run.mode === "chain" && !run.children.some((c) => c.state === "running" || c.state === "waiting")) {
		const next = run.children.find((c) => c.state === "queued");
		if (next && !run.children.some((c) => c.state === "failed" || c.state === "stopped")) {
			next.state = "running";
			next.startedAt = Date.now();
			changed = true;
		} else if (next) {
			for (const c of run.children) if (c.state === "queued") c.state = "stopped";
			changed = true;
		}
	}
	if (changed) publishRun(id, run);
}

setInterval(() => {
	if (subHold) return;
	for (const [id, inst] of instances)
		for (const run of inst.subagents?.runs ?? []) if (SUB_ACTIVE.has(run.state)) tickRun(id, run);
}, SUB_TICK_MS).unref();

const fileRead = (n) => Array.from({ length: n }, (_, i) => `${String(i + 1).padStart(3)}  // …`).join("\n");

const MORE_FILES = [
	"src/api/http.ts",
	"src/api/errors.ts",
	"src/auth/types.ts",
	"src/auth/index.ts",
	"src/hooks/useAuth.ts",
	"src/hooks/useSession.ts",
	"src/pages/Login.tsx",
	"src/pages/Logout.tsx",
	"src/lib/clock.ts",
	"src/lib/storage.ts",
	"src/lib/retry.ts",
	"src/lib/events.ts",
];
/** Extra reading so the canned runs last a few minutes. */
const moreReading = (prefix) =>
	MORE_FILES.flatMap((path, i) => [
		{ tool: "read", args: { path }, result: fileRead(40 + i * 7) },
		...(i % 4 === 3
			? [{ tool: "grep", args: { pattern: `${prefix}${i}`, path: "src/" }, result: "src/a.ts:1\nsrc/b.ts:2" }]
			: []),
	]);

const REVIEW_STEPS = {
	correctness: [
		{
			tool: "ls",
			args: { path: "src/auth/" },
			think: "まず認証まわりの構成を確認する。",
			result: "guard.tsx\nrefresh.ts\nsession.ts\nstorage.ts\ntypes.ts\nindex.ts",
		},
		{ tool: "read", args: { path: "src/auth/session.ts" }, result: fileRead(128) },
		{ tool: "read", args: { path: "src/auth/refresh.ts" }, result: fileRead(96) },
		{
			tool: "grep",
			args: { pattern: "expiresAt", path: "src/" },
			result: Array.from({ length: 7 }, (_, i) => `src/auth/session.ts:${20 + i}: expiresAt`).join("\n"),
		},
		{
			text: "`session.ts` は期限の判定に端末の時刻を使っています。サーバーと時刻がずれていると、期限切れのトークンを有効と判定するおそれがあります。",
		},
		{
			tool: "grep",
			args: { pattern: "refreshPromise", path: "src/" },
			result: "src/auth/refresh.ts:12\nsrc/auth/refresh.ts:40\nsrc/api/client.ts:88",
		},
		{ tool: "read", args: { path: "src/api/client.ts" }, result: fileRead(210) },
		{ tool: "read", args: { path: "src/auth/storage.ts" }, result: fileRead(54) },
		{
			tool: "grep",
			args: { pattern: "catch", path: "src/auth/" },
			result: "src/auth/refresh.ts:51\nsrc/auth/session.ts:77",
		},
		{ text: "更新が同時に走ると `refreshPromise` が上書きされ、2 回目の更新が古いトークンで送られる経路があります。" },
		{ tool: "read", args: { path: "src/auth/guard.tsx" }, result: fileRead(66) },
		...moreReading("token"),
		{
			tool: "bash",
			args: { command: "git log --oneline -5 -- src/auth" },
			result: "a1b2c3d fix: refresh race\n9f8e7d6 feat: guard",
		},
		{
			text: "指摘を重要度順にまとめました。\n\n1. 期限の判定が端末の時刻に依存\n2. 同時更新でトークンが巻き戻る\n3. 更新失敗時にセッションが残る",
		},
	],
	tests: [
		{
			tool: "find",
			args: { pattern: "*.test.ts", path: "src/auth/" },
			result: "src/auth/session.test.ts\nsrc/auth/refresh.test.ts",
		},
		{ tool: "read", args: { path: "src/auth/session.test.ts" }, result: fileRead(84) },
		{
			tool: "bash",
			args: { command: "npm test -- auth" },
			result: "PASS src/auth/session.test.ts\nPASS src/auth/refresh.test.ts\nTests: 14 passed",
		},
		{ text: "既存のテストは通っていますが、期限切れの直前・直後の境界を扱うテストがありません。" },
		{ tool: "read", args: { path: "src/auth/refresh.test.ts" }, result: fileRead(61) },
		{ tool: "grep", args: { pattern: "useFakeTimers", path: "src/" }, result: "src/api/client.test.ts:5" },
		{
			tool: "bash",
			args: { command: "npm test -- --coverage auth" },
			result: "session.ts | 71.4 %\nrefresh.ts | 58.2 %",
		},
		{ tool: "read", args: { path: "src/api/client.test.ts" }, result: fileRead(140) },
		...moreReading("expect"),
		{ text: "テストの不足をまとめました。同時更新とエラー時の扱いにテストがありません。" },
	],
	complexity: [
		{ tool: "read", args: { path: "src/auth/session.ts" }, result: fileRead(128) },
		{ tool: "read", args: { path: "src/auth/refresh.ts" }, result: fileRead(96) },
		{ text: "複雑さの指摘は 2 件です。`refresh.ts` の分岐が深く、`session.ts` に保存と判定が混在しています。" },
	],
};

function addChild(run, { id, index, agent, title, model, task, steps, startedAgo = 0, state = "running" }) {
	const child = {
		id,
		index,
		agent,
		...(title ? { title } : {}),
		state,
		model,
		thinking: "medium",
		...(state === "queued" ? {} : { startedAt: Date.now() - startedAgo }),
		hasTranscript: true,
		actions: run.backend === "pi-subagents" ? ["steer", "follow_up", "stop_child"] : [],
		script: [...steps],
	};
	run.children.push(child);
	subTranscripts.set(`${run.id}/${id}`, { task, items: [], pending: null, followUps: [] });
	return child;
}

function newRun(id, patch) {
	const run = {
		id: `run-${Date.now().toString(36)}-${++subSeq}`,
		backend: "pi-subagents",
		background: true,
		mode: "parallel",
		state: "running",
		startedAt: Date.now(),
		children: [],
		actions: ["stop"],
		...patch,
	};
	subState(id).runs.push(run);
	return run;
}

/** Fast-forward a child (canned history, previous runs). */
function playOut(run, child, n = Infinity) {
	for (let i = 0; i < n && child.state === "running"; i++) stepChild(run, child);
}

const SONNET = "anthropic/claude-sonnet-5";
const HAIKU = "anthropic/claude-haiku-5";

function startParallel(id, toolCallId) {
	const run = newRun(id, { toolCallId, startedAt: Date.now() - 252_000 });
	const c1 = addChild(run, {
		id: `${run.id}-c1`,
		index: 0,
		agent: "reviewer",
		title: "正しさのレビュー",
		model: SONNET,
		startedAgo: 252_000,
		task: "src/auth/ 以下を正しさの観点でレビューしてください。期限切れの判定、トークン更新、エラー時の扱いを重点的に見て、指摘は重要度順に。",
		steps: REVIEW_STEPS.correctness,
	});
	const c2 = addChild(run, {
		id: `${run.id}-c2`,
		index: 1,
		agent: "reviewer",
		title: "テストのレビュー",
		model: SONNET,
		startedAgo: 252_000,
		task: "src/auth/ のテストをレビューしてください。足りないケースを重要度順に。",
		steps: REVIEW_STEPS.tests,
	});
	const c3 = addChild(run, {
		id: `${run.id}-c3`,
		index: 2,
		agent: "reviewer",
		title: "複雑さのレビュー",
		model: SONNET,
		startedAgo: 252_000,
		task: "src/auth/ を複雑さの観点でレビューしてください。",
		steps: REVIEW_STEPS.complexity,
	});
	playOut(run, c1, 5);
	playOut(run, c2, 2);
	playOut(run, c3, 3);
	publishRun(id, run);
	return run;
}

function seedPrevious(id) {
	const done = newRun(id, { background: false, mode: "single", startedAt: Date.now() - 19.2 * MIN, actions: [] });
	const scout = addChild(done, {
		id: `${done.id}-c1`,
		index: 0,
		agent: "scout",
		title: "ログイン処理の調査",
		model: HAIKU,
		startedAgo: 19.2 * MIN,
		task: "Web 版のログイン処理に関係するファイルを探して、呼び出しの流れをまとめて。",
		steps: [
			{ tool: "find", args: { pattern: "*.tsx", path: "src/" }, result: "src/pages/Login.tsx" },
			{ tool: "read", args: { path: "src/pages/Login.tsx" }, result: fileRead(88) },
			{ text: "ログインの入口は `src/pages/Login.tsx` の 1 か所です。" },
		],
	});
	playOut(done, scout);
	scout.endedAt = scout.startedAt + 72_000;
	done.endedAt = scout.endedAt;
	const failed = newRun(id, { background: true, mode: "single", startedAt: Date.now() - 45 * MIN, actions: [] });
	const worker = addChild(failed, {
		id: `${failed.id}-c1`,
		index: 0,
		agent: "worker",
		title: "依存パッケージの確認",
		model: SONNET,
		startedAgo: 45 * MIN,
		task: "依存パッケージを最新にして、テストが通るか確認して。",
		steps: [
			{ tool: "bash", args: { command: "npm outdated" }, result: "react 19.1.0 → 19.2.0" },
			{ tool: "bash", args: { command: "npm ci" }, result: "npm ERR! code 1" },
		],
	});
	worker.failWith = "npm ci が終了コード 1";
	playOut(failed, worker);
	worker.endedAt = worker.startedAt + 185_000;
	failed.endedAt = worker.endedAt;
	for (const run of [done, failed]) publishRun(id, run);
	done.updatedAt = done.endedAt;
	failed.updatedAt = failed.endedAt;
}

function startWaiting(id) {
	const run = newRun(id, { mode: "single" });
	const child = addChild(run, {
		id: `${run.id}-c1`,
		index: 0,
		agent: "planner",
		title: "API 設計の確認",
		model: SONNET,
		startedAgo: 40_000,
		task: "API クライアントのリファクタ方針を立てて。迷う点は確認して。",
		steps: [
			{ tool: "read", args: { path: "src/api/client.ts" }, result: fileRead(210) },
			{ tool: "grep", args: { pattern: "/v1/", path: "src/" }, result: "src/api/client.ts:12\nsrc/api/users.ts:4" },
			{
				tool: "ask_parent",
				args: { question: "エンドポイントを v2 に分けますか？" },
				ask: "エンドポイントを v2 に分けますか？ それとも既存の v1 を拡張しますか？",
				result: "v2 に分ける",
			},
			{ text: "v2 に分ける方針で計画を書きます。" },
			{ tool: "write", args: { path: "docs/plan.md", content: "# plan" }, result: "ok" },
			{ text: "計画を docs/plan.md にまとめました。" },
		],
	});
	playOut(run, child, 3);
	publishRun(id, run);
	return run;
}

function startChain(id) {
	const inst = instances.get(id);
	inst.subagents ??= { runs: [], backends: [] };
	if (!inst.subagents.backends.some((b) => b.backend === "example"))
		inst.subagents.backends.push({ backend: "example", supported: true });
	const run = newRun(id, {
		backend: "example",
		background: false,
		mode: "chain",
		actions: ["abort_parent"],
		toolCallId: `chain-${subSeq}`,
		startedAt: Date.now() - 48_000,
	});
	const task = "Web 版のログイン処理に関係するファイルを探して、呼び出しの流れをまとめて。";
	const scout = addChild(run, {
		id: `${run.id}-c1`,
		index: 0,
		agent: "scout",
		title: "ログイン処理の調査",
		model: HAIKU,
		startedAgo: 48_000,
		task,
		steps: [
			{
				tool: "find",
				args: { pattern: "*.tsx", path: "src/" },
				think: "ログインの画面から探す。",
				result: Array.from({ length: 214 }, (_, i) => `src/c${i}.tsx`).join("\n"),
			},
			{
				tool: "grep",
				args: { pattern: "login", path: "src/" },
				result: Array.from({ length: 18 }, (_, i) => `src/x${i}.ts`).join("\n"),
			},
			{ text: "ログインの入口は `src/pages/Login.tsx` の 1 か所です。ここから呼び出しをたどります。" },
			{ tool: "read", args: { path: "src/pages/Login.tsx" }, result: fileRead(88) },
			{ tool: "read", args: { path: "src/api/session.ts" }, result: fileRead(64) },
			{
				text: "ここまでの流れです。\n\n1. `Login.tsx` の送信で `signIn()` を呼ぶ\n2. `signIn()` が `/api/session` に送信\n3. 成功したらトークンを保存（保存先を確認中）",
			},
			{ tool: "grep", args: { pattern: "useSession", path: "src/" }, result: "src/hooks/useSession.ts:3" },
			{ text: "保存先は `useSession` です。" },
		],
	});
	addChild(run, {
		id: `${run.id}-c2`,
		index: 1,
		agent: "planner",
		model: SONNET,
		state: "queued",
		task: "scout の結果をもとに改修の計画を立てて。",
		steps: [
			{ tool: "read", args: { path: "src/hooks/useSession.ts" }, result: fileRead(40) },
			{ text: "計画を立てました。" },
		],
	});
	addChild(run, {
		id: `${run.id}-c3`,
		index: 2,
		agent: "worker",
		model: SONNET,
		state: "queued",
		task: "計画どおりに実装して。",
		steps: [{ tool: "edit", args: { path: "src/pages/Login.tsx" }, result: "ok" }, { text: "実装しました。" }],
	});
	playOut(run, scout, 7);
	// The example's subagent tool runs inside the parent's turn.
	setStatus(id, "running");
	publishRun(id, run);
	return run;
}

function findSubRun(id, runId) {
	return subState(id)?.runs.find((r) => r.id === runId);
}

RC.subagent_transcript = (id, p) => {
	const run = findSubRun(id, p.runId);
	const t = subTranscripts.get(`${p.runId}/${p.childId}`);
	if (!run || !t) return { error: "not_found", message: "no such subagent" };
	const from = Number(p.cursor ?? 0) || 0;
	return { result: { task: t.task, items: clone(t.items.slice(from)), cursor: String(t.items.length) } };
};

RC.subagent_control = (id, p) => {
	const run = findSubRun(id, p.runId);
	if (!run) return { error: "not_found", message: "no such run" };
	const child = p.childId ? run.children.find((c) => c.id === p.childId) : undefined;
	if (p.childId && !child) return { error: "not_found", message: "no such child" };
	const childAction = ["steer", "follow_up", "stop_child", "resume"].includes(p.action);
	const allowed = childAction ? child?.actions.includes(p.action) : run.actions.includes(p.action);
	if (!allowed) return { error: "unsupported", message: `${p.action} is not available` };
	const text = typeof p.text === "string" ? p.text.trim() : "";
	if (["steer", "follow_up", "resume"].includes(p.action) && !text)
		return { error: "bad_request", message: "text is required" };
	const key = child && `${run.id}/${child.id}`;
	switch (p.action) {
		case "steer":
			flushPending(key);
			subItem(key, { kind: "user", text });
			if (child.state === "waiting") {
				child.state = "running";
				child.question = undefined;
			}
			publishRun(id, run);
			return { result: {} };
		case "follow_up":
			subTranscripts.get(key).followUps.push(text);
			return { result: { message: "今の作業が終わったら伝えます" } };
		case "stop_child":
		case "stop": {
			const targets = p.action === "stop" ? run.children : [child];
			for (const c of targets) if (SUB_ACTIVE.has(c.state)) c.state = "stopping";
			publishRun(id, run);
			setTimeout(() => {
				for (const c of targets)
					if (c.state === "stopping") {
						c.state = "stopped";
						c.endedAt = Date.now();
						c.activity = undefined;
						c.actions = ["resume"];
					}
				if (p.action === "stop") run.actions = [];
				publishRun(id, run);
			}, 1500);
			return { result: {} };
		}
		case "abort_parent":
			for (const c of run.children)
				if (SUB_ACTIVE.has(c.state)) {
					c.state = "stopped";
					c.endedAt = Date.now();
					c.activity = undefined;
				}
			publishRun(id, run);
			setStatus(id, "idle");
			return { result: { message: "親の Pi の作業を止めました" } };
		case "resume": {
			const next = newRun(id, { mode: "single", resumedFrom: run.id, toolCallId: undefined });
			run.resumedAs = next.id;
			child.actions = child.actions.filter((a) => a !== "resume");
			const c = addChild(next, {
				id: `${next.id}-c1`,
				index: 0,
				agent: child.agent,
				title: child.title,
				model: child.model,
				task: text,
				steps: [
					{ tool: "read", args: { path: "src/auth/refresh.ts" }, result: fileRead(96) },
					{ tool: "grep", args: { pattern: "retry", path: "src/auth/" }, result: "src/auth/refresh.ts:61" },
					{ text: "続きを確認しました。追加の指摘はありません。" },
				],
			});
			c.startedAt = Date.now();
			publishRun(id, run);
			publishRun(id, next);
			return { result: { newRunId: next.id } };
		}
		default:
			return { error: "unsupported", message: `${p.action} is not available` };
	}
};

// The parent instance of the subagent screens (Chat-Subagents.html).
const AUTH_ID = "5d0c4e88-auth";
const AUTH_TOOL = "auth-subagent-1";
addInstance(AUTH_ID, {
	cwd: "/home/dev/work/api",
	name: "認証まわりのレビュー",
	updatedAgo: 5 * MIN,
	model: { provider: "anthropic", id: "claude-opus-5-5" },
	thinking: "high",
	history: [
		{
			kind: "user",
			entryId: eid(),
			text: "ログインまわりの実装を読んで、構成を教えて",
			timestamp: Date.now() - 12 * MIN,
		},
		{
			kind: "assistant",
			entryId: eid(),
			text: "認証は `src/auth/` にまとまっています。\n\n- `session.ts` がセッションの保存と期限の判定\n- `refresh.ts` がトークンの更新\n- `guard.tsx` が未ログイン時の画面の切り替え",
			timestamp: Date.now() - 12 * MIN + 31_000,
			toolCalls: [],
			model: { provider: "anthropic", id: "claude-opus-5-5" },
			usage: { input: 14_000, output: 380, cost: 0.09 },
			stopReason: "stop",
		},
		{
			kind: "user",
			entryId: eid(),
			text: "正しさ・テスト・複雑さの3つの観点で、並列にレビューして。バックグラウンドでいいよ",
			timestamp: Date.now() - 5 * MIN,
		},
		{
			kind: "assistant",
			entryId: eid(),
			text: "",
			timestamp: Date.now() - 5 * MIN + 4_000,
			toolCalls: [{ id: AUTH_TOOL, name: "subagent", args: { agent: "reviewer", tasks: 3, async: true } }],
			model: { provider: "anthropic", id: "claude-opus-5-5" },
			stopReason: "toolUse",
		},
		{
			kind: "tool_result",
			entryId: eid(),
			toolCallId: AUTH_TOOL,
			toolName: "subagent",
			text: "Started 3 reviewers in the background.",
			isError: false,
		},
		{
			kind: "assistant",
			entryId: eid(),
			text: "レビュアーを3人、バックグラウンドで起動しました。終わりしだい、指摘を重要度順にまとめて報告します。",
			timestamp: Date.now() - 5 * MIN + 6_000,
			toolCalls: [],
			model: { provider: "anthropic", id: "claude-opus-5-5" },
			usage: { input: 15_000, output: 120, cost: 0.05 },
			stopReason: "stop",
		},
	],
});
seedPrevious(AUTH_ID);
startParallel(AUTH_ID, AUTH_TOOL);

/** /_dev/sub?kind=… */
function devSubagents(kind, id) {
	switch (kind) {
		case "parallel":
			return startParallel(id ?? AUTH_ID).id;
		case "waiting":
			return startWaiting(id ?? "3e8f0a55-api").id;
		case "chain":
			return startChain(id ?? "1f5e6a77-poc").id;
		case "hold":
			subHold = !subHold;
			return subHold ? "held" : "running";
		case "answer": {
			for (const [iid, inst] of instances)
				if (!id || iid === id)
					for (const run of inst.subagents?.runs ?? [])
						for (const c of run.children)
							if (c.state === "waiting") {
								c.state = "running";
								c.question = undefined;
								publishRun(iid, run);
							}
			return "ok";
		}
		case "finish": {
			for (const [iid, inst] of instances)
				if (!id || iid === id)
					for (const run of inst.subagents?.runs ?? [])
						if (SUB_ACTIVE.has(run.state)) {
							for (const c of run.children)
								while (SUB_ACTIVE.has(c.state)) {
									c.state = "running";
									c.question = undefined;
									stepChild(run, c);
								}
							publishRun(iid, run);
						}
			return "ok";
		}
		case "reset": {
			const iid = id ?? AUTH_ID;
			const st = subState(iid);
			st.runs = [];
			emit(iid, { type: "subagents_reset", state: clone(st) });
			instances.get(iid).summary.subagents = subCounts([]);
			broadcastInstances();
			return "ok";
		}
		default:
			return null;
	}
}

// ------------------------------------------------------------------ HTTP

const server = createServer((req, res) => {
	const url = new URL(req.url, "http://x");
	const reply = (status, body) => {
		res.writeHead(status, { "content-type": "application/json" });
		res.end(JSON.stringify(body));
	};
	if (req.method === "GET" && url.pathname === "/health") return reply(200, { ok: true, protocol: 1 });
	if (req.method === "POST" && url.pathname === "/pair") {
		let body = "";
		req.on("data", (c) => {
			body += c;
		});
		req.on("end", () => {
			let value;
			try {
				value = JSON.parse(body);
			} catch {
				return reply(400, { error: "bad_request" });
			}
			if (!value || typeof value.code !== "string" || typeof value.deviceName !== "string")
				return reply(400, { error: "bad_request" });
			if (value.code.startsWith("expired")) return reply(410, { error: "expired_code" });
			if (value.code !== pairCode) return reply(401, { error: "invalid_code" });
			const token = randomBytes(32).toString("base64url");
			state.tokens.push(token);
			saveState();
			log(`paired "${value.deviceName}"`);
			reply(200, { hostId: state.hostId, hostName: HOST_NAME, deviceId: randomUUID(), token });
		});
		return;
	}
	if (req.method === "POST" && url.pathname.startsWith("/_dev/")) {
		const cmd = url.pathname.slice(6);
		const id = url.searchParams.get("i") ?? [...instances.keys()][0];
		const inst = instances.get(id);
		switch (cmd) {
			case "quota": {
				// Issue #59: the RC shares the newest PC-wide snapshot, so every instance gets the same event.
				const source = url.searchParams.get("source") === "codex" ? "codex" : "claude";
				const quota = {
					source,
					windows: [
						{
							minutes: 300,
							usedPercent: Number(url.searchParams.get("p") ?? 50),
							resetsAt: Date.now() + Number(url.searchParams.get("reset") ?? 3600) * 1000,
						},
					],
					observedAt: Date.now(),
				};
				for (const i of instances.keys()) emit(i, { type: "quota", quota });
				return reply(200, { ok: true });
			}
			case "auth": {
				if (!inst) return reply(404, {});
				for (const key of ["old", "oldHost", "fail", "refresh", "badurl"])
					if (url.searchParams.has(key)) authOptions[key] = url.searchParams.get(key) === "1";
				if (url.searchParams.has("saving"))
					authOptions.saving = Math.max(0, Math.min(30000, Number(url.searchParams.get("saving")) || 0));
				const flow = authFlows.get(id);
				if (flow && authActive(flow) && flow.status !== "saving") {
					if (url.searchParams.has("expire"))
						changeAuth(id, { status: "expired", prompt: undefined, authorization: undefined });
					else if (url.searchParams.has("complete")) saveAuth(id);
				}
				return reply(200, { ok: true, options: authOptions });
			}
			case "turn":
				if (!inst) return reply(404, {});
				if (inst.turn) inst.followUps.push("PC から: 続けて");
				else startTurn(id, "PC から: --shout フラグを追加して。テストも書いて", "full");
				break;
			case "ask": {
				if (!inst) return reply(404, {});
				const make = ASK[url.searchParams.get("kind") ?? "confirm"];
				if (!make) return reply(400, { error: "kind must be select|confirm|input|editor" });
				const request = { requestId: `ui-${Date.now()}`, ...make() };
				inst.pendingUI.push(request);
				emit(id, { type: "ui_request", request });
				setStatus(id, "waiting_input");
				break;
			}
			case "answered": {
				const request = inst?.pendingUI.shift();
				if (!request) return reply(404, { error: "no open question" });
				emit(id, { type: "ui_request_end", requestId: request.requestId, by: "tui" });
				if (!inst.pendingUI.length) setStatus(id, inst.turn ? "running" : "idle");
				break;
			}
			case "custom": {
				if (!inst) return reply(404, {});
				if (url.searchParams.get("end")) {
					const kind = inst.pcPrompt?.kind ?? "custom";
					inst.pcPrompt = null;
					emit(id, { type: "ui_prompt", phase: "end", kind });
					setStatus(id, inst.turn ? "running" : "idle");
				} else {
					inst.pcPrompt = { kind: "custom", title: url.searchParams.get("title") ?? "git-graph" };
					emit(id, { type: "ui_prompt", phase: "start", ...inst.pcPrompt });
					setStatus(id, "waiting_input");
				}
				break;
			}
			case "model": {
				if (!inst) return reply(404, {});
				RC.set_model(id, { provider: "openai", id: "gpt-6-luna" });
				RC.set_thinking(id, { level: "low" });
				break;
			}
			case "resume": {
				if (!inst) return reply(404, {});
				const from = inst.summary.session?.name;
				const session = { id: `sess-${Date.now()}`, name: "エラー処理の見直し" };
				switchSession(id, "resume", session, [
					{ kind: "user", entryId: eid(), text: "エラーメッセージを日本語にそろえて" },
					{
						kind: "assistant",
						entryId: eid(),
						text: "エラーメッセージを `errors.ts` にまとめ、文言を日本語にそろえました。",
						toolCalls: [],
						model: MODEL,
						usage: { input: 9100, output: 380, cost: 0.04 },
						stopReason: "stop",
					},
				]);
				log(`resume: ${from} -> ${session.name}`);
				break;
			}
			case "sub": {
				const result = devSubagents(url.searchParams.get("kind"), url.searchParams.get("i") ?? undefined);
				if (!result) return reply(400, { error: "kind must be parallel|waiting|chain|answer|finish|hold|reset" });
				return reply(200, { ok: true, result });
			}
			case "refuse-shutdown":
				refuseShutdown = url.searchParams.get("on") !== "0";
				return reply(200, { ok: true, refuseShutdown });
			case "gone":
				if (!inst) return reply(404, {});
				removeInstance(id);
				break;
			case "drop":
				for (const p of [...peers]) p.destroy();
				break;
			case "offline": {
				const s = Number(url.searchParams.get("s") ?? 20);
				refuseUntil = Date.now() + s * 1000;
				for (const p of [...peers]) p.destroy();
				log(`offline for ${s}s`);
				break;
			}
			case "revoke":
				state.tokens = [];
				saveState();
				for (const p of [...peers]) p.close(4403);
				break;
			case "pair":
				pairCode = randomBytes(18).toString("base64url");
				printLink();
				return reply(200, pairingLink());
			default:
				return reply(404, { error: "unknown command" });
		}
		return reply(200, { ok: true });
	}
	reply(404, {});
});

server.on("upgrade", (req, socket) => {
	if (req.url !== "/ws" || Date.now() < refuseUntil) {
		socket.destroy();
		return;
	}
	const key = req.headers["sec-websocket-key"];
	const accept = createHash("sha1")
		.update(key + GUID)
		.digest("base64");
	socket.write(
		`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
	);
	socket.setNoDelay(true);
	peers.add(new Peer(socket));
});

server.listen(port, listen, () => {
	if (port === 0) {
		port = server.address().port;
		if (!args.includes("--address")) address = `${listen}:${port}`;
	}
	console.log(`Fake PiMate Host on http://${listen}:${port} (hostId ${state.hostId}, state ${statePath})`);
	printLink();
});

const stop = () => {
	for (const p of [...peers]) p.destroy();
	server.close(() => process.exit(0));
	setTimeout(() => process.exit(0), 500).unref();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
