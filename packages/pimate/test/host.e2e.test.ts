import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { HostMessage, PairResponse } from "@pimate/protocol";
import { expect, it } from "vitest";
import { WebSocket } from "ws";
import { findExecutable, HostCore, HostServer, resolveAbduco } from "../src/host/index.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const fallback = join(root, "poc/bin", `${process.platform}-${process.arch}`, "abduco");
const abduco = resolveAbduco() ?? (existsSync(fallback) ? fallback : undefined);
const pi = findExecutable("pi");
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
if (process.env.PIMATE_E2E_REQUIRED && (!pi || !abduco))
	throw new Error(`E2E requires pi (${pi}) and abduco (${abduco})`);
it.skipIf(!pi || !abduco)(
	"real Pi + authenticated Host WS: pairing, subscribe, prompt, streaming/history and abort",
	async () => {
		const dir = mkdtempSync(join(tmpdir(), "pimate-host-e2e-"));
		const core = new HostCore({
			runDir: join(dir, "run"),
			env: { PIMATE_ABDUCO: abduco, PI_CODING_AGENT_DIR: join(dir, "agent"), PIMATE_E2E: "1" },
		});
		const host = new HostServer({ core, configDir: join(dir, "config"), port: 0, listen: ["127.0.0.1"], pollMs: 100 });
		let ws: WebSocket | undefined;
		let pid: number | undefined;
		let instanceId: string | undefined;
		let session: string | undefined;
		try {
			const launched = await core.spawn({
				cwd: dir,
				args: [
					"--no-extensions",
					"-e",
					join(root, "packages/pimate/test/fixtures/faux.ts"),
					"--model",
					"pimate-faux/scripted",
					"--no-skills",
					"--no-context-files",
					"--no-prompt-templates",
					"--no-themes",
					"--thinking",
					"off",
				],
			});
			instanceId = launched.instanceId;
			session = launched.abducoSession;
			const [bound] = await host.start();
			const code = host.config.createCode();
			const response = await fetch(`http://127.0.0.1:${bound.port}/pair`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ code, deviceName: "E2E phone" }),
			});
			expect(response.status).toBe(200);
			const pair = (await response.json()) as PairResponse;
			ws = new WebSocket(`ws://127.0.0.1:${bound.port}/ws`);
			const messages: HostMessage[] = [];
			let changed: (() => void) | undefined;
			ws.on("message", (data) => {
				messages.push(JSON.parse(data.toString()));
				changed?.();
			});
			const wait = (predicate: (message: HostMessage) => boolean): Promise<HostMessage> =>
				new Promise((resolve, reject) => {
					const timer = setTimeout(
						() => reject(new Error(`Host E2E timed out: ${JSON.stringify(messages.slice(-5))}`)),
						20000,
					);
					const check = () => {
						const value = messages.find(predicate);
						if (value) {
							clearTimeout(timer);
							changed = undefined;
							resolve(value);
						}
					};
					changed = check;
					check();
				});
			await new Promise<void>((resolve) => ws!.once("open", resolve));
			const send = (value: unknown) => ws!.send(JSON.stringify(value));
			send({ type: "auth", token: pair.token, protocol: 1, app: { version: "e2e", platform: "test" } });
			await wait((m) => m.type === "auth_ok");
			await wait((m) => m.type === "instances" && m.instances.some((i) => i.instanceId === instanceId));
			send({ type: "subscribe", instanceId });
			const subscribed = await wait((m) => m.type === "subscribed");
			if (subscribed.type !== "subscribed") throw new Error("Missing snapshot");
			pid = subscribed.snapshot.pid;
			const rc = (id: string, method: string, params: unknown) =>
				send({
					type: "rc",
					instanceId,
					request: {
						id,
						method,
						params,
						expectInstanceId: instanceId,
						expectSessionId: subscribed.snapshot.session?.id,
					},
				});
			rc("prompt", "prompt", { text: "hello from phone" });
			expect(await wait((m) => m.type === "rc_result" && m.response.id === "prompt")).toMatchObject({
				response: { ok: true },
			});
			await wait((m) => m.type === "event" && m.event.type === "agent_settled");
			const events = messages.filter((m) => m.type === "event");
			expect(events.some((m) => m.event.type === "text_delta" && m.event.delta.length > 1)).toBe(true);
			expect(events.every((m, i) => !i || m.seq > events[i - 1].seq)).toBe(true);
			expect(
				events
					.filter((m) => m.event.type === "text_delta")
					.map((m) => (m.event.type === "text_delta" ? m.event.delta : ""))
					.join(""),
			).toBe("Hello from the PiMate faux model.");
			rc("history", "history", {});
			const history = await wait((m) => m.type === "rc_result" && m.response.id === "history");
			if (history.type !== "rc_result" || !history.response.ok || !("items" in history.response.result))
				throw new Error("Missing history");
			for (const event of events)
				if (event.event.type === "message_end") expect(history.response.result.items).toContainEqual(event.event.item);
			messages.length = 0;
			rc("slow", "prompt", { text: "slow reply" });
			await wait((m) => m.type === "event" && m.event.type === "text_delta");
			// Late subscribe must include already-streamed text, not start a blank assistant bubble.
			send({ type: "subscribe", instanceId });
			expect(await wait((m) => m.type === "subscribed")).toMatchObject({
				snapshot: { streaming: { text: expect.stringMatching(/.+/) } },
			});
			rc("abort", "abort", {});
			await wait((m) => m.type === "event" && m.event.type === "agent_settled" && m.event.aborted);
			expect(await wait((m) => m.type === "rc_result" && m.response.id === "abort")).toMatchObject({
				response: { ok: true },
			});
		} finally {
			ws?.terminate();
			await host.close();
			if (!pid && instanceId) {
				try {
					pid = JSON.parse(readFileSync(join(core.runDir, `${instanceId}.json`), "utf8")).pid;
				} catch {
					/* no metadata */
				}
			}
			if (pid) {
				try {
					process.kill(pid, "SIGTERM");
				} catch {
					/* exited */
				}
				await delay(400);
				try {
					process.kill(pid, "SIGKILL");
				} catch {
					/* exited */
				}
			}
			if (abduco && session)
				for (const line of execFileSync(abduco, [], { encoding: "utf8", env: core.env }).split("\n")) {
					const cols = line.split("\t");
					if (cols[3]?.trim() !== session) continue;
					const serverPid = Number(cols[2]?.trim());
					if (Number.isInteger(serverPid) && serverPid > 1) {
						try {
							process.kill(serverPid, "SIGTERM");
						} catch {
							/* exited */
						}
					}
				}
			rmSync(dir, { recursive: true, force: true });
		}
	},
);
