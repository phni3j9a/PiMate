import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { EventMessage } from "@pimate/protocol";
import { expect, it } from "vitest";
import type { RcClient } from "../src/host/index.ts";
import { findExecutable, HostCore, parseAbducoList, resolveAbduco } from "../src/host/index.ts";

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
// CI sets PIMATE_E2E_REQUIRED so a missing pi/abduco fails instead of silently skipping.
if (process.env.PIMATE_E2E_REQUIRED && (!pi || !abduco))
	throw new Error(`E2E requires pi (${pi}) and abduco (${abduco})`);
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
			env: {
				PIMATE_ABDUCO: abduco,
				PI_CODING_AGENT_DIR: join(dir, "agent"),
				PIMATE_E2E: "1",
				PIMATE_E2E_WRITE_DIFF: "1",
				PIMATE_E2E_IMAGE_RESIZE: "1",
			},
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
					"--tools",
					"write,edit,read",
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
			expect((await client.request("hello", {})).snapshot).toMatchObject({
				promptImages: true,
				promptImageLimit: 4,
				entryImages: true,
				fileImages: true,
			});
			const image = {
				type: "image" as const,
				mimeType: "image/png" as const,
				data: readFileSync(join(root, "packages/pimate/test/fixtures/prompt-image.png")).toString("base64"),
			};
			expect(await client.request("prompt", { text: "say hello", images: [image, image] })).toEqual({
				deliveredAs: "prompt",
			});
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
			const userImage = history.items.find((item) => item.kind === "user");
			expect(userImage).toMatchObject({
				kind: "user",
				imageCount: 2,
				images: [expect.objectContaining({ type: "image" }), expect.objectContaining({ type: "image" })],
				imageIndices: [0, 1],
			});
			if (userImage?.kind !== "user") throw new Error("Missing image user entry");
			expect(userImage.text).toContain("say hello");
			expect(userImage.text).toContain("1024");
			expect(userImage.images?.[0]?.data).not.toBe(image.data);
			for (const index of [0, 1])
				expect(await client.request("entry_image", { entryId: userImage.entryId, index })).toEqual({
					image: { mimeType: userImage.images![index].mimeType, data: userImage.images![index].data },
				});
			await expect(client.request("entry_image", { entryId: userImage.entryId, index: 2 })).rejects.toMatchObject({
				code: "not_found",
			});
			await expect(client.request("entry_image", { entryId: "missing", index: 0 })).rejects.toMatchObject({
				code: "not_found",
			});
			writeFileSync(join(dir, "read-image.png"), Buffer.from(image.data, "base64"));
			expect(await client.request("file_image", { path: "read-image.png" })).toEqual({
				image: { mimeType: "image/png", data: image.data },
			});
			await expect(client.request("file_image", { path: "missing.png" })).rejects.toMatchObject({ code: "not_found" });
			writeFileSync(
				join(dir, "large-image.txt"),
				Buffer.concat([Buffer.from(image.data, "base64"), Buffer.alloc(2 * 1024 * 1024)]),
			);
			const large = await client.request("file_image", { path: "large-image.txt" });
			expect(Buffer.byteLength(large.image.data, "base64")).toBeLessThanOrEqual(2 * 1024 * 1024);
			expect(large.image.width).toBeLessThanOrEqual(2048);
			expect(large.image.height).toBeLessThanOrEqual(2048);
			for (const e of events) {
				if (e.event.type === "message_end") expect(history.items).toContainEqual(e.event.item);
			}
			expect(events.every((e, i) => !i || e.seq === events[i - 1].seq + 1)).toBe(true);
			events.length = 0;
			expect(cli("prompt", instanceId, "write and edit a file")).toEqual({ deliveredAs: "prompt" });
			await until(
				() => events,
				(e) => e.some((x) => x.event.type === "agent_settled"),
			);
			const diffHistory = await client.request("history", {});
			const write = diffHistory.items.find((item) => item.kind === "tool_result" && item.toolName === "write");
			const edit = diffHistory.items.find((item) => item.kind === "tool_result" && item.toolName === "edit");
			expect(write).toMatchObject({
				isError: false,
				text: "Successfully wrote to diff.txt",
				details: { pimate: { kind: "write_diff", existed: false, patch: expect.stringContaining("+before edit") } },
			});
			expect(edit).toMatchObject({ isError: false, details: { patch: expect.stringContaining("+after edit") } });
			expect(readFileSync(join(dir, "diff.txt"), "utf8")).toBe("after edit\n");
			const read = diffHistory.items.find((item) => item.kind === "tool_result" && item.toolName === "read");
			expect(read).toMatchObject({
				imageCount: 1,
				imageIndices: [0],
				images: [expect.objectContaining({ type: "image" })],
			});
			if (read?.kind !== "tool_result") throw new Error("Missing image tool result");
			expect(await client.request("entry_image", { entryId: read.entryId, index: 0 })).toEqual({
				image: { mimeType: read.images![0].mimeType, data: read.images![0].data },
			});
			for (const item of [write, edit]) {
				expect(events.some((e) => e.event.type === "message_end" && e.event.item.entryId === item?.entryId)).toBe(true);
			}
			// Verify disk persistence too, not only the in-memory branch used by history.
			const persisted = readFileSync(diffHistory.session!.file!, "utf8")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line));
			expect(persisted).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						message: expect.objectContaining({
							role: "toolResult",
							toolName: "write",
							details: expect.objectContaining({ pimate: expect.objectContaining({ patch: expect.any(String) }) }),
						}),
					}),
				]),
			);
			events.length = 0;
			await client.request("prompt", { text: "slow now" });
			await until(
				() => events,
				(e) => e.some((x) => x.event.type === "text_delta"),
			);
			await expect(
				client.request(
					"session_op",
					{ op: "tree", arg: userImage.entryId, summarize: false },
					{ expectSessionId: history.session!.id },
				),
			).rejects.toMatchObject({ code: "busy" });
			expect(cli("abort", instanceId)).toEqual({});
			await until(
				() => events,
				(e) => e.some((x) => x.event.type === "agent_settled" && x.event.aborted),
			);
			const abortedHistory = await client.request("history", {});
			expect(abortedHistory.items).toEqual(
				expect.arrayContaining([expect.objectContaining({ kind: "assistant", stopReason: "aborted" })]),
			);
			expect(
				events.some(
					(event) =>
						event.event.type === "message_end" &&
						event.event.item.kind === "assistant" &&
						event.event.item.stopReason === "aborted",
				),
			).toBe(true);
			// Tree navigation uses the real command context, without invoking an LLM summary.
			expect((await client.request("hello", {})).snapshot.sessionTree).toBe(true);
			const tree = await client.request("session_tree", {});
			const target = tree.nodes.find((n) => n.kind === "user")!;
			await client.request("set_label", { entryId: target.id, label: "bookmark" });
			expect((await client.request("session_tree", {})).nodes.find((n) => n.id === target.id)?.label).toBe("bookmark");
			await client.request("set_label", { entryId: target.id });
			expect((await client.request("session_tree", {})).nodes.find((n) => n.id === target.id)?.label).toBeUndefined();
			events.length = 0;
			await client.request(
				"session_op",
				{ op: "tree", arg: target.id, summarize: false },
				{ expectSessionId: abortedHistory.session!.id },
			);
			await until(
				() => events,
				(es) => es.some((e) => e.event.type === "session_op_done" && e.event.op === "tree"),
			);
			expect(events).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ event: expect.objectContaining({ type: "session_changed", reason: "tree" }) }),
					expect.objectContaining({
						event: expect.objectContaining({
							type: "session_op_done",
							op: "tree",
							cancelled: false,
							editorText: expect.stringContaining("say hello"),
						}),
					}),
				]),
			);
			expect((await client.request("history", {})).items.some((item) => item.entryId === target.id)).toBe(false);
			expect((await client.request("session_tree", {})).nodes.some((n) => n.id === target.id)).toBe(true);
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
			// Shutting down from the phone exits Pi; the Host then reaps the leftover abduco session.
			await client.request("shutdown", {});
			client.close();
			client = undefined;
			const name = abducoSession;
			await until(
				async () => {
					const list = await host.list();
					const sessions = parseAbducoList(execFileSync(abduco!, [], { encoding: "utf8", env: host.env }));
					return { list, sessions };
				},
				({ list, sessions }) =>
					!list.some((i) => i.instanceId === instanceId) && !sessions.some((s) => s.name === name),
			);
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
