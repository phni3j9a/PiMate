import type { AuthFlow, InstanceSummary } from "@pimate/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HostRegistry, MemoryStorage } from "../src/lib/hostRegistry";
import { authBrowserUrl, ProviderAuthController, providerGroups } from "../src/lib/providerAuth";
import { AppStore } from "../src/lib/store";
import { authenticate, FakeSocket } from "./fakes";

const instance = (id: string, updatedAt: number): InstanceSummary => ({
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

const flush = () => new Promise((r) => setTimeout(r, 0));
let uuid = 0;
const stores: AppStore[] = [];
afterEach(() => {
	for (const store of stores.splice(0)) store.dispose();
});
const SECRET = "sk-test-SECRET-VALUE";

const flow = (patch: Partial<AuthFlow> = {}): AuthFlow => ({
	id: "f1",
	provider: "openai",
	method: "api_key",
	revision: 0,
	expiresAt: Date.now() + 60_000,
	status: "working",
	...patch,
});
const providers = [
	{ id: "openai", methods: ["oauth", "api_key"], stored: null, configured: false },
	{ id: "openai-codex", methods: ["oauth"], stored: null, configured: false },
	{ id: "anthropic", methods: ["oauth"], stored: "oauth", configured: true, source: "stored" },
];

async function setup(hostAuth = true) {
	const storage = new MemoryStorage();
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
		fetch: async () => ({ status: 200, json: async () => ({}) }),
		randomUUID: () => `req-${++uuid}`,
		deviceName: () => "Pixel",
		app: { version: "1.0.0", platform: "android" },
	});
	stores.push(store);
	await store.init();
	authenticate(FakeSocket.last(), [instance("i1", 5), instance("i2", 1)], {
		providerAuth: hostAuth,
		authSession: hostAuth,
	});
	return { store, storage };
}

/** Auth requests (the store's own subscribe/models traffic is ignored). */
const authRcs = (s = FakeSocket.last()) =>
	s.sentOfType("rc").filter((m) => m.request.method === "hello" || m.request.method.startsWith("auth_"));
const last = (method: string, s = FakeSocket.last()) =>
	authRcs(s)
		.filter((m) => m.request.method === method)
		.at(-1);
function reply(msg: { instanceId: string; request: { id: string } }, result: unknown, s = FakeSocket.last()) {
	s.receive({
		type: "rc_result",
		instanceId: msg.instanceId,
		response: { type: "response", id: msg.request.id, ok: true, result },
	});
}
function fail(msg: { instanceId: string; request: { id: string } }, code: string, s = FakeSocket.last()) {
	s.receive({
		type: "rc_result",
		instanceId: msg.instanceId,
		response: { type: "response", id: msg.request.id, ok: false, error: { code } },
	});
}

async function acquire(id = "login-pi") {
	const socket = FakeSocket.last();
	const request = socket.sentOfType("auth_session").at(-1)!;
	socket.receive({ type: "auth_session_result", requestId: request.requestId, ok: true, instanceId: id });
	await flush();
}

/** Opens the controller for the machine and answers acquisition, hello and auth_list. */
async function ready(listFlow?: AuthFlow) {
	const env = await setup();
	const c = new ProviderAuthController(
		env.store,
		{ hostId: "h1" },
		() => `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}`,
	);
	c.start();
	await acquire();
	reply(last("hello"), { snapshot: { providerAuth: true, authSession: true } });
	await flush();
	reply(last("auth_list"), { providers, ...(listFlow ? { flow: listFlow } : {}) });
	await flush();
	return { ...env, c };
}

beforeEach(() => FakeSocket.reset());

