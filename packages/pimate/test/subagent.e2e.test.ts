import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SubagentRun } from "@pimate/protocol";
import { expect, it } from "vitest";
import { findExecutable, HostCore, parseAbducoList, type RcClient, resolveAbduco } from "../src/host/index.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const official = join(
	resolve(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))), ".."),
	"examples/extensions/subagent/index.ts",
);
const bundled = join(root, "poc/bin", `${process.platform}-${process.arch}`, "abduco");
const abduco = resolveAbduco() ?? (existsSync(bundled) ? bundled : undefined);
const pi = findExecutable("pi");
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(read: () => T | Promise<T>, accept: (v: T) => boolean): Promise<T> {
	const end = Date.now() + 25000;
	while (Date.now() < end) {
		const value = await read();
		if (accept(value)) return value;
		await delay(100);
	}
	throw new Error("Timed out waiting for official subagent");
}
it.skipIf(!pi || !abduco || !existsSync(official))(
	"official example: live run, transcript, branch reload and new-session reset",
	async () => {
		const dir = mkdtempSync(join(tmpdir(), "pimate-subagent-e2e-"));
		const agentDir = join(dir, "agent");
		mkdirSync(join(agentDir, "agents"), { recursive: true });
		const fixture = join(root, "packages/pimate/test/fixtures/subagent-faux.ts");
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ extensions: [fixture] }));
		writeFileSync(
			join(agentDir, "agents/m4-test.md"),
			"---\nname: m4-test\ndescription: Offline subagent test\nmodel: pimate-subagent-faux/scripted\ntools: read\n---\nReply briefly.\n",
		);
		const host = new HostCore({
			runDir: join(dir, "run"),
			env: { PIMATE_ABDUCO: abduco, PI_CODING_AGENT_DIR: agentDir },
		});
		let client: RcClient | undefined;
		let pid: number | undefined;
		let session: string | undefined;
		try {
			const launched = await host.spawn({
				cwd: dir,
				args: [
					"--no-extensions",
					"-e",
					fixture,
					"-e",
					official,
					"--model",
					"pimate-subagent-faux/scripted",
					"--thinking",
					"off",
					"--no-skills",
					"--no-context-files",
				],
			});
			session = launched.abducoSession;
			const instances = await until(
				() => host.list(),
				(list) => list.some((i) => i.instanceId === launched.instanceId && i.reachable),
			);
			pid = instances.find((i) => i.instanceId === launched.instanceId)!.pid;
			client = host.client(launched.instanceId);
			const runs: SubagentRun[] = [];
			let resets = 0;
			const completedOps: string[] = [];
			client.onEvent((e) => {
				if (e.event.type === "subagent_run") runs.push(e.event.run);
				if (e.event.type === "subagents_reset") resets++;
				if (e.event.type === "session_op_done") completedOps.push(e.event.op);
			});
			await client.connect();
			await client.request("prompt", { text: "Run the test child" });
			await until(
				() => runs,
				(runs) => runs.some((r) => r.state === "complete"),
			);
			expect(runs.some((r) => r.actions.includes("abort_parent"))).toBe(true);
			const run = runs.find((r) => r.state === "complete")!;
			expect(run).toMatchObject({
				backend: "example",
				background: false,
				actions: [],
				children: [{ state: "complete", hasTranscript: true }],
			});
			const transcript = await client.request("subagent_transcript", { runId: run.id, childId: run.children[0]!.id });
			expect(transcript.task).toBe("Inspect safely");
			expect(transcript.items).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ kind: "assistant", text: "Child verified without network." }),
				]),
			);
			await expect(client.request("subagent_control", { runId: run.id, action: "abort_parent" })).rejects.toMatchObject(
				{ code: "unsupported" },
			);
			await until(
				() => client!.request("hello", {}),
				(r) => r.snapshot.status === "idle",
			);
			await client.request("session_op", { op: "reload" });
			await until(
				() => completedOps,
				(ops) => ops.includes("reload"),
			);
			await until(
				() => client!.request("hello", {}),
				(r) => !!r.snapshot.subagents?.runs.some((x) => x.id === run.id),
			);
			await client.request("session_op", { op: "new" });
			await until(
				() => completedOps,
				(ops) => ops.includes("new"),
			);
			await until(
				() => client!.request("hello", {}),
				(r) => r.snapshot.subagents?.runs.length === 0,
			);
			expect(resets).toBeGreaterThan(1);
			await client.request("shutdown", {});
		} finally {
			client?.close();
			if (pid) {
				try {
					process.kill(pid, "SIGTERM");
				} catch {}
				await delay(400);
				try {
					process.kill(pid, "SIGKILL");
				} catch {}
			}
			if (abduco && session)
				for (const s of parseAbducoList(execFileSync(abduco, [], { encoding: "utf8", env: host.env })))
					if (s.name === session) {
						try {
							process.kill(s.pid, "SIGTERM");
						} catch {}
					}
			rmSync(dir, { recursive: true, force: true });
		}
	},
);
