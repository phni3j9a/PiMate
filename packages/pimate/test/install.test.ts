import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { registerSetup } from "../src/extension/setup.ts";
import { getLocalUI, patchUI } from "../src/extension/ui.ts";
import { HostCore, resolveAbduco } from "../src/host/index.ts";
import { hostEnv, serviceUnit, systemdQuote } from "../src/host/service.ts";

const dirs: string[] = [];
const temp = () => {
	const dir = mkdtempSync(join(tmpdir(), "pimate-install-"));
	dirs.push(dir);
	return dir;
};
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	vi.restoreAllMocks();
});
it("only executes checksummed bundled abduco, otherwise reports system fallback", () => {
	const root = temp();
	const relative = `bin/${process.platform}-${process.arch}/abduco`;
	mkdirSync(join(root, `bin/${process.platform}-${process.arch}`), { recursive: true });
	writeFileSync(join(root, relative), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
	const sum = createHash("sha256")
		.update(readFileSync(join(root, relative)))
		.digest("hex");
	writeFileSync(join(root, "bin/SHA256SUMS.json"), JSON.stringify({ [relative]: sum }));
	const warn = vi.fn();
	expect(resolveAbduco({ PATH: root }, root, warn)).toBe(join(root, relative));
	expect(warn).not.toHaveBeenCalled();
	writeFileSync(join(root, relative), "tampered");
	writeFileSync(join(root, "abduco"), "system", { mode: 0o755 });
	expect(resolveAbduco({ PATH: root }, root, warn)).toBe(join(root, "abduco"));
	expect(warn).toHaveBeenCalledWith(expect.stringContaining("checksum mismatch"));
	rmSync(join(root, "bin/SHA256SUMS.json"));
	expect(resolveAbduco({ PATH: "/absent" }, root, warn)).toBeUndefined();
	expect(resolveAbduco({ PIMATE_ABDUCO: join(root, "abduco") }, root, warn)).toBe(join(root, "abduco"));
});
it("skips mismatched RC protocols without deleting them and ignores future fields", async () => {
	const dir = temp();
	const core = new HostCore({ runDir: dir, env: { PIMATE_ABDUCO: "/absent" }, probeTimeoutMs: 10 });
	const meta = {
		protocol: 99,
		instanceId: "future",
		pid: process.pid,
		cwd: dir,
		origin: "pc",
		abducoSession: null,
		startedAt: 1,
		status: "idle",
		session: null,
	};
	writeFileSync(join(dir, "future.json"), JSON.stringify(meta));
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	expect(await core.list()).toEqual([]);
	expect(core.incompatible.get("future")).toBe(99);
	expect(warn).toHaveBeenCalledOnce();
	await core.list();
	expect(warn).toHaveBeenCalledOnce();
	writeFileSync(join(dir, "future.json"), JSON.stringify({ ...meta, protocol: 1, newMinorField: { x: true } }));
	expect(await core.list()).toHaveLength(1);
	expect(core.incompatible.size).toBe(0);
});
it("quotes systemd paths and environment without accepting injected directives", () => {
	expect(systemdQuote('a b"%$\\c')).toBe('"a b\\"%%$\\\\c"');
	expect(() => systemdQuote("a\nExecStart=evil")).toThrow();
	const unit = serviceUnit({ PATH: "/a b/$literal/%x", PIMATE_CONFIG_DIR: "/tmp/test" });
	expect(unit).toContain('Environment="PATH=/a b/$literal/%%x"');
	expect(unit).toContain("Restart=on-failure");
	expect(unit).not.toContain("enable-linger");
});
it("hands the Host absolute paths and literal command arguments", () => {
	const env = hostEnv(
		{
			PATH: "/bin",
			PIMATE_CONFIG_DIR: "cfg",
			PIMATE_RUN_DIR: "./run",
			PIMATE_PI: "pi",
			PIMATE_ABDUCO: "abduco",
			PIMATE_EXTENSION: "none",
			PI_CODING_AGENT_DIR: "~/.pi/agent",
			XDG_RUNTIME_DIR: "/run/user/1000",
		},
		"/repo",
	);
	expect(Object.fromEntries(env)).toEqual({
		PATH: "/bin",
		PIMATE_CONFIG_DIR: "/repo/cfg",
		PIMATE_RUN_DIR: "/repo/run",
		PIMATE_PI: "pi",
		PIMATE_ABDUCO: "abduco",
		PIMATE_EXTENSION: "none",
		PI_CODING_AGENT_DIR: join(homedir(), ".pi/agent"),
		XDG_RUNTIME_DIR: "/run/user/1000",
	});
	const ext = (v: string) => Object.fromEntries(hostEnv({ PIMATE_EXTENSION: v }, "/repo")).PIMATE_EXTENSION;
	expect(ext("rc.ts")).toBe("/repo/rc.ts");
	expect(ext("npm:pimate")).toBe("npm:pimate");
	expect(ext("none")).toBe("none");
	expect(serviceUnit({ PIMATE_RUN_DIR: "./run", PIMATE_CONFIG_DIR: "/c" }, "/repo")).toContain(
		'Environment="PIMATE_RUN_DIR=/repo/run"',
	);
});
it("management dialogs and notifications do not enter the remote UI bridge", async () => {
	const original = { confirm: vi.fn(async () => true), notify: vi.fn() };
	const ctx = { ui: original } as unknown as ExtensionContext;
	const state = { pendingUI: new Map(), emit: vi.fn(), setStatus: vi.fn(), isIdle: () => true };
	patchUI(ctx, state);
	expect(await getLocalUI(ctx).confirm("Service?", "PC consent")).toBe(true);
	getLocalUI(ctx).notify("private pairing link");
	expect(state.emit).not.toHaveBeenCalled();
	expect(state.pendingUI.size).toBe(0);
});
it("refuses /pimate in RPC and print mode before accessing Host", async () => {
	const registerCommand = vi.fn();
	registerSetup({ registerCommand } as unknown as ExtensionAPI);
	const handler = registerCommand.mock.calls[0][1].handler;
	for (const mode of ["rpc", "json", "text"]) {
		const notify = vi.fn();
		await handler("setup", { mode, ui: { notify } });
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("only in the PC TUI"), "error");
	}
});
