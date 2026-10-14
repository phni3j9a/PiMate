import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import type { HostMessage } from "@pimate/protocol";
import { expect, it } from "vitest";
import { WebSocket } from "ws";
import { findExecutable, HostCore, HostServer, resolveAbduco } from "../src/host/index.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const fallback = join(root, "poc/bin", `${process.platform}-${process.arch}`, "abduco");
const abduco = resolveAbduco() ?? (existsSync(fallback) ? fallback : undefined);
const real = !!process.env.PIMATE_E2E_REAL_MODEL;
if (process.env.PIMATE_E2E_REQUIRED && (!findExecutable("pi") || !abduco))
	throw new Error("M2 E2E requires pi and abduco");
it.skipIf(!findExecutable("pi") || !abduco)(
	`M2 WS spawn + initial message + trust + models/sessions/shutdown (${real ? "openai/gpt-6-luna" : "faux"})`,
	async () => {
		const dir = mkdtempSync(join(tmpdir(), "pimate-m2-e2e-"));
		const agent = join(dir, "agent");
		mkdirSync(agent);
		mkdirSync(join(dir, ".pi/extensions"), { recursive: true });
		const marker = join(dir, "untrusted-loaded");
		writeFileSync(
			join(dir, ".pi/extensions/untrusted.ts"),
			`import {writeFileSync} from 'node:fs'; export default function(){writeFileSync(${JSON.stringify(marker)}, 'loaded');}`,
		);
		// Declining trust still preserves Pi's pre-trust sessionDir setting.
		writeFileSync(join(dir, ".pi/settings.json"), JSON.stringify({ sessionDir: join(dir, "custom-sessions") }));
		writeFileSync(join(agent, "settings.json"), JSON.stringify({ enableSkills: false }));
		if (real) {
			const auth = join(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi/agent"), "auth.json");
			if (existsSync(auth)) symlinkSync(auth, join(agent, "auth.json"));
		}
		const core = new HostCore({
			runDir: join(dir, "run"),
			env: {
				PIMATE_ABDUCO: abduco,
				PI_CODING_AGENT_DIR: agent,
				PIMATE_EXTENSION: join(root, "packages/pimate/test/fixtures/m2.ts"),
				PIMATE_E2E: "1",
			},
		});
		const host = new HostServer({ core, configDir: join(dir, "config"), port: 0, listen: ["127.0.0.1"], pollMs: 100 });
		let ws: WebSocket | undefined;
		let instanceId: string | undefined;
		let session: string | undefined;
		let pid: number | undefined;
		try {
			const [bound] = await host.start();
			const pair = host.config.pair(host.config.createCode(), "M2 phone");
			ws = new WebSocket(`ws://127.0.0.1:${bound.port}/ws`);
			const messages: HostMessage[] = [];
			let notify: (() => void) | undefined;
			ws.on("message", (data) => {
				messages.push(JSON.parse(data.toString()));
				notify?.();
			});
			const wait = (predicate: (m: HostMessage) => boolean): Promise<HostMessage> =>
				new Promise((resolve, reject) => {
					const timer = setTimeout(() => reject(new Error(`M2 timeout: ${JSON.stringify(messages.slice(-3))}`)), 40000);
					const check = () => {
						const m = messages.find(predicate);
						if (m) {
							clearTimeout(timer);
							notify = undefined;
							resolve(m);
						}
					};
					notify = check;
					check();
				});
			await new Promise<void>((resolve) => ws!.once("open", resolve));
			const send = (m: unknown) => ws!.send(JSON.stringify(m));
			send({ type: "auth", token: pair.token, protocol: 1, app: { version: "test", platform: "test" } });
			await wait((m) => m.type === "auth_ok");
			const prompt = "Reply with only the word HELLO. Do not use any tools.";
			send({
				type: "spawn",
				requestId: "spawn",
				params: {
					cwd: dir,
					trust: false,
					thinking: "off",
					message: prompt,
					model: real ? { provider: "openai", id: "gpt-6-luna" } : { provider: "pimate-faux", id: "scripted" },
				},
			});
			const spawned = await wait((m) => m.type === "spawn_result");
			if (spawned.type !== "spawn_result" || !spawned.ok) throw new Error(JSON.stringify(spawned));
			instanceId = spawned.instanceId;
			session = spawned.abducoSession;
			await wait((m) => m.type === "instances" && m.instances.some((i) => i.instanceId === instanceId));
			send({ type: "subscribe", instanceId });
			const subscribed = await wait((m) => m.type === "subscribed");
			if (subscribed.type !== "subscribed") throw new Error("Missing snapshot");
			pid = subscribed.snapshot.pid;
			expect(subscribed.snapshot).toMatchObject({ origin: "mobile", thinking: "off", pcPrompt: null });
			expect(existsSync(marker)).toBe(false);
			const client = core.client(instanceId);
			try {
				await client.connect();
				await wait(
					(m) =>
						(m.type === "event" && m.event.type === "agent_settled") ||
						(m.type === "subscribed" && m.snapshot.status === "idle"),
				);
				const history = await client.request("history", {});
				expect(history.items.filter((item) => item.kind === "user" && item.text === prompt)).toHaveLength(1);
				expect(
					history.items.some((item) => item.kind === "assistant" && !!item.text && item.stopReason !== "error"),
				).toBe(true);
				const models = await client.request("models", {});
				expect(models.models).toEqual(expect.arrayContaining([expect.objectContaining(models.current!)]));
				const sessions = await client.request("sessions", { limit: 5 });
				expect(sessions.sessions).toEqual(
					expect.arrayContaining([
						expect.objectContaining({ current: true, id: history.session?.id, modified: expect.any(Number) }),
					]),
				);
				expect(sessions.sessions[0].path).toContain("custom-sessions");
				const attachList = execFileSync(process.execPath, [join(root, "packages/pimate/src/host/cli.ts"), "attach"], {
					env: core.env,
					encoding: "utf8",
				});
				expect(attachList).toContain(session);
				expect(attachList).toContain("Ctrl+\\");
				await client.request("shutdown", {});
			} finally {
				client.close();
			}
			await wait((m) => m.type === "instance_gone" && m.instanceId === instanceId);
		} finally {
			ws?.terminate();
			await host.close();
			// Also recover metadata when startup/assertions fail before receiving the spawn result.
			const instances = await core.list();
			for (const instance of instances) {
				pid ??= instance.pid;
				session ??= instance.abducoSession ?? undefined;
				instanceId ??= instance.instanceId;
			}
			if (!pid && instanceId) {
				try {
					pid = JSON.parse(readFileSync(join(core.runDir, `${instanceId}.json`), "utf8")).pid;
				} catch {}
			}
			if (pid) {
				try {
					process.kill(pid, "SIGTERM");
				} catch {}
				await delay(300);
				try {
					process.kill(pid, "SIGKILL");
				} catch {}
			}
			if (abduco && session)
				for (const line of execFileSync(abduco, [], { env: core.env, encoding: "utf8" }).split("\n")) {
					const cols = line.split("\t");
					if (cols[3]?.trim() === session) {
						const id = Number(cols[2]?.trim());
						if (Number.isInteger(id) && id > 1) {
							try {
								process.kill(id, "SIGTERM");
							} catch {}
						}
					}
				}
			rmSync(dir, { recursive: true, force: true });
		}
	},
);
