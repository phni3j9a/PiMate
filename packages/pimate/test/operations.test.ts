import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InstanceSummary } from "@pimate/protocol";
import { afterEach, expect, it } from "vitest";
import { listDirs, listFolders, validateSpawn } from "../src/host/operations.ts";

const dirs: string[] = [];
function temp() {
	const dir = mkdtempSync(join(tmpdir(), "pimate-ops-"));
	dirs.push(dir);
	return dir;
}
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
it("validates spawn paths and typed params without accepting a remote command", async () => {
	const dir = temp();
	writeFileSync(join(dir, "file"), "file");
	for (const params of [
		null,
		[],
		{},
		{ cwd: "." },
		{ cwd: dir, trust: "yes" },
		{ cwd: dir, thinking: "huge" },
		{ cwd: dir, model: { provider: "x", id: "" } },
		{ cwd: dir, message: "" },
	])
		await expect(validateSpawn(params, dir)).rejects.toMatchObject({ code: "bad_request" });
	await expect(validateSpawn({ cwd: join(dir, "missing") }, dir)).rejects.toMatchObject({ code: "not_found" });
	await expect(validateSpawn({ cwd: join(dir, "file") }, dir)).rejects.toMatchObject({ code: "not_directory" });
	expect(
		await validateSpawn(
			{ cwd: "~/", model: { provider: "openai", id: "gpt-6-luna" }, thinking: "off", trust: false },
			dir,
		),
	).toMatchObject({ cwd: dir, trust: false });
});
it("merges recent saved session headers, live cwd counts and nearest saved trust", async () => {
	const home = temp();
	const project = join(home, "project");
	const child = join(project, "child");
	mkdirSync(child, { recursive: true });
	const agent = join(home, "agent");
	const sessions = join(agent, "sessions", "--encoded--");
	mkdirSync(sessions, { recursive: true });
	writeFileSync(join(agent, "trust.json"), JSON.stringify({ [home]: true, [project]: false, [child]: null }));
	const older = join(sessions, "2020.jsonl");
	writeFileSync(older, `${JSON.stringify({ type: "session", cwd: child })}\n${"x".repeat(30000)}`);
	writeFileSync(join(sessions, "2021.jsonl"), JSON.stringify({ type: "session", cwd: project }));
	utimesSync(older, new Date(), new Date(Date.now() + 1000));
	const instance = { cwd: child, updatedAt: 1 } as InstanceSummary;
	const folders = await listFolders({ HOME: home, PI_CODING_AGENT_DIR: agent }, [
		instance,
		instance,
		{ cwd: "/absent", updatedAt: 2 } as InstanceSummary,
	]);
	expect(folders).toEqual([{ path: child, running: 2, trusted: false, lastUsed: expect.any(Number) }]);
	expect(await listFolders({ HOME: temp() }, [])).toEqual([]);
});
it("lists only subfolder names (incl. hidden and linked folders) for completion", async () => {
	const home = temp();
	mkdirSync(join(home, "code", "b"), { recursive: true });
	mkdirSync(join(home, "code", "A"));
	mkdirSync(join(home, "code", ".hidden"));
	writeFileSync(join(home, "code", "file"), "x");
	symlinkSync(join(home, "code", "b"), join(home, "code", "link"));
	symlinkSync(join(home, "code", "file"), join(home, "code", "filelink"));
	expect(await listDirs("~/code/", home)).toEqual([".hidden", "A", "b", "link"]);
	expect(await listDirs(join(home, "code"), home)).toEqual([".hidden", "A", "b", "link"]);
	expect(await listDirs("~/code/file", home)).toEqual([]);
	expect(await listDirs("~/missing/", home)).toEqual([]);
	expect(await listDirs("code/", home)).toEqual([]);
});
