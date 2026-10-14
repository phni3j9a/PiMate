import type { InstanceSummary, TranscriptItem } from "@pimate/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HostRegistry, MemoryStorage } from "../src/lib/hostRegistry";
import { AppStore, SPAWN_APPEAR_TIMEOUT_MS } from "../src/lib/store";
import { authenticate, FakeSocket, hostInfo } from "./fakes";

const instance = (id: string, updatedAt = 1): InstanceSummary => ({
	instanceId: id,
	cwd: `/home/me/${id}`,
	origin: "pc",
	abducoSession: null,
	pcAttached: null,
	session: { id: "s1", name: id },
	status: "idle",
	startedAt: 0,
	updatedAt,
});

let uuid = 0;

/** rc requests other than the automatic `models` lookup. */
const opRcs = (s: FakeSocket) => s.sentOfType("rc").filter((m) => m.request.method !== "models");

async function setup(opts: { paired?: boolean } = {}) {
	const storage = new MemoryStorage();
	if (opts.paired !== false)
		await new HostRegistry(storage).save({
			hostId: "h1",
			hostName: "srv",
			address: "127.0.0.1:47800",
			deviceId: "d1",
			token: "tok",
			pairedAt: 0,
		});
	const store = new AppStore({
		storage,
		createSocket: (url) => new FakeSocket(url),
		fetch: async () => ({
			status: 200,
			json: async () => ({ hostId: "h2", hostName: "new", deviceId: "d2", token: "t2" }),
		}),
		randomUUID: () => `req-${++uuid}`,
		deviceName: () => "Pixel",
		app: { version: "1.0.0", platform: "android" },
	});
	await store.init();
	return { store, storage };
}

function subscribedMsg(
	items: TranscriptItem[],
	sessionId = "s1",
	status: "idle" | "running" = "idle",
	extra: Record<string, unknown> = {},
) {
	return {
		type: "subscribed",
		instanceId: "i1",
		snapshot: {
			protocol: 1,
			instanceId: "i1",
			pid: 1,
			cwd: "/home/me/i1",
			origin: "pc",
			abducoSession: null,
			startedAt: 0,
			session: { id: sessionId, name: sessionId },
			status,
			model: null,
			thinking: null,
			pendingUI: [],
			seq: 5,
			...extra,
		},
		history: { session: { id: sessionId, name: sessionId }, items },
	};
}

/** Connects h1 with one instance; the store auto-selects it and we answer the subscribe. */
function connect(items: TranscriptItem[] = []) {
	const s = FakeSocket.last();
	authenticate(s, [instance("i1", 5), instance("i0", 1)]);
	s.receive(subscribedMsg(items));
	return s;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
	FakeSocket.reset();
});
afterEach(() => {
	vi.useRealTimers();
});

