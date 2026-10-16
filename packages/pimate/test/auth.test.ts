import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	AuthInteraction,
	Credential,
	LoginOptions,
	Provider,
	ProviderAuthInteraction,
} from "@earendil-works/pi-ai";
import {
	CredentialSynchronizationError,
	type ExtensionContext,
	ModelRuntime,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { AUTH_FLOW_TTL_MS, type AuthFlow, type AuthProviderId, type ProviderAuthType } from "@pimate/protocol";
import { afterEach, expect, it, vi } from "vitest";
import { createProviderAuth, ProviderAuth } from "../src/extension/auth.ts";
import { dispatch, type Handlers, validateRequest } from "../src/extension/dispatch.ts";
import { createHandlers } from "../src/extension/handlers.ts";
import type { Hub } from "../src/extension/hub.ts";

const oauth: Credential = { type: "oauth", access: "SECRET_ACCESS", refresh: "SECRET_REFRESH", expires: 1234567 };
const instances: ProviderAuth[] = [];
afterEach(() => {
	for (const auth of instances.splice(0)) auth.dispose();
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});
const tick = async () => {
	for (let i = 0; i < 20; i++) await Promise.resolve();
};
function setup(login?: (i: ProviderAuthInteraction, options?: LoginOptions) => Promise<Credential>) {
	const credentials = new Map<string, Credential>();
	let registered: Provider;
	const provider = (id: string) =>
		({
			id,
			name: id,
			models: [],
			auth: {
				oauth: { name: "OAuth", login: login ?? (async () => oauth) },
				...(id !== "openai-codex"
					? {
							apiKey: {
								name: "API key",
								login: async (i: ProviderAuthInteraction) => ({
									type: "api_key",
									key: await i.prompt({ type: "secret", message: "SECRET_PROMPT" }),
								}),
							},
						}
					: {}),
			},
		}) as unknown as Provider;
	const registry = {
		getProvider: vi.fn(provider),
		getProviderAuthStatus: vi.fn(() => ({ configured: true, source: "environment" as const, label: "SECRET_LABEL" })),
		refresh: vi.fn(async () => ({ aborted: false, errors: new Map() })),
	};
	const runtime = {
		listCredentials: vi.fn(async () =>
			[...credentials].map(([providerId, credential]) => ({ providerId, type: credential.type })),
		),
		registerNativeProvider: vi.fn((p: Provider) => {
			registered = p;
		}),
		beforeSave: vi.fn(async (_signal: AbortSignal) => {}),
		login: vi.fn(async (id: string, method: ProviderAuthType, i: AuthInteraction, options?: LoginOptions) => {
			const auth = method === "oauth" ? registered.auth.oauth! : registered.auth.apiKey!;
			const result = await auth.login!({ ...i, signal: i.signal! }, options);
			await runtime.beforeSave(i.signal!);
			i.signal!.throwIfAborted();
			credentials.set(id, result);
			return result;
		}),
		logout: vi.fn(async (id: string) => {
			credentials.delete(id);
		}),
	};
	const device = vi.fn(async () => "00000000-0000-4000-8000-000000000001");
	const auth = new ProviderAuth(registry, Promise.resolve(runtime), device);
	instances.push(auth);
	const state = async (flow: AuthFlow) => (await auth.wait(flow.id, 0, 0)).flow;
	return { auth, runtime, registry, credentials, device, state };
}
const uuid = "00000000-0000-4000-8000-000000000001";
it("validates auth RPC provider, method, IDs and bounded inputs/waits", () => {
	for (const provider of ["openai", "openai-codex", "anthropic"])
		expect(validateRequest({ id: "a", method: "auth_begin", params: { provider, method: "oauth" } }).method).toBe(
			"auth_begin",
		);
	for (const params of [
		{ provider: "google", method: "oauth" },
		{ provider: "openai", method: "token" },
		{ provider: {}, method: "oauth" },
	])
		expect(() => validateRequest({ id: "a", method: "auth_begin", params })).toThrow("Invalid params");
	for (const [method, params] of [
		["auth_logout", { provider: "google" }],
		["auth_cancel", { flowId: "invalid" }],
		["auth_wait", { flowId: uuid, afterRevision: -1 }],
		["auth_wait", { flowId: uuid, afterRevision: 0, waitMs: 25001 }],
		["auth_wait", { flowId: uuid, afterRevision: 0, waitMs: "25000" }],
		["auth_respond", { flowId: uuid, promptId: uuid, value: "x".repeat(8193) }],
		["auth_respond", { flowId: uuid, promptId: "wrong", value: "secret" }],
	] as const)
		expect(() => validateRequest({ id: "a", method, params })).toThrow("Invalid params");
});
it("lists only safe metadata, methods and registry sources without resolving stored credentials", async () => {
	const { auth, credentials, registry } = setup();
	credentials.set("openai", oauth);
	credentials.set("anthropic", { type: "api_key", key: "!SECRET_COMMAND" });
	credentials.set("google", oauth);
	const result = await auth.list();
	expect(result.providers.map((p) => p.id)).toEqual(["openai", "openai-codex", "anthropic"]);
	expect(result.providers.map((p) => p.methods)).toEqual([["oauth", "api_key"], ["oauth"], ["oauth", "api_key"]]);
	expect(result.providers.map((p) => p.stored)).toEqual(["oauth", null, "api_key"]);
	expect(JSON.stringify(result)).not.toContain("SECRET");
	expect(registry.refresh).not.toHaveBeenCalled();
	expect(() => auth.begin("google" as AuthProviderId, "oauth")).toThrow("Invalid auth input");
	expect(() => auth.begin("openai-codex", "api_key")).toThrow("unavailable");
});
it.each(["openai", "anthropic"] as const)(
	"uses standard API-key login for %s, stores literal input only on PC, and refreshes",
	async (id) => {
		const { auth, credentials, state, registry, device } = setup();
		let { flow } = auth.begin(id, "api_key");
		await tick();
		flow = await state(flow);
		expect(flow.prompt?.kind).toBe("api_key");
		for (const value of ["!command", " !command", "key\nline", "", "x".repeat(4097)])
			expect(() => auth.respond(flow.id, flow.prompt!.id, value)).toThrow("Invalid auth input");
		expect(() => auth.respond(flow.id, uuid, "SECRET_KEY")).toThrow("no longer active");
		const receipt = auth.respond(flow.id, flow.prompt!.id, "SECRET_KEY-$LITERAL");
		expect(JSON.stringify(receipt)).not.toContain("SECRET");
		await tick();
		expect((await state(flow)).status).toBe("succeeded");
		expect(credentials.get(id)).toEqual({ type: "api_key", key: "SECRET_KEY-$$LITERAL" });
		expect(registry.refresh).toHaveBeenCalledWith(expect.objectContaining({ allowNetwork: false, providers: [id] }));
		expect(device).not.toHaveBeenCalled();
		expect(() => auth.respond(flow.id, flow.prompt!.id, "SECRET_KEY")).toThrow("no longer active");
	},
);
it.each([
	["openai-codex", "device_code"],
	["anthropic", "copy_code"],
] as const)("selects mobile %s flow %s without asking the app to choose", async (id, expected) => {
	let selected: string | undefined;
	const { auth, state } = setup(async (i) => {
		selected = await i.prompt({
			type: "select",
			message: "SECRET",
			options: ["browser", expected].map((id) => ({ id, label: id })),
		});
		if (id === "openai-codex") {
			i.notify({ type: "device_code", userCode: "ABCD-1234", verificationUri: "https://auth.openai.com/codex/device" });
			await new Promise(() => {});
		} else {
			i.notify({ type: "auth_url", url: "https://claude.ai/oauth/authorize?state=s" });
			await i.prompt({ type: "manual_code", message: "SECRET" });
		}
		return oauth;
	});
	let { flow } = auth.begin(id, "oauth");
	await tick();
	flow = await state(flow);
	expect(selected).toBe(expected);
	expect(flow.authorization?.url).toContain(id === "anthropic" ? "claude.ai" : "auth.openai.com");
	expect(JSON.stringify(flow)).not.toContain("SECRET");
	if (id === "anthropic") expect(flow.prompt?.kind).toBe("code");
	else expect(flow.authorization?.userCode).toBe("ABCD-1234");
});
it("OpenAI uses stable Pi device ID and requires FULL callback URL including matching state/client_id", async () => {
	let received = "";
	let device = "";
	const { auth, state } = setup(async (i, options) => {
		device = options!.getDeviceId!();
		i.notify({ type: "auth_url", url: "https://auth.openai.com/api/accounts/authorize?state=s" });
		received = await i.prompt({ type: "manual_code", message: "secret" });
		return oauth;
	});
	let { flow } = auth.begin("openai", "oauth");
	await tick();
	flow = await state(flow);
	expect(device).toBe(uuid);
	expect(flow.prompt?.kind).toBe("callback_url");
	for (const value of [
		"code",
		"javascript:evil",
		"http://localhost:1455/auth/callback?code=c&state=s&client_id=i",
		"http://127.0.0.1:1455/auth/callback?code=c&state=wrong&client_id=i",
		"http://127.0.0.1:1455/auth/callback?code=c&state=s",
		"http://127.0.0.1:1455/auth/callback?code=c&code=d&state=s&client_id=i",
	])
		expect(() => auth.respond(flow.id, flow.prompt!.id, value)).toThrow("Invalid auth input");
	const value = "http://127.0.0.1:1455/auth/callback?code=SECRET_CODE&state=s&client_id=i";
	expect(JSON.stringify(auth.respond(flow.id, flow.prompt!.id, value))).not.toContain("SECRET");
	await tick();
	expect(received).toBe(value);
	expect((await state(flow)).status).toBe("succeeded");
});
it.each(["cancel", "expire", "dispose"])("%s aborts provider work and prevents a late result saving", async (mode) => {
	vi.useFakeTimers();
	let finish!: (credential: Credential) => void;
	let signal!: AbortSignal;
	const { auth, credentials, state } = setup(async (i) => {
		signal = i.signal;
		return new Promise((resolve) => {
			finish = resolve;
		});
	});
	const { flow } = auth.begin("anthropic", "oauth");
	await tick();
	expect(() => auth.begin("openai", "oauth")).toThrow("busy");
	await expect(auth.logout("openai")).rejects.toMatchObject({ code: "busy" });
	const waiting = auth.wait(flow.id, flow.revision);
	if (mode === "cancel") auth.cancel(flow.id);
	else if (mode === "expire") await vi.advanceTimersByTimeAsync(AUTH_FLOW_TTL_MS);
	else auth.dispose();
	expect((await waiting).flow.status).toBe(mode === "expire" ? "working" : "cancelled");
	expect(signal.aborted).toBe(true);
	finish(oauth);
	await tick();
	expect(credentials.size).toBe(0);
	if (mode !== "dispose") expect((await state(flow)).status).toBe(mode === "expire" ? "expired" : "cancelled");
});
it.each(["cancel", "dispose"])("%s during OpenAI setup still reaches provider cleanup", async (mode) => {
	let prepared!: () => void;
	const closeCallbackServer = vi.fn();
	const { auth, credentials } = setup(async (i) => {
		await new Promise<void>((resolve) => {
			prepared = resolve;
		});
		// Pi's OpenAI provider installs its cleanup after these callbacks.
		i.notify({ type: "auth_url", url: "https://auth.openai.com/api/accounts/authorize?state=s" });
		const input = i.prompt({ type: "manual_code", message: "Paste callback URL" });
		try {
			await input;
			return oauth;
		} finally {
			closeCallbackServer();
		}
	});
	const { flow } = auth.begin("openai", "oauth");
	await tick();
	if (mode === "cancel") auth.cancel(flow.id);
	else auth.dispose();
	prepared();
	await tick();
	expect(closeCallbackServer).toHaveBeenCalledOnce();
	expect(credentials.size).toBe(0);
});
it("long-polls changes or deadline, bounds independent waits, and rejects stale flows", async () => {
	vi.useFakeTimers();
	const { auth, state } = setup(async () => new Promise(() => {}));
	const { flow } = auth.begin("anthropic", "oauth");
	await tick();
	const waiting = auth.wait(flow.id, flow.revision, 25000);
	const reconnects = Array.from({ length: 7 }, () => auth.wait(flow.id, flow.revision, 25000));
	await expect(auth.wait(flow.id, flow.revision, 25000)).rejects.toMatchObject({ code: "busy" });
	await expect(auth.wait(flow.id, 999, 0)).rejects.toMatchObject({ code: "bad_request" });
	await vi.advanceTimersByTimeAsync(24999);
	let settled = false;
	void waiting.then(() => {
		settled = true;
	});
	await tick();
	expect(settled).toBe(false);
	await vi.advanceTimersByTimeAsync(1);
	expect((await waiting).flow.revision).toBe(flow.revision);
	expect((await Promise.all(reconnects)).every((reply) => reply.flow.revision === flow.revision)).toBe(true);
	auth.cancel(flow.id);
	auth.begin("openai-codex", "oauth");
	await expect(state(flow)).rejects.toMatchObject({ code: "not_found" });
});
it("per-prompt abort clears the prompt without ending the overall OAuth flow", async () => {
	const controller = new AbortController();
	let finish!: (credential: Credential) => void;
	const { auth, state } = setup(async (i) => {
		void i.prompt({ type: "manual_code", message: "secret", signal: controller.signal }).catch(() => {});
		return new Promise((resolve) => {
			finish = resolve;
		});
	});
	let { flow } = auth.begin("anthropic", "oauth");
	await tick();
	flow = await state(flow);
	const prompt = flow.prompt!;
	controller.abort();
	await tick();
	expect((await state(flow)).prompt).toBeUndefined();
	expect(() => auth.respond(flow.id, prompt.id, "SECRET_CODE")).toThrow("no longer active");
	finish(oauth);
	await tick();
	expect((await state(flow)).status).toBe("succeeded");
});
it("refuses cancellation once standard runtime begins committing", async () => {
	const { auth, runtime, state, credentials } = setup();
	let release!: () => void;
	const original = runtime.login.getMockImplementation()!;
	runtime.login.mockImplementation(async (...args) => {
		const result = await original(...args);
		await new Promise<void>((resolve) => {
			release = resolve;
		});
		return result;
	});
	const { flow } = auth.begin("anthropic", "oauth");
	await tick();
	expect((await state(flow)).status).toBe("saving");
	expect(credentials.has("anthropic")).toBe(true);
	expect(() => auth.cancel(flow.id)).toThrow("commit already started");
	release();
	await tick();
	expect((await state(flow)).status).toBe("succeeded");
});
it.each(["login", "logout"])(
	"reports %s CredentialSynchronizationError as saved outcome, not retryable failure",
	async (operation) => {
		const { auth, runtime, registry, state, credentials } = setup();
		const error = new CredentialSynchronizationError("anthropic", operation as "login" | "logout", oauth, {
			cause: new Error("SECRET_BODY"),
		});
		if (operation === "login") {
			const original = runtime.login.getMockImplementation()!;
			runtime.login.mockImplementation(async (...args) => {
				await original(...args);
				throw error;
			});
			const { flow } = auth.begin("anthropic", "oauth");
			await tick();
			expect(await state(flow)).toMatchObject({ status: "succeeded", refreshRequired: true });
			expect(JSON.stringify(await state(flow))).not.toContain("SECRET");
		} else {
			runtime.logout.mockRejectedValue(error);
			expect(await auth.logout("anthropic")).toEqual({ refreshRequired: true });
		}
		expect(registry.refresh).toHaveBeenCalled();
		if (operation === "login") expect(credentials.has("anthropic")).toBe(true);
	},
);
it("logout removes stored auth only, retains environment availability and indicates refresh failures", async () => {
	const { auth, credentials, registry } = setup();
	credentials.set("anthropic", oauth);
	credentials.set("openai", oauth);
	expect(await auth.logout("anthropic")).toEqual({ refreshRequired: false });
	expect(credentials.has("anthropic")).toBe(false);
	expect(credentials.has("openai")).toBe(true);
	expect((await auth.list()).providers[2]).toMatchObject({ configured: true, source: "environment", stored: null });
	registry.refresh.mockRejectedValue(new Error("SECRET_BODY"));
	expect(await auth.logout("openai")).toEqual({ refreshRequired: true });
});
it("sanitizes provider, storage, metadata and unexpected dispatcher errors", async () => {
	const { auth, runtime, state } = setup(async () => {
		throw new Error("SECRET_BODY");
	});
	const { flow } = auth.begin("anthropic", "oauth");
	await tick();
	expect(await state(flow)).toMatchObject({ status: "failed", error: "login_failed" });
	runtime.listCredentials.mockRejectedValue(new Error("SECRET_KEY"));
	await expect(auth.list()).rejects.toThrow("Auth metadata unavailable");
	runtime.logout.mockRejectedValue(new Error("SECRET_KEY"));
	await expect(auth.logout("anthropic")).rejects.toThrow("could not be removed");
	const result = await dispatch({ id: "x", method: "auth_list" }, { instanceId: "i" }, {
		auth_list: () => {
			throw new Error("SECRET_KEY");
		},
	} as unknown as Handlers);
	expect(JSON.stringify(result)).not.toContain("SECRET");
});
it.each([
	"javascript:alert(1)",
	"https://evil.test/oauth",
	"https://claude.ai/oauth/authorize?access_token=SECRET",
	"https://user:password@claude.ai/oauth/authorize",
	"https://claude.ai/oauth/authorize#SECRET",
])("rejects unsafe provider URLs %s", async (url) => {
	const { auth, state, credentials } = setup(async (i) => {
		i.notify({ type: "auth_url", url });
		return oauth;
	});
	const { flow } = auth.begin("anthropic", "oauth");
	await tick();
	expect(await state(flow)).toMatchObject({ status: "failed" });
	expect(credentials.size).toBe(0);
	expect(JSON.stringify(await state(flow))).not.toContain("SECRET");
});
it("routes only auth RPCs, never chat/UI/history/events", async () => {
	const { auth, state } = setup();
	const hub = { auth, pi: {}, ctx: { hasUI: true }, emit: vi.fn(), pendingUI: new Map() } as unknown as Hub;
	const handlers = createHandlers(hub);
	const { flow } = await handlers.auth_begin({ provider: "anthropic", method: "api_key" });
	await tick();
	const ready = await state(flow);
	const result = await dispatch(
		{
			id: "secret",
			method: "auth_respond",
			params: { flowId: ready.id, promptId: ready.prompt!.id, value: "SECRET_KEY" },
		},
		{ instanceId: "i" },
		handlers,
	);
	await tick();
	expect(result.ok).toBe(true);
	expect(JSON.stringify(result)).not.toContain("SECRET");
	expect(hub.emit).not.toHaveBeenCalled();
	expect(hub.pendingUI.size).toBe(0);
});
it("uses explicit active CLI agent dir and stable global Pi device ID through public APIs", async () => {
	vi.stubEnv("PI_CODING_AGENT_DIR", "/tmp/FAKE-PIMATE-agent");
	const { runtime, registry } = setup();
	const create = vi.spyOn(ModelRuntime, "create").mockResolvedValue(runtime as unknown as ModelRuntime);
	const settings = { getOrCreateDeviceId: vi.fn(() => uuid), flush: vi.fn(async () => {}), drainErrors: () => [] };
	const settingsCreate = vi.spyOn(SettingsManager, "create").mockReturnValue(settings as unknown as SettingsManager);
	const auth = createProviderAuth({ cwd: "/tmp/work", modelRegistry: registry } as unknown as ExtensionContext);
	instances.push(auth);
	expect(create).toHaveBeenCalledWith({
		authPath: "/tmp/FAKE-PIMATE-agent/auth.json",
		modelsPath: null,
		refreshOnCreate: false,
		allowModelNetwork: false,
	});
	auth.begin("openai", "oauth");
	await tick();
	expect(settingsCreate).toHaveBeenCalledWith("/tmp/work", "/tmp/FAKE-PIMATE-agent");
	expect(settings.getOrCreateDeviceId).toHaveBeenCalledOnce();
	expect(settings.flush).toHaveBeenCalledOnce();
});
it("disposal while waiting for the storage lock aborts before a late commit", async () => {
	const { auth, runtime, credentials } = setup();
	let release!: () => void;
	let signal!: AbortSignal;
	runtime.beforeSave.mockImplementation(async (s) => {
		signal = s;
		await new Promise<void>((resolve) => {
			release = resolve;
		});
	});
	auth.begin("anthropic", "oauth");
	await tick();
	auth.dispose();
	expect(signal.aborted).toBe(true);
	release();
	await tick();
	expect(credentials.size).toBe(0);
});
it("storage failure and active-registry refresh failure never reveal credentials or invite retries", async () => {
	const { auth, runtime, registry, state, credentials } = setup();
	runtime.beforeSave.mockRejectedValueOnce(new Error("SECRET_BODY"));
	const failed = auth.begin("anthropic", "oauth").flow;
	await tick();
	expect(await state(failed)).toMatchObject({ status: "failed", error: "storage_failed" });
	expect(credentials.size).toBe(0);
	registry.refresh.mockResolvedValue({ aborted: false, errors: new Map([["anthropic", new Error("SECRET_BODY")]]) });
	const saved = auth.begin("anthropic", "oauth").flow;
	await tick();
	expect(await state(saved)).toMatchObject({ status: "succeeded", refreshRequired: true });
	expect(credentials.has("anthropic")).toBe(true);
	expect(JSON.stringify(await state(saved))).not.toContain("SECRET");
});
it("expires input prompts, rejects code URLs/control characters and ignores arbitrary provider text", async () => {
	vi.useFakeTimers();
	const { auth, state } = setup(async (i) => {
		i.notify({ type: "info", message: "SECRET_BODY", links: [{ url: "javascript:SECRET" }] });
		i.notify({ type: "progress", message: "SECRET_BODY" });
		await i.prompt({ type: "manual_code", message: "SECRET_PROMPT" });
		return oauth;
	});
	let { flow } = auth.begin("anthropic", "oauth");
	await tick();
	flow = await state(flow);
	for (const value of ["https://evil.test/code", "code\nsecret", "code#state#extra"])
		expect(() => auth.respond(flow.id, flow.prompt!.id, value)).toThrow("Invalid auth input");
	const wait = auth.wait(flow.id, flow.revision, 25000);
	await vi.advanceTimersByTimeAsync(AUTH_FLOW_TTL_MS);
	await wait;
	expect(await state(flow)).toMatchObject({ status: "expired" });
	expect((await state(flow)).prompt).toBeUndefined();
	expect(JSON.stringify(await state(flow))).not.toContain("SECRET");
});
it("auth_list recovers the transient flow after a lost begin receipt without retrying secrets", async () => {
	const { auth, state, runtime } = setup();
	const { flow } = auth.begin("anthropic", "api_key");
	await tick();
	const current = await state(flow);
	expect((await auth.list()).flow).toEqual(current);
	auth.cancel(current.id);
	expect((await auth.list()).flow?.status).toBe("cancelled");
	expect(runtime.login).toHaveBeenCalledOnce();
});
it("bounds an in-flight credential commit and aborts storage on its deadline", async () => {
	vi.useFakeTimers();
	const { auth, runtime, state, credentials } = setup();
	runtime.beforeSave.mockImplementation(
		(signal) =>
			new Promise((_resolve, reject) => {
				signal.addEventListener("abort", () => reject(new Error("SECRET_TIMEOUT")), { once: true });
			}),
	);
	const { flow } = auth.begin("anthropic", "oauth");
	await tick();
	expect((await state(flow)).status).toBe("saving");
	await vi.advanceTimersByTimeAsync(30000);
	expect(await state(flow)).toMatchObject({ status: "failed", error: "storage_failed" });
	expect(credentials.size).toBe(0);
});
it("serializes logout against another login/logout and aborts it on disposal", async () => {
	const { auth, runtime } = setup();
	let signal!: AbortSignal;
	runtime.logout.mockImplementation(
		(_id, options?: { signal?: AbortSignal }) =>
			new Promise((_resolve, reject) => {
				signal = options!.signal!;
				signal.addEventListener("abort", () => reject(new Error("SECRET_CANCEL")), { once: true });
			}),
	);
	const pending = auth.logout("anthropic");
	await tick();
	const rejected = expect(pending).rejects.toThrow("could not be removed");
	expect(() => auth.begin("openai", "oauth")).toThrow("busy");
	await expect(auth.logout("openai")).rejects.toMatchObject({ code: "busy" });
	auth.dispose();
	expect(signal.aborted).toBe(true);
	await rejected;
});
it("does not fall back to a localhost OAuth method when the mobile method is unavailable", async () => {
	const { auth, state, credentials } = setup(async (i) => {
		await i.prompt({ type: "select", message: "secret", options: [{ id: "browser", label: "Browser" }] });
		return oauth;
	});
	const { flow } = auth.begin("anthropic", "oauth");
	await tick();
	expect(await state(flow)).toMatchObject({ status: "failed", error: "login_failed" });
	expect(credentials.size).toBe(0);
});
it("reconnect waits have independent deadlines and all receive the same state change", async () => {
	vi.useFakeTimers();
	const { auth } = setup(async () => new Promise(() => {}));
	const { flow } = auth.begin("anthropic", "oauth");
	await tick();
	const abandoned = auth.wait(flow.id, flow.revision, 25000);
	await vi.advanceTimersByTimeAsync(10000);
	const reconnect = auth.wait(flow.id, flow.revision, 25000);
	let reconnected = false;
	void reconnect.then(() => {
		reconnected = true;
	});
	await vi.advanceTimersByTimeAsync(15000);
	expect((await abandoned).flow.status).toBe("working");
	expect(reconnected).toBe(false);
	const otherPhone = auth.wait(flow.id, flow.revision, 25000);
	auth.cancel(flow.id);
	expect((await reconnect).flow.status).toBe("cancelled");
	expect((await otherPhone).flow.status).toBe("cancelled");
});
it("dispose during saving does not claim cancellation after credentials have already committed", async () => {
	const { auth, runtime, state, credentials } = setup();
	let release!: () => void;
	const original = runtime.login.getMockImplementation()!;
	runtime.login.mockImplementation(async (...args) => {
		const result = await original(...args);
		await new Promise<void>((resolve) => {
			release = resolve;
		});
		return result;
	});
	const { flow } = auth.begin("anthropic", "oauth");
	await tick();
	const saving = await state(flow);
	expect(saving.status).toBe("saving");
	expect(credentials.has("anthropic")).toBe(true);
	const abandoned = auth.wait(flow.id, saving.revision);
	const reconnect = auth.wait(flow.id, saving.revision);
	auth.dispose();
	expect((await abandoned).flow.status).toBe("saving");
	expect((await reconnect).flow.status).toBe("saving");
	await expect(auth.wait(flow.id, saving.revision, 0)).rejects.toMatchObject({ code: "not_ready" });
	release();
	await tick();
	expect(credentials.has("anthropic")).toBe(true);
});
it("actual public ModelRuntime persists literal keys/OAuth metadata and logs out in an isolated temporary auth file", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pimate-auth-api-"));
	try {
		const runtime = await ModelRuntime.create({
			authPath: join(dir, "auth.json"),
			modelsPath: null,
			refreshOnCreate: false,
			allowModelNetwork: false,
		});
		// Registration normally checks every builtin's ambient auth; this test exercises only the fake provider/store.
		vi.spyOn(runtime, "refresh").mockResolvedValue({ aborted: false, errors: new Map() });
		const provider: Provider = {
			id: "anthropic",
			name: "Fake Anthropic",
			getModels: () => [],
			stream: () => {
				throw new Error("Network forbidden");
			},
			streamSimple: () => {
				throw new Error("Network forbidden");
			},
			auth: {
				apiKey: {
					name: "Fake key",
					login: async (i) => ({ type: "api_key", key: await i.prompt({ type: "secret", message: "Fake key" }) }),
					check: async ({ credential }) => (credential?.key ? { type: "api_key", source: "stored" } : undefined),
					resolve: async ({ credential }) =>
						credential?.key ? { auth: { apiKey: credential.key }, source: "stored" } : undefined,
				},
				oauth: {
					name: "Fake OAuth",
					login: async () => ({ ...oauth, type: "oauth" }),
					refresh: async (credential) => credential,
					toAuth: async (credential) => ({ apiKey: credential.access }),
				},
			},
		};
		const registry = {
			getProvider: () => provider,
			getProviderAuthStatus: (id: string) => runtime.getProviderAuthStatus(id),
			refresh: vi.fn(async () => ({ aborted: false, errors: new Map() })),
		};
		const auth = new ProviderAuth(registry, Promise.resolve(runtime), async () => uuid);
		instances.push(auth);
		const settle = async (initial: AuthFlow) => {
			let flow = initial;
			while (["working", "saving"].includes(flow.status)) flow = (await auth.wait(flow.id, flow.revision)).flow;
			return flow;
		};
		vi.stubEnv("PIMATE_LITERAL_ONLY", "MUST_NOT_BE_EXPANDED");
		// biome-ignore lint/suspicious/noTemplateCurlyInString: Verify that literal placeholders are not expanded.
		const literal = "FAKE-$PIMATE_LITERAL_ONLY-${PIMATE_LITERAL_ONLY}-$$-$!";
		let flow = await settle(auth.begin("anthropic", "api_key").flow);
		expect(flow.prompt?.kind).toBe("api_key");
		flow = await settle(auth.respond(flow.id, flow.prompt!.id, literal).flow);
		expect(flow.status).toBe("succeeded");
		expect(await runtime.listCredentials()).toEqual([{ providerId: "anthropic", type: "api_key" }]);
		expect((await runtime.getAuth("anthropic"))?.auth.apiKey).toBe(literal);
		expect((await auth.list()).providers[2].stored).toBe("api_key");
		flow = await settle(auth.begin("anthropic", "oauth").flow);
		expect(flow.status).toBe("succeeded");
		expect(await runtime.listCredentials()).toEqual([{ providerId: "anthropic", type: "oauth" }]);
		expect((await auth.list()).providers[2].stored).toBe("oauth");
		expect(await auth.logout("anthropic")).toEqual({ refreshRequired: false });
		expect(await runtime.listCredentials()).toEqual([]);
		auth.dispose();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
