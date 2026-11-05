import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AuthFlow, HostMessage, PairResponse } from "@pimate/protocol";
import { expect, it } from "vitest";
import { WebSocket } from "ws";
import { findExecutable, HostCore, HostServer, resolveAbduco } from "../src/host/index.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const fallback = join(root, "poc/bin", `${process.platform}-${process.arch}`, "abduco");
const abduco = resolveAbduco() ?? (existsSync(fallback) ? fallback : undefined);
const pi = findExecutable("pi");
if (process.env.PIMATE_E2E_REQUIRED && (!pi || !abduco))
	throw new Error(`E2E requires pi (${pi}) and abduco (${abduco})`);

it.skipIf(!pi || !abduco)(
	"real login Pi: hidden, saves an API key to the agent dir, and exits after the app leaves",
	async () => {
		const dir = mkdtempSync(join(tmpdir(), "pimate-auth-e2e-"));
		const agentDir = join(dir, "agent");
		const core = new HostCore({
			runDir: join(dir, "run"),
			env: { PIMATE_ABDUCO: abduco, PI_CODING_AGENT_DIR: agentDir, PIMATE_E2E: "1" },
		});
		const host = new HostServer({
			core,
			configDir: join(dir, "config"),
			port: 0,
			listen: ["127.0.0.1"],
			pollMs: 100,
			authSession: { graceMs: 100 },
		});
		let ws: WebSocket | undefined;
		let pid: number | undefined;
		try {
			const [bound] = await host.start();
			const pair = (await (
				await fetch(`http://127.0.0.1:${bound.port}/pair`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ code: host.config.createCode(), deviceName: "E2E phone" }),
				})
			).json()) as PairResponse;
			ws = new WebSocket(`ws://127.0.0.1:${bound.port}/ws`);
			const messages: HostMessage[] = [];
			let changed: (() => void) | undefined;
			ws.on("message", (data) => {
				messages.push(JSON.parse(data.toString()));
				changed?.();
			});
			const wait = <T extends HostMessage>(predicate: (m: HostMessage) => m is T, ms = 30000): Promise<T> =>
				new Promise((resolve, reject) => {
					const timer = setTimeout(() => reject(new Error(`timed out: ${JSON.stringify(messages.slice(-3))}`)), ms);
					const check = () => {
						const i = messages.findIndex(predicate);
						if (i < 0) return;
						clearTimeout(timer);
						changed = undefined;
						resolve(messages.splice(i, 1)[0] as T);
					};
					changed = check;
					check();
				});
			await new Promise<void>((resolve) => ws!.once("open", resolve));
			const send = (value: unknown) => ws!.send(JSON.stringify(value));
			send({ type: "auth", token: pair.token, protocol: 1, app: { version: "e2e", platform: "test" } });
			await wait((m): m is HostMessage => m.type === "auth_ok");
			send({ type: "auth_session", requestId: "s" });
			const session = await wait(
				(m): m is Extract<HostMessage, { type: "auth_session_result"; ok: true }> =>
					m.type === "auth_session_result" && m.ok,
			);
			const id = session.instanceId;
			pid = JSON.parse(readFileSync(join(core.runDir, `${id}.json`), "utf8")).pid;
			let n = 0;
			const rc = async (method: string, params: unknown) => {
				const requestId = `r${++n}`;
				send({ type: "rc", instanceId: id, request: { id: requestId, method, params, expectInstanceId: id } });
				const r = await wait(
					(m): m is Extract<HostMessage, { type: "rc_result" }> =>
						m.type === "rc_result" && m.response.id === requestId,
				);
				if (!r.response.ok) throw new Error(JSON.stringify(r.response.error));
				return r.response.result as { flow: AuthFlow } & Record<string, unknown>;
			};
			const list = (await rc("auth_list", {})) as unknown as { providers: { id: string; methods: string[] }[] };
			expect(list.providers.find((p) => p.id === "opencode-go")?.methods).toEqual(["api_key"]);
			let { flow } = await rc("auth_begin", { provider: "opencode-go", method: "api_key" });
			while (flow.status === "working")
				({ flow } = await rc("auth_wait", { flowId: flow.id, afterRevision: flow.revision }));
			({ flow } = await rc("auth_respond", { flowId: flow.id, promptId: flow.prompt!.id, value: "e2e-key" }));
			while (["working", "saving"].includes(flow.status))
				({ flow } = await rc("auth_wait", { flowId: flow.id, afterRevision: flow.revision }));
			expect(flow.status).toBe("succeeded");
			expect(JSON.parse(readFileSync(join(agentDir, "auth.json"), "utf8"))["opencode-go"]).toMatchObject({
				type: "api_key",
				key: "e2e-key",
			});
			expect(messages.some((m) => m.type === "instances" && m.instances.some((i) => i.instanceId === id))).toBe(false);
			send({ type: "auth_session_end" });
			const end = Date.now() + 20000;
			while ((await core.list()).some((i) => i.instanceId === id)) {
				if (Date.now() > end) throw new Error("login Pi still running");
				await new Promise((r) => setTimeout(r, 200));
			}
			pid = undefined;
		} finally {
			ws?.terminate();
			await host.close();
			if (pid)
				try {
					process.kill(pid, "SIGKILL");
				} catch {
					/* exited */
				}
			await core.list().catch(() => {}); // reaps the terminated abduco session
			rmSync(dir, { recursive: true, force: true });
		}
	},
	60000,
);
