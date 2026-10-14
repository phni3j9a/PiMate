import type { InstanceSummary, TranscriptItem } from "@pimate/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HostRegistry, MemoryStorage } from "../src/lib/hostRegistry";
import { AppStore } from "../src/lib/store";
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

function subscribedMsg(items: TranscriptItem[], sessionId = "s1", status: "idle" | "running" = "idle") {
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
		const rc = s.sentOfType("rc")[0];
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
		const id = s.sentOfType("rc")[0].request.id;
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
		const id = s.sentOfType("rc")[0].request.id;
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
		expect(s.sentOfType("rc")).toHaveLength(1);
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
		expect(s2.sentOfType("rc")).toEqual([]);
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
		expect(s2.sentOfType("rc")).toEqual([]);
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
		expect(FakeSocket.last().sentOfType("rc")).toEqual([]);
	});

	it("aborts with an instance guard", async () => {
		const { store } = await setup();
		const s = connect();
		const p = store.abort();
		const rc = s.sentOfType("rc")[0];
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
