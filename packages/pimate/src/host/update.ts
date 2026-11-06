import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { PackageUpdateCheck, PackageUpdateResult } from "@pimate/protocol";
import { PACKAGE_VERSION, packageDir } from "../package.ts";
import { findExecutable } from "./index.ts";
import { hostHome } from "./operations.ts";
import { restartManagedService, SERVICE } from "./service.ts";

const exec = promisify(execFile);
const NAME = "@phni3j9a/pimate";
const VERSION = /^\d+\.\d+\.\d+$/;

export function compareVersions(a: string, b: string): number {
	const aa = a.split(".").map(BigInt);
	const bb = b.split(".").map(BigInt);
	for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return aa[i] > bb[i] ? 1 : -1;
	return 0;
}

export interface UpdateOptions {
	root?: string;
	platform?: string;
	cgroup?: () => string;
	fetch?: typeof fetch;
	execute?: (pi: string, env: NodeJS.ProcessEnv) => Promise<void>;
	restart?: () => Promise<void>;
	schedule?: (fn: () => void) => void;
	current?: string;
}

export class PackageUpdater {
	private busy = false;
	private env: NodeJS.ProcessEnv;
	private options: UpdateOptions;
	constructor(env: NodeJS.ProcessEnv, options: UpdateOptions = {}) {
		this.env = env;
		this.options = options;
	}
	private metadata(): { name: string; version: string } {
		return JSON.parse(readFileSync(join(this.options.root ?? packageDir, "package.json"), "utf8"));
	}
	private support(): PackageUpdateCheck["reason"] | undefined {
		try {
			if (this.metadata().name !== NAME) return "not_package";
		} catch {
			return "not_package";
		}
		try {
			const group = (this.options.cgroup ?? (() => readFileSync("/proc/self/cgroup", "utf8")))();
			if ((this.options.platform ?? process.platform) === "linux" && group.trimEnd().endsWith(`/${SERVICE}`)) return;
		} catch {
			/* no managed service */
		}
		return "not_service";
	}
	async check(): Promise<PackageUpdateCheck> {
		const reason = this.support();
		const current = this.options.current ?? PACKAGE_VERSION;
		try {
			// shortcut: ignores npm registry config (.npmrc/proxy/mirror); use npm config if registry selection is needed.
			const res = await (this.options.fetch ?? fetch)(`https://registry.npmjs.org/${NAME}/latest`, {
				signal: AbortSignal.timeout(5000),
			});
			if (!res.ok) throw new Error("registry HTTP error");
			const data: unknown = await res.json();
			if (
				!data ||
				typeof data !== "object" ||
				!("version" in data) ||
				typeof data.version !== "string" ||
				!VERSION.test(data.version)
			)
				throw new Error("invalid registry version");
			return { current, latest: data.version, canUpdate: !reason, ...(reason ? { reason } : {}) };
		} catch {
			return { current, canUpdate: !reason, ...(reason ? { reason } : {}), error: "Registry check failed" };
		}
	}
	async update(): Promise<PackageUpdateResult> {
		const reason = this.support();
		if (reason) return { ok: false, code: "unsupported", message: reason };
		if (this.busy) return { ok: false, code: "busy", message: "Another update is running" };
		this.busy = true;
		let restarting = false;
		try {
			const from = this.metadata().version;
			if (typeof from !== "string" || !VERSION.test(from)) throw new Error("Invalid installed version");
			const pi = findExecutable(this.env.PIMATE_PI || "pi", this.env.PATH);
			if (!pi) throw new Error("pi not found on PATH");
			await (
				this.options.execute ??
				(async (command, env) => {
					await exec(command, ["update", `npm:${NAME}`], {
						cwd: hostHome(env),
						env,
						timeout: 600_000,
						maxBuffer: 1024 * 1024,
					});
				})
			)(pi, this.env);
			const to = this.metadata().version;
			if (typeof to !== "string" || !VERSION.test(to)) throw new Error("Invalid installed version after update");
			restarting = from !== to;
			if (restarting)
				(
					this.options.schedule ??
					((fn) => {
						setTimeout(fn, 300);
					})
				)(() => {
					void (this.options.restart ?? restartManagedService)().catch((e) => {
						console.error("PiMate Host restart failed:", e);
						this.busy = false;
					});
				});
			return { ok: true, from, to, restarting };
		} catch (e) {
			const err = e as { stderr?: string; stdout?: string; message?: string };
			return {
				ok: false,
				code: "failed",
				message: (err.stderr || err.stdout || err.message || String(e)).trim().slice(-2048),
			};
		} finally {
			if (!restarting) this.busy = false;
		}
	}
}
