import type { ErrorCode, ParamsOf, ProtocolError, RcMethod, Request, Response, ResultOf } from "@pimate/protocol";
import {
	AUTH_MAX_INPUT_LENGTH,
	AUTH_MAX_WAIT_MS,
	AUTH_PROVIDER_IDS,
	MAX_IMAGE_PROMPT_TEXT,
	validPromptImages,
} from "@pimate/protocol";

export class RcError extends Error {
	readonly code: ErrorCode;
	readonly data?: unknown;
	constructor(code: ErrorCode, message = code as string, data?: unknown) {
		super(message);
		this.code = code;
		this.data = data;
	}
}
export type Handlers = { [M in RcMethod]: (params: ParamsOf<M>) => ResultOf<M> | Promise<ResultOf<M>> };
const methods = [
	"hello",
	"history",
	"entry_image",
	"file_image",
	"prompt",
	"abort",
	"ui_respond",
	"set_thinking",
	"set_model",
	"compact",
	"session_op",
	"session_tree",
	"set_label",
	"commands",
	"models",
	"set_scoped_models",
	"sessions",
	"shutdown",
	"subagents_rpc",
	"subagent_transcript",
	"subagent_control",
	"auth_list",
	"auth_begin",
	"auth_wait",
	"auth_respond",
	"auth_cancel",
	"auth_logout",
];
function object(v: unknown): v is Record<string, unknown> {
	return !!v && typeof v === "object" && !Array.isArray(v);
}
export function validateRequest(value: unknown): Request {
	if (!object(value) || typeof value.id !== "string" || !value.id || typeof value.method !== "string")
		throw new RcError("bad_request");
	if (!methods.includes(value.method)) throw new RcError("unknown_method");
	for (const k of ["expectInstanceId", "expectSessionId"])
		if (value[k] !== undefined && typeof value[k] !== "string") throw new RcError("bad_request");
	const p = value.params === undefined ? {} : value.params;
	if (!object(p)) throw new RcError("bad_request");
	const str = (k: string, required = false) =>
		required ? typeof p[k] === "string" && !!p[k] : p[k] === undefined || typeof p[k] === "string";
	const bool = (k: string) => p[k] === undefined || typeof p[k] === "boolean";
	let ok = true;
	const authId = (k: string) => typeof p[k] === "string" && /^[a-f0-9-]{36}$/.test(p[k] as string);
	const authProvider = () =>
		typeof p.provider === "string" && (AUTH_PROVIDER_IDS as readonly string[]).includes(p.provider);
	switch (value.method) {
		case "auth_begin":
			ok = authProvider() && (p.method === "oauth" || p.method === "api_key");
			break;
		case "auth_logout":
			ok = authProvider();
			break;
		case "auth_cancel":
			ok = authId("flowId");
			break;
		case "auth_wait":
			ok =
				authId("flowId") &&
				Number.isSafeInteger(p.afterRevision) &&
				(p.afterRevision as number) >= 0 &&
				(p.waitMs === undefined ||
					(Number.isSafeInteger(p.waitMs) && (p.waitMs as number) >= 0 && (p.waitMs as number) <= AUTH_MAX_WAIT_MS));
			break;
		case "auth_respond":
			ok =
				authId("flowId") &&
				authId("promptId") &&
				typeof p.value === "string" &&
				p.value.length > 0 &&
				p.value.length <= AUTH_MAX_INPUT_LENGTH;
			break;
		case "entry_image":
			ok = str("entryId", true) && Number.isSafeInteger(p.index) && (p.index as number) >= 0 && bool("thumbnail");
			break;
		case "file_image":
			ok = str("path", true) && !(p.path as string).includes("\0");
			break;
		case "sessions":
			ok = p.limit === undefined || (Number.isSafeInteger(p.limit) && (p.limit as number) > 0);
			break;
		case "prompt":
			ok =
				typeof p.text === "string" &&
				(p.images === undefined || validPromptImages(p.images)) &&
				(!!p.text.trim() || (Array.isArray(p.images) && p.images.length > 0)) &&
				(!Array.isArray(p.images) || !p.images.length || p.text.length <= MAX_IMAGE_PROMPT_TEXT) &&
				(p.deliverAs === undefined ||
					(typeof p.deliverAs === "string" && ["steer", "followUp"].includes(p.deliverAs))) &&
				bool("expandTemplates");
			break;
		case "ui_respond":
			ok = str("requestId", true) && str("value") && bool("confirmed") && bool("cancelled");
			break;
		case "set_thinking":
			ok = typeof p.level === "string" && ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(p.level);
			break;
		case "set_model":
			ok = str("provider", true) && str("id", true);
			break;
		case "set_scoped_models":
			ok =
				Array.isArray(p.models) &&
				p.models.length <= 500 &&
				p.models.every((m) => object(m) && typeof m.provider === "string" && typeof m.id === "string");
			break;
		case "compact":
			ok = str("instructions");
			break;
		case "session_op":
			ok =
				typeof p.op === "string" &&
				["new", "switch", "fork", "reload", "tree"].includes(p.op) &&
				str("arg", ["switch", "fork", "tree"].includes(p.op)) &&
				bool("summarize");
			break;
		case "set_label":
			ok = str("entryId", true) && str("label") && (p.label === undefined || (p.label as string).length <= 200);
			break;
		case "subagent_transcript":
			ok = str("runId", true) && str("childId", true) && str("cursor");
			break;
		case "subagent_control":
			ok =
				str("runId", true) &&
				str("childId") &&
				str("text") &&
				typeof p.action === "string" &&
				["steer", "follow_up", "interrupt", "resume", "stop", "stop_child", "abort_parent"].includes(p.action);
			break;
		case "subagents_rpc":
			ok =
				str("method", true) &&
				(p.timeoutMs === undefined ||
					(typeof p.timeoutMs === "number" &&
						Number.isFinite(p.timeoutMs) &&
						p.timeoutMs > 0 &&
						p.timeoutMs <= 120000));
			break;
	}
	if (!ok) throw new RcError("bad_request", `Invalid params for ${value.method}`);
	return { ...value, params: p } as unknown as Request;
}
export async function dispatch(
	value: unknown,
	target: { instanceId: string; sessionId?: string },
	handlers: Handlers,
): Promise<Response> {
	let id: string | null = object(value) && typeof value.id === "string" ? value.id : null;
	try {
		const req = validateRequest(value);
		id = req.id;
		if (req.expectInstanceId !== undefined && req.expectInstanceId !== target.instanceId)
			throw new RcError("instance_mismatch");
		if (req.expectSessionId !== undefined && req.expectSessionId !== target.sessionId)
			throw new RcError("session_changed", "Session changed", { sessionId: target.sessionId });
		const handler = handlers[req.method] as (
			params: Request["params"],
		) => ResultOf<RcMethod> | Promise<ResultOf<RcMethod>>;
		return { type: "response", id, ok: true, result: await handler(req.params) };
	} catch (e) {
		const error: ProtocolError =
			e instanceof RcError
				? { code: e.code, message: e.message, data: e.data }
				: {
						code: "internal",
						message:
							object(value) && typeof value.method === "string" && value.method.startsWith("auth_")
								? "Auth operation failed"
								: String(e),
					};
		return { type: "response", id, ok: false, error };
	}
}
