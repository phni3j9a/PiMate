import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { AuthEvent, AuthPrompt, Credential, Provider } from "@earendil-works/pi-ai";
import {
	CredentialSynchronizationError,
	type ExtensionContext,
	getAgentDir,
	ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import {
	AUTH_FLOW_TTL_MS,
	AUTH_MAX_INPUT_LENGTH,
	AUTH_MAX_WAIT_MS,
	AUTH_PROVIDER_IDS,
	type AuthFlow,
	type AuthProviderId,
	type AuthProviderInfo,
	type ProviderAuthType,
} from "@pimate/protocol";
import { RcError } from "./dispatch.ts";

type AuthRuntime = Pick<ModelRuntime, "listCredentials" | "login" | "logout" | "registerNativeProvider">;
type Registry = Pick<ExtensionContext["modelRegistry"], "getProvider" | "getProviderAuthStatus" | "refresh">;
type Pending = {
	id: string;
	kind: NonNullable<AuthFlow["prompt"]>["kind"];
	resolve(value: string): void;
	reject(): void;
};
type Operation = { state: AuthFlow; controller: AbortController; timer: NodeJS.Timeout; pending?: Pending };
const active = (s: AuthFlow) => ["working", "input", "saving"].includes(s.status);
const validProvider = (id: string): id is AuthProviderId => AUTH_PROVIDER_IDS.includes(id as AuthProviderId);
const terminal = (s: AuthFlow) => !active(s);
const inputError = () => new RcError("bad_request", "Invalid auth input");
// biome-ignore lint/suspicious/noControlCharactersInRegex: Auth inputs must reject control characters.
const invalidAuthCharacters = /[\s\x00-\x1f\x7f]/;

/** Standard CLI only: SDK-injected credentials/authPath are not exposed by ExtensionContext. */
export function createProviderAuth(ctx: ExtensionContext): ProviderAuth {
	const agentDir = getAgentDir();
	return new ProviderAuth(
		ctx.modelRegistry,
		ModelRuntime.create({
			authPath: join(agentDir, "auth.json"),
			modelsPath: null,
			refreshOnCreate: false,
			allowModelNetwork: false,
		}),
	);
}

/** One transient operation per RC. Bounded independent waits allow reconnects without invalidating other clients. */
export class ProviderAuth {
	private operation?: Operation;
	private waiters = new Set<() => void>();
	private mutating = false;
	private disposed = false;
	private lifetime = new AbortController();
	private registry: Registry;
	private runtime: Promise<AuthRuntime>;
	constructor(registry: Registry, runtime: Promise<AuthRuntime>) {
		this.registry = registry;
		this.runtime = runtime;
		void runtime.catch(() => {});
	}

	async list(): Promise<{ providers: AuthProviderInfo[]; flow?: AuthFlow }> {
		this.check();
		try {
			const stored = await (await this.runtime).listCredentials({
				signal: AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(30000)]),
			});
			return {
				...(this.operation ? this.result(this.find(this.operation.state.id)) : {}),
				providers: AUTH_PROVIDER_IDS.map((id) => {
					const provider = this.registry.getProvider(id);
					const status = this.registry.getProviderAuthStatus(id);
					const type = stored.find((s) => s.providerId === id)?.type;
					return {
						id,
						methods: [
							...(id !== "openai" && provider?.auth?.oauth ? ["oauth" as const] : []),
							...(provider?.auth?.apiKey?.login ? ["api_key" as const] : []),
						],
						stored: type === "oauth" || type === "api_key" ? type : null,
						configured: status.configured,
						source: status.source,
					};
				}),
			};
		} catch {
			throw new RcError("internal", "Auth metadata unavailable");
		}
	}

	begin(providerId: AuthProviderId, method: ProviderAuthType): { flow: AuthFlow } {
		this.checkIdle();
		const provider = this.provider(providerId);
		if (
			!(["oauth", "api_key"] as string[]).includes(method) ||
			!(method === "oauth" ? providerId !== "openai" && provider.auth?.oauth?.login : provider.auth?.apiKey?.login)
		)
			throw new RcError("unsupported", "Authentication method unavailable");
		const state: AuthFlow = {
			id: randomUUID(),
			provider: providerId,
			method,
			revision: 0,
			expiresAt: Date.now() + AUTH_FLOW_TTL_MS,
			status: "working",
		};
		const op: Operation = {
			state,
			controller: new AbortController(),
			timer: setTimeout(() => {
				if (op.state.status !== "saving") this.end(op, "expired");
			}, AUTH_FLOW_TTL_MS).unref(),
		};
		this.operation = op;
		void this.login(op, provider);
		return this.result(op);
	}

	async wait(flowId: string, afterRevision: number, waitMs = AUTH_MAX_WAIT_MS): Promise<{ flow: AuthFlow }> {
		const op = this.find(flowId);
		if (
			!Number.isSafeInteger(afterRevision) ||
			afterRevision < 0 ||
			afterRevision > op.state.revision ||
			!Number.isSafeInteger(waitMs) ||
			waitMs < 0 ||
			waitMs > AUTH_MAX_WAIT_MS
		)
			throw inputError();
		if (op.state.revision === afterRevision && !terminal(op.state) && waitMs) {
			if (this.waiters.size >= 8) throw new RcError("busy", "Too many auth waits");
			await new Promise<void>((resolve) => {
				const finish = () => {
					clearTimeout(timer);
					this.waiters.delete(finish);
					resolve();
				};
				const timer = setTimeout(finish, waitMs).unref();
				this.waiters.add(finish);
			});
		}
		return this.result(op);
	}

	respond(flowId: string, promptId: string, value: string): { flow: AuthFlow } {
		const op = this.find(flowId);
		const pending = op.pending;
		if (op.state.status !== "input" || !pending || pending.id !== promptId)
			throw new RcError("no_such_request", "Auth prompt is no longer active");
		if (!validInput(pending.kind, value)) throw inputError();
		pending.resolve(value);
		return this.result(op);
	}

	cancel(flowId: string): { flow: AuthFlow } {
		const op = this.find(flowId);
		if (op.state.status === "saving") throw new RcError("busy", "Credential commit already started");
		if (active(op.state)) this.end(op, "cancelled");
		return this.result(op);
	}

	async logout(providerId: AuthProviderId): Promise<{ refreshRequired: boolean }> {
		this.checkIdle();
		this.provider(providerId);
		this.mutating = true;
		const signal = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(30000)]);
		try {
			let syncFailed = false;
			try {
				await (await this.runtime).logout(providerId, { signal });
			} catch (error) {
				if (!(error instanceof CredentialSynchronizationError)) throw error;
				syncFailed = true;
			}
			const refreshed = await this.refresh(providerId);
			return { refreshRequired: syncFailed || !refreshed };
		} catch {
			throw new RcError("internal", "Stored credential could not be removed");
		} finally {
			this.mutating = false;
		}
	}

	dispose(): void {
		this.disposed = true;
		this.lifetime.abort();
		const op = this.operation;
		if (op?.state.status === "saving") {
			// Storage may already have committed: retain saving/outcome-unknown instead of claiming cancellation.
			clearTimeout(op.timer);
			op.controller.abort();
		} else if (op && active(op.state)) this.end(op, "cancelled");
		for (const wake of this.waiters) wake();
	}

	private check(): void {
		if (this.disposed) throw new RcError("not_ready");
	}
	private checkIdle(): void {
		this.check();
		if (this.mutating || (this.operation && active(this.operation.state))) throw new RcError("busy");
	}
	private provider(id: string): Provider {
		if (!validProvider(id)) throw inputError();
		const provider = this.registry.getProvider(id);
		if (!provider) throw new RcError("unsupported", "Provider unavailable");
		return provider;
	}
	private find(id: string): Operation {
		this.check();
		const op = this.operation;
		if (!op || id !== op.state.id) throw new RcError("not_found", "Auth flow not found");
		if (Date.now() >= op.state.expiresAt && active(op.state) && op.state.status !== "saving") this.end(op, "expired");
		return op;
	}
	private result(op: Operation): { flow: AuthFlow } {
		return { flow: structuredClone(op.state) };
	}
	private update(op: Operation, patch: Partial<AuthFlow>): void {
		op.state = { ...op.state, ...patch, revision: op.state.revision + 1 };
		for (const wake of this.waiters) wake();
	}
	private end(op: Operation, status: AuthFlow["status"], error?: AuthFlow["error"]): void {
		clearTimeout(op.timer);
		this.update(op, { status, error, authorization: undefined, prompt: undefined });
		op.controller.abort();
		op.pending?.reject();
	}
	private async refresh(provider: AuthProviderId): Promise<boolean> {
		try {
			const result = await this.registry.refresh({
				allowNetwork: false,
				providers: [provider],
				signal: AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(30000)]),
			});
			return !result.aborted && !result.errors.size;
		} catch {
			return false;
		}
	}
	private async login(op: Operation, provider: Provider): Promise<void> {
		const signal = op.controller.signal;
		try {
			const runtime = await this.runtime;
			signal.throwIfAborted();
			const commit = <T extends Credential>(credential: T): T => {
				signal.throwIfAborted();
				if (
					credential.type !== op.state.method ||
					(credential.type === "api_key" && !validInput("api_key", credential.key ?? ""))
				)
					throw inputError();
				// ModelRuntime persists immediately after provider login returns; cancellation stops at this boundary.
				this.update(op, { status: "saving", prompt: undefined, authorization: undefined });
				clearTimeout(op.timer);
				op.timer = setTimeout(() => op.controller.abort(), 30000).unref();
				// Pi auth.json values are templates: $$ preserves literal $ without resolving environment variables.
				return credential.type === "api_key"
					? { ...credential, key: credential.key!.replaceAll("$", () => "$$") }
					: credential;
			};
			const auth = provider.auth;
			runtime.registerNativeProvider({
				...provider,
				auth: {
					...auth,
					...(auth.oauth
						? {
								oauth: {
									...auth.oauth,
									login: async (interaction, options) => {
										const credential = await auth.oauth!.login(interaction, options);
										return commit(credential);
									},
								},
							}
						: {}),
					...(auth.apiKey?.login
						? {
								apiKey: {
									...auth.apiKey,
									login: async (interaction) => {
										const credential = await auth.apiKey!.login!(interaction);
										return commit(credential);
									},
								},
							}
						: {}),
				},
			});
			signal.throwIfAborted();
			let syncFailed = false;
			try {
				await runtime.login(op.state.provider, op.state.method, {
					signal,
					prompt: (prompt) => this.prompt(op, prompt),
					notify: (event) => this.notify(op, event),
				});
			} catch (error) {
				if (!(error instanceof CredentialSynchronizationError)) throw error;
				syncFailed = true; // Persistence succeeded; never report this as a failed login or encourage resubmission.
			}
			clearTimeout(op.timer);
			const refreshed = await this.refresh(op.state.provider);
			if (!this.disposed) this.update(op, { status: "succeeded", refreshRequired: syncFailed || !refreshed });
		} catch {
			if (!this.disposed && active(op.state))
				this.end(op, "failed", op.state.status === "saving" ? "storage_failed" : "login_failed");
		}
	}
	// Return prompt failures asynchronously so provider cleanup can still be installed.
	private async prompt(op: Operation, prompt: AuthPrompt): Promise<string> {
		op.controller.signal.throwIfAborted();
		if (prompt.signal?.aborted) return Promise.reject(new Error("Auth prompt cancelled"));
		if (prompt.type === "select") {
			const choice =
				op.state.provider === "openai-codex"
					? "device_code"
					: op.state.provider === "anthropic"
						? "copy_code"
						: undefined;
			if (!choice || !prompt.options.some((o) => o.id === choice))
				return Promise.reject(new Error("Unsupported auth choice"));
			return Promise.resolve(choice);
		}
		if (op.pending) return Promise.reject(new Error("Auth prompt already active"));
		const kind =
			op.state.method === "api_key" && prompt.type === "secret"
				? "api_key"
				: op.state.method === "oauth" && prompt.type === "manual_code" && op.state.provider === "anthropic"
					? "code"
					: undefined;
		if (!kind) return Promise.reject(new Error("Unsupported auth prompt"));
		return new Promise<string>((resolve, reject) => {
			const clean = () => {
				prompt.signal?.removeEventListener("abort", abort);
				op.controller.signal.removeEventListener("abort", abort);
				op.pending = undefined;
				if (op.state.prompt) this.update(op, { prompt: undefined, status: "working" });
			};
			const abort = () => {
				clean();
				reject(new Error("Auth prompt cancelled"));
			};
			op.pending = {
				id: randomUUID(),
				kind,
				resolve: (value) => {
					clean();
					resolve(value);
				},
				reject: abort,
			};
			prompt.signal?.addEventListener("abort", abort, { once: true });
			op.controller.signal.addEventListener("abort", abort, { once: true });
			this.update(op, { status: "input", prompt: { id: op.pending.id, kind } });
		});
	}
	private notify(op: Operation, event: AuthEvent): void {
		if (op.controller.signal.aborted) return;
		if (event.type === "auth_url") {
			if (!validAuthUrl(op.state.provider, event.url)) throw new Error("Invalid authorization URL");
			this.update(op, { authorization: { url: event.url } });
		} else if (event.type === "device_code") {
			if (
				op.state.provider !== "openai-codex" ||
				event.verificationUri !== "https://auth.openai.com/codex/device" ||
				!/^[-A-Za-z0-9]{1,64}$/.test(event.userCode)
			)
				throw new Error("Invalid device code");
			this.update(op, { authorization: { url: event.verificationUri, userCode: event.userCode } });
		}
		// Ignore arbitrary info/progress text: a provider error body must never reach an event or RPC.
	}
}

