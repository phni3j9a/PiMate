import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, expect, it } from "vitest";
import { atomicWrite } from "../src/host/config.ts";
import { answeredHere, keepRetry, markAnswered, payload, post, retryable, setupInput } from "../src/host/webhook.ts";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
it("reads setup through Authorization and writes credentials privately", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pimate-webhook-"));
	dirs.push(dir);
	const config = await setupInput(
		Readable.from(["http://127.0.0.1:1234/hook\nX-Test: value\nAuthorization: Bearer abc\nignored\n"]),
		"desk",
	);
	atomicWrite(join(dir, "webhook.json"), config);
	expect(statSync(join(dir, "webhook.json")).mode & 0o777).toBe(0o600);
	expect(JSON.parse(readFileSync(join(dir, "webhook.json"), "utf8"))).toEqual(config);
	expect(config.headers).toEqual({ "X-Test": "value", Authorization: "Bearer abc" });
	await expect(setupInput(Readable.from(["http://example.com\n"]))).rejects.toThrow("Invalid webhook URL");
});
it("builds summaries and recursively redacts text but not ids", () => {
	const secret = `sk-${"a".repeat(30)}`;
	const config = { url: "https://example.com", headers: {}, machine: "desk" };
	const result = payload(config, "request.opened", "instance", "session", `${process.env.HOME}/work`, undefined, "r", {
		requestId: secret,
		kind: "select",
		title: `token: ${secret}`,
		options: [secret, "safe"],
	});
	expect(result.requestId).toBe(secret);
	expect(result.cwd).toBe("~/work");
	expect(result.title).toBe("work");
	expect(JSON.stringify(result.text)).not.toContain(secret);
	expect(result.options).toEqual(["[redacted]", "safe"]);
	expect(result.eventId).toMatch(/^[a-f0-9]{16}$/);
});
it("classifies failures and enforces retry age and round limits", () => {
	expect(retryable(400, "Automation run rate limit exceeded")).toBe(true);
	expect(retryable(401)).toBe(false);
	expect(retryable(0)).toBe(true);
	expect(keepRetry(503, "", 0, 99, 86400_000)).toBe(false);
	expect(keepRetry(401, "", 0, 9, 0)).toBe(true);
	expect(keepRetry(401, "", 0, 10, 0)).toBe(false);
});
it("markers are scoped to an instance and expire", () => {
	const dir = mkdtempSync(join(tmpdir(), "pimate-webhook-"));
	dirs.push(dir);
	markAnswered(dir, "one", "request");
	expect(answeredHere(dir, "one", "request")).toBe(true);
	expect(answeredHere(dir, "two", "request")).toBe(false);
	const path = join(dir, "answered-here", readdirSync(join(dir, "answered-here"))[0]);
	const old = new Date(Date.now() - 8 * 86400_000);
	utimesSync(path, old, old);
	expect(answeredHere(dir, "one", "request")).toBe(false);
});
it("posts to loopback and strips configured secrets from rejection bodies", async () => {
	const server = createServer((_req, res) => {
		res.writeHead(401);
		res.end("Bearer verysecretvalue");
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	try {
		const config = {
			url: `http://127.0.0.1:${(server.address() as { port: number }).port}/hook`,
			headers: { Authorization: "Bearer verysecretvalue" },
			machine: "desk",
		};
		const result = await post(config, payload(config, "test", "", null, "", "", "test"));
		expect(result.status).toBe(401);
		expect(result).not.toHaveProperty("body");
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});

it("CLI setup, status, test and off use only the temporary config and loopback", async () => {
	const { spawn } = await import("node:child_process");
	const { fileURLToPath } = await import("node:url");
	const dir = mkdtempSync(join(tmpdir(), "pimate-cli-webhook-"));
	dirs.push(dir);
	const received: unknown[] = [];
	const server = createServer(async (req, res) => {
		const chunks: Buffer[] = [];
		for await (const chunk of req) chunks.push(Buffer.from(chunk));
		received.push(JSON.parse(Buffer.concat(chunks).toString()));
		res.writeHead(200).end();
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const run = (args: string[], stdin = "") =>
		new Promise<{ code: number | null; output: string }>((resolve, reject) => {
			const child = spawn(
				process.execPath,
				[fileURLToPath(new URL("../src/host/cli.ts", import.meta.url)), "webhook", ...args],
				{
					env: {
						...process.env,
						PIMATE_CONFIG_DIR: join(dir, "config"),
						PIMATE_RUN_DIR: join(dir, "run"),
						PIMATE_ABDUCO: "/absent",
					},
				},
			);
			let output = "";
			child.stdout.on("data", (chunk) => {
				output += String(chunk);
			});
			child.stderr.on("data", (chunk) => {
				output += String(chunk);
			});
			child.on("error", reject);
			child.on("close", (code) => resolve({ code, output }));
			child.stdin.end(stdin);
		});
	try {
		const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/hook`;
		const setup = await run(["setup", "--machine", "desk"], `${url}\nAuthorization: Bearer verysecretvalue\n`);
		expect(setup.code).toBe(0);
		expect(setup.output).not.toContain("verysecretvalue");
		expect(setup.output).not.toContain(url);
		expect(statSync(join(dir, "config", "webhook.json")).mode & 0o777).toBe(0o600);
		const status = await run(["status"]);
		expect(JSON.parse(status.output)).toEqual({ configured: true, machine: "desk", watched: [] });
		const test = await run(["test"]);
		expect(JSON.parse(test.output)).toEqual({ ok: true, status: 200 });
		expect(received).toMatchObject([{ event: "test", machine: "desk" }]);
		expect((await run(["watch", "missing"])).output).toContain("NOT_FOUND");
		expect((await run(["off"])).code).toBe(0);
		expect((await run(["test"])).output).toContain("WEBHOOK_NOT_CONFIGURED");
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});

it("retries rejected deliveries for ten rounds and transient errors for at most 24 hours", async () => {
	const { vi } = await import("vitest");
	const { WebhookDelivery } = await import("../src/host/webhook.ts");
	vi.useFakeTimers();
	const log = vi.spyOn(console, "error").mockImplementation(() => {});
	const config = { url: "http://127.0.0.1:1234", headers: {}, machine: "desk" };
	const event = payload(config, "test", "instance", null, "", "", "r");
	const mock = vi.fn().mockResolvedValue(new Response("denied", { status: 401 }));
	vi.stubGlobal("fetch", mock);
	const delivery = new WebhookDelivery(() => config);
	try {
		await delivery.send(event);
		await vi.advanceTimersByTimeAsync(11 * 60_000);
		expect(mock).toHaveBeenCalledTimes(11);
		delivery.close();
		mock.mockClear();
		mock.mockRejectedValue(new Error("offline"));
		const transient = new WebhookDelivery(() => config);
		const sent = transient.send(event);
		await vi.advanceTimersByTimeAsync(8000);
		await sent;
		expect(mock).toHaveBeenCalledTimes(3);
		vi.setSystemTime(Date.now() + 24 * 60 * 60_000);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(mock).toHaveBeenCalledTimes(4);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(mock).toHaveBeenCalledTimes(4);
		transient.close();
	} finally {
		delivery.close();
		log.mockRestore();
		vi.unstubAllGlobals();
		vi.useRealTimers();
	}
});

it("isolates delivery callbacks, including retry callbacks", async () => {
	const { vi } = await import("vitest");
	const { WebhookDelivery } = await import("../src/host/webhook.ts");
	const config = { url: "http://127.0.0.1:1234", headers: {}, machine: "test" };
	const event = payload(config, "test", "instance", null, "", "", "r");
	let status = 200;
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response("", { status })),
	);
	const log = vi.spyOn(console, "error").mockImplementation(() => {});
	const delivery = new WebhookDelivery(() => config);
	try {
		await expect(
			delivery.send(event, () => {
				throw new Error("disk");
			}),
		).resolves.toBeUndefined();
		status = 401;
		await delivery.send(event, () => {
			throw new Error("disk");
		});
		status = 200;
		await expect((delivery as unknown as { retry: () => Promise<void> }).retry()).resolves.toBeUndefined();
	} finally {
		delivery.close();
		log.mockRestore();
		vi.unstubAllGlobals();
	}
});

it("treats invalid webhook data as absent and ignores obsolete lock files", async () => {
	const { writeFileSync } = await import("node:fs");
	const { readWebhookConfig, timestamps, setWatch, watches } = await import("../src/host/webhook.ts");
	const dir = mkdtempSync(join(tmpdir(), "pimate-invalid-webhook-"));
	dirs.push(dir);
	writeFileSync(join(dir, "webhook-watch.lock"), "stale");
	writeFileSync(join(dir, "answered-here.lock"), "stale");
	for (const value of ["{", "null", "[]", '"bad"']) {
		for (const file of ["webhook.json", "webhook-state.json"]) writeFileSync(join(dir, file), value);
		expect(readWebhookConfig(dir)).toBeNull();
		expect(watches(dir)).toEqual([]);
		expect(timestamps(dir, "webhook-state.json")).toEqual({});
		expect(answeredHere(dir, "instance", "request")).toBe(false);
	}
	setWatch(dir, "instance", true);
	expect(watches(dir)).toEqual(["instance"]);
	markAnswered(dir, "instance", "request");
	expect(answeredHere(dir, "instance", "request")).toBe(true);
});

it("never prints a rejection body containing the webhook URL path secret", async () => {
	const { spawn } = await import("node:child_process");
	const { fileURLToPath } = await import("node:url");
	const { vi } = await import("vitest");
	const { WebhookDelivery } = await import("../src/host/webhook.ts");
	const dir = mkdtempSync(join(tmpdir(), "pimate-secret-response-"));
	dirs.push(dir);
	const secret = "url-path-secret-do-not-print";
	const server = createServer((req, res) => {
		res.writeHead(404);
		res.end(`Cannot POST ${req.url}`);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const config = {
		url: `http://127.0.0.1:${(server.address() as { port: number }).port}/hooks/${secret}`,
		headers: {},
		machine: "desk",
	};
	atomicWrite(join(dir, "webhook.json"), config);
	const logs = vi.spyOn(console, "error").mockImplementation(() => {});
	const delivery = new WebhookDelivery(() => config);
	try {
		const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
			const child = spawn(
				process.execPath,
				[fileURLToPath(new URL("../src/host/cli.ts", import.meta.url)), "webhook", "test"],
				{ env: { ...process.env, PIMATE_CONFIG_DIR: dir, PIMATE_RUN_DIR: join(dir, "run"), PIMATE_ABDUCO: "/absent" } },
			);
			let output = "";
			child.stdout.on("data", (c) => {
				output += String(c);
			});
			child.stderr.on("data", (c) => {
				output += String(c);
			});
			child.on("error", reject);
			child.on("close", (code) => resolve({ code, output }));
		});
		expect(result.code).toBe(1);
		expect(result.output).toContain("WEBHOOK_REJECTED HTTP 404");
		expect(result.output).not.toContain(secret);
		expect(result.output).not.toContain("Cannot POST");
		await delivery.send(payload(config, "test", "i", null, "", "", "r"));
		expect(JSON.stringify(logs.mock.calls)).not.toContain(secret);
		expect(JSON.stringify(logs.mock.calls)).not.toContain("Cannot POST");
	} finally {
		delivery.close();
		logs.mockRestore();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});

it("keeps concurrent watch writers and independent answered markers private", async () => {
	const { spawn } = await import("node:child_process");
	const { fileURLToPath, pathToFileURL } = await import("node:url");
	const { watches, unmarkAnswered } = await import("../src/host/webhook.ts");
	const dir = mkdtempSync(join(tmpdir(), "pimate-concurrent-watch-"));
	dirs.push(dir);
	const moduleUrl = pathToFileURL(fileURLToPath(new URL("../src/host/webhook.ts", import.meta.url))).href;
	const write = (id: string) =>
		new Promise<void>((resolve, reject) => {
			const child = spawn(
				process.execPath,
				[
					"--input-type=module",
					"-e",
					`import { setWatch } from ${JSON.stringify(moduleUrl)}; setWatch(process.argv[1], process.argv[2], true)`,
					dir,
					id,
				],
				{ stdio: "pipe" },
			);
			child.on("error", reject);
			child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`child exited ${code}`))));
		});
	await Promise.all([write("one"), write("two")]);
	expect(watches(dir)).toEqual(["one", "two"]);
	expect(statSync(join(dir, "webhook-watch")).mode & 0o777).toBe(0o700);
	for (const id of ["one", "two"]) expect(statSync(join(dir, "webhook-watch", id)).mode & 0o777).toBe(0o600);
	const first = markAnswered(dir, "one", "request");
	markAnswered(dir, "two", "request");
	unmarkAnswered(dir, "one", "request", first);
	expect(answeredHere(dir, "one", "request")).toBe(false);
	expect(answeredHere(dir, "two", "request")).toBe(true);
	expect(statSync(join(dir, "answered-here")).mode & 0o777).toBe(0o700);
	for (const name of readdirSync(join(dir, "answered-here")))
		expect(statSync(join(dir, "answered-here", name)).mode & 0o777).toBe(0o600);
});

it("avoids repeating a request title identical to a question", () => {
	const config = { url: "https://example.com", headers: {}, machine: "desk" };
	const result = payload(config, "request.opened", "i", null, "/tmp", "project", "r", {
		title: "Which DB?",
		kind: "questionnaire",
		questions: [{ question: "Which DB?", options: [{ label: "Postgres" }, { label: "SQLite" }] }],
	});
	expect(result.text).toBe('Pi needs input in "project" on desk: Which DB? (Postgres, SQLite)');
});

it("classifies rate-limit bodies without exposing them in post results", async () => {
	const server = createServer((_req, res) => {
		res.writeHead(400);
		res.end("Automation run rate limit exceeded /secret");
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	try {
		const config = {
			url: `http://127.0.0.1:${(server.address() as { port: number }).port}/secret`,
			headers: {},
			machine: "desk",
		};
		const result = await post(config, payload(config, "test", "", null, "", "", "r"));
		expect(result).toMatchObject({ status: 400, retry: true, rateLimited: true });
		expect(JSON.stringify(result)).not.toContain("secret");
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});
