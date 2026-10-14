import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BACKOFF_MAX_MS, backoffDelay, HostConnection, RcError } from "../src/lib/hostConnection";
import { authenticate, FakeSocket } from "./fakes";

function connection(random = () => 0.5) {
	return new HostConnection("127.0.0.1:47800", "tok", {
		createSocket: (url) => new FakeSocket(url),
		app: { version: "1.0.0", platform: "android" },
		random,
	});
}

beforeEach(() => {
	vi.useFakeTimers();
	FakeSocket.reset();
});
afterEach(() => {
	vi.useRealTimers();
});

describe("backoffDelay", () => {
	it("grows from ~1 s and caps at 30 s with jitter", () => {
		expect(backoffDelay(0, () => 0.5)).toBe(1000);
		expect(backoffDelay(1, () => 0.5)).toBe(2000);
		expect(backoffDelay(0, () => 0)).toBe(800);
		expect(backoffDelay(0, () => 1)).toBe(1200);
		expect(backoffDelay(20, () => 1)).toBe(BACKOFF_MAX_MS);
		expect(backoffDelay(5, () => 0)).toBeLessThanOrEqual(BACKOFF_MAX_MS);
	});
});

describe("HostConnection", () => {
	it("authenticates first, then reports connected with host info and instances", () => {
		const c = connection();
		const states: string[] = [];
		c.onChange(() => states.push(c.state));
		c.start();
		const s = FakeSocket.last();
		expect(s.url).toBe("ws://127.0.0.1:47800/ws");
		expect(c.state).toBe("connecting");
		s.open();
		expect(s.sent[0]).toEqual({
			type: "auth",
			token: "tok",
			protocol: 1,
			app: { version: "1.0.0", platform: "android" },
		});
		authenticate(s, [{ instanceId: "i1" }]);
		expect(c.state).toBe("connected");
		expect(c.info?.name).toBe("server-Macmini");
		expect(c.instances).toEqual([{ instanceId: "i1" }]);
		expect(states).toContain("connected");
	});

	it("stops on auth_error and does not retry", () => {
		const c = connection();
		c.start();
		const s = FakeSocket.last();
		s.open();
		s.receive({ type: "auth_error", code: "invalid_token" });
		s.drop(4401);
		expect(c.state).toBe("auth_failed");
		expect(c.authFailure).toBe("invalid_token");
		vi.advanceTimersByTime(120_000);
		expect(FakeSocket.all).toHaveLength(1);
		c.start();
		c.foreground();
		expect(FakeSocket.all).toHaveLength(1);
	});

	it("treats a revoked device (4403) as needing re-pairing", () => {
		const c = connection();
		c.start();
		authenticate(FakeSocket.last());
		FakeSocket.last().drop(4403);
		expect(c.state).toBe("auth_failed");
		expect(c.authFailure).toBe("revoked");
		vi.advanceTimersByTime(60_000);
		expect(FakeSocket.all).toHaveLength(1);
	});

	it("reconnects with exponential backoff and resubscribes after auth", () => {
		const c = connection();
		c.start();
		authenticate(FakeSocket.last());
		c.setSubscription("i1");
		expect(FakeSocket.last().sentOfType("subscribe")).toEqual([{ type: "subscribe", instanceId: "i1" }]);
		FakeSocket.last().drop();
		expect(c.state).toBe("offline");
		vi.advanceTimersByTime(999);
		expect(FakeSocket.all).toHaveLength(1);
		vi.advanceTimersByTime(1);
		expect(FakeSocket.all).toHaveLength(2);
		// Failing attempts back off: 1 s, 2 s, 4 s ...
		FakeSocket.last().drop();
		vi.advanceTimersByTime(1000);
		expect(FakeSocket.all).toHaveLength(3);
		FakeSocket.last().drop();
		vi.advanceTimersByTime(1999);
		expect(FakeSocket.all).toHaveLength(3);
		vi.advanceTimersByTime(1);
		expect(FakeSocket.all).toHaveLength(4);
		const s = FakeSocket.last();
		authenticate(s);
		expect(s.sentOfType("subscribe")).toEqual([{ type: "subscribe", instanceId: "i1" }]);
		expect(c.attempt).toBe(0);
	});

	it("never waits longer than 30 s between attempts", () => {
		const c = connection(() => 1);
		c.start();
		const waits: number[] = [];
		for (let i = 0; i < 12; i++) {
			FakeSocket.last().drop();
			const wait = c.nextRetryAt! - Date.now();
			waits.push(wait);
			vi.advanceTimersByTime(wait);
		}
		expect(FakeSocket.all).toHaveLength(13);
		expect(Math.max(...waits)).toBe(BACKOFF_MAX_MS);
		expect(waits[0]).toBe(1200);
	});

	it("reconnects immediately when the app returns to the foreground", () => {
		const c = connection();
		c.start();
		FakeSocket.last().drop();
		expect(c.state).toBe("offline");
		c.foreground();
		expect(FakeSocket.all).toHaveLength(2);
		expect(c.state).toBe("connecting");
	});

	it("pings periodically and drops a socket that stops answering", () => {
		const c = connection();
		c.start();
		const s = FakeSocket.last();
		authenticate(s);
		vi.advanceTimersByTime(20_000);
		const ping = s.sentOfType("ping")[0];
		expect(ping).toBeDefined();
		s.receive({ type: "pong", t: ping.t });
		vi.advanceTimersByTime(20_000);
		expect(s.sentOfType("ping")).toHaveLength(2);
		vi.advanceTimersByTime(10_000);
		expect(c.state).toBe("offline");
	});

	it("checks a live socket with a ping on foreground", () => {
		const c = connection();
		c.start();
		const s = FakeSocket.last();
		authenticate(s);
		c.foreground();
		expect(s.sentOfType("ping")).toHaveLength(1);
		vi.advanceTimersByTime(10_000);
		expect(c.state).toBe("offline");
	});

	it("times out a socket that never authenticates", () => {
		const c = connection();
		c.start();
		FakeSocket.last().open();
		vi.advanceTimersByTime(10_000);
		expect(c.state).toBe("offline");
	});

	it("switches subscriptions and resubscribes on demand", () => {
		const c = connection();
		c.setSubscription("i1");
		c.start();
		const s = FakeSocket.last();
		authenticate(s);
		expect(s.sentOfType("subscribe")).toEqual([{ type: "subscribe", instanceId: "i1" }]);
		c.setSubscription("i2");
		expect(s.sentOfType("unsubscribe")).toEqual([{ type: "unsubscribe", instanceId: "i1" }]);
		c.resubscribe();
		expect(s.sentOfType("subscribe").map((m) => m.instanceId)).toEqual(["i1", "i2", "i2"]);
	});

	it("matches rc results by request id and forwards other messages", async () => {
		const c = connection();
		const seen: string[] = [];
		c.onMessage((m) => seen.push(m.type));
		c.start();
		const s = FakeSocket.last();
		authenticate(s);
		const p = c.rc("i1", { id: "r1", method: "abort", params: {} });
		expect(s.sentOfType("rc")[0]).toEqual({
			type: "rc",
			instanceId: "i1",
			request: { id: "r1", method: "abort", params: {} },
		});
		s.receive({
			type: "rc_result",
			instanceId: "i1",
			response: { type: "response", id: "other", ok: true, result: {} },
		});
		s.receive({ type: "rc_result", instanceId: "i1", response: { type: "response", id: "r1", ok: true, result: {} } });
		await expect(p).resolves.toMatchObject({ id: "r1", ok: true });
		s.receive({ type: "instance_gone", instanceId: "i1" });
		expect(seen).toEqual(["instance_gone"]);
	});

	it("rejects in-flight rc requests as outcome_unknown on disconnect and refuses when offline", async () => {
		const c = connection();
		c.start();
		authenticate(FakeSocket.last());
		const p = c.rc("i1", { id: "r1", method: "prompt", params: { text: "hi" } });
		FakeSocket.last().drop();
		await expect(p).rejects.toMatchObject({ code: "outcome_unknown" });
		await expect(c.rc("i1", { id: "r2", method: "abort", params: {} })).rejects.toBeInstanceOf(RcError);
		// Nothing is re-sent after reconnecting.
		vi.advanceTimersByTime(1000);
		authenticate(FakeSocket.last());
		expect(FakeSocket.last().sentOfType("rc")).toEqual([]);
	});

	it("stop() closes the socket and cancels retries", () => {
		const c = connection();
		c.start();
		FakeSocket.last().drop();
		c.stop();
		vi.advanceTimersByTime(60_000);
		expect(FakeSocket.all).toHaveLength(1);
		expect(c.state).toBe("idle");
	});
});