describe("AppStore", () => {
	it("starts unpaired, then pairs and connects", async () => {
		const { store, storage } = await setup({ paired: false });
		expect(store.getState().loaded).toBe(true);
		expect(store.getState().hosts).toEqual([]);
		await store.pair({ address: "10.0.0.2:47800", code: "AbCdEfGhIjKlMnOpQr", hostName: "new", hostId: "h2" });
		expect(store.getState().hosts.map((h) => [h.hostId, h.state])).toEqual([["h2", "connecting"]]);
		expect(FakeSocket.last().url).toBe("ws://10.0.0.2:47800/ws");
		expect((await new HostRegistry(storage).load())[0].token).toBe("t2");
	});

	it("auto-selects the most recent instance, subscribes and remembers it", async () => {
		const { store, storage } = await setup();
		const s = connect([{ kind: "user", entryId: "u1", text: "hi" }]);
		expect(store.getState().selection).toEqual({ hostId: "h1", instanceId: "i1" });
		expect(s.sentOfType("subscribe")).toEqual([{ type: "subscribe", instanceId: "i1" }]);
		expect(store.getState().view?.items).toHaveLength(1);
		await flush();
		expect(await new HostRegistry(storage).loadSelection()).toEqual({ hostId: "h1", instanceId: "i1" });
		store.select("h1", "i0");
		expect(s.sentOfType("unsubscribe")).toEqual([{ type: "unsubscribe", instanceId: "i1" }]);
		expect(store.getState().view?.phase).toBe("loading");
	});

	it("sends a guarded prompt, keeps the draft until rc_result and never inserts optimistically", async () => {
		const { store } = await setup();
		const s = connect();
		store.setDraft("hello  ");
		const sending = store.send();
		const rc = opRcs(s)[0];
		expect(rc).toMatchObject({
			instanceId: "i1",
			request: { method: "prompt", params: { text: "hello" }, expectInstanceId: "i1", expectSessionId: "s1" },
		});
		expect(store.getState().drafts["h1/i1"]).toBe("hello  ");
		expect(store.sendBlocker()).toBe("sending");
		expect(store.getState().view?.items).toEqual([]);
		s.receive({
			type: "rc_result",
			instanceId: "i1",
			response: { type: "response", id: rc.request.id, ok: true, result: { deliveredAs: "prompt" } },
		});
		await sending;
		expect(store.getState().drafts["h1/i1"]).toBe("");
		expect(store.getState().outbox).toMatchObject([{ state: "delivered", text: "hello" }]);
		// The real message arrives: the delivered entry disappears.
		s.receive({
			type: "event",
			instanceId: "i1",
			sessionId: "s1",
			seq: 6,
			event: { type: "message_end", item: { kind: "user", entryId: "u9", text: "hello" } },
		});
		expect(store.getState().outbox).toEqual([]);
		expect(store.getState().view?.items).toHaveLength(1);
	});

	it("shows follow-ups as queued until Pi takes them", async () => {
		const { store } = await setup();
		const s = connect();
		store.setDraft("later");
		const p = store.send();
		const id = opRcs(s)[0].request.id;
		s.receive({
			type: "rc_result",
			instanceId: "i1",
			response: { type: "response", id, ok: true, result: { deliveredAs: "followUp" } },
		});
		await p;
		expect(store.getState().outbox).toMatchObject([{ state: "queued", deliveredAs: "followUp" }]);
		s.receive({
			type: "event",
			instanceId: "i1",
			sessionId: "s1",
			seq: 9,
			event: { type: "agent_settled", aborted: false },
		});
		expect(store.getState().outbox).toEqual([]);
	});

	it("keeps the draft and requires confirmation when the session changed", async () => {
		const { store } = await setup();
		const s = connect();
		store.setDraft("fix it");
		const p = store.send();
		const id = opRcs(s)[0].request.id;
		s.receive({
			type: "rc_result",
			instanceId: "i1",
			response: { type: "response", id, ok: false, error: { code: "session_changed" } },
		});
		await p;
		const st = store.getState();
		expect(st.drafts["h1/i1"]).toBe("fix it");
		expect(st.notice?.kind).toBe("error");
		expect(st.targetChanged).not.toBeNull();
		expect(store.sendBlocker()).toBe("target_changed");
		store.confirmTarget();
		expect(store.sendBlocker()).toBeNull();
		expect(opRcs(s)).toHaveLength(1);
	});

	it("marks a send unconfirmed when the connection drops and resolves it after the resync", async () => {
		vi.useFakeTimers();
		const { store } = await setup();
		connect([{ kind: "user", entryId: "u1", text: "old" }]);
		store.setDraft("are you there");
		const p = store.send();
		FakeSocket.last().drop();
		await p;
		let st = store.getState();
		expect(st.outbox).toMatchObject([{ state: "unconfirmed" }]);
		expect(st.notice?.kind).toBe("unconfirmed");
		expect(st.drafts["h1/i1"]).toBe("are you there");
		expect(store.sendBlocker()).toBe("offline");
		// Reconnect: the Host resends the subscription; the message turns out to have arrived.
		vi.advanceTimersByTime(1200);
		const s2 = FakeSocket.last();
		authenticate(s2, [instance("i1", 5)]);
		expect(s2.sentOfType("subscribe")).toEqual([{ type: "subscribe", instanceId: "i1" }]);
		expect(opRcs(s2)).toEqual([]);
		s2.receive(
			subscribedMsg([
				{ kind: "user", entryId: "u1", text: "old" },
				{ kind: "user", entryId: "u2", text: "are you there" },
			]),
		);
		st = store.getState();
		expect(st.outbox).toEqual([]);
		expect(st.notice).toBeNull();
		expect(st.drafts["h1/i1"]).toBe("");
	});

	it("keeps the unconfirmed notice when the resync does not contain the message", async () => {
		vi.useFakeTimers();
		const { store } = await setup();
		connect();
		store.setDraft("lost");
		const p = store.send();
		FakeSocket.last().drop();
		await p;
		vi.advanceTimersByTime(1200);
		const s2 = FakeSocket.last();
		authenticate(s2, [instance("i1", 5)]);
		s2.receive(subscribedMsg([]));
		const st = store.getState();
		expect(st.notice?.kind).toBe("unconfirmed");
		expect(st.drafts["h1/i1"]).toBe("lost");
		expect(opRcs(s2)).toEqual([]);
	});

	it("does not treat the same text in another session as delivered", async () => {
		vi.useFakeTimers();
		const { store } = await setup();
		connect();
		store.setDraft("continue");
		const p = store.send();
		FakeSocket.last().drop();
		await p;
		vi.advanceTimersByTime(1200);
		const s2 = FakeSocket.last();
		authenticate(s2, [instance("i1", 5)]);
		s2.receive(subscribedMsg([{ kind: "user", entryId: "old", text: "continue" }], "s2"));
		const st = store.getState();
		expect(st.outbox).toMatchObject([{ state: "unconfirmed" }]);
		expect(st.drafts["h1/i1"]).toBe("continue");
	});

	it("re-subscribes after session_changed and flags a pending draft", async () => {
		const { store } = await setup();
		const s = connect([{ kind: "user", entryId: "u1", text: "hi" }]);
		store.setDraft("draft");
		s.receive({
			type: "event",
			instanceId: "i1",
			sessionId: "s2",
			seq: 7,
			event: { type: "session_changed", reason: "resume", session: { id: "s2", name: "other" } },
		});
		expect(store.getState().view?.phase).toBe("resyncing");
		expect(s.sentOfType("subscribe")).toHaveLength(2);
		expect(store.getState().targetChanged).toEqual({ to: "other" });
		s.receive(subscribedMsg([], "s2"));
		expect(store.getState().view?.phase).toBe("ready");
		expect(store.getState().view?.sessionNotice).toMatchObject({ reason: "resume", to: "other" });
	});

	it("persists auth failure and stops connecting", async () => {
		const { store, storage } = await setup();
		const s = FakeSocket.last();
		s.open();
		s.receive({ type: "auth_error", code: "invalid_token" });
		expect(store.getState().hosts[0].state).toBe("auth_failed");
		await flush();
		expect((await new HostRegistry(storage).load())[0].needsRepair).toBe(true);
		store.foreground();
		expect(FakeSocket.all).toHaveLength(1);
	});

	it("removes a host and clears its selection", async () => {
		const { store, storage } = await setup();
		connect();
		await store.removeHost("h1");
		expect(store.getState().hosts).toEqual([]);
		expect(store.getState().selection).toBeNull();
		expect(await new HostRegistry(storage).load()).toEqual([]);
	});

	it("drops a restored selection that no longer exists", async () => {
		const storage = new MemoryStorage();
		const reg = new HostRegistry(storage);
		await reg.save({ hostId: "h1", hostName: "srv", address: "a:1", deviceId: "d", token: "t", pairedAt: 0 });
		await reg.saveSelection({ hostId: "h1", instanceId: "gone" });
		const store = new AppStore({
			storage,
			createSocket: (url) => new FakeSocket(url),
			fetch: async () => ({ status: 500, json: async () => ({}) }),
			randomUUID: () => "x",
			deviceName: () => "p",
			app: { version: "1", platform: "android" },
		});
		await store.init();
		expect(store.getState().selection?.instanceId).toBe("gone");
		const s = FakeSocket.last();
		authenticate(s, [instance("i1", 5)]);
		expect(store.getState().selection?.instanceId).toBe("i1");
	});

	it("keeps a restored selection until the instance list arrives", async () => {
		const storage = new MemoryStorage();
		const reg = new HostRegistry(storage);
		await reg.save({ hostId: "h1", hostName: "srv", address: "a:1", deviceId: "d", token: "t", pairedAt: 0 });
		await reg.saveSelection({ hostId: "h1", instanceId: "i0" });
		const store = new AppStore({
			storage,
			createSocket: (url) => new FakeSocket(url),
			fetch: async () => ({ status: 500, json: async () => ({}) }),
			randomUUID: () => "x",
			deviceName: () => "p",
			app: { version: "1", platform: "android" },
		});
		await store.init();
		const s = FakeSocket.last();
		s.open();
		s.receive({ type: "auth_ok", host: hostInfo, deviceId: "d1" });
		expect(store.getState().selection?.instanceId).toBe("i0");
		s.receive({ type: "instances", instances: [instance("i1", 5), instance("i0", 1)] });
		expect(store.getState().selection?.instanceId).toBe("i0");
	});

	it("does not abort while the session is unknown", async () => {
		const { store } = await setup();
		authenticate(FakeSocket.last(), [instance("i1", 5)]);
		await store.abort();
		expect(opRcs(FakeSocket.last())).toEqual([]);
	});

	it("aborts with an instance guard", async () => {
		const { store } = await setup();
		const s = connect();
		const p = store.abort();
		const rc = opRcs(s)[0];
		expect(rc.request).toMatchObject({ method: "abort", expectInstanceId: "i1", expectSessionId: "s1" });
		s.receive({
			type: "rc_result",
			instanceId: "i1",
			response: { type: "response", id: rc.request.id, ok: true, result: {} },
		});
		await p;
		expect(store.getState().aborting).toBe(false);
	});
});

