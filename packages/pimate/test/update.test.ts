import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { compareVersions, PackageUpdater, type UpdateOptions } from "../src/host/update.ts";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture(options: UpdateOptions = {}) {
	const root = mkdtempSync(join(tmpdir(), "pimate-update-test-"));
	dirs.push(root);
	const write = (name = "@phni3j9a/pimate", version = "0.1.2") =>
		writeFileSync(join(root, "package.json"), JSON.stringify({ name, version }));
	write();
	const updater = new PackageUpdater(
		{ PATH: "/usr/bin:/bin", PIMATE_PI: process.execPath },
		{
			root,
			current: "0.1.2",
			platform: "linux",
			cgroup: () => "0::/user.slice/pimate-host.service\n",
			fetch: async () => new Response(JSON.stringify({ version: "0.2.0" })),
			...options,
		},
	);
	return { updater, write };
}
it("compares numeric versions", () => {
	expect(compareVersions("0.10.0", "0.9.20")).toBe(1);
	expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
	expect(compareVersions("1.0.0", "2.0.0")).toBe(-1);
});
it("checks service, transient, non-linux, and package name", async () => {
	expect(await fixture().updater.check()).toMatchObject({ canUpdate: true, latest: "0.2.0" });
	expect(await fixture({ cgroup: () => "0::/pimate-host-11-22.service" }).updater.check()).toMatchObject({
		canUpdate: false,
		reason: "not_service",
	});
	expect(await fixture({ platform: "darwin" }).updater.check()).toMatchObject({
		canUpdate: false,
		reason: "not_service",
	});
	const dev = fixture();
	dev.write("@pimate/pimate");
	expect(await dev.updater.check()).toMatchObject({ canUpdate: false, reason: "not_package" });
	expect(await dev.updater.update()).toMatchObject({ ok: false, code: "unsupported" });
});
it.each([
	async () => new Response(JSON.stringify({ version: "1.0.0-beta" })),
	async () => {
		throw new Error("offline");
	},
	async () => new Response("{}", { status: 503 }),
])("registry errors do not invent latest", async (fetcher) => {
	const result = await fixture({ fetch: fetcher }).updater.check();
	expect(result.error).toBeTruthy();
	expect(result.latest).toBeUndefined();
});
it("updates only once and restarts after the result", async () => {
	let release!: () => void;
	const restart = vi.fn(async () => {});
	let scheduled!: () => void;
	const f = fixture({
		execute: async () => {
			await new Promise<void>((r) => {
				release = r;
			});
			f.write(undefined, "0.2.0");
		},
		restart,
		schedule: (fn) => {
			scheduled = fn;
		},
	});
	const pending = f.updater.update();
	expect(await f.updater.update()).toMatchObject({ ok: false, code: "busy" });
	release();
	expect(await pending).toEqual({ ok: true, from: "0.1.2", to: "0.2.0", restarting: true });
	expect(restart).not.toHaveBeenCalled();
	scheduled();
	expect(restart).toHaveBeenCalledOnce();
});
it("unchanged and failed updates do not restart", async () => {
	const restart = vi.fn(async () => {});
	expect(await fixture({ execute: async () => {}, restart }).updater.update()).toMatchObject({
		ok: true,
		restarting: false,
	});
	expect(
		await fixture({
			execute: async () => {
				throw Object.assign(new Error("bad"), { stderr: "x".repeat(3000) });
			},
			restart,
		}).updater.update(),
	).toMatchObject({ ok: false, code: "failed", message: "x".repeat(2048) });
	expect(restart).not.toHaveBeenCalled();
});

it("executes the fixed command against a test-only fake pi", async () => {
	const root = mkdtempSync(join(tmpdir(), "pimate-update-fake-"));
	dirs.push(root);
	writeFileSync(join(root, "package.json"), JSON.stringify({ name: "@phni3j9a/pimate", version: "1.0.0" }));
	const pi = join(root, "fake-pi");
	writeFileSync(pi, `#!/bin/sh\nprintf '%s\\n' "$@" > '${join(root, "args")}'\n`);
	chmodSync(pi, 0o700);
	const updater = new PackageUpdater(
		{ PIMATE_PI: pi, PATH: "/usr/bin:/bin", HOME: root },
		{
			root,
			platform: "linux",
			cgroup: () => "0::/pimate-host.service",
			restart: async () => {
				throw new Error("must not restart");
			},
		},
	);
	expect(await updater.update()).toMatchObject({ ok: true, restarting: false });
	expect(readFileSync(join(root, "args"), "utf8")).toBe("update\nnpm:@phni3j9a/pimate\n");
});