describe("authBrowserUrl", () => {
	it("allows only the providers' own HTTPS endpoints", () => {
		const ok = (provider: AuthFlow["provider"], url: string, userCode?: string) =>
			authBrowserUrl(flow({ provider, method: "oauth", authorization: { url, userCode } }));
		expect(ok("openai", "https://auth.openai.com/api/accounts/authorize?client_id=x&state=y")).toBeNull();
		expect(ok("anthropic", "https://claude.ai/oauth/authorize?code=true&state=y")).toBeTruthy();
		expect(ok("openai-codex", "https://auth.openai.com/codex/device", "ABCD-1234")).toBeTruthy();
		for (const [p, u] of [
			["openai", "http://auth.openai.com/api/accounts/authorize?x=1"],
			["openai", "https://auth.openai.com.evil.example/api/accounts/authorize?x=1"],
			["openai", "https://auth.openai.com@evil.example/api/accounts/authorize?x=1"],
			["openai", "https://auth.openai.com/api/accounts/authorize?x=1#frag"],
			["openai", "https://claude.ai/oauth/authorize?x=1"],
			["anthropic", "javascript:alert(1)"],
			["anthropic", "https://claude.ai/oauth/authorize?x=1 y"],
			["openai-codex", "https://auth.openai.com/codex/device?next=evil"],
		] as const)
			expect(ok(p, u, "ABCD")).toBeNull();
		expect(ok("openai-codex", "https://auth.openai.com/codex/device", "bad code")).toBeNull();
		expect(ok("openai-codex", "https://auth.openai.com/codex/device")).toBeNull();
	});
});

describe("providerGroups", () => {
	const info = (id: string) => ({ id, methods: ["api_key"], stored: null, configured: false }) as never;
	const rows = (ids: string[]) =>
		providerGroups(ids.map(info)).map((g) => [g.name, g.members.map((m) => `${m.info.id}:${m.label}`)]);
	it("puts OpenAI API key with ChatGPT (Codex) and OpenCode Zen with Go on one row each", () => {
		expect(rows(["opencode-go", "openai", "openai-codex", "anthropic", "opencode"])).toEqual([
			["OpenAI", ["openai:API キー", "openai-codex:ChatGPT"]],
			["Anthropic", ["anthropic:"]],
			["OpenCode", ["opencode:Zen", "opencode-go:Go"]],
		]);
	});
	it("drops rows an older PC does not list and keeps unknown providers", () => {
		expect(rows(["openai", "anthropic", "future"])).toEqual([
			["OpenAI", ["openai:API キー"]],
			["Anthropic", ["anthropic:"]],
			["future", ["future:"]],
		]);
	});
});

