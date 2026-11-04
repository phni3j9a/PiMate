import { closeSync, openSync, readFileSync, rmSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import type { UIRequest } from "@pimate/protocol";
import { PACKAGE_VERSION } from "../package.ts";
import { atomicWrite, hash } from "./config.ts";

export type WebhookConfig = { url: string; headers: Record<string, string>; machine: string };
export function readJSON<T>(dir: string, file: string, fallback: T): T {
	try {
		return JSON.parse(readFileSync(join(dir, file), "utf8")) as T;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
		throw error;
	}
}
export async function setupInput(input: NodeJS.ReadableStream, machine = hostname()): Promise<WebhookConfig> {
	if ((input as NodeJS.ReadStream).isTTY)
		console.error("Line 1: Webhook URL starting https://\nLine 2: Authorization header starting Authorization:");
	const lines = createInterface({ input, crlfDelay: Infinity });
	let url = "";
	const headers: Record<string, string> = {};
	for await (const line of lines) {
		if (!url) {
			url = line.trim();
			let parsed: URL;
			try {
				parsed = new URL(url);
			} catch {
				throw new Error("Invalid webhook URL");
			}
			if (
				parsed.username ||
				parsed.password ||
				!(
					parsed.protocol === "https:" ||
					(parsed.protocol === "http:" && ["127.0.0.1", "localhost"].includes(parsed.hostname))
				)
			)
				throw new Error("Invalid webhook URL");
			continue;
		}
		if (!line.trim()) break;
		const match = /^([!#$%&'*+.^_`|~\w-]+):\s*(.*)$/.exec(line);
		if (!match || /[\r\n]/.test(match[2])) throw new Error("Invalid header");
		headers[match[1]] = match[2];
		if (match[1].toLowerCase() === "authorization") break;
	}
	if (!url || !machine.trim()) throw new Error("Invalid webhook setup");
	return { url, headers, machine };
}
export function watches(dir: string): string[] {
	return readJSON<string[]>(dir, "webhook-watch.json", []);
}
function locked<T>(dir: string, name: string, update: () => T): T {
	const path = join(dir, `${name}.lock`);
	const fd = openSync(path, "wx", 0o600);
	try {
		return update();
	} finally {
		closeSync(fd);
		rmSync(path, { force: true });
	}
}
export function updateWatches(dir: string, update: (ids: string[]) => string[]): string[] {
	return locked(dir, "webhook-watch", () => {
		const ids = update(watches(dir));
		atomicWrite(join(dir, "webhook-watch.json"), ids);
		return ids;
	});
}
const markerKey = (instanceId: string, requestId: string) => hash(JSON.stringify([instanceId, requestId])).slice(0, 16);
export function markAnswered(dir: string, instanceId: string, requestId: string): void {
	locked(dir, "answered-here", () => {
		const now = Date.now();
		const entries = readJSON<Record<string, number>>(dir, "answered-here.json", {});
		for (const [key, time] of Object.entries(entries)) if (now - time > 7 * 86400_000) delete entries[key];
		entries[markerKey(instanceId, requestId)] = now;
		atomicWrite(join(dir, "answered-here.json"), entries);
	});
}
export function answeredHere(dir: string, instanceId: string, requestId: string): boolean {
	const time = readJSON<Record<string, number>>(dir, "answered-here.json", {})[markerKey(instanceId, requestId)];
	return typeof time === "number" && Date.now() - time <= 7 * 86400_000;
}
// Redaction patterns adapted from T3 Tots t3listen (MIT).
const SECRET_KEYS = String.raw`sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_[a-z]+_[A-Za-z0-9_]{16,}|whsec_[A-Za-z0-9+/=_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abposr]-[A-Za-z0-9-]{10,}|xapp-[A-Za-z0-9-]{10,}|npm_[A-Za-z0-9]{30,}|glpat-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|-----BEGIN [A-Z ]*PRIVATE KEY-----|https://hooks\.slack\.com/services/[A-Za-z0-9/]+|https://(?:ptb\.|canary\.)?discord(?:app)?\.com/api/webhooks/\d+/[\w-]+`;
const RED = new RegExp(
	`(${SECRET_KEYS}|eyJ[A-Za-z0-9_-]{15,}\\.[A-Za-z0-9_.-]+|\\b(?:(?:api|secret|access|private|client)[_-]?(?:key|secret)s?|tokens?|secrets?|passwds?|passwords?)["']?\\s*[:=]\\s*(?:"(?:[^"\\\\\\n]|\\\\.){4,}"|'(?:[^'\\\\\\n]|\\\\.){4,}'|\\S{6,})|\\bauthorization\\s*[:=]\\s*(?:(?:bearer|basic|token)\\s+)?[A-Za-z0-9._~+/=-]{12,}|\\bbearer\\s+[A-Za-z0-9._~+/=-]{16,})`,
	"gi",
);
export function clean(value: unknown, key = ""): unknown {
	if (typeof value === "string")
		return /(^id$|Id$)/.test(key) ? value : value.replace(RED, "[redacted]").split(homedir()).join("~");
	if (Array.isArray(value)) return value.map((item) => clean(item, key));
	if (value && typeof value === "object")
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clean(v, k)]));
	return value;
}
type Payload = Record<string, unknown> & { event: string; eventId: string; instanceId: string };
export function payload(
	config: WebhookConfig,
	event: string,
	instanceId: string,
	sessionId: string | null,
	cwd: string,
	title: string | undefined,
	ref: string,
	details: Record<string, unknown> = {},
): Payload {
	const where = `"${title || basename(cwd)}" on ${config.machine}`;
	const req = details as Partial<UIRequest>;
	const questions = req.questions
		?.map((q) => `${q.question}${q.options.length ? ` (${q.options.map((o) => o.label).join(", ")})` : ""}`)
		.join("; ");
	const text =
		event === "request.opened"
			? `Pi needs input in ${where}: ${[req.title, req.message, questions, req.options?.join(", ")].filter(Boolean).join("; ")}`
			: event === "request.resolved"
				? `Pi request in ${where} was resolved by ${details.by}.`
				: event === "test"
					? `Pi webhook test on ${config.machine}.`
					: `Pi ${event === "pi.finished" ? "finished" : event === "pi.failed" ? "failed" : String(details.kind)} in ${where}.${details.lastReply ? ` Last reply: ${details.lastReply}` : ""}${details.error ? ` Error: ${details.error}` : ""}`;
	return clean({
		...details,
		event,
		eventId: hash(JSON.stringify([event, instanceId, ref])).slice(0, 16),
		machine: config.machine,
		instanceId,
		sessionId,
		title: title || basename(cwd),
		cwd,
		sentAt: new Date().toISOString(),
		text,
	}) as Payload;
}
export function retryable(status: number, body = ""): boolean {
	return !status || status === 408 || status === 429 || status >= 500 || /rate.?limit|too many|try again/i.test(body);
}
export function keepRetry(status: number, body: string, since: number, rounds: number, now = Date.now()): boolean {
	return retryable(status, body) ? now - since < 86400_000 : rounds < 10;
}
type Result = { ok: boolean; status: number; body: string; code?: string; retry: boolean; rateLimited?: boolean };
export async function post(config: WebhookConfig, event: Payload): Promise<Result> {
	try {
		const response = await fetch(config.url, {
			method: "POST",
			redirect: "error",
			headers: { "content-type": "application/json", "user-agent": `pimate/${PACKAGE_VERSION}`, ...config.headers },
			body: JSON.stringify(event),
			signal: AbortSignal.timeout(20_000),
		});
		let body = response.ok ? "" : await response.text().catch(() => "");
		const retry = retryable(response.status, body);
		const rateLimited = /rate.?limit|too many|try again/i.test(body);
		for (const secret of [config.url, ...Object.values(config.headers).flatMap((v) => [v, ...v.split(/\s+/)])]
			.filter(Boolean)
			.sort((a, b) => b.length - a.length))
			body = body.split(secret).join("[redacted]");
		body = String(clean(body)).replace(/\s+/g, " ").slice(0, 500);
		return { ok: response.ok, status: response.status, body, retry, rateLimited };
	} catch (error) {
		const e = error as NodeJS.ErrnoException & { cause?: NodeJS.ErrnoException };
		return { ok: false, status: 0, body: "", code: e.cause?.code || e.code || e.name || "ERROR", retry: true };
	}
}
type Item = { event: Payload; since: number; rounds: number; onSuccess?: () => void; onDrop?: () => void };
export class WebhookDelivery {
	// shortcut: retry queue is memory-only, use durable storage if delivery across Host restarts is required.
	private queue: Item[] = [];
	private timer: NodeJS.Timeout;
	private timers = new Set<NodeJS.Timeout>();
	private stopped = false;
	private config: (event: Payload) => WebhookConfig | null;
	constructor(config: (event: Payload) => WebhookConfig | null) {
		this.config = config;
		this.timer = setInterval(() => void this.retry(), 60_000);
		this.timer.unref();
	}
	private log(event: Payload, result: Result): void {
		console.error(
			`webhook ${result.ok ? "sent" : "failed"} ${event.event} ${event.eventId.slice(-12)} ${result.status ? `HTTP ${result.status}` : result.code}`,
		);
	}
	private enqueue(item: Item): void {
		if (this.queue.length < 100) this.queue.push(item);
		else {
			console.error(`webhook dropped ${item.event.event} ${item.event.eventId}`);
			item.onDrop?.();
		}
	}
	async send(event: Payload, onSuccess?: () => void, onDrop?: () => void): Promise<void> {
		const item = { event, since: Date.now(), rounds: 0, onSuccess, onDrop };
		for (let i = 0; i < 3 && !this.stopped; i++) {
			const config = this.config(event);
			if (!config) {
				onDrop?.();
				return;
			}
			const result = await post(config, event);
			this.log(event, result);
			if (this.stopped) return;
			if (result.ok) {
				onSuccess?.();
				return;
			}
			if (!result.retry || i === 2) {
				this.enqueue(item);
				return;
			}
			await new Promise<void>((resolve) => {
				const timer = setTimeout(
					() => {
						this.timers.delete(timer);
						resolve();
					},
					(result.rateLimited ? 20000 : 2000) * (i ? 3 : 1),
				);
				timer.unref();
				this.timers.add(timer);
			});
		}
	}
	private async retry(): Promise<void> {
		const items = this.queue.splice(0);
		for (const item of items) {
			const config = this.config(item.event);
			if (!config || this.stopped) {
				item.onDrop?.();
				continue;
			}
			item.rounds++;
			const result = await post(config, item.event);
			this.log(item.event, result);
			if (this.stopped) return;
			if (result.ok) item.onSuccess?.();
			else if (keepRetry(result.retry ? 0 : result.status, "", item.since, item.rounds)) this.enqueue(item);
			else {
				console.error(`webhook dropped ${item.event.event} ${item.event.eventId}`);
				item.onDrop?.();
			}
		}
	}
	close(): void {
		this.stopped = true;
		clearInterval(this.timer);
		for (const timer of this.timers) clearTimeout(timer);
		this.timers.clear();
		this.queue = [];
	}
}
export function off(dir: string): void {
	rmSync(join(dir, "webhook.json"), { force: true });
	locked(dir, "webhook-watch", () => rmSync(join(dir, "webhook-watch.json"), { force: true }));
}