function validAuthUrl(provider: AuthProviderId, value: string): boolean {
	if (typeof value !== "string" || value.length > AUTH_MAX_INPUT_LENGTH || invalidAuthCharacters.test(value))
		return false;
	try {
		const url = new URL(value);
		const endpoint = provider === "anthropic" ? "https://claude.ai/oauth/authorize" : "";
		return (
			`${url.origin}${url.pathname}` === endpoint &&
			!url.username &&
			!url.password &&
			!url.hash &&
			![...url.searchParams.keys()].some(
				(k) =>
					![
						"client_id",
						"agent_name_hint",
						"ext_agent_host_id",
						"response_type",
						"redirect_uri",
						"resource",
						"scope",
						"state",
						"code_challenge",
						"code_challenge_method",
						"nonce",
						"code",
					].includes(k),
			)
		);
	} catch {
		return false;
	}
}

function validInput(kind: NonNullable<AuthFlow["prompt"]>["kind"], value: string): boolean {
	if (
		typeof value !== "string" ||
		!value.length ||
		value.length > AUTH_MAX_INPUT_LENGTH ||
		invalidAuthCharacters.test(value)
	)
		return false;
	if (kind === "api_key") return value.length <= 4096 && !value.startsWith("!");
	return kind === "code" && /^[A-Za-z0-9._~+/%=-]+(?:#[A-Za-z0-9._~+/%=-]+)?$/.test(value);
}