describe("ProviderAuthController", () => {
	it("targets the hidden login Pi without changing the chat selection", async () => {
		const { c, store } = await ready();
		expect(store.getState().selection).toEqual({ hostId: "h1", instanceId: "i1" });
		for (const m of authRcs()) {
			expect(m.instanceId).toBe("login-pi");
			expect(m.request.expectInstanceId).toBe("login-pi");
		}
		expect(c.state.phase).toBe("ready");
		expect(c.state.providers).toHaveLength(3);
	});

	it("hides and refuses OpenAI OAuth advertised by an older PC, including after refresh", async () => {
		const { c } = await ready();
		expect(c.state.providers?.find((p) => p.id === "openai")?.methods).toEqual(["api_key"]);
		expect(c.state.providers?.find((p) => p.id === "openai-codex")?.methods).toEqual(["oauth"]);
		await c.begin("openai", "oauth");
		expect(last("auth_begin")).toBeUndefined();
		expect(c.state.notice?.title).toBe("開始できませんでした");
		const pending = c.logout("openai");
		reply(last("auth_logout"), { refreshRequired: false });
		await flush();
		reply(last("auth_list"), { providers });
		await pending;
		expect(c.state.providers?.find((p) => p.id === "openai")?.methods).toEqual(["api_key"]);
	});

	it("requires an updated Host as well as RC for long auth requests", async () => {
		const { store } = await setup(false);
		const c = new ProviderAuthController(store, { hostId: "h1" }, () => "x");
		c.start();
		await flush();
		expect(c.state.phase).toBe("old");
		expect(authRcs()).toHaveLength(0);
	});

	it("does not send acquisition to a Host without authSession", async () => {
		const { store } = await setup();
		store.connection("h1")!.info!.authSession = false;
		const c = new ProviderAuthController(store, { hostId: "h1" }, () => "old");
		c.start();
		expect(c.state.phase).toBe("old");
		expect(FakeSocket.last().sentOfType("auth_session")).toHaveLength(0);
		c.dispose();
		expect(FakeSocket.last().sentOfType("auth_session_end")).toHaveLength(0);
	});

	it("reports acquisition failure without retrying", async () => {
		const { store } = await setup();
		const c = new ProviderAuthController(store, { hostId: "h1" }, () => `id-${++uuid}`);
		c.start();
		const socket = FakeSocket.last();
		const request = socket.sentOfType("auth_session")[0];
		socket.receive({ type: "auth_session_result", requestId: request.requestId, ok: false, code: "spawn_failed" });
		await flush();
		expect(c.state.notice?.title).toBe("ログイン用の Pi を起動できませんでした");
		expect(socket.sentOfType("auth_session")).toHaveLength(1);
		expect(authRcs()).toHaveLength(0);
	});

	it("reports a dropped acquisition without retrying until reconnection", async () => {
		const { store } = await setup();
		const c = new ProviderAuthController(store, { hostId: "h1" }, () => `id-${++uuid}`);
		c.start();
		const socket = FakeSocket.last();
		socket.drop();
		await flush();
		expect(c.state.notice?.title).toBe("ログイン用の Pi を起動できませんでした");
		expect(socket.sentOfType("auth_session")).toHaveLength(1);
	});

	it("cancels an active flow before releasing its hold", async () => {
		const { c } = await ready(flow({ status: "input", prompt: { id: "p", kind: "api_key" } }));
		c.dispose();
		const sent = FakeSocket.last().sent;
		const cancel = sent.findIndex((m) => m.type === "rc" && m.request.method === "auth_cancel");
		const end = sent.findIndex((m) => m.type === "auth_session_end");
		expect(cancel).toBeGreaterThanOrEqual(0);
		expect(end).toBeGreaterThan(cancel);
	});

	it("releases only its own hold, so a reopened screen keeps the login Pi", async () => {
		const { store } = await setup();
		const old = new ProviderAuthController(store, { hostId: "h1" }, () => `id-${++uuid}`);
		old.start();
		old.dispose();
		const fresh = new ProviderAuthController(store, { hostId: "h1" }, () => `id-${++uuid}`);
		fresh.start();
		await acquire(); // late reply for the closed screen
		const socket = FakeSocket.last();
		const [oldHold, freshHold] = socket.sentOfType("auth_session").map((m) => m.holdId);
		expect(oldHold).not.toBe(freshHold);
		expect(new Set(socket.sentOfType("auth_session_end").map((m) => m.holdId))).toEqual(new Set([oldHold]));
		fresh.dispose();
	});

	it("releases a pending acquisition after leaving", async () => {
		const { store } = await setup();
		const c = new ProviderAuthController(store, { hostId: "h1" }, () => `id-${++uuid}`);
		c.start();
		c.dispose();
		await acquire();
		expect(FakeSocket.last().sentOfType("auth_session_end").length).toBeGreaterThanOrEqual(1);
		expect(authRcs()).toHaveLength(0);
	});

	it("marks an old flow ended if reconnect acquires another login Pi", async () => {
		const { c, store } = await ready(flow({ status: "saving" }));
		FakeSocket.last().drop();
		await flush();
		store.foreground();
		authenticate(FakeSocket.last(), [], { providerAuth: true, authSession: true });
		await acquire("replacement");
		reply(last("hello"), { snapshot: { providerAuth: true } });
		await flush();
		reply(last("auth_list"), { providers });
		await flush();
		expect(c.state.flow).toBeNull();
		expect(c.state.notice?.title).toBe("保存されたか確認できません");
		expect(last("hello").instanceId).toBe("replacement");
	});

	it("reacquires after reconnect even if a prior operation has not settled yet", async () => {
		const { c, store } = await ready();
		void c.begin("anthropic", "oauth");
		FakeSocket.last().drop();
		store.foreground();
		authenticate(FakeSocket.last(), [], { providerAuth: true, authSession: true });
		await flush();
		expect(FakeSocket.last().sentOfType("auth_session")).toHaveLength(1);
		await acquire();
		reply(last("hello"), { snapshot: { providerAuth: true } });
		await flush();
		reply(last("auth_list"), { providers });
		await flush();
		expect(c.state.phase).toBe("ready");
	});

	it("reports a login Pi exit while refreshing after logout", async () => {
		const { c } = await ready();
		const pending = c.logout("anthropic");
		reply(last("auth_logout"), { refreshRequired: true });
		await flush();
		fail(last("auth_list"), "not_found");
		await pending;
		expect(c.state.notice?.text).toContain("ログイン用の Pi が終了");
		expect(c.state.notice?.text).toContain("状態を確認");
		expect(c.state.notice?.text).not.toContain("反映を確認できませんでした");
	});

	it("forgets a stopped login Pi and restarts it on check", async () => {
		const { c } = await ready(flow());
		fail(last("auth_wait"), "not_found");
		await flush();
		expect(c.state.notice?.text).toContain("状態を確認");
		const checked = c.check();
		await acquire("replacement");
		reply(last("hello"), { snapshot: { providerAuth: true } });
		await flush();
		reply(last("auth_list"), { providers });
		await checked;
		expect(last("hello").request.expectInstanceId).toBe("replacement");
	});

	it("stops at an old RC without sending auth requests", async () => {
		const { store } = await setup();
		const c = new ProviderAuthController(store, { hostId: "h1" }, () => "x");
		c.start();
		await acquire();
		reply(last("hello"), { snapshot: {} });
		await flush();
		expect(c.state.phase).toBe("old");
		expect(authRcs().map((m) => m.request.method)).toEqual(["hello"]);
	});

	it("long-polls one wait at a time and ignores stale revisions", async () => {
		const { c } = await ready();
		void c.begin("openai", "api_key");
		reply(last("auth_begin"), { flow: flow() });
		await flush();
		expect(authRcs().filter((m) => m.request.method === "auth_wait")).toHaveLength(1);
		expect(last("auth_wait").request.params).toMatchObject({ flowId: "f1", afterRevision: 0 });
		reply(last("auth_wait"), { flow: flow({ revision: 2, status: "input", prompt: { id: "p1", kind: "api_key" } }) });
		await flush();
		const waits = authRcs().filter((m) => m.request.method === "auth_wait");
		expect(waits).toHaveLength(2);
		expect(waits[1].request.params.afterRevision).toBe(2);
		// A late, older answer never moves the flow back.
		reply(waits[0], { flow: flow({ revision: 1 }) });
		await flush();
		expect(c.state.flow?.revision).toBe(2);
	});

	it("never resends a secret after a lost reply, and keeps it out of state and storage", async () => {
		const { c, store, storage } = await ready();
		void c.begin("openai", "api_key");
		reply(last("auth_begin"), { flow: flow({ revision: 1, status: "input", prompt: { id: "p1", kind: "api_key" } }) });
		await flush();
		void c.respond(`  ${SECRET} `);
		expect(last("auth_respond").request.params.value).toBe(SECRET);
		FakeSocket.last().drop();
		await flush();
		expect(c.state.notice?.title).toBe("送信できたか確認できません");
		store.foreground();
		authenticate(FakeSocket.last(), [instance("i1", 5), instance("i2", 1)], { providerAuth: true, authSession: true });
		await flush();
		await acquire();
		reply(last("hello"), { snapshot: { providerAuth: true, authSession: true } });
		await flush();
		reply(last("auth_list"), { providers, flow: flow({ revision: 2, status: "saving" }) });
		await flush();
		expect(last("auth_respond")).toBeUndefined();
		expect(last("auth_wait").request.params).toMatchObject({ flowId: "f1", afterRevision: 2 });
		// The runtime went away while saving: unknown, not "cancelled".
		fail(last("auth_wait"), "not_found");
		await flush();
		expect(c.state.notice?.title).toBe("保存されたか確認できません");
		expect(JSON.stringify(c.state)).not.toContain(SECRET);
		expect(JSON.stringify(store.getState())).not.toContain(SECRET);
		expect(JSON.stringify([...storage.map.values()])).not.toContain(SECRET);
	});

	it("recovers a flow whose begin reply was lost, but does not reopen an old finished one", async () => {
		const { c, store } = await ready(flow({ id: "old", status: "succeeded", revision: 4 }));
		expect(c.state.flow).toBeNull();
		void c.begin("anthropic", "oauth");
		FakeSocket.last().drop();
		await flush();
		expect(c.state.notice?.title).toBe("開始できたか確認できません");
		store.foreground();
		authenticate(FakeSocket.last(), [instance("i1", 5), instance("i2", 1)], { providerAuth: true, authSession: true });
		await flush();
		await acquire();
		reply(last("hello"), { snapshot: { providerAuth: true, authSession: true } });
		await flush();
		const failed = flow({ id: "new", provider: "anthropic", method: "oauth", status: "failed", revision: 3 });
		reply(last("auth_list"), { providers, flow: failed });
		await flush();
		expect(last("auth_begin")).toBeUndefined();
		expect(c.state.flow?.id).toBe("new");
		c.dismissFlow();
		const checked = c.check();
		await acquire();
		reply(last("hello"), { snapshot: { providerAuth: true, authSession: true } });
		await flush();
		reply(last("auth_list"), { providers, flow: failed });
		await checked;
		expect(c.state.flow).toBeNull();
	});

	it("does not mistake the last observed success for a new begin with an unknown outcome", async () => {
		const { c } = await ready();
		void c.begin("openai", "api_key");
		reply(last("auth_begin"), { flow: flow() });
		await flush();
		const succeeded = flow({ revision: 1, status: "succeeded" });
		reply(last("auth_wait"), { flow: succeeded });
		await flush();
		reply(last("auth_list"), { providers, flow: succeeded });
		await flush();
		c.dismissFlow();
		void c.begin("openai", "api_key");
		fail(last("auth_begin"), "internal");
		await flush();
		await acquire();
		reply(last("hello"), { snapshot: { providerAuth: true, authSession: true } });
		await flush();
		reply(last("auth_list"), { providers, flow: succeeded });
		await flush();
		expect(c.state.flow).toBeNull();
		expect(c.state.notice?.title).toBe("手続きは見つかりませんでした");
	});

	it("follows a new flow once an older wait settles, still one wait at a time", async () => {
		const { c } = await ready();
		void c.begin("openai", "api_key");
		reply(last("auth_begin"), { flow: flow({ status: "input", prompt: { id: "p1", kind: "api_key" } }) });
		await flush();
		const oldWait = last("auth_wait");
		void c.cancel();
		reply(last("auth_cancel"), { flow: flow({ revision: 1, status: "cancelled" }) });
		await flush();
		c.dismissFlow();
		void c.begin("openai-codex", "oauth");
		reply(last("auth_begin"), { flow: flow({ id: "f2", provider: "openai-codex", method: "oauth" }) });
		await flush();
		expect(authRcs().filter((m) => m.request.method === "auth_wait")).toHaveLength(1);
		reply(oldWait, { flow: flow({ revision: 1, status: "cancelled" }) });
		await flush();
		expect(last("auth_wait").request.params).toMatchObject({ flowId: "f2", afterRevision: 0 });
		expect(c.state.waiting).toBe(true);
	});

	it("cancels interactive flows when leaving, including one whose begin reply arrives late", async () => {
		const { c } = await ready();
		void c.begin("anthropic", "oauth");
		const begin = last("auth_begin");
		c.dispose();
		reply(begin, { flow: flow({ id: "late", provider: "anthropic", method: "oauth", status: "working" }) });
		await flush();
		// The hold ends at once; the Host keeps the login Pi for its grace period, so the late cancel still lands.
		expect(last("auth_cancel").request.params).toEqual({ flowId: "late" });
		expect(FakeSocket.last().sentOfType("auth_session_end")).toHaveLength(1);
		expect(c.state.flow).toBeNull();

		const second = await ready();
		void second.c.begin("openai", "api_key");
		reply(last("auth_begin"), { flow: flow({ status: "saving" }) });
		await flush();
		second.c.dispose();
		expect(last("auth_cancel")).toBeUndefined();
	});

	it("refreshes metadata without reloading chat models after success", async () => {
		const { c, store } = await setup().then(async (env) => {
			const ctl = new ProviderAuthController(env.store, { hostId: "h1" }, () => `id-${++uuid}`);
			ctl.start();
			await acquire();
			reply(last("hello"), { snapshot: { providerAuth: true, authSession: true } });
			await flush();
			reply(last("auth_list"), { providers });
			await flush();
			return { ...env, c: ctl };
		});
		store.select("h1", "i1");
		const models = () =>
			FakeSocket.last()
				.sentOfType("rc")
				.filter((m) => m.request.method === "models").length;
		const before = models();
		void c.begin("openai", "api_key");
		reply(last("auth_begin"), { flow: flow() });
		await flush();
		reply(last("auth_wait"), { flow: flow({ revision: 1, status: "succeeded" }) });
		await flush();
		expect(authRcs().filter((m) => m.request.method === "auth_list")).toHaveLength(2);
		reply(last("auth_list"), { providers });
		await flush();
		expect(models()).toBe(before);
		expect(c.state.flow?.status).toBe("succeeded");
	});

	it("allows a manual retry after the initial capability request fails", async () => {
		const { store } = await setup();
		const c = new ProviderAuthController(store, { hostId: "h1" }, () => `id-${++uuid}`);
		c.start();
		await acquire();
		fail(last("hello"), "internal");
		await flush();
		expect(c.state.phase).toBe("ready");
		expect(c.state.busy).toBeNull();
		const checked = c.check();
		await acquire();
		reply(last("hello"), { snapshot: { providerAuth: true, authSession: true } });
		await flush();
		reply(last("auth_list"), { providers });
		await checked;
		expect(c.state.providers).toHaveLength(3);
	});

	it("stops on wait limits and resumes only on explicit status check", async () => {
		const current = flow({ status: "input", prompt: { id: "p1", kind: "api_key" } });
		const { c } = await ready(current);
		fail(last("auth_wait"), "busy");
		await flush();
		expect(c.state.waiting).toBe(false);
		expect(authRcs().filter((m) => m.request.method === "auth_wait")).toHaveLength(1);
		const checked = c.check();
		await acquire();
		reply(last("hello"), { snapshot: { providerAuth: true, authSession: true } });
		await flush();
		reply(last("auth_list"), { providers, flow: current });
		await checked;
		expect(authRcs().filter((m) => m.request.method === "auth_wait")).toHaveLength(2);
	});

	it.each(["not_found", "not_ready"])("treats saving followed by %s as unknown, not cancelled", async (code) => {
		const { c } = await ready(flow({ status: "saving" }));
		await c.cancel();
		expect(last("auth_cancel")).toBeUndefined();
		fail(last("auth_wait"), code);
		await flush();
		expect(c.state.flow).toBeNull();
		expect(c.state.notice?.title).toBe("保存されたか確認できません");
	});

	it("confirms logout only after refreshing metadata, without hiding remaining environment auth", async () => {
		const { c } = await ready();
		const pending = c.logout("anthropic");
		reply(last("auth_logout"), { refreshRequired: false });
		await flush();
		expect(c.state.busy).toBe("logout");
		reply(last("auth_list"), {
			providers: [{ id: "anthropic", methods: ["oauth"], stored: null, configured: true, source: "environment" }],
		});
		await pending;
		expect(c.state.busy).toBeNull();
		expect(c.state.notice?.title).toBe("保存済みの認証情報を削除しました");
		expect(c.state.notice?.text).toContain("環境変数");
	});

	it("reports an unknown logout instead of retrying it", async () => {
		const { c } = await ready();
		void c.logout("anthropic");
		fail(last("auth_logout"), "internal");
		await flush();
		expect(c.state.notice?.title).toBe("ログアウトできたか確認できません");
		expect(authRcs().filter((m) => m.request.method === "auth_logout")).toHaveLength(1);
	});
});
