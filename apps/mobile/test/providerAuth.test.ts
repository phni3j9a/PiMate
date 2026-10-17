import type { AuthFlow, InstanceSummary } from "@pimate/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HostRegistry, MemoryStorage } from "../src/lib/hostRegistry";
import { authBrowserUrl, ProviderAuthController } from "../src/lib/providerAuth";
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
	authenticate(FakeSocket.last(), [instance("i1", 5), instance("i2", 1)], { providerAuth: hostAuth });
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

/** Opens the controller on i2 (not the selected i1) and answers hello + auth_list. */
async function ready(listFlow?: AuthFlow) {
	const env = await setup();
	const c = new ProviderAuthController(
		env.store,
		{ hostId: "h1", instanceId: "i2" },
		() => `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}`,
	);
	c.start();
	reply(last("hello"), { snapshot: { providerAuth: true } });
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

describe("ProviderAuthController", () => {
	it("targets the captured Pi without changing the chat selection", async () => {
		const { c, store } = await ready();
		expect(store.getState().selection).toEqual({ hostId: "h1", instanceId: "i1" });
		for (const m of authRcs()) {
			expect(m.instanceId).toBe("i2");
			expect(m.request.expectInstanceId).toBe("i2");
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
		const c = new ProviderAuthController(store, { hostId: "h1", instanceId: "i2" }, () => "x");
		c.start();
		await flush();
		expect(c.state.phase).toBe("old");
		expect(authRcs()).toHaveLength(0);
	});

	it("stops at an old RC without sending auth requests", async () => {
		const { store } = await setup();
		const c = new ProviderAuthController(store, { hostId: "h1", instanceId: "i2" }, () => "x");
		c.start();
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
		authenticate(FakeSocket.last(), [instance("i1", 5), instance("i2", 1)], { providerAuth: true });
		await flush();
		reply(last("hello"), { snapshot: { providerAuth: true } });
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
		authenticate(FakeSocket.last(), [instance("i1", 5), instance("i2", 1)], { providerAuth: true });
		await flush();
		reply(last("hello"), { snapshot: { providerAuth: true } });
		await flush();
		const failed = flow({ id: "new", provider: "anthropic", method: "oauth", status: "failed", revision: 3 });
		reply(last("auth_list"), { providers, flow: failed });
		await flush();
		expect(last("auth_begin")).toBeUndefined();
		expect(c.state.flow?.id).toBe("new");
		c.dismissFlow();
		const checked = c.check();
		reply(last("hello"), { snapshot: { providerAuth: true } });
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
		reply(last("hello"), { snapshot: { providerAuth: true } });
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
		expect(last("auth_cancel").request.params).toEqual({ flowId: "late" });
		expect(c.state.flow).toBeNull();

		const second = await ready();
		void second.c.begin("openai", "api_key");
		reply(last("auth_begin"), { flow: flow({ status: "saving" }) });
		await flush();
		second.c.dispose();
		expect(last("auth_cancel")).toBeUndefined();
	});

	it("refreshes metadata and the target's models after success", async () => {
		const { c, store } = await setup().then(async (env) => {
			const ctl = new ProviderAuthController(env.store, { hostId: "h1", instanceId: "i1" }, () => `id-${++uuid}`);
			ctl.start();
			reply(last("hello"), { snapshot: { providerAuth: true } });
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
		expect(models()).toBe(before + 1);
		expect(c.state.flow?.status).toBe("succeeded");
	});

	it("allows a manual retry after the initial capability request fails", async () => {
		const { store } = await setup();
		const c = new ProviderAuthController(store, { hostId: "h1", instanceId: "i2" }, () => `id-${++uuid}`);
		c.start();
		fail(last("hello"), "internal");
		await flush();
		expect(c.state.phase).toBe("ready");
		expect(c.state.busy).toBeNull();
		const checked = c.check();
		reply(last("hello"), { snapshot: { providerAuth: true } });
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
		reply(last("hello"), { snapshot: { providerAuth: true } });
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
