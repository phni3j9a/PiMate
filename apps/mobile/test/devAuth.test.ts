import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthFlow, ParamsOf, RcMethod, Request, ResultOf } from "@pimate/protocol";
import { parsePairingLink } from "@pimate/protocol";
import { expect, it } from "vitest";
import { HostConnection, type SocketLike } from "../src/lib/hostConnection";

it("exercises all fake auth flows, long polls, logout and old capabilities without storing secrets", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pimate-dev-auth-"));
	const child = spawn(
		process.execPath,
		["scripts/dev-fake-host.mjs", "--port", "0", "--state", join(dir, "host.json")],
		{
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	let output = "";
	child.stdout.on("data", (data) => {
		output += data.toString();
	});
	let connection: HostConnection | undefined;
	try {
		const base = await new Promise<string>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("Fake Host did not start")), 5000);
			child.once("error", reject);
			child.stdout.on("data", () => {
				const address = /Fake PiMate Host on (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1];
				if (address) {
					clearTimeout(timer);
					resolve(address);
				}
			});
		});
		const control = (query: string) => fetch(`${base}/_dev/auth?${query}`, { method: "POST" });
		const pair = await (await fetch(`${base}/_dev/pair`, { method: "POST" })).json();
		const link = parsePairingLink(pair.pimate)!;
		const credentials = await (
			await fetch(`${base}/pair`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ code: link.code, deviceName: "auth test" }),
			})
		).json();
		connection = new HostConnection(link.address, credentials.token, {
			createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
			app: { version: "test", platform: "test" },
		});
		const connected = new Promise<void>((resolve) => {
			const off = connection!.onChange(() => {
				if (connection!.state === "connected") {
					off();
					resolve();
				}
			});
		});
		connection.start();
		await connected;
		expect(connection.info?.providerAuth).toBe(true);
		let seq = 0;
		async function request<M extends RcMethod>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>> {
			const instanceId = "6c1b2f0e-shout";
			const response = await connection!.rc(instanceId, {
				id: `test-${++seq}`,
				method,
				params,
				expectInstanceId: instanceId,
			} as Request);
			if (!response.ok) throw new Error(response.error.code);
			return response.result as ResultOf<M>;
		}
		async function finish(flow: AuthFlow): Promise<AuthFlow> {
			while (["input", "working", "saving"].includes(flow.status))
				flow = (await request("auth_wait", { flowId: flow.id, afterRevision: flow.revision })).flow;
			return flow;
		}
		expect((await request("hello", {})).snapshot.providerAuth).toBe(true);
		for (const provider of ["openai", "anthropic"] as const) {
			const { flow } = await request("auth_begin", { provider, method: "oauth" });
			expect(flow.prompt?.kind).toBe(provider === "openai" ? "callback_url" : "code");
			const receipt = await request("auth_respond", {
				flowId: flow.id,
				promptId: flow.prompt!.id,
				value: "FAKE_SECRET_CODE",
			});
			expect((await finish(receipt.flow)).status).toBe("succeeded");
		}
		const key = (await request("auth_begin", { provider: "openai", method: "api_key" })).flow;
		expect(
			(
				await finish(
					(
						await request("auth_respond", {
							flowId: key.id,
							promptId: key.prompt!.id,
							value: "FAKE_SECRET_KEY",
						})
					).flow,
				)
			).status,
		).toBe("succeeded");
		const codex = (await request("auth_begin", { provider: "openai-codex", method: "oauth" })).flow;
		expect(codex.authorization?.userCode).toContain("FAKE");
		const wait = request("auth_wait", { flowId: codex.id, afterRevision: codex.revision });
		await control("complete=1");
		expect((await finish((await wait).flow)).status).toBe("succeeded");
		await request("auth_logout", { provider: "openai" });
		expect((await request("auth_list", {})).providers[0].stored).toBeNull();
		const cancel = (await request("auth_begin", { provider: "anthropic", method: "oauth" })).flow;
		expect((await request("auth_cancel", { flowId: cancel.id })).flow.status).toBe("cancelled");
		await control("old=1");
		expect((await request("hello", {})).snapshot.providerAuth).toBe(false);
		expect(output).not.toContain("FAKE_SECRET");
	} finally {
		connection?.stop();
		if (child.pid && child.exitCode === null && child.signalCode === null) {
			const exited = once(child, "exit");
			child.kill("SIGTERM");
			await exited;
		}
		await rm(dir, { recursive: true, force: true });
	}
}, 10000);