const ASK = { requestId: "q1", kind: "select" as const, title: "方式は？", options: ["A", "B"] };

/** Replies to an rc request (by its request id). */
function rcReply(s: FakeSocket, id: string, ok: true, result?: unknown): void;
function rcReply(s: FakeSocket, id: string, ok: false, error: { code: string; message?: string }): void;
function rcReply(s: FakeSocket, id: string, ok: boolean, payload: unknown = {}) {
	s.receive({
		type: "rc_result",
		instanceId: "i1",
		response: ok ? { type: "response", id, ok, result: payload } : { type: "response", id, ok, error: payload },
	});
}

const event = (seq: number, ev: Record<string, unknown>, sessionId = "s1") => ({
	type: "event",
	instanceId: "i1",
	sessionId,
	seq,
	event: ev,
});

describe("AppStore M2", () => {
	it("answers a dialog with both guards and only once while in flight", async () => {
		const { store } = await setup();
		const s = FakeSocket.last();
		authenticate(s, [instance("i1", 5)]);
		s.receive(subscribedMsg([], "s1", "idle", { pendingUI: [ASK] }));
		expect(store.sendBlocker()).toBe("dialog");

		const first = store.answerUI("q1", { value: "B" });
		void store.answerUI("q1", { value: "A" });
		void store.answerUI("unknown", { cancelled: true });
		const sent = opRcs(s);
		expect(sent).toHaveLength(1);
		expect(sent[0].request).toMatchObject({
			method: "ui_respond",
			params: { requestId: "q1", value: "B" },
			expectInstanceId: "i1",
			expectSessionId: "s1",
		});
		expect(store.getState().answering).toBe("q1");
		rcReply(s, sent[0].request.id, true);
		await first;
		expect(store.getState().answering).toBeNull();
		s.receive(event(6, { type: "ui_request_end", requestId: "q1", by: "remote" }));
		expect(store.getState().view?.pendingUI).toEqual([]);
		expect(store.getState().view?.uiNotes).toEqual([]);
	});

	it("drops a dialog that was already answered elsewhere and says so", async () => {
		const { store } = await setup();
		const s = FakeSocket.last();
		authenticate(s, [instance("i1", 5)]);
		s.receive(subscribedMsg([], "s1", "idle", { pendingUI: [ASK] }));
		const p = store.answerUI("q1", { confirmed: true });
		rcReply(s, opRcs(s)[0].request.id, false, { code: "no_such_request" });
		await p;
		expect(store.getState().view?.pendingUI).toEqual([]);
		expect(store.getState().notice).toMatchObject({ kind: "error", title: "回答できませんでした" });
	});

	it("notes a question answered on the PC and shows a PC-only prompt", async () => {
		const { store } = await setup();
		const s = FakeSocket.last();
		authenticate(s, [instance("i1", 5)]);
		s.receive(
			subscribedMsg([{ kind: "user", entryId: "u1", text: "hi" }], "s1", "idle", {
				pendingUI: [ASK],
				pcPrompt: { kind: "custom", title: "git-graph" },
			}),
		);
		expect(store.getState().view?.uiPrompt).toEqual({ kind: "custom", title: "git-graph" });
		s.receive(event(6, { type: "ui_request_end", requestId: "q1", by: "tui" }));
		expect(store.getState().view?.uiNotes).toEqual([
			{ requestId: "q1", afterEntryId: "u1", text: "PC で回答されました：方式は？" },
		]);
		expect(store.sendBlocker()).toBe("pc_prompt");
		s.receive(event(7, { type: "ui_prompt", phase: "end", kind: "custom" }));
		expect(store.getState().view?.uiPrompt).toBeNull();
	});

	it("does not ask to confirm the draft target after a session change started on the phone", async () => {
		const { store } = await setup();
		const s = connect([{ kind: "user", entryId: "u1", text: "hi" }]);
		store.setDraft("next question");
		const op = store.sessionOp("new");
		const rc = opRcs(s)[0];
		expect(rc.request).toMatchObject({ method: "session_op", params: { op: "new" }, expectSessionId: "s1" });
		rcReply(s, rc.request.id, true);
		await op;
		s.receive(event(6, { type: "session_changed", reason: "new", session: { id: "s2" } }));
		expect(store.getState().targetChanged).toBeNull();
		expect(store.getState().view?.sessionNotice).toMatchObject({ reason: "new", byPhone: true });
		s.receive(event(7, { type: "session_op_done", op: "new", cancelled: false }, "s2"));
		expect(store.getState().op).toBeNull();
	});

	it("requires confirmation before a draft goes to a session switched on the PC", async () => {
		const { store } = await setup();
		const s = connect();
		store.setDraft("draft");
		s.receive(event(6, { type: "session_changed", reason: "resume", session: { id: "s2", name: "別の会話" } }));
		expect(store.getState().targetChanged).toEqual({ to: "別の会話" });
		s.receive(subscribedMsg([], "s2"));
		expect(store.sendBlocker()).toBe("target_changed");
		await store.send();
		expect(opRcs(s).filter((m) => m.request.method === "prompt")).toEqual([]);
		store.confirmTarget();
		expect(store.sendBlocker()).toBeNull();
	});

	it("offers the forked message as the draft and reports a cancelled op", async () => {
		const { store } = await setup();
		const s = connect([{ kind: "user", entryId: "u1", text: "最初の質問" }]);
		const fork = store.sessionOp("fork", "u1", "最初の質問");
		rcReply(s, opRcs(s)[0].request.id, true);
		await fork;
		s.receive(event(6, { type: "session_changed", reason: "fork", session: { id: "s2" } }));
		s.receive(subscribedMsg([], "s2"));
		s.receive(event(7, { type: "session_op_done", op: "fork", cancelled: false }, "s2"));
		expect(store.getState().drafts["h1/i1"]).toBe("最初の質問");

		const again = store.sessionOp("new");
		rcReply(s, opRcs(s)[1].request.id, true);
		await again;
		s.receive(event(8, { type: "session_op_done", op: "new", cancelled: true }, "s2"));
		expect(store.getState().op).toBeNull();
		expect(store.getState().notice?.kind).toBe("info");
		expect(store.getState().notice?.text).toContain("新しいセッションは取り消されました");
	});

	it("allows one op at a time and surfaces RC errors", async () => {
		const { store } = await setup();
		const s = connect();
		const compact = store.compact();
		expect((await store.setThinking("high")).ok).toBe(false);
		rcReply(s, opRcs(s)[0].request.id, false, { code: "busy" });
		const res = await compact;
		expect(res.ok).toBe(false);
		expect(store.getState().op).toBeNull();
		expect(store.getState().notice?.kind).toBe("error");
	});

	it("spawns a Pi, waits for it in the list and opens it", async () => {
		const { store } = await setup();
		const s = connect();
		const p = store.spawn("h1", { cwd: "~/code/x", trust: true, message: "hello" });
		const [msg] = s.sentOfType("spawn");
		expect(msg.params).toEqual({ cwd: "~/code/x", trust: true, message: "hello" });
		s.receive({ type: "spawn_result", requestId: msg.requestId, ok: true, instanceId: "i9", abducoSession: "a9" });
		await flush();
		expect(store.getState().selection?.instanceId).toBe("i1");
		s.receive({ type: "instances", instances: [instance("i1", 5), { ...instance("i9", 9), origin: "mobile" }] });
		expect(await p).toEqual({ ok: true, value: { instanceId: "i9" } });
		expect(store.getState().selection).toEqual({ hostId: "h1", instanceId: "i9" });
	});

	it("reports spawn errors and never retries", async () => {
		const { store } = await setup();
		const s = connect();
		const p = store.spawn("h1", { cwd: "/nope" });
		const [msg] = s.sentOfType("spawn");
		s.receive({ type: "spawn_result", requestId: msg.requestId, ok: false, code: "not_found", message: "/nope" });
		expect(await p).toMatchObject({ ok: false, title: "起動できませんでした" });

		const half = store.spawn("h1", { cwd: "/y", message: "hi" });
		const second = s.sentOfType("spawn")[1];
		s.receive({
			type: "spawn_result",
			requestId: second.requestId,
			ok: false,
			code: "spawn_failed",
			message: "Error: boom; Pi started: i9 (pimate attach pimate-i9); message outcome may be unknown, not resent",
		});
		expect(await half).toMatchObject({
			ok: false,
			title: "Pi は起動しましたが、最初のメッセージを送れませんでした",
			text: expect.stringContaining("pimate attach pimate-i9"),
		});

		const lost = store.spawn("h1", { cwd: "/x" });
		s.drop();
		expect(await lost).toMatchObject({ ok: false, title: "起動したか確認できません" });
		expect(s.sentOfType("spawn")).toHaveLength(3);
	});

	it("gives up waiting for a spawned Pi that never appears", async () => {
		vi.useFakeTimers();
		const { store } = await setup();
		const s = connect();
		const p = store.spawn("h1", { cwd: "/x" });
		const [msg] = s.sentOfType("spawn");
		s.receive({ type: "spawn_result", requestId: msg.requestId, ok: true, instanceId: "i9", abducoSession: "a9" });
		await vi.advanceTimersByTimeAsync(SPAWN_APPEAR_TIMEOUT_MS + 10);
		expect(await p).toMatchObject({ ok: false, title: "起動しましたが、まだ一覧にありません" });
		expect(store.getState().selection?.instanceId).toBe("i1");
	});
});
