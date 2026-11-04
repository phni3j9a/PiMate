import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
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
	const path = join(dir, "answered-here.json");
	const data = JSON.parse(readFileSync(path, "utf8"));
	for (const key of Object.keys(data)) data[key] = Date.now() - 8 * 86400_000;
	atomicWrite(path, data);
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
		expect(result.body).not.toContain("verysecretvalue");
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
	const { readWebhookConfig, timestamps, updateWatches, watches } = await import("../src/host/webhook.ts");
	const dir = mkdtempSync(join(tmpdir(), "pimate-invalid-webhook-"));
	dirs.push(dir);
	writeFileSync(join(dir, "webhook-watch.lock"), "stale");
	writeFileSync(join(dir, "answered-here.lock"), "stale");
	for (const value of ["{", "null", "[]", '"bad"']) {
		for (const file of ["webhook.json", "webhook-watch.json", "answered-here.json", "webhook-state.json"])
			writeFileSync(join(dir, file), value);
		expect(readWebhookConfig(dir)).toBeNull();
		expect(watches(dir)).toEqual([]);
		expect(timestamps(dir, "webhook-state.json")).toEqual({});
		expect(answeredHere(dir, "instance", "request")).toBe(false);
	}
	expect(updateWatches(dir, () => ["instance"])).toEqual(["instance"]);
	markAnswered(dir, "instance", "request");
	expect(answeredHere(dir, "instance", "request")).toBe(true);
});
