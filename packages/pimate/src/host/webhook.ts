import { randomUUID } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import type { UIRequest } from "@pimate/protocol";
import { PACKAGE_VERSION } from "../package.ts";
import { privateRunDir, validInstanceId } from "../runtime.ts";
import { atomicWrite, hash } from "./config.ts";

export type WebhookConfig = { url: string; headers: Record<string, string>; machine: string };
const logged = new Set<string>();
export function webhookError(operation: string): void {
	if (!logged.has(operation)) {
		logged.add(operation);
		console.error(`webhook ${operation} failed`);
	}
}
function readJSON<T>(dir: string, file: string, fallback: T, valid: (value: unknown) => value is T): T {
	try {
		const value: unknown = JSON.parse(readFileSync(join(dir, file), "utf8"));
		if (valid(value)) return value;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
	}
	webhookError(`read ${file}`);
	return fallback;
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === "object" && !Array.isArray(value);
export function readWebhookConfig(dir: string): WebhookConfig | null {
	return readJSON<WebhookConfig | null>(dir, "webhook.json", null, (value): value is WebhookConfig => {
		if (
			!isRecord(value) ||
			typeof value.url !== "string" ||
			typeof value.machine !== "string" ||
			!isRecord(value.headers) ||
			!Object.values(value.headers).every((v) => typeof v === "string")
		)
			return false;
		try {
			const url = new URL(value.url);
			return (
				!url.username &&
				!url.password &&
				(url.protocol === "https:" || (url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname)))
			);
		} catch {
			return false;
		}
	});
}
export function timestamps(dir: string, file: string): Record<string, number> {
	return readJSON<Record<string, number>>(
		dir,
		file,
		{},
		(value): value is Record<string, number> =>
			isRecord(value) && Object.values(value).every((v) => typeof v === "number" && Number.isFinite(v)),
	);
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
function entries(dir: string, name: string): string[] {
	try {
		return readdirSync(join(dir, name), { withFileTypes: true })
			.filter((entry) => entry.isFile())
			.map((entry) => entry.name);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") webhookError(`read ${name}`);
		return [];
	}
}
export function watches(dir: string): string[] {
	return entries(dir, "webhook-watch").filter(validInstanceId).sort();
}
export function setWatch(dir: string, id: string, enabled: boolean): void {
	if (!validInstanceId(id)) throw new Error("Invalid instance id");
	const path = join(dir, "webhook-watch", id);
	if (!enabled) {
		rmSync(path, { force: true });
		return;
	}
	privateRunDir(dir);
	privateRunDir(join(dir, "webhook-watch"));
	try {
		writeFileSync(path, "", { flag: "wx", mode: 0o600 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
}
const markerKey = (instanceId: string, requestId: string) => hash(JSON.stringify([instanceId, requestId])).slice(0, 16);
export function markAnswered(dir: string, instanceId: string, requestId: string): string {
	privateRunDir(dir);
	const folder = join(dir, "answered-here");
	privateRunDir(folder);
	const now = Date.now();
	for (const name of entries(dir, "answered-here")) {
		if (!/^[a-f0-9]{16}$/.test(name)) continue;
		try {
			if (now - lstatSync(join(folder, name)).mtimeMs > 7 * 86400_000) rmSync(join(folder, name), { force: true });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
	const token = randomUUID();
	atomicWrite(join(folder, markerKey(instanceId, requestId)), token);
	return token;
}
export function unmarkAnswered(dir: string, instanceId: string, requestId: string, token: string): void {
	const path = join(dir, "answered-here", markerKey(instanceId, requestId));
	try {
		if (JSON.parse(readFileSync(path, "utf8")) === token) rmSync(path, { force: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}
export function answeredHere(dir: string, instanceId: string, requestId: string): boolean {
	try {
		const stat = lstatSync(join(dir, "answered-here", markerKey(instanceId, requestId)));
		return stat.isFile() && Date.now() - stat.mtimeMs <= 7 * 86400_000;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") webhookError("read answered-here");
		return false;
	}
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
			? `Pi needs input in ${where}: ${[req.questions?.some((q) => q.question === req.title) ? undefined : req.title, req.message, questions, req.options?.join(", ")].filter(Boolean).join("; ")}`
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
type Result = { ok: boolean; status: number; code?: string; retry: boolean; rateLimited?: boolean };
export async function post(config: WebhookConfig, event: Payload): Promise<Result> {
	try {
		const response = await fetch(config.url, {
			method: "POST",
			redirect: "error",
			headers: { "content-type": "application/json", "user-agent": `pimate/${PACKAGE_VERSION}`, ...config.headers },
			body: JSON.stringify(event),
			signal: AbortSignal.timeout(20_000),
		});
		const body = response.ok ? "" : await response.text().catch(() => "");
		return {
			ok: response.ok,
			status: response.status,
			retry: retryable(response.status, body),
			rateLimited: /rate.?limit|too many|try again/i.test(body),
		};
	} catch (error) {
		const e = error as NodeJS.ErrnoException & { cause?: NodeJS.ErrnoException };
		return { ok: false, status: 0, code: e.cause?.code || e.code || e.name || "ERROR", retry: true };
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
		this.timer = setInterval(() => {
			void this.retry().catch(() => webhookError("retry"));
		}, 60_000);
		this.timer.unref();
	}
	private log(event: Payload, result: Result): void {
		console.error(
			`webhook ${result.ok ? "sent" : "failed"} ${event.event} ${event.eventId.slice(-12)} ${result.status ? `HTTP ${result.status}` : result.code}`,
		);
	}
	private callback(fn?: () => void): void {
		if (!fn) return;
		try {
			fn();
		} catch {
			webhookError("callback");
		}
	}
	private enqueue(item: Item): void {
		if (this.queue.length < 100) this.queue.push(item);
		else {
			console.error(`webhook dropped ${item.event.event} ${item.event.eventId}`);
			this.callback(item.onDrop);
		}
	}
	async send(event: Payload, onSuccess?: () => void, onDrop?: () => void): Promise<void> {
		try {
			await this.sendAttempts(event, onSuccess, onDrop);
		} catch {
			webhookError("delivery");
			this.callback(onDrop);
		}
	}
	private async sendAttempts(event: Payload, onSuccess?: () => void, onDrop?: () => void): Promise<void> {
		const item = { event, since: Date.now(), rounds: 0, onSuccess, onDrop };
		for (let i = 0; i < 3 && !this.stopped; i++) {
			const config = this.config(event);
			if (!config) {
				this.callback(onDrop);
				return;
			}
			const result = await post(config, event);
			this.log(event, result);
			if (this.stopped) return;
			if (result.ok) {
				this.callback(onSuccess);
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
				this.callback(item.onDrop);
				continue;
			}
			item.rounds++;
			const result = await post(config, item.event);
			this.log(item.event, result);
			if (this.stopped) return;
			if (result.ok) this.callback(item.onSuccess);
			else if (keepRetry(result.retry ? 0 : result.status, "", item.since, item.rounds)) this.enqueue(item);
			else {
				console.error(`webhook dropped ${item.event.event} ${item.event.eventId}`);
				this.callback(item.onDrop);
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
	rmSync(join(dir, "webhook-watch"), { recursive: true, force: true });
}
