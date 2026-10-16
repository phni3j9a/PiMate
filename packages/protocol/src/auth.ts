/** Auth is scoped to a running standard Pi CLI and its shared agent directory, not a chat session. */
export const AUTH_PROVIDER_IDS = ["openai", "openai-codex", "anthropic"] as const;
export type AuthProviderId = (typeof AUTH_PROVIDER_IDS)[number];
export type ProviderAuthType = "oauth" | "api_key";
export const AUTH_MAX_WAIT_MS = 25000;
export const AUTH_FLOW_TTL_MS = 15 * 60 * 1000;
export const AUTH_MAX_INPUT_LENGTH = 8192;

export interface AuthProviderInfo {
	id: AuthProviderId;
	methods: ProviderAuthType[];
	/** Stored credential metadata only; not proof that it is valid. */
	stored: ProviderAuthType | null;
	/** Active registry snapshot; environment/models.json/runtime auth can survive logout. */
	configured: boolean;
	source?: "stored" | "runtime" | "environment" | "fallback" | "models_json_key" | "models_json_command";
}

/** RPC-only, transient state. Never put auth inputs or this state in app persistence or chat. */
export interface AuthFlow {
	id: string;
	provider: AuthProviderId;
	method: ProviderAuthType;
	revision: number;
	/** Interactive deadline; an already-started commit/refresh can finish up to 60s later. */
	expiresAt: number;
	status: "working" | "input" | "saving" | "succeeded" | "failed" | "cancelled" | "expired";
	/** Public authorization URL and optional user-facing device code, never tokens. */
	authorization?: { url: string; userCode?: string };
	prompt?: { id: string; kind: "api_key" | "code" | "callback_url" };
	/** Fixed safe messages only. storage_failed may have unknown persistence outcome: inspect metadata, never auto-resend. */
	error?: "login_failed" | "storage_failed";
	/** Credential saved but local registry refresh failed. Reopen models/reload Pi; do not resend credentials. */
	refreshRequired?: boolean;
}

export interface AuthMethods {
	/** Also recovers the latest transient flow after reconnect/lost begin receipt, without resending input. */
	auth_list: { params: Record<string, never>; result: { providers: AuthProviderInfo[]; flow?: AuthFlow } };
	auth_begin: { params: { provider: AuthProviderId; method: ProviderAuthType }; result: { flow: AuthFlow } };
	/** One outstanding wait per RC. Wait again only after the previous response; max 25s. */
	auth_wait: { params: { flowId: string; afterRevision: number; waitMs?: number }; result: { flow: AuthFlow } };
	/** Submit once; never automatically retry secrets after a transport failure. */
	auth_respond: { params: { flowId: string; promptId: string; value: string }; result: { flow: AuthFlow } };
	/** Cancellation is no longer allowed at the atomic storage commit boundary (`saving` => busy). */
	auth_cancel: { params: { flowId: string }; result: { flow: AuthFlow } };
	/** Removes only the stored credential. No env/models.json changes or provider revocation. */
	auth_logout: { params: { provider: AuthProviderId }; result: { refreshRequired: boolean } };
}
