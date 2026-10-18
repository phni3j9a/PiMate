import type { InstanceSummary, PromptImage, TranscriptItem } from "@pimate/protocol";
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

	it("clears a queued steer when Pi settles normally", async () => {
		const { store } = await setup();
		const s = connect();
		store.setDraft("direction");
		const p = store.send();
		const id = opRcs(s)[0].request.id;
		s.receive({
			type: "rc_result",
			instanceId: "i1",
			response: { type: "response", id, ok: true, result: { deliveredAs: "steer" } },
		});
		await p;
		expect(store.getState().outbox).toMatchObject([{ state: "queued", deliveredAs: "steer" }]);
		s.receive({
			type: "event",
			instanceId: "i1",
			sessionId: "s1",
			seq: 9,
			event: { type: "agent_settled", aborted: false },
		});
		expect(store.getState().outbox).toEqual([]);
	});

	it.each(["idle", "running"] as const)("always requests steer when the phone sees %s", async (status) => {
		const { store } = await setup();
		const s = connect();
		s.receive(subscribedMsg([], "s1", status));
		store.setDraft("direction");
		const p = store.send();
		const rc = opRcs(s)[0];
		expect(rc.request).toMatchObject({
			params: { text: "direction", deliverAs: "steer" },
			expectInstanceId: "i1",
			expectSessionId: "s1",
		});
		s.receive({
			type: "rc_result",
			instanceId: "i1",
			response: { type: "response", id: rc.request.id, ok: true, result: { deliveredAs: "steer" } },
		});
		await p;
		expect(store.getState().outbox).toMatchObject([{ state: "queued", deliveredAs: "steer" }]);
		s.receive({
			type: "event",
			instanceId: "i1",
			sessionId: "s1",
			seq: 6,
			event: { type: "message_end", item: { kind: "user", entryId: "u9", text: "direction" } },
		});
		expect(store.getState().outbox).toEqual([]);
	});

	it("accepts prompt delivery from an idle RC while still requesting steer", async () => {
		const { store } = await setup();
		const s = connect();
		store.setDraft("start");
		const p = store.send();
		const rc = opRcs(s)[0];
		expect(rc.request.params).toEqual({ text: "start", deliverAs: "steer" });
		s.receive({
			type: "rc_result",
			instanceId: "i1",
			response: { type: "response", id: rc.request.id, ok: true, result: { deliveredAs: "prompt" } },
		});
		await p;
	});

	it.each(["before", "after"])("keeps an unconsumed steer when stop settles %s its send ACK", async (ack) => {
		const { store } = await setup();
		const s = connect();
		s.receive(subscribedMsg([], "s1", "running"));
		store.setDraft("direction");
		const sending = store.send();
		const id = opRcs(s)[0].request.id;
		const receipt = () =>
			s.receive({
				type: "rc_result",
				instanceId: "i1",
				response: { type: "response", id, ok: true, result: { deliveredAs: "steer" } },
			});
		if (ack === "after") {
			receipt();
			await sending;
		}
		s.receive({
			type: "event",
			instanceId: "i1",
			sessionId: "s1",
			seq: 6,
			event: { type: "agent_settled", aborted: true },
		});
		if (ack === "before") {
			receipt();
			await sending;
		}
		expect(store.getState().outbox).toMatchObject([{ state: "unconfirmed", text: "direction" }]);
		expect(store.getState().drafts["h1/i1"]).toBe(ack === "before" ? "direction" : "");
		expect(store.getState().notice).toMatchObject({ kind: "unconfirmed" });
		expect(store.getState().notice?.title).toContain("届いていない可能性");
		s.receive(subscribedMsg([], "s1", "idle"));
		expect(store.getState().drafts["h1/i1"]).toBe(ack === "before" ? "direction" : "");
		expect(opRcs(s)).toHaveLength(1);
	});

	it.each(["success", "timeout", "rejected"])(
		"preserves stopped drafts on abort %s without waiting for a settle event",
		async (outcome) => {
			const { store } = await setup();
			const s = connect();
			store.setDraft("first");
			const sending = store.send();
			s.receive({
				type: "rc_result",
				instanceId: "i1",
				response: { type: "response", id: opRcs(s)[0].request.id, ok: true, result: { deliveredAs: "steer" } },
			});
			await sending;
			store.setDraft("new draft");
			const stopping = store.abort();
			s.receive({
				type: "rc_result",
				instanceId: "i1",
				response: {
					type: "response",
					id: opRcs(s)[1].request.id,
					...(outcome === "success"
						? { ok: true, result: {} }
						: { ok: false, error: { code: outcome === "timeout" ? "timeout" : "session_changed" } }),
				},
			});
			await stopping;
			expect(store.getState().drafts["h1/i1"]).toBe("new draft");
			expect(store.getState().outbox[0].state).toBe(outcome === "rejected" ? "queued" : "unconfirmed");
			expect(opRcs(s).map((r) => r.request.method)).toEqual(["prompt", "abort"]);
		},
	);

	it.each([true, false])("never resurrects a consumed steer on stop (ACK already seen: %s)", async (acked) => {
		const { store } = await setup();
		const s = connect();
		store.setDraft("direction");
		const sending = store.send();
		const receipt = () =>
			s.receive({
				type: "rc_result",
				instanceId: "i1",
				response: { type: "response", id: opRcs(s)[0].request.id, ok: true, result: { deliveredAs: "steer" } },
			});
		if (acked) {
			receipt();
			await sending;
		}
		s.receive({
			type: "event",
			instanceId: "i1",
			sessionId: "s1",
			seq: 6,
			event: { type: "message_end", item: { kind: "user", entryId: "u-new", text: "direction" } },
		});
		s.receive({
			type: "event",
			instanceId: "i1",
			sessionId: "s1",
			seq: 7,
			event: { type: "agent_settled", aborted: true },
		});
		if (!acked) {
			receipt();
			await sending;
		}
		expect(store.getState().outbox).toEqual([]);
		expect(store.getState().drafts["h1/i1"]).toBe("");
		expect(store.getState().notice).toBeNull();
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

	it("ends a phone session op from the new snapshot when session_op_done was lost in the resync", async () => {
		const { store } = await setup();
		const s = connect([{ kind: "user", entryId: "u1", text: "最初の質問" }]);
		const fork = store.sessionOp("fork", "u1", "最初の質問");
		rcReply(s, opRcs(s)[0].request.id, true);
		await fork;
		s.receive(event(6, { type: "session_changed", reason: "fork", session: { id: "s2" } }));
		expect(store.getState().op?.kind).toBe("fork");
		// The Host built the snapshot after session_op_done (seq 7) and dropped the buffered event.
		s.receive(subscribedMsg([], "s2", "idle", { seq: 8 }));
		expect(store.getState().op).toBeNull();
		expect(store.getState().drafts["h1/i1"]).toBe("最初の質問");
		expect(store.getState().view?.sessionNotice).toMatchObject({ reason: "fork", byPhone: true });
	});

	it("does not take a snapshot of another session as the fork's arrival", async () => {
		const { store } = await setup();
		const s = connect([{ kind: "user", entryId: "u1", text: "最初の質問" }]);
		const fork = store.sessionOp("fork", "u1", "最初の質問");
		rcReply(s, opRcs(s)[0].request.id, true);
		await fork;
		s.receive(event(6, { type: "session_changed", reason: "fork", session: { id: "s2" } }));
		// session_op_done was lost and the PC switched again before the snapshot was built.
		s.receive(subscribedMsg([], "s3", "idle", { seq: 9 }));
		expect(store.getState().op).toBeNull();
		expect(store.getState().notice).toMatchObject({ kind: "error" });
		expect(store.getState().drafts["h1/i1"] ?? "").toBe("");
	});

	it("keeps a phone switch its own when the Host delivers the result ahead of the snapshot", async () => {
		const { store } = await setup();
		const s = connect([{ kind: "user", entryId: "u1", text: "最初の質問" }]);
		const fork = store.sessionOp("fork", "u1", "最初の質問");
		rcReply(s, opRcs(s)[0].request.id, true);
		await fork;
		// The Host resynced: session_changed (6) is inside the snapshot, session_op_done (7) comes first.
		s.receive(event(7, { type: "session_op_done", op: "fork", cancelled: false }, "s2"));
		expect(store.getState().op).toBeNull();
		s.receive(subscribedMsg([], "s2", "idle", { seq: 8 }));
		expect(store.getState().drafts["h1/i1"]).toBe("最初の質問");
		expect(store.getState().targetChanged).toBeNull();
		expect(store.sendBlocker()).toBeNull();
		// The marker is spent: a later PC switch asks again.
		s.receive(event(9, { type: "session_changed", reason: "resume", session: { id: "s3", name: "s3" } }));
		expect(store.getState().targetChanged).toEqual({ to: "s3" });
	});

	it("asks before the draft follows when the PC moved on after a phone switch reported ahead", async () => {
		const { store } = await setup();
		const s = connect([{ kind: "user", entryId: "u1", text: "最初の質問" }]);
		const fork = store.sessionOp("fork", "u1", "最初の質問");
		rcReply(s, opRcs(s)[0].request.id, true);
		await fork;
		// The fork arrived at s2 (reported ahead), but the PC switched to s3 before the snapshot.
		s.receive(event(7, { type: "session_op_done", op: "fork", cancelled: false }, "s2"));
		s.receive(subscribedMsg([], "s3", "idle", { seq: 9 }));
		expect(store.getState().targetChanged).toEqual({ to: "s3" });
		expect(store.sendBlocker()).toBe("target_changed");
	});

	it("gives up an accepted op whose result can no longer arrive after a fresh snapshot", async () => {
		const { store } = await setup();
		const s = connect();
		const op = store.compact();
		rcReply(s, opRcs(s)[0].request.id, true);
		await op;
		expect(store.getState().op?.kind).toBe("compact");
		s.receive(subscribedMsg([], "s1"));
		expect(store.getState().op).toBeNull();
		expect(store.getState().notice).toMatchObject({ kind: "error", title: "圧縮の結果を確認できません" });
		// Other operations are possible again.
		void store.setThinking("low");
		expect(store.getState().op?.kind).toBe("thinking");
	});

	it("clears an accepted op on disconnect and asks before the draft follows a later session change", async () => {
		vi.useFakeTimers();
		const { store } = await setup();
		const s = connect();
		const op = store.sessionOp("new");
		rcReply(s, opRcs(s)[0].request.id, true);
		await op;
		store.setDraft("古い下書き");
		s.drop();
		expect(store.getState().op).toBeNull();
		expect(store.getState().notice).toMatchObject({ title: "新しいセッションの結果を確認できません" });
		// Reconnect into another conversation: not known to be the phone's doing, so the draft needs confirmation.
		vi.advanceTimersByTime(1200);
		const s2 = FakeSocket.last();
		authenticate(s2, [instance("i1", 5)]);
		s2.receive(subscribedMsg([], "s9"));
		expect(store.getState().targetChanged).toEqual({ to: "s9" });
		expect(store.sendBlocker()).toBe("target_changed");
	});

	it("shuts down only the Pi that was on screen when the confirmation opened", async () => {
		const { store } = await setup();
		const s = connect();
		const target = store.opTarget();
		expect(target).toEqual({ hostId: "h1", instanceId: "i1", sessionId: "s1" });
		store.select("h1", "i0");
		const res = await store.shutdown(target!);
		expect(res).toMatchObject({ ok: false, title: "終了しませんでした" });
		expect(opRcs(s).filter((m) => m.request.method === "shutdown")).toHaveLength(0);
		// Same Pi but another conversation: also refused.
		store.select("h1", "i1");
		s.receive(subscribedMsg([], "s2"));
		await store.shutdown(target!);
		expect(opRcs(s).filter((m) => m.request.method === "shutdown")).toHaveLength(0);
		const ok = store.shutdown(store.opTarget()!);
		expect(opRcs(s).filter((m) => m.request.method === "shutdown")).toHaveLength(1);
		rcReply(s, opRcs(s).at(-1)!.request.id, true);
		expect(await ok).toEqual({ ok: true, value: null });
	});

	it("never lets a leftover session op waive the retarget confirmation", async () => {
		const { store } = await setup();
		const s = connect();
		const op = store.sessionOp("new");
		rcReply(s, opRcs(s)[0].request.id, true);
		await op;
		// The phone's switch finished (its result event lost), then the PC switches again.
		s.receive(event(6, { type: "session_changed", reason: "new", session: { id: "s2" } }));
		s.receive(subscribedMsg([], "s2", "idle", { seq: 8 }));
		expect(store.getState().op).toBeNull();
		store.setDraft("下書き");
		s.receive(event(9, { type: "session_changed", reason: "resume", session: { id: "s3", name: "s3" } }));
		expect(store.getState().targetChanged).toEqual({ to: "s3" });
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

	it("names an unnamed resumed conversation by its first message, not as a new one", async () => {
		const { store } = await setup();
		const s = connect([{ kind: "user", entryId: "u1", text: "今の質問" }]);
		store.setDraft("draft");
		s.receive(event(6, { type: "session_changed", reason: "resume", session: { id: "s2" } }));
		expect(store.getState().targetChanged).toEqual({ to: undefined });
		s.receive({
			...subscribedMsg([{ kind: "user", entryId: "u9", text: "前の\n質問" }], "s2"),
			history: { session: { id: "s2" }, items: [{ kind: "user", entryId: "u9", text: "前の\n質問" }] },
		});
		expect(store.getState().targetChanged).toEqual({ to: "前の 質問" });
		expect(store.getState().view?.sessionNotice).toMatchObject({ reason: "resume", from: "s1", to: "前の 質問" });
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

	it("leaves the chat alone when the spawn finishes after its screen was closed", async () => {
		const { store } = await setup();
		const s = connect();
		let open = true;
		const p = store.spawn("h1", { cwd: "~/code/x" }, () => open);
		const [msg] = s.sentOfType("spawn");
		open = false;
		s.receive({ type: "spawn_result", requestId: msg.requestId, ok: true, instanceId: "i9", abducoSession: "a9" });
		await flush();
		s.receive({ type: "instances", instances: [instance("i1", 5), { ...instance("i9", 9), origin: "mobile" }] });
		expect(await p).toEqual({ ok: true, value: { instanceId: "i9" } });
		expect(store.getState().selection).toEqual({ hostId: "h1", instanceId: "i1" });
		expect(s.sentOfType("spawn")).toHaveLength(1);
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
			ok: true,
			instanceId: "i9",
			abducoSession: "pimate-i9",
			messageError: "Error: boom; not resent",
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

describe("subagent session guards", () => {
	it("guards resume with the displayed session and reports session_changed without recording or retrying it", async () => {
		const { store } = await setup();
		const s = connect();
		const pending = store.subagentControl("i1", {
			runId: "same-run",
			childId: "c",
			action: "resume",
			text: "continue",
		});
		const request = opRcs(s)[0]!.request;
		expect(request).toMatchObject({ method: "subagent_control", expectInstanceId: "i1", expectSessionId: "s1" });
		// The PC forked to s2 (which contains the same run ID), before the phone heard about it.
		s.receive({
			type: "rc_result",
			instanceId: "i1",
			response: { type: "response", id: request.id, ok: false, error: { code: "session_changed" } },
		});
		expect(await pending).toMatchObject({
			ok: false,
			code: "session_changed",
			text: expect.stringContaining("会話が切り替わりました"),
		});
		expect(store.sentToSubagent("same-run", "c")).toEqual([]);
		expect(opRcs(s)).toHaveLength(1);
	});

	it.each(["control", "transcript"])("rejects a late %s response after the displayed session changes", async (kind) => {
		const { store } = await setup();
		const s = connect();
		const pending =
			kind === "control"
				? store.subagentControl("i1", { runId: "same-run", childId: "c", action: "resume", text: "continue" })
				: store.subagentTranscript("i1", "same-run", "c");
		const request = opRcs(s)[0]!.request;
		expect(request.expectSessionId).toBe("s1");
		s.receive(subscribedMsg([], "s2"));
		s.receive({
			type: "rc_result",
			instanceId: "i1",
			response: {
				type: "response",
				id: request.id,
				ok: true,
				result: { newRunId: "new", cursor: "old-cursor", items: [{ kind: "user", entryId: "old", text: "old" }] },
			},
		});
		expect(await pending).toMatchObject({ ok: false, code: "session_changed" });
		expect(store.sentToSubagent("same-run", "c")).toEqual([]);
	});

	it("does not apply a transcript fetched for a previously selected instance", async () => {
		const { store } = await setup();
		const s = connect();
		const pending = store.subagentTranscript("i1", "r", "c", "cursor");
		const request = opRcs(s)[0]!.request;
		expect(request).toMatchObject({ params: { runId: "r", childId: "c", cursor: "cursor" }, expectSessionId: "s1" });
		store.select("h1", "i0");
		s.receive({
			type: "rc_result",
			instanceId: "i1",
			response: { type: "response", id: request.id, ok: true, result: { cursor: "old-cursor", items: [] } },
		});
		expect(await pending).toMatchObject({ ok: false, code: "session_changed" });
	});

	it.each(["control", "transcript"])("does not send %s without a known session", async (kind) => {
		const { store } = await setup();
		const s = connect();
		store.select("h1", "i0"); // Its first snapshot (and session ID) has not arrived yet.
		const result =
			kind === "control"
				? await store.subagentControl("i0", { runId: "r", childId: "c", action: "resume", text: "continue" })
				: await store.subagentTranscript("i0", "r", "c");
		expect(result.ok).toBe(false);
		expect(opRcs(s)).toHaveLength(0);
	});
});

it("notification tap validates live session with guards and never sends a prompt", async () => {
	const { store } = await setup();
	const s = connect();
	const opening = store.openNotification({ hostId: "h1", instanceId: "i1", sessionId: "s1" });
	await flush();
	const request = opRcs(s).find((m) => m.request.method === "hello").request;
	expect(request).toMatchObject({ expectInstanceId: "i1", expectSessionId: "s1" });
	s.receive({
		type: "rc_result",
		instanceId: "i1",
		response: { type: "response", id: request.id, ok: true, result: {} },
	});
	await opening;
	expect(opRcs(s).some((m) => m.request.method === "prompt")).toBe(false);
	store.dispose();
});
it("old notification refuses stale session without selecting another instance", async () => {
	const { store } = await setup();
	const s = connect();
	const opening = store.openNotification({ hostId: "h1", instanceId: "i0", sessionId: "old" });
	const rejected = expect(opening).rejects.toThrow("通知時のセッション");
	await flush();
	const request = opRcs(s).find((m) => m.request.method === "hello").request;
	s.receive({
		type: "rc_result",
		instanceId: "i0",
		response: { type: "response", id: request.id, ok: false, error: { code: "session_changed" } },
	});
	await rejected;
	expect(store.getState().selection?.instanceId).toBe("i1");
	store.dispose();
});
it("notification to a removed host cannot retarget current chat", async () => {
	const { store } = await setup();
	connect();
	await expect(store.openNotification({ hostId: "absent", instanceId: "i1", sessionId: "s1" })).rejects.toThrow(
		"登録されていません",
	);
	store.dispose();
});
it("cold notification waits for auth/list and cannot open an exited Pi", async () => {
	const { store } = await setup();
	const opening = store.openNotification({ hostId: "h1", instanceId: "gone", sessionId: "s1" });
	const rejected = expect(opening).rejects.toThrow("終了しています");
	await flush();
	const s = connect();
	await rejected;
	expect(opRcs(s)).toHaveLength(0);
	store.dispose();
});
it("leaving the notification screen during validation does not change selection", async () => {
	const { store } = await setup();
	const s = connect();
	const opening = store.openNotification({ hostId: "h1", instanceId: "i0", sessionId: "s1" }, () => false);
	await flush();
	const request = opRcs(s).find((m) => m.request.method === "hello").request;
	s.receive({
		type: "rc_result",
		instanceId: "i0",
		response: { type: "response", id: request.id, ok: true, result: {} },
	});
	await opening;
	expect(store.getState().selection?.instanceId).toBe("i1");
	store.dispose();
});

describe("parent image drafts", () => {
	const image = { type: "image", mimeType: "image/jpeg", data: "YQ==" } as const;
	const other = { ...image, data: "Yg==" };
	function attach(store: AppStore, images: PromptImage[] = [image]) {
		expect(store.setImages(images, store.opTarget()!)).toBe(true);
	}
	function result(s: FakeSocket, ok: boolean, value: Record<string, unknown>) {
		const id = opRcs(s).at(-1).request.id;
		s.receive({
			type: "rc_result",
			instanceId: "i1",
			response: { type: "response", id, ok, ...(ok ? { result: value } : { error: value }) },
		});
	}
	it("sends image-only with guards, clears only on success and never inserts history optimistically", async () => {
		const { store } = await setup();
		const s = connect();
		s.receive(subscribedMsg([], "s1", "idle", { promptImages: true }));
		attach(store);
		expect(store.sendBlocker()).toBeNull();
		const pending = store.send();
		expect(opRcs(s)[0].request).toMatchObject({
			params: { text: "", images: [image] },
			expectSessionId: "s1",
			expectInstanceId: "i1",
		});
		expect(store.getState().view?.items).toEqual([]);
		expect(store.getState().attachments["h1/i1"]).toEqual([image]);
		result(s, true, { deliveredAs: "prompt" });
		await pending;
		expect(store.getState().attachments["h1/i1"]).toEqual([]);
		expect(store.getState().outbox).toEqual([]);
		expect(store.getState().notice?.title).toBe("画像付きメッセージを受け付けました");
		expect(store.getState().view?.items).toEqual([]);
		s.receive(
			subscribedMsg([{ kind: "user", entryId: "actual", text: "", images: [image], imageCount: 1 }], "s1", "idle", {
				promptImages: true,
			}),
		);
		expect(store.getState().outbox).toEqual([]);
	});
	it("queues image+text as steer while busy so stopping can recover both", async () => {
		const { store } = await setup();
		const s = connect();
		s.receive(subscribedMsg([], "s1", "running", { promptImages: true }));
		store.setDraft("look");
		attach(store);
		const pending = store.send();
		expect(opRcs(s)[0].request.params).toEqual({ text: "look", images: [image], deliverAs: "steer" });
		result(s, true, { deliveredAs: "steer" });
		await pending;
		expect(store.getState().outbox).toMatchObject([{ state: "queued", images: [image], deliveredAs: "steer" }]);
		expect(store.getState().notice?.text).toContain("割り込み");
	});
	it.each([false, true])(
		"recovers a stopped image steer without replacing an edited attachment (%s)",
		async (edited) => {
			const { store } = await setup();
			const s = connect();
			s.receive(subscribedMsg([], "s1", "running", { promptImages: true }));
			store.setDraft("look");
			attach(store);
			const sending = store.send();
			result(s, true, { deliveredAs: "steer" });
			await sending;
			if (edited) {
				store.setDraft("next");
				attach(store, [other]);
			}
			s.receive({
				type: "event",
				instanceId: "i1",
				sessionId: "s1",
				seq: 6,
				event: { type: "agent_settled", aborted: true },
			});
			expect(store.getState().outbox).toMatchObject([{ state: "unconfirmed", images: [image], text: "look" }]);
			expect(store.getState().drafts["h1/i1"]).toBe(edited ? "next" : "");
			expect(store.getState().attachments["h1/i1"]).toEqual(edited ? [other] : []);
			const id = store.getState().outbox[0].id;
			expect(store.restoreOutboxDraft(id)).toBe(!edited);
			if (!edited) {
				expect(store.getState().drafts["h1/i1"]).toBe("look");
				expect(store.getState().attachments["h1/i1"]).toEqual([image]);
				expect(store.getState().outbox).toEqual([]);
			}
			expect(opRcs(s)).toHaveLength(1);
		},
	);
	it("preserves multiple stopped image drafts as separate sends and restores only into an empty composer", async () => {
		const { store } = await setup();
		const s = connect();
		s.receive(subscribedMsg([], "s1", "running", { promptImages: true }));
		for (const [text, img] of [
			["first", image],
			["second", other],
		] as const) {
			store.setDraft(text);
			attach(store, [img]);
			const pending = store.send();
			result(s, true, { deliveredAs: "steer" });
			await pending;
		}
		s.receive({
			type: "event",
			instanceId: "i1",
			sessionId: "s1",
			seq: 6,
			event: { type: "agent_settled", aborted: true },
		});
		const [first, second] = store.getState().outbox;
		expect(store.getState().outbox).toMatchObject([
			{ text: "first", images: [image], state: "unconfirmed" },
			{ text: "second", images: [other], state: "unconfirmed" },
		]);
		expect(store.restoreOutboxDraft("missing")).toBe(false);
		store.setDraft(" ");
		expect(store.restoreOutboxDraft(first.id)).toBe(false);
		store.setDraft("");
		attach(store);
		expect(store.restoreOutboxDraft(first.id)).toBe(false);
		attach(store, []);
		expect(store.restoreOutboxDraft(first.id)).toBe(true);
		expect(store.getState().drafts["h1/i1"]).toBe("first");
		expect(store.getState().attachments["h1/i1"]).toEqual([image]);
		expect(store.getState().outbox).toEqual([second]);
		expect(store.restoreOutboxDraft(second.id)).toBe(false);
		const retry = store.send();
		expect(store.getState().outbox).toContainEqual(second);
		result(s, true, { deliveredAs: "prompt" });
		await retry;
		expect(store.restoreOutboxDraft(second.id)).toBe(true);
		expect(store.getState().attachments["h1/i1"]).toEqual([other]);
		expect(store.getState().drafts["h1/i1"]).toBe("second");
		expect(store.getState().outbox).toEqual([]);
		expect(opRcs(s)).toHaveLength(3); // Only the explicit manual retry added a request.
	});
	it("does not let a late steer ACK erase a manually restored draft", async () => {
		const { store } = await setup();
		const s = connect();
		store.setDraft("direction");
		const pending = store.send();
		const id = opRcs(s)[0].request.id;
		s.receive({
			type: "event",
			instanceId: "i1",
			sessionId: "s1",
			seq: 6,
			event: { type: "agent_settled", aborted: true },
		});
		store.setDraft("");
		expect(store.restoreOutboxDraft(id)).toBe(true);
		result(s, true, { deliveredAs: "steer" });
		await pending;
		expect(store.getState().drafts["h1/i1"]).toBe("direction");
		expect(store.getState().outbox).toEqual([]);
		expect(opRcs(s)).toHaveLength(1);
	});
	it("cannot restore an uncertain send into another session", async () => {
		const { store } = await setup();
		const s = connect();
		store.setDraft("direction");
		const pending = store.send();
		result(s, true, { deliveredAs: "steer" });
		await pending;
		s.receive({
			type: "event",
			instanceId: "i1",
			sessionId: "s1",
			seq: 6,
			event: { type: "agent_settled", aborted: true },
		});
		const id = store.getState().outbox[0].id;
		s.receive(subscribedMsg([], "s2", "idle"));
		expect(store.restoreOutboxDraft(id)).toBe(false);
		expect(store.getState().outbox).toHaveLength(1);
		expect(opRcs(s)).toHaveLength(1);
	});
	it.each(["invalid_request", "session_changed"])("retains the complete draft on %s", async (code) => {
		const { store } = await setup();
		const s = connect();
		s.receive(subscribedMsg([], "s1", "idle", { promptImages: true }));
		store.setDraft("look");
		attach(store);
		const pending = store.send();
		result(s, false, { code, message: "rejected" });
		await pending;
		expect(store.getState().attachments["h1/i1"]).toEqual([image]);
		expect(store.getState().drafts["h1/i1"]).toBe("look");
		expect(store.getState().outbox).toEqual([]);
		expect(opRcs(s)).toHaveLength(1);
	});
	it("requires exactly true capability; old RC cannot silently discard images, but text still sends", async () => {
		const { store } = await setup();
		const s = connect();
		attach(store);
		for (const promptImages of [undefined, false, "true"]) {
			s.receive(subscribedMsg([], "s1", "idle", { promptImages }));
			expect(store.sendBlocker()).toBe("images_unsupported");
			await store.send();
		}
		expect(opRcs(s)).toEqual([]);
		attach(store, []);
		store.setDraft("text only");
		const pending = store.send();
		expect(opRcs(s)[0].request.params).toEqual({ text: "text only", deliverAs: "steer" });
		result(s, true, {});
		await pending;
	});
	it("bounds text only when images are attached", async () => {
		const { store } = await setup();
		const s = connect();
		s.receive(subscribedMsg([], "s1", "idle", { promptImages: true }));
		attach(store);
		store.setDraft("x".repeat(32769));
		expect(store.sendBlocker()).toBe("image_text_limit");
		store.setDraft("x".repeat(32768));
		expect(store.sendBlocker()).toBeNull();
		attach(store, []);
		store.setDraft("x".repeat(32769));
		expect(store.sendBlocker()).toBeNull();
	});
	it.each(["image", "text"])("preserves the entire edited draft after a late success (%s changed)", async (changed) => {
		const { store } = await setup();
		const s = connect();
		s.receive(subscribedMsg([], "s1", "idle", { promptImages: true }));
		store.setDraft("sent");
		attach(store);
		const pending = store.send();
		if (changed === "image") expect(store.setImages([other], store.opTarget()!)).toBe(true);
		else store.setDraft("edited");
		result(s, true, { deliveredAs: "prompt" });
		await pending;
		expect(store.getState().drafts["h1/i1"]).toBe(changed === "image" ? "sent" : "edited");
		expect(store.getState().attachments["h1/i1"]).toEqual([changed === "image" ? other : image]);
	});
	it("retains unknown drafts, matches exact images not text alone, and never automatically resends", async () => {
		vi.useFakeTimers();
		const { store } = await setup();
		const s = connect();
		s.receive(subscribedMsg([], "s1", "idle", { promptImages: true }));
		attach(store);
		const pending = store.send();
		s.drop();
		await pending;
		expect(store.getState().outbox).toMatchObject([{ state: "unconfirmed", images: [image] }]);
		expect(store.getState().attachments["h1/i1"]).toEqual([image]);
		vi.advanceTimersByTime(1200);
		const next = FakeSocket.last();
		authenticate(next, [instance("i1")]);
		const wrong: TranscriptItem = { kind: "user", entryId: "different", text: "", images: [other], imageCount: 1 };
		next.receive(subscribedMsg([wrong], "s1", "idle", { promptImages: true }));
		expect(store.getState().outbox).toHaveLength(1);
		expect(store.getState().attachments["h1/i1"]).toEqual([image]);
		expect(opRcs(next)).toEqual([]);
		next.receive(
			subscribedMsg(
				[wrong, { kind: "user", entryId: "actual", text: "", images: [image], imageCount: 1 }],
				"s1",
				"idle",
				{ promptImages: true },
			),
		);
		expect(store.getState().outbox).toEqual([]);
		expect(store.getState().attachments["h1/i1"]).toEqual([]);
		expect(opRcs(next)).toEqual([]);
	});
	it("requires confirmation for an image-only draft after a session change and rejects a stale picker", async () => {
		const { store } = await setup();
		const s = connect();
		s.receive(subscribedMsg([], "s1", "idle", { promptImages: true }));
		const target = store.opTarget()!;
		attach(store);
		s.receive({
			type: "event",
			instanceId: "i1",
			sessionId: "s2",
			seq: 6,
			event: { type: "session_changed", reason: "resume", session: { id: "s2", name: "other" } },
		});
		expect(store.getState().targetChanged).toEqual({ to: "other" });
		expect(store.setImages([other], target)).toBe(false);
		s.receive(subscribedMsg([], "s2", "idle", { promptImages: true }));
		expect(store.sendBlocker()).toBe("target_changed");
		expect(store.getState().attachments["h1/i1"]).toEqual([image]);
		expect(store.setImages([other], target)).toBe(false);
		const current = store.opTarget()!;
		store.select("h1", "i0");
		expect(store.setImages([other], current)).toBe(false);
	});
	it("explains unsupported image models without blaming the RC", async () => {
		const { store } = await setup();
		const s = connect();
		s.receive(subscribedMsg([], "s1", "idle", { promptImages: true }));
		attach(store);
		const pending = store.send();
		const id = opRcs(s)[0].request.id;
		s.receive({
			type: "rc_result",
			instanceId: "i1",
			response: {
				type: "response",
				id,
				ok: false,
				error: { code: "unsupported", message: "このモデルは画像を扱えません。画像対応モデルを選んでください" },
			},
		});
		await pending;
		expect(store.getState().notice?.text).toContain("画像対応モデルを選んでください");
		expect(store.getState().attachments["h1/i1"]).toEqual([image]);
	});
	it("renders only the authoritative re-encoded image and dimension hints after an ACK", async () => {
		const { store } = await setup();
		const s = connect();
		s.receive(subscribedMsg([], "s1", "idle", { promptImages: true }));
		store.setDraft("look");
		attach(store);
		const pending = store.send();
		result(s, true, { deliveredAs: "prompt" });
		await pending;
		const normalized: TranscriptItem = {
			kind: "user",
			entryId: "normalized",
			text: "look\n[Image #1: original 1600x900, resized to 1024x576.]",
			images: [{ ...image, mimeType: "image/png", data: "Yg==" }],
			imageCount: 1,
		};
		s.receive(subscribedMsg([normalized], "s1", "idle", { promptImages: true }));
		expect(store.getState().outbox).toEqual([]);
		expect(store.getState().view?.items).toEqual([normalized]);
		expect(store.getState().attachments["h1/i1"]).toEqual([]);
	});
	it("retains an uncertain image draft when Pi has transformed it, without guessing or resending", async () => {
		vi.useFakeTimers();
		const { store } = await setup();
		const s = connect();
		s.receive(subscribedMsg([], "s1", "idle", { promptImages: true }));
		attach(store);
		const pending = store.send();
		s.drop();
		await pending;
		vi.advanceTimersByTime(1200);
		const next = FakeSocket.last();
		authenticate(next, [instance("i1")]);
		next.receive(
			subscribedMsg(
				[{ kind: "user", entryId: "normalized", text: "[Image resized]", images: [other], imageCount: 1 }],
				"s1",
				"idle",
				{ promptImages: true },
			),
		);
		expect(store.getState().attachments["h1/i1"]).toEqual([image]);
		expect(store.getState().outbox).toMatchObject([{ state: "unconfirmed" }]);
		expect(store.getState().notice?.text).toContain("履歴を確認");
		expect(opRcs(next)).toEqual([]);
	});
	it("does not show an old image receipt in another session", async () => {
		const { store } = await setup();
		const s = connect();
		s.receive(subscribedMsg([], "s1", "idle", { promptImages: true }));
		attach(store);
		const pending = store.send();
		const id = opRcs(s).at(-1).request.id;
		s.receive(subscribedMsg([], "s2", "idle", { promptImages: true }));
		s.receive({
			type: "rc_result",
			instanceId: "i1",
			response: { type: "response", id, ok: true, result: { deliveredAs: "prompt" } },
		});
		await pending;
		expect(store.getState().view?.session?.id).toBe("s2");
		expect(store.getState().notice).toBeNull();
		expect(store.getState().outbox).toEqual([]);
	});
	it("does not overwrite a newer error with an old image ACK after leaving and returning", async () => {
		const { store } = await setup();
		const s = connect();
		s.receive(subscribedMsg([], "s1", "idle", { promptImages: true }));
		attach(store);
		const old = store.send();
		const oldId = opRcs(s).at(-1).request.id;
		store.select("h1", "i0");
		store.select("h1", "i1");
		s.receive(subscribedMsg([], "s1", "idle", { promptImages: true }));
		store.setDraft("new request");
		const newer = store.send();
		result(s, false, { code: "unsupported", message: "画像対応モデルを選んでください" });
		await newer;
		const error = store.getState().notice;
		s.receive({
			type: "rc_result",
			instanceId: "i1",
			response: { type: "response", id: oldId, ok: true, result: { deliveredAs: "prompt" } },
		});
		await old;
		expect(store.getState().notice).toEqual(error);
		expect(store.getState().notice?.text).toContain("画像対応モデル");
		expect(store.getState().drafts["h1/i1"]).toBe("new request");
	});
});

describe("session tree", () => {
	async function ready(status: "idle" | "running" = "idle") {
		const { store } = await setup();
		const s = connect();
		s.receive(subscribedMsg([], "s1", status, { sessionTree: true }));
		return { store, s, target: store.opTarget()! };
	}

	it("hides the capability for old RCs and refuses tree methods without it", async () => {
		const { store } = await setup();
		const s = connect();
		expect(store.getState().view?.sessionTree).toBe(false);
		expect(await store.sessionTree(store.opTarget()!)).toMatchObject({ ok: false, title: "未対応です" });
		expect(opRcs(s)).toHaveLength(0);
	});

	it("guards read, navigation and label requests with the displayed session, and rejects stale results", async () => {
		const { store, s, target } = await ready();
		const read = store.sessionTree(target);
		let rc = opRcs(s).at(-1);
		expect(rc.request).toMatchObject({ method: "session_tree", expectInstanceId: "i1", expectSessionId: "s1" });
		rcReply(s, rc.request.id, true, { nodes: [], leafId: "leaf", truncated: true });
		expect(await read).toEqual({ ok: true, value: { nodes: [], leafId: "leaf", truncated: true } });
		const label = store.setTreeLabel(target, "u", "bookmark");
		rc = opRcs(s).at(-1);
		expect(rc.request).toMatchObject({
			method: "set_label",
			params: { entryId: "u", label: "bookmark" },
			expectSessionId: "s1",
		});
		s.receive(event(6, { type: "session_changed", reason: "new", session: { id: "s2" } }, "s2"));
		rcReply(s, rc.request.id, true);
		expect(await label).toMatchObject({ ok: false, code: "session_changed" });
		expect(await store.navigateTree(target, "u", false)).toMatchObject({ ok: false, title: "会話が変わりました" });
	});

	it.each(["", "existing draft"])(
		"resyncs after tree navigation and restores text only into an empty draft (%s)",
		async (draft) => {
			const { store, s, target } = await ready();
			store.setDraft(draft);
			const move = store.navigateTree(target, "u", true);
			const rc = opRcs(s).at(-1);
			expect(rc.request).toMatchObject({
				method: "session_op",
				params: { op: "tree", arg: "u", summarize: true },
				expectSessionId: "s1",
			});
			rcReply(s, rc.request.id, true);
			await move;
			expect(store.getState().op?.kind).toBe("tree");
			s.receive(event(6, { type: "session_changed", reason: "tree", session: { id: "s1" } }));
			expect(store.getState().view?.phase).toBe("resyncing");
			expect(store.getState().view?.sessionNotice).toBeNull();
			expect(store.getState().targetChanged).toBeNull();
			expect(s.sentOfType("subscribe").length).toBeGreaterThan(1);
			s.receive(event(7, { type: "session_op_done", op: "tree", cancelled: false, editorText: "complete user text" }));
			expect(store.getState().op).toBeNull();
			expect(store.getState().drafts["h1/i1"]).toBe(draft || "complete user text");
			s.receive(subscribedMsg([], "s1", "idle", { seq: 8, sessionTree: true }));
			expect(store.getState().view?.phase).toBe("ready");
			expect(store.getState().notice?.text).toContain("移動しました");
		},
	);

	it("rejects moving during a run without sending", async () => {
		const { store, s, target } = await ready("running");
		expect(await store.navigateTree(target, "u", false)).toMatchObject({ ok: false, title: "実行中は移動できません" });
		expect(opRcs(s)).toHaveLength(0);
	});

	it.each([{ cancelled: true }, { cancelled: true, error: "summary failed" }])(
		"finishes cancelled/failed moves and reports them",
		async (result) => {
			const { store, s, target } = await ready();
			const move = store.navigateTree(target, "u", false);
			rcReply(s, opRcs(s).at(-1).request.id, true);
			await move;
			s.receive(event(6, { type: "session_op_done", op: "tree", ...result }));
			expect(store.getState().op).toBeNull();
			expect(store.getState().notice?.text).toContain("error" in result ? "summary failed" : "取り消されました");
			expect(store.getState().drafts["h1/i1"] ?? "").toBe("");
		},
	);

	it("never restores tree text into a different session after a PC switch", async () => {
		const { store, s, target } = await ready();
		const move = store.navigateTree(target, "u", false);
		rcReply(s, opRcs(s).at(-1).request.id, true);
		await move;
		s.receive(event(6, { type: "session_changed", reason: "new", session: { id: "s2" } }, "s2"));
		s.receive(event(7, { type: "session_op_done", op: "tree", cancelled: false, editorText: "old text" }, "s1"));
		expect(store.getState().drafts["h1/i1"] ?? "").toBe("");
		expect(store.getState().op).toBeNull();
		expect(store.getState().notice?.kind).toBe("error");
	});
});

describe("slash command sending and catalogs", () => {
	const catalog = [
		{ name: "hello", source: "extension" },
		{ name: "hello:1", source: "extension" },
		{ name: "review", source: "prompt" },
		{ name: "skill:design", source: "skill" },
	];
	const rcs = (s: FakeSocket, method: string) => s.sentOfType("rc").filter((r) => r.request.method === method);
	function reply(s: FakeSocket, method: string, result: unknown) {
		const request = rcs(s, method).at(-1)!.request;
		s.receive({
			type: "rc_result",
			instanceId: "i1",
			response: { type: "response", id: request.id, ok: true, result },
		});
	}
	async function commandSetup(status: "idle" | "running" = "idle") {
		const { store } = await setup();
		const s = connect([{ kind: "user", entryId: "u1", text: "hi" }]);
		s.receive(subscribedMsg(store.getState().view!.items, "s1", status, { slashCommands: true, promptImages: true }));
		reply(s, "commands", { commands: catalog });
		await flush();
		return { store, s };
	}

	it.each(["idle", "running"] as const)(
		"expands known RC commands and clears command outbox on ACK while %s",
		async (status) => {
			const { store, s } = await commandSetup(status);
			store.setDraft("/hello:1 arg ");
			const sending = store.send();
			expect(rcs(s, "prompt").at(-1)?.request).toMatchObject({
				params: { text: "/hello:1 arg", expandTemplates: true, deliverAs: "steer" },
				expectSessionId: "s1",
				expectInstanceId: "i1",
			});
			expect(store.getState().outbox).toMatchObject([{ state: "sending" }]);
			reply(s, "prompt", { deliveredAs: "command" });
			await sending;
			expect(store.getState().outbox).toEqual([]);
			expect(store.getState().drafts["h1/i1"]).toBe("");
			expect(store.getState().view?.items).toHaveLength(1);
		},
	);

	it("keeps edits made while an extension command is being acknowledged", async () => {
		const { store, s } = await commandSetup();
		store.setDraft("/hello");
		const sending = store.send();
		store.setDraft("another message");
		reply(s, "prompt", { deliveredAs: "command" });
		await sending;
		expect(store.getState().drafts["h1/i1"]).toBe("another message");
		expect(store.getState().outbox).toEqual([]);
	});

	it.each(["review", "skill:design"])("does not retain a raw /%s bubble after template expansion", async (name) => {
		const { store, s } = await commandSetup();
		store.setDraft(`/${name} arg`);
		const sending = store.send();
		expect(rcs(s, "prompt").at(-1)?.request.params).toEqual({
			text: `/${name} arg`,
			expandTemplates: true,
			deliverAs: "steer",
		});
		reply(s, "prompt", { deliveredAs: "prompt" });
		await sending;
		expect(store.getState().outbox).toEqual([]);
	});

	it("preserves queued templates until Pi settles", async () => {
		const { store, s } = await commandSetup("running");
		store.setDraft("/review arg");
		const sending = store.send();
		reply(s, "prompt", { deliveredAs: "steer" });
		await sending;
		expect(store.getState().outbox).toMatchObject([{ text: "/review arg", state: "queued" }]);
		s.receive({
			type: "event",
			instanceId: "i1",
			sessionId: "s1",
			seq: 6,
			event: { type: "agent_settled", aborted: false },
		});
		expect(store.getState().outbox).toEqual([]);
	});

	it("opens the session tree for /tree only when the RC supports it", async () => {
		const { store } = await setup();
		const s = connect([{ kind: "user", entryId: "u1", text: "hi" }]);
		s.receive(subscribedMsg(store.getState().view!.items, "s1", "idle", { slashCommands: true, sessionTree: true }));
		reply(s, "commands", { commands: catalog });
		await flush();
		store.setDraft("/tree");
		expect(await store.send()).toBe("tree");
		expect(store.getState().drafts["h1/i1"]).toBe("");
		expect(rcs(s, "prompt")).toEqual([]);
	});

	it("blocks unknown command tokens without changing drafts or sending to the model", async () => {
		const { store, s } = await commandSetup();
		for (const text of ["/unknown", "/hello:2 arg", "/tree", "/pimate", "/reload"]) {
			store.setDraft(text);
			await store.send();
			expect(store.getState().drafts["h1/i1"]).toBe(text);
			expect(store.getState().notice?.text).toContain("使えません");
		}
		expect(rcs(s, "prompt")).toEqual([]);
		expect(store.getState().outbox).toEqual([]);
	});

	it("sends absolute paths as ordinary text and keeps old RC behavior", async () => {
		const { store, s } = await commandSetup();
		for (const text of ["/home/x", "/home/x arg"]) {
			store.setDraft(text);
			const sending = store.send();
			expect(rcs(s, "prompt").at(-1)?.request.params).toEqual({ text, deliverAs: "steer" });
			reply(s, "prompt", { deliveredAs: "prompt" });
			await sending;
		}
		s.receive(subscribedMsg([])); // Old RC: no capability.
		store.setDraft("/model");
		const sending = store.send();
		expect(rcs(s, "prompt").at(-1)?.request.params).toEqual({ text: "/model", deliverAs: "steer" });
		reply(s, "prompt", { deliveredAs: "prompt" });
		await sending;
	});

	it.each(["model", "resume", "fork"])("routes /%s to its existing app picker without an RC prompt", async (name) => {
		const { store, s } = await commandSetup();
		store.setDraft(`/${name} `);
		expect(await store.send()).toBe(name);
		expect(store.getState().drafts["h1/i1"]).toBe("");
		expect(rcs(s, "prompt")).toEqual([]);
	});

	it.each(["new", "compact"])("routes /%s through the existing guarded operation", async (name) => {
		const { store, s } = await commandSetup();
		store.setDraft(`/${name}`);
		const sending = store.send();
		const method = name === "new" ? "session_op" : "compact";
		expect(rcs(s, method).at(-1)?.request).toMatchObject({
			params: name === "new" ? { op: "new" } : {},
			expectInstanceId: "i1",
			expectSessionId: "s1",
		});
		reply(s, method, {});
		await sending;
		expect(store.getState().drafts["h1/i1"]).toBe("");
		expect(rcs(s, "prompt")).toEqual([]);
		expect(store.getState().outbox).toEqual([]);
	});

	it("keeps a refused operation's draft, and rejects unsupported arguments, images and empty forks", async () => {
		const { store, s } = await commandSetup();
		store.setDraft("/new");
		const sending = store.send();
		const request = rcs(s, "session_op").at(-1)!.request;
		s.receive({
			type: "rc_result",
			instanceId: "i1",
			response: { type: "response", id: request.id, ok: false, error: { code: "busy" } },
		});
		await sending;
		expect(store.getState().drafts["h1/i1"]).toBe("/new");
		store.setDraft("/model ignored");
		expect(await store.send()).toBeUndefined();
		expect(store.getState().notice?.text).toContain("引数や画像");
		store.setDraft("/hello");
		store.setImages([{ type: "image", mimeType: "image/jpeg", data: "YQ==" }], store.opTarget()!);
		await store.send();
		expect(store.getState().notice?.text).toContain("画像を添付できません");
		expect(store.getState().attachments["h1/i1"]).toHaveLength(1);
		store.setImages([], store.opTarget()!);
		s.receive(subscribedMsg([], "s1", "idle", { slashCommands: true }));
		store.setDraft("/fork");
		expect(await store.send()).toBeUndefined();
		expect(store.getState().notice?.text).toContain("分岐できるメッセージ");
		expect(rcs(s, "prompt")).toEqual([]);
	});

	it("caches per instance, refreshes on session switches and reloads, and ignores old replies", async () => {
		const { store, s } = await commandSetup();
		await store.loadCommands();
		expect(rcs(s, "commands")).toHaveLength(1);
		s.receive({
			type: "event",
			instanceId: "i1",
			sessionId: "s1",
			seq: 6,
			event: { type: "session_changed", reason: "reload", session: { id: "s1" } },
		});
		expect(store.getState().commands["h1/i1"]).toBeUndefined();
		s.receive(subscribedMsg([], "s1", "idle", { slashCommands: true, seq: 6 }));
		expect(rcs(s, "commands")).toHaveLength(2);
		const old = rcs(s, "commands").at(-1)!.request.id;
		s.receive({
			type: "event",
			instanceId: "i1",
			sessionId: "s2",
			seq: 7,
			event: { type: "session_changed", reason: "resume", session: { id: "s2" } },
		});
		s.receive(subscribedMsg([], "s2", "idle", { slashCommands: true, seq: 7 }));
		expect(rcs(s, "commands")).toHaveLength(3);
		s.receive({
			type: "rc_result",
			instanceId: "i1",
			response: { type: "response", id: old, ok: true, result: { commands: [{ name: "stale", source: "extension" }] } },
		});
		await flush();
		expect(store.getState().commands["h1/i1"]?.list).toBeNull();
		reply(s, "commands", { commands: catalog });
		await flush();
		expect(store.getState().commands["h1/i1"]?.list).toEqual(catalog);
		store.select("h1", "i0");
		expect(store.getState().commands["h1/i0"]).toBeUndefined();
		store.select("h1", "i1");
		s.receive(subscribedMsg([], "s2", "idle", { slashCommands: true, seq: 7 }));
		expect(rcs(s, "commands")).toHaveLength(4);
	});

	it("refreshes cached commands after reconnecting, including a reload missed while offline", async () => {
		const { store, s } = await commandSetup();
		expect(store.getState().commands["h1/i1"]?.list).toEqual(catalog);
		s.drop();
		expect(store.getState().commands["h1/i1"]).toBeUndefined();
		store.retryConnection("h1");
		const next = FakeSocket.last();
		authenticate(next, [instance("i1", 5)]);
		next.receive(subscribedMsg([], "s1", "idle", { slashCommands: true }));
		expect(rcs(next, "commands")).toHaveLength(1);
		reply(next, "commands", { commands: [{ name: "reloaded", source: "extension" }] });
		await flush();
		expect(store.getState().commands["h1/i1"]?.list?.[0]?.name).toBe("reloaded");
	});

	it("does not query commands or intercept slash text on an old RC", async () => {
		const { store } = await setup();
		const s = connect();
		expect(rcs(s, "commands")).toEqual([]);
		await store.loadCommands();
		expect(rcs(s, "commands")).toEqual([]);
		store.setDraft("/unknown arg");
		const sending = store.send();
		expect(rcs(s, "prompt").at(-1)?.request.params).toEqual({ text: "/unknown arg", deliverAs: "steer" });
		reply(s, "prompt", { deliveredAs: "prompt" });
		await sending;
	});

	it("blocks command sending during catalog lookup, supports manual retry and never auto-resends commands", async () => {
		const { store } = await setup();
		const s = connect();
		s.receive(subscribedMsg([], "s1", "idle", { slashCommands: true }));
		store.setDraft("/hello");
		await store.send();
		expect(rcs(s, "prompt")).toEqual([]);
		expect(store.getState().notice?.text).toContain("一覧を取得");
		const lookup = rcs(s, "commands").at(-1)!.request;
		s.receive({
			type: "rc_result",
			instanceId: "i1",
			response: { type: "response", id: lookup.id, ok: false, error: { code: "not_ready" } },
		});
		await flush();
		expect(store.getState().commands["h1/i1"]?.error).toBeTruthy();
		const retry = store.loadCommands(true);
		reply(s, "commands", { commands: catalog });
		await retry;
		const sending = store.send();
		const request = rcs(s, "prompt").at(-1)!.request;
		s.receive({
			type: "rc_result",
			instanceId: "i1",
			response: { type: "response", id: request.id, ok: false, error: { code: "timeout" } },
		});
		await sending;
		expect(store.getState().outbox).toMatchObject([{ state: "unconfirmed" }]);
		expect(store.getState().drafts["h1/i1"]).toBe("/hello");
		s.receive(subscribedMsg([], "s1", "idle", { slashCommands: true }));
		expect(rcs(s, "prompt")).toHaveLength(1);
		expect(store.getState().notice?.text).toContain("自動で再送しません");
	});
});

describe("entry image retrieval", () => {
	const image = { mimeType: "image/gif", data: "YQ==" };
	it("uses instance/session guards and shares requests within the same image variant", async () => {
		const { store } = await setup();
		const socket = connect();
		socket.receive(subscribedMsg([], "s1", "idle", { entryImages: true }));
		const target = store.opTarget()!;
		const first = store.entryImage(target, "entry", 2);
		const duplicate = store.entryImage(target, "entry", 2);
		await flush();
		const request = opRcs(socket).at(-1).request;
		expect(request).toMatchObject({
			method: "entry_image",
			params: { entryId: "entry", index: 2 },
			expectInstanceId: "i1",
			expectSessionId: "s1",
		});
		expect(opRcs(socket).filter((r) => r.request.method === "entry_image")).toHaveLength(1);
		socket.receive({
			type: "rc_result",
			instanceId: "i1",
			response: { type: "response", id: request.id, ok: true, result: { image } },
		});
		expect(await first).toEqual(image);
		expect(await duplicate).toEqual(image);
		expect(await store.entryImage(target, "entry", 2)).toEqual(image);
		expect(opRcs(socket)).toHaveLength(1);
		store.dispose();
	});
	it("discards stale replies, separates sessions and does not request unsupported RCs", async () => {
		const { store } = await setup();
		const socket = connect();
		await expect(store.entryImage(store.opTarget()!, "entry", 0)).rejects.toThrow("更新");
		expect(opRcs(socket)).toHaveLength(0);
		socket.receive(subscribedMsg([], "s1", "idle", { entryImages: true }));
		const oldTarget = store.opTarget()!;
		const first = store.entryImage(oldTarget, "entry", 0);
		const failed = expect(first).rejects.toThrow();
		await flush();
		const oldRequest = opRcs(socket).at(-1).request;
		socket.receive(subscribedMsg([], "s2", "idle", { entryImages: true }));
		socket.receive({
			type: "rc_result",
			instanceId: "i1",
			response: { type: "response", id: oldRequest.id, ok: true, result: { image } },
		});
		await failed;
		await expect(store.entryImage(oldTarget, "entry", 0)).rejects.toThrow("会話が変わりました");
		const second = store.entryImage(store.opTarget()!, "entry", 0);
		await flush();
		const request = opRcs(socket).at(-1).request;
		expect(request.expectSessionId).toBe("s2");
		socket.receive({
			type: "rc_result",
			instanceId: "i1",
			response: { type: "response", id: request.id, ok: true, result: { image } },
		});
		expect(await second).toEqual(image);
		store.dispose();
	});
	it("rejects malformed view images without caching them", async () => {
		const { store } = await setup();
		const socket = connect();
		socket.receive(subscribedMsg([], "s1", "idle", { entryImages: true }));
		const load = store.entryImage(store.opTarget()!, "entry", 0);
		const failed = expect(load).rejects.toThrow("画像を読み込めません");
		await flush();
		const request = opRcs(socket).at(-1).request;
		socket.receive({
			type: "rc_result",
			instanceId: "i1",
			response: { type: "response", id: request.id, ok: true, result: { image: { ...image, data: "invalid" } } },
		});
		await failed;
		store.dispose();
	});
});

it("sends and restores every attachment, gates older RCs, and preserves drafts when their limit shrinks", async () => {
	const images: PromptImage[] = ["YQ==", "Yg==", "Yw==", "ZA=="].map((data) => ({
		type: "image",
		mimeType: "image/png",
		data,
	}));
	const { store } = await setup();
	const socket = connect();
	socket.receive(subscribedMsg([], "s1", "running", { promptImages: true }));
	expect(store.setImages(images, store.opTarget()!)).toBe(false);
	socket.receive(subscribedMsg([], "s1", "running", { promptImages: true, promptImageLimit: 4 }));
	expect(store.setImages(images, store.opTarget()!)).toBe(true);
	socket.receive(subscribedMsg([], "s1", "running", { promptImages: true }));
	expect(store.sendBlocker()).toBe("image_count_limit");
	expect(store.getState().attachments["h1/i1"]).toEqual(images);
	expect(store.setImages(images.slice(1), store.opTarget()!)).toBe(true);
	expect(store.sendBlocker()).toBe("image_count_limit");
	socket.receive(subscribedMsg([], "s1", "running", { promptImages: true, promptImageLimit: 4 }));
	expect(store.setImages(images, store.opTarget()!)).toBe(true);
	store.setDraft("all images");
	const sending = store.send();
	const request = opRcs(socket).at(-1).request;
	expect(request.params).toMatchObject({ text: "all images", images, deliverAs: "steer" });
	socket.receive({
		type: "rc_result",
		instanceId: "i1",
		response: { type: "response", id: request.id, ok: true, result: { deliveredAs: "steer" } },
	});
	await sending;
	// An abort before delivery keeps the complete unit for manual restoration.
	socket.receive({
		type: "event",
		instanceId: "i1",
		sessionId: "s1",
		seq: 6,
		event: { type: "agent_settled", aborted: true },
	});
	const queued = store.getState().outbox[0]!;
	expect(queued).toMatchObject({ state: "unconfirmed", images });
	expect(store.restoreOutboxDraft(queued.id)).toBe(true);
	expect(store.getState().attachments["h1/i1"]).toEqual(images);
	expect(store.getState().drafts["h1/i1"]).toBe("all images");
	store.dispose();
});

it("separates thumbnail and full caches and rejects large originals from RCs ignoring thumbnail", async () => {
	const { store } = await setup();
	const socket = connect();
	socket.receive(subscribedMsg([], "s1", "idle", { entryImages: true }));
	const target = store.opTarget()!;
	const fullImage = { mimeType: "image/png", data: Buffer.alloc(512 * 1024 + 1).toString("base64") };
	const thumbnail = { mimeType: "image/jpeg", data: "YQ==", width: 320, height: 160 };
	const full = store.entryImage(target, "entry", 0);
	await flush();
	const fullRequest = opRcs(socket).at(-1).request;
	expect(fullRequest.params).toMatchObject({ thumbnail: false });
	socket.receive({
		type: "rc_result",
		instanceId: "i1",
		response: { type: "response", id: fullRequest.id, ok: true, result: { image: fullImage } },
	});
	expect((await full).data.length).toBe(fullImage.data.length);
	const unsupported = store.entryImage(target, "entry", 0, true);
	const failed = expect(unsupported).rejects.toThrow("画像を読み込めません");
	await flush();
	const oldRcRequest = opRcs(socket).at(-1).request;
	expect(oldRcRequest.params).toMatchObject({ thumbnail: true });
	socket.receive({
		type: "rc_result",
		instanceId: "i1",
		response: { type: "response", id: oldRcRequest.id, ok: true, result: { image: fullImage } },
	});
	await failed;
	const thumb = store.entryImage(target, "entry", 0, true);
	const duplicate = store.entryImage(target, "entry", 0, true);
	await flush();
	const request = opRcs(socket).at(-1).request;
	socket.receive({
		type: "rc_result",
		instanceId: "i1",
		response: { type: "response", id: request.id, ok: true, result: { image: thumbnail } },
	});
	expect(await thumb).toEqual(thumbnail);
	expect(await duplicate).toEqual(thumbnail);
	expect(await store.entryImage(target, "entry", 0, true)).toEqual(thumbnail);
	expect((await store.entryImage(target, "entry", 0)).data.length).toBe(fullImage.data.length);
	expect(opRcs(socket)).toHaveLength(3);
	store.dispose();
});

describe("Markdown file image retrieval", () => {
	const image = { mimeType: "image/png", data: "YQ==" };
	it("deduplicates target/cwd/path/variant requests and keeps full images separate from thumbnails", async () => {
		const { store } = await setup();
		const socket = connect();
		socket.receive(subscribedMsg([], "s1", "idle", { fileImages: true }));
		const target = { ...store.opTarget()!, cwd: store.getState().view!.cwd };
		const first = store.fileImage(target, "./x.png", true);
		const duplicate = store.fileImage(target, "./x.png", true);
		await flush();
		const request = opRcs(socket).at(-1).request;
		expect(request).toMatchObject({
			method: "file_image",
			params: { path: "./x.png", thumbnail: true },
			expectInstanceId: "i1",
			expectSessionId: "s1",
		});
		expect(opRcs(socket)).toHaveLength(1);
		socket.receive({
			type: "rc_result",
			instanceId: "i1",
			response: { type: "response", id: request.id, ok: true, result: { image } },
		});
		expect(await first).toEqual(image);
		expect(await duplicate).toEqual(image);
		expect(await store.fileImage(target, "./x.png", true)).toEqual(image);
		expect(opRcs(socket)).toHaveLength(1);
		const full = store.fileImage(target, "./x.png", false);
		await flush();
		const fullRequest = opRcs(socket).at(-1).request;
		expect(fullRequest.params.thumbnail).toBe(false);
		socket.receive({
			type: "rc_result",
			instanceId: "i1",
			response: { type: "response", id: fullRequest.id, ok: true, result: { image } },
		});
		expect(await full).toEqual(image);
		expect(opRcs(socket)).toHaveLength(2);
		// A later answer may show an overwritten file at the same path.
		store.fileImage(target, "./x.png", true, "answer-2").catch(() => {});
		await flush();
		expect(opRcs(socket)).toHaveLength(3);
		store.dispose();
	});
	it("gates the capability and rejects changed host/instance/session/cwd, including in-flight replies", async () => {
		const { store } = await setup();
		const socket = connect();
		const target = { ...store.opTarget()!, cwd: store.getState().view!.cwd };
		await expect(store.fileImage(target, "./x.png", true)).rejects.toThrow("更新");
		expect(opRcs(socket)).toHaveLength(0);
		socket.receive(subscribedMsg([], "s1", "idle", { fileImages: true }));
		for (const changed of [{ hostId: "other" }, { instanceId: "other" }, { sessionId: "other" }, { cwd: "/other" }])
			await expect(store.fileImage({ ...target, ...changed }, "./x.png", true)).rejects.toThrow("会話が変わりました");
		const pending = store.fileImage(target, "./x.png", true);
		const rejected = expect(pending).rejects.toThrow("会話が変わりました");
		await flush();
		const request = opRcs(socket).at(-1).request;
		socket.receive(subscribedMsg([], "s1", "idle", { fileImages: true, cwd: "/different-cwd" }));
		socket.receive({
			type: "rc_result",
			instanceId: "i1",
			response: { type: "response", id: request.id, ok: true, result: { image } },
		});
		await rejected;
		await expect(store.fileImage(target, "./x.png", true)).rejects.toThrow("会話が変わりました");
		const next = store.fileImage({ ...target, cwd: "/different-cwd" }, "./x.png", true);
		await flush();
		const nextRequest = opRcs(socket).at(-1).request;
		expect(opRcs(socket)).toHaveLength(2);
		socket.receive({
			type: "rc_result",
			instanceId: "i1",
			response: { type: "response", id: nextRequest.id, ok: true, result: { image } },
		});
		expect(await next).toEqual(image);
		store.dispose();
	});
	it("rejects large originals from older RCs that ignore thumbnail mode", async () => {
		const { store } = await setup();
		const socket = connect();
		socket.receive(subscribedMsg([], "s1", "idle", { fileImages: true }));
		const target = { ...store.opTarget()!, cwd: store.getState().view!.cwd };
		const pending = store.fileImage(target, "./x.png", true);
		const rejected = expect(pending).rejects.toThrow("画像を読み込めません");
		await flush();
		const request = opRcs(socket).at(-1).request;
		socket.receive({
			type: "rc_result",
			instanceId: "i1",
			response: {
				type: "response",
				id: request.id,
				ok: true,
				result: { image: { ...image, data: Buffer.alloc(512 * 1024 + 1).toString("base64") } },
			},
		});
		await rejected;
		store.dispose();
	});
});
