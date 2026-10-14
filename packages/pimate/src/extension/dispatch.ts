import type { ErrorCode, ParamsOf, ProtocolError, RcMethod, Request, Response, ResultOf } from "@pimate/protocol";

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
	"prompt",
	"abort",
	"ui_respond",
	"set_thinking",
	"set_model",
	"compact",
	"session_op",
	"commands",
	"models",
	"sessions",
	"shutdown",
	"subagents_rpc",
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
	switch (value.method) {
		case "sessions":
			ok = p.limit === undefined || (Number.isSafeInteger(p.limit) && (p.limit as number) > 0);
			break;
		case "prompt":
			ok =
				str("text", true) &&
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
		case "compact":
			ok = str("instructions");
			break;
		case "session_op":
			ok =
				typeof p.op === "string" &&
				["new", "switch", "fork", "reload"].includes(p.op) &&
				str("arg", ["switch", "fork"].includes(p.op));
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
				: { code: "internal", message: String(e) };
		return { type: "response", id, ok: false, error };
	}
}
