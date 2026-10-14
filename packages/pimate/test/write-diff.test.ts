import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { applyPatch, parsePatch } from "diff";
import { afterEach, beforeEach, expect, it } from "vitest";
import { MAX_WRITE_BYTES, registerWriteDiff, resolveWritePath } from "../src/extension/write-diff.ts";

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "pimate-write-"));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});
function setup() {
	const hooks = new Map<string, (...args: any[]) => any>();
	registerWriteDiff({
		on: (name: string, handler: (...args: any[]) => any) => {
			hooks.set(name, handler);
			return () => hooks.delete(name);
		},
	} as unknown as ExtensionAPI);
	const ctx = { cwd: dir };
	const input = { path: "file.txt", content: "new\n" };
	const event = { toolName: "write", toolCallId: "call-1", input, isError: false, details: undefined };
	return {
		hooks,
		event,
		call: () => hooks.get("tool_call")!(event, ctx),
		result: () => hooks.get("tool_result")!(event, ctx),
	};
}
it("captures a new file, merges details, and returns only display metadata", async () => {
	const { event, call, result } = setup();
	await expect(call()).resolves.toBeUndefined();
	Object.assign(event, { details: { otherExtension: 42 }, content: [{ type: "text", text: "Success" }] });
	const output = result();
	expect(Object.keys(output)).toEqual(["details"]);
	expect(output.details).toMatchObject({ otherExtension: 42, pimate: { kind: "write_diff", existed: false } });
	expect(applyPatch("", output.details.pimate.patch)).toBe("new\n");
	expect(parsePatch(output.details.pimate.patch)[0].newFileName).toBe("file.txt");
	expect(result()).toBeUndefined();
});
it("captures old content before overwrite with three context lines", async () => {
	const old = "1\n2\n3\n4\nold\n6\n7\n8\n9\n";
	const { event, call, result } = setup();
	event.input.content = old.replace("old", "new");
	await writeFile(join(dir, "file.txt"), old);
	await call();
	await writeFile(join(dir, "file.txt"), event.input.content);
	const { pimate } = result().details;
	expect(pimate.existed).toBe(true);
	expect(applyPatch(old, pimate.patch)).toBe(event.input.content);
	expect(parsePatch(pimate.patch)[0].hunks[0].lines).toEqual([" 2", " 3", " 4", "-old", "+new", " 6", " 7", " 8"]);
});
it.each(["old", "new"])("omits %s content over 256 KiB, measured in UTF-8 bytes", async (side) => {
	const { event, call, result } = setup();
	const large = "あ".repeat(Math.ceil(MAX_WRITE_BYTES / 3));
	if (side === "old") await writeFile(join(dir, "file.txt"), large);
	else event.input.content = large;
	await call();
	expect(result().details.pimate).toEqual({ kind: "write_diff", existed: side === "old", omitted: "too_large" });
});
it("allows exactly 256 KiB", async () => {
	const { event, call, result } = setup();
	event.input.content = "a".repeat(MAX_WRITE_BYTES);
	await writeFile(join(dir, "file.txt"), event.input.content);
	await call();
	expect(result().details.pimate).toMatchObject({ omitted: undefined, patch: expect.any(String) });
});
it.each(["old", "new"])("omits binary %s content", async (side) => {
	const { event, call, result } = setup();
	if (side === "old") await writeFile(join(dir, "file.txt"), "old\0binary");
	else event.input.content = "new\0binary";
	await call();
	expect(result().details.pimate).toEqual({ kind: "write_diff", existed: side === "old", omitted: "binary" });
});
it("does not attach details to an error, and cleans up the snapshot", async () => {
	const { event, call, result } = setup();
	await call();
	event.isError = true;
	expect(result()).toBeUndefined();
	event.isError = false;
	expect(result()).toBeUndefined();
});
it.each(["session_start", "session_shutdown", "agent_settled"])("clears snapshots on %s", async (lifecycle) => {
	const { hooks, call, result } = setup();
	await call();
	hooks.get(lifecycle)!();
	expect(result()).toBeUndefined();
});
it("does not resurrect a snapshot when the session changes during capture", async () => {
	const { hooks, call, result } = setup();
	const capture = call();
	hooks.get("session_shutdown")!();
	await capture;
	expect(result()).toBeUndefined();
});
it("uses independent snapshots for parallel tool calls", async () => {
	const { hooks, event, call, result } = setup();
	const other = { ...event, toolCallId: "call-2", input: { path: "other.txt", content: "other\n" } };
	await writeFile(join(dir, "other.txt"), "before\n");
	await Promise.all([call(), hooks.get("tool_call")!(other, { cwd: dir })]);
	expect(hooks.get("tool_result")!(other, { cwd: dir }).details.pimate.existed).toBe(true);
	expect(result().details.pimate.existed).toBe(false);
});
it("omits the diff for same-path writes or edits in one parallel batch", async () => {
	const { hooks, event, call, result } = setup();
	const second = { ...event, toolCallId: "call-2", input: { path: "./file.txt", content: "two\n" } };
	const edit = { ...event, toolName: "edit", toolCallId: "call-3", input: { path: "other.txt" } };
	const write3 = { ...event, toolCallId: "call-4", input: { path: "other.txt", content: "x\n" } };
	await Promise.all([
		call(),
		hooks.get("tool_call")!(second, { cwd: dir }),
		hooks.get("tool_call")!(edit, { cwd: dir }),
		hooks.get("tool_call")!(write3, { cwd: dir }),
	]);
	for (const e of [event, second, write3]) {
		const pimate = hooks.get("tool_result")!(e, { cwd: dir }).details.pimate;
		expect(pimate.omitted).toBe("concurrent");
		expect(pimate.patch).toBeUndefined();
	}
	expect(hooks.get("tool_result")!(edit, { cwd: dir })).toBeUndefined();
	// Once the batch has finished, a later write is diffed normally again.
	await call();
	expect(result().details.pimate.patch).toBeTypeOf("string");
});
it("leaves non-object details from another extension untouched", async () => {
	for (const details of [["extension-state"], "text", null, 0]) {
		const { event, call, result } = setup();
		await call();
		Object.assign(event, { details });
		expect(result()).toBeUndefined();
	}
});
it("leaves other tools unchanged", async () => {
	const { event, call, result } = setup();
	event.toolName = "edit";
	await call();
	expect(result()).toBeUndefined();
});
it("fails open for unreadable files and invalid paths", async () => {
	for (const path of [dir, "invalid\0path"]) {
		const { event, call, result } = setup();
		event.input.path = path;
		await expect(call()).resolves.toBeUndefined();
		expect(result().details.pimate).toEqual({ kind: "write_diff", existed: true, omitted: "unreadable" });
	}
});
it.skipIf(process.platform === "win32")("does not hang reading a FIFO", async () => {
	const { event, call, result } = setup();
	execFileSync("mkfifo", [join(dir, event.input.path)]);
	await call();
	expect(result().details.pimate.omitted).toBe("unreadable");
});
it("fails open if another extension changes the target path after capture", async () => {
	const { event, call, result } = setup();
	await call();
	event.input.path = "different.txt";
	expect(result().details.pimate.omitted).toBe("unreadable");
});
it("preserves another extension's details even when diff capture fails", async () => {
	const { event, call, result } = setup();
	await call();
	event.input.path = "file://%";
	Object.assign(event, { details: { otherExtension: 42 } });
	expect(result().details).toMatchObject({ otherExtension: 42, pimate: { omitted: "unreadable" } });
});
it("matches Pi's Unix path normalization, without trimming or read-path filename fallbacks", () => {
	expect(resolveWritePath("@./a\u202fb.txt", dir)).toBe(join(dir, "a b.txt"));
	expect(resolveWritePath("~/a.txt", dir)).toBe(join(homedir(), "a.txt"));
	expect(resolveWritePath("~", dir)).toBe(homedir());
	expect(resolveWritePath(pathToFileURL(join(dir, "a b.txt")).href, dir)).toBe(join(dir, "a b.txt"));
	expect(resolveWritePath(" a.txt ", dir)).toBe(join(dir, " a.txt "));
	expect(resolveWritePath(join(dir, "absolute.txt"), "/different")).toBe(join(dir, "absolute.txt"));
});
