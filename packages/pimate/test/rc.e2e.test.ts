import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { EventMessage } from "@pimate/protocol";
import { expect, it } from "vitest";
import type { RcClient } from "../src/host/index.ts";
import { findExecutable, HostCore, resolveAbduco } from "../src/host/index.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const pocAbduco = join(root, "poc/bin", `${process.platform}-${process.arch}`, "abduco");
const abduco = resolveAbduco() ?? (existsSync(pocAbduco) ? pocAbduco : undefined);
const pi = findExecutable("pi");
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(read: () => T | Promise<T>, accept: (v: T) => boolean, timeout = 20000): Promise<T> {
	const end = Date.now() + timeout;
	while (Date.now() < end) {
		const value = await read();
		if (accept(value)) return value;
		await delay(100);
	}
	throw new Error("Timed out waiting for Pi");
}
it.skipIf(!pi || !abduco)(
	"real Pi TUI: discovery, streaming, history, abort, CLI and process cleanup without network LLM",
	async () => {
		const dir = mkdtempSync(join(tmpdir(), "pimate-e2e-"));
		let client: RcClient | undefined;
		let pid: number | undefined;
		let instanceId: string | undefined;
		let abducoSession: string | undefined;
		const host = new HostCore({
			runDir: join(dir, "run"),
			env: { PIMATE_ABDUCO: abduco, PI_CODING_AGENT_DIR: join(dir, "agent"), PIMATE_E2E: "1" },
		});
		try {
			const launched = await host.spawn({
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
			abducoSession = launched.abducoSession;
			const list = await until(
				() => host.list(),
				(list) => list.some((i) => i.instanceId === instanceId && i.reachable),
			);
			const instance = list.find((i) => i.instanceId === instanceId)!;
			pid = instance.pid;
			client = host.client(instanceId);
			const events: EventMessage[] = [];
			client.onEvent((e) => events.push(e));
			expect(await client.connect()).toMatchObject({
				instanceId,
				origin: "mobile",
				model: { provider: "pimate-faux", id: "scripted" },
			});
			const cli = (...args: string[]) =>
				JSON.parse(
					execFileSync(process.execPath, [join(root, "packages/pimate/src/host/cli.ts"), ...args], {
						env: { ...process.env, PIMATE_RUN_DIR: host.runDir, PIMATE_ABDUCO: abduco },
						encoding: "utf8",
						timeout: 10000,
					}),
				);
			expect(cli("list")).toEqual(expect.arrayContaining([expect.objectContaining({ instanceId, reachable: true })]));
			expect(cli("prompt", instanceId, "say hello")).toEqual({ deliveredAs: "prompt" });
			await until(
				() => events,
				(e) => e.some((x) => x.event.type === "agent_settled"),
			);
			expect(events.some((e) => e.event.type === "text_delta")).toBe(true);
			expect(
				events.some(
					(e) =>
						e.event.type === "message_end" &&
						e.event.item.kind === "assistant" &&
						e.event.item.text === "Hello from the PiMate faux model.",
				),
			).toBe(true);
			expect((await client.request("history", {})).items).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ kind: "assistant", text: "Hello from the PiMate faux model." }),
				]),
			);
			const history = await client.request("history", {});
			for (const e of events) {
				if (e.event.type === "message_end") expect(history.items).toContainEqual(e.event.item);
			}
			expect(events.every((e, i) => !i || e.seq === events[i - 1].seq + 1)).toBe(true);
			events.length = 0;
			await client.request("prompt", { text: "slow now" });
			await until(
				() => events,
				(e) => e.some((x) => x.event.type === "text_delta"),
			);
			expect(cli("abort", instanceId)).toEqual({});
			await until(
				() => events,
				(e) => e.some((x) => x.event.type === "agent_settled" && x.event.aborted),
			);
			const before = (await client.request("hello", {})).snapshot;
			expect(before.status).toBe("idle");
			for (const op of ["new", "reload"] as const) {
				events.length = 0;
				await client.request("session_op", { op });
				await until(
					() => events,
					(es) => es.some((e) => e.event.type === "session_op_done" && e.event.op === op),
				);
				expect(events.filter((e) => e.event.type === "session_changed")).toHaveLength(1);
				expect((await client.request("hello", {})).snapshot.instanceId).toBe(instanceId);
			}
			expect((await client.request("hello", {})).snapshot.session?.id).not.toBe(before.session?.id);
		} finally {
			client?.close();
			if (!pid && instanceId) {
				try {
					pid = JSON.parse(readFileSync(join(host.runDir, `${instanceId}.json`), "utf8")).pid;
				} catch {
					/* startup failed before metadata */
				}
			}
			if (pid) {
				try {
					process.kill(pid, "SIGTERM");
				} catch {
					/* already exited */
				}
				await delay(400);
				try {
					process.kill(pid, "SIGKILL");
				} catch {
					/* already exited */
				}
			}
			// abduco retains the exited child's terminal buffer until an attach. Stop that
			// server too; killing only Pi leaks the session/scope after every test run.
			if (abduco && abducoSession) {
				const lines = execFileSync(abduco, [], { encoding: "utf8", env: host.env }).split("\n");
				for (const line of lines) {
					const cols = line.split("\t");
					if (cols[3]?.trim() !== abducoSession) continue;
					const serverPid = Number(cols[2]?.trim());
					if (Number.isInteger(serverPid) && serverPid > 1) {
						try {
							process.kill(serverPid, "SIGTERM");
						} catch {
							/* already exited */
						}
					}
				}
			}
			rmSync(dir, { recursive: true, force: true });
		}
	},
);
