import { execFile, spawn } from "node:child_process";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readlinkSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir, userInfo } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { DEFAULT_HOST_PORT } from "@pimate/protocol";
import { cliPath } from "../package.ts";
import { HostConfig, resolveConfigDir } from "./config.ts";

const exec = promisify(execFile);
export const SERVICE = "pimate-host.service";
const MARKER = "# Managed by PiMate\n";
export function unitPath(): string {
	return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "systemd/user", SERVICE);
}
export function systemdQuote(value: string): string {
	if (/[\n\r\0]/.test(value)) throw new Error("Invalid newline/NUL in service configuration");
	return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%")}"`;
}
const ENV_KEYS = [
	"PATH",
	"PIMATE_CONFIG_DIR",
	"PIMATE_RUN_DIR",
	"PIMATE_ABDUCO",
	"PIMATE_PI",
	"PIMATE_EXTENSION",
	"PI_CODING_AGENT_DIR",
	"XDG_CONFIG_HOME",
	"XDG_RUNTIME_DIR",
] as const;
const PATH_KEYS = new Set<string>(ENV_KEYS.filter((k) => k !== "PATH"));
/**
 * Environment handed to the service/transient Host. systemd starts it from the home directory, so relative paths
 * the user's Pi resolved against its own cwd are made absolute here (bare command names like `pi` stay as is).
 */
export function hostEnv(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): [string, string][] {
	const out: [string, string][] = [];
	for (const key of ENV_KEYS) {
		let value = key === "PIMATE_CONFIG_DIR" && !env.PIMATE_CONFIG_DIR ? resolveConfigDir(env) : env[key];
		if (!value) continue;
		if (PATH_KEYS.has(key)) value = absolutePath(value, cwd, key);
		out.push([key, value]);
	}
	return out;
}
/** Command names without a slash (`pi`, `abduco`) are looked up in PATH later and stay as is. */
const COMMAND_KEYS = new Set(["PIMATE_PI", "PIMATE_ABDUCO"]);
/** Resolves like the reader of each variable does: Pi expands `~` in its agent dir, PiMate resolves against cwd. */
function absolutePath(value: string, cwd: string, key: string): string {
	if (key === "PI_CODING_AGENT_DIR" && (value === "~" || value.startsWith("~/")))
		return join(homedir(), value.slice(1));
	if (isAbsolute(value) || (COMMAND_KEYS.has(key) && !value.includes("/"))) return value;
	// Pi package sources (`npm:x`, `git:…`, URLs) and the `none` keyword are not file paths.
	if (key === "PIMATE_EXTENSION" && (value === "none" || /^[a-z][a-z0-9+.-]*:/i.test(value))) return value;
	return resolve(cwd, value);
}
/** systemd expands `$VAR` in command arguments (also for systemd-run); keep them literal. The executable path is not expanded. */
const literalArg = (value: string) => value.replaceAll("$", "$$$$");
export function serviceUnit(env = process.env, cwd = process.cwd()): string {
	return `${MARKER}[Unit]\nDescription=PiMate Host\n\n[Service]\nType=simple\nExecStart=${systemdQuote(process.execPath)} ${literalArg(systemdQuote(cliPath))} serve\nRestart=on-failure\nRestartSec=3\nUMask=0077\n${hostEnv(
		env,
		cwd,
	)
		.map(([key, value]) => `Environment=${systemdQuote(`${key}=${value}`)}`)
		.join("\n")}\n\n[Install]\nWantedBy=default.target\n`;
}
async function systemctl(...args: string[]): Promise<string> {
	return (await exec("systemctl", ["--user", ...args], { timeout: 15000 })).stdout.trim();
}
export async function hasUserSystemd(): Promise<boolean> {
	if (process.platform !== "linux") return false;
	try {
		await systemctl("show-environment");
		return true;
	} catch {
		return false;
	}
}
export async function serviceStatus(): Promise<{ installed: boolean; active: boolean; linger: string }> {
	const installed = existsSync(unitPath());
	let active = false;
	let linger = "unknown (no change made)";
	if (await hasUserSystemd()) {
		try {
			active = (await systemctl("is-active", SERVICE)) === "active";
		} catch {
			/* inactive */
		}
		try {
			linger = (
				await exec("loginctl", ["show-user", userInfo().username, "-p", "Linger", "--value"], { timeout: 3000 })
			).stdout.trim();
		} catch {
			/* not available */
		}
	}
	return { installed, active, linger };
}
export interface Health {
	ok: boolean;
	protocol: number;
	rcProtocol?: number;
	version?: string;
	hostId?: string;
	pid?: number;
	abduco?: string | null;
	addresses?: { address: string; port: number }[];
	incompatible?: Record<string, number>;
}
export async function hostHealth(): Promise<Health | undefined> {
	try {
		const response = await fetch(`http://127.0.0.1:${DEFAULT_HOST_PORT}/health`, { signal: AbortSignal.timeout(1500) });
		if (!response.ok) throw new Error("Invalid response");
		const value = (await response.json()) as Health;
		return value.ok === true && typeof value.protocol === "number" ? value : undefined;
	} catch {
		return undefined;
	}
}
function ensureOwnedUnit(): void {
	const unit = readFileSync(unitPath(), "utf8");
	if (!unit.startsWith(MARKER)) throw new Error(`Refusing to change unmanaged unit: ${unitPath()}`);
	if (!unit.includes(`Environment=${systemdQuote(`PIMATE_CONFIG_DIR=${resolveConfigDir()}`)}\n`))
		throw new Error(
			"This service belongs to a different config directory. Use its original PIMATE_CONFIG_DIR to manage it.",
		);
}
function ensureOurHost(health: Health): void {
	if (health.hostId !== new HostConfig().host.hostId)
		throw new Error("Port 47800 belongs to another/older Host. Stop that Host first; no process was changed.");
}
async function waitForHost(): Promise<void> {
	for (let i = 0; i < 40; i++) {
		const health = await hostHealth();
		if (health) {
			ensureOurHost(health);
			return;
		}
		await delay(250);
	}
	throw new Error(
		`Host did not become ready. Check journalctl --user -u ${SERVICE}, or ${join(resolveConfigDir(), "host.log")}`,
	);
}
export async function installService(): Promise<void> {
	if (!(await hasUserSystemd()))
		throw new Error("systemd user service registration is supported on Linux with a running user manager only");
	if (existsSync(unitPath())) ensureOwnedUnit();
	if (await hostHealth()) await stopHost();
	mkdirSync(dirname(unitPath()), { recursive: true });
	writeFileSync(unitPath(), serviceUnit(), { mode: 0o600 });
	await systemctl("daemon-reload");
	await systemctl("enable", "--now", SERVICE);
	await waitForHost();
}
const statePath = () => join(resolveConfigDir(), "host-process.json");
export async function startHost(): Promise<void> {
	const current = await hostHealth();
	if (current) {
		ensureOurHost(current);
		return;
	}
	new HostConfig();
	if (existsSync(unitPath())) {
		ensureOwnedUnit();
		await systemctl("start", SERVICE);
	} else if (await hasUserSystemd()) {
		const unit = `pimate-host-${process.pid}-${Date.now()}`;
		await exec(
			"systemd-run",
			[
				"--user",
				"--quiet",
				"--collect",
				`--unit=${unit}`,
				...hostEnv().map(([k, v]) => `--setenv=${k}=${v}`),
				process.execPath,
				literalArg(cliPath),
				"serve",
			],
			{ timeout: 15000 },
		);
		writeFileSync(statePath(), JSON.stringify({ unit }), { mode: 0o600 });
	} else {
		// Detached fallback survives Pi exit, but not necessarily logout without an OS user manager.
		const { openSync, closeSync } = await import("node:fs");
		const log = openSync(join(resolveConfigDir(), "host.log"), "a", 0o600);
		try {
			const child = spawn(process.execPath, [cliPath, "serve"], { detached: true, stdio: ["ignore", log, log] });
			await new Promise<void>((resolve, reject) => {
				child.once("spawn", resolve);
				child.once("error", reject);
			});
			child.unref();
			writeFileSync(statePath(), JSON.stringify({ pid: child.pid }), { mode: 0o600 });
		} finally {
			closeSync(log);
		}
	}
	await waitForHost();
}
export async function stopHost(): Promise<void> {
	const health = await hostHealth();
	if (health) ensureOurHost(health);
	if (existsSync(unitPath())) {
		ensureOwnedUnit();
		await systemctl("stop", SERVICE);
	}
	if (existsSync(statePath())) {
		const state = JSON.parse(readFileSync(statePath(), "utf8"));
		if (typeof state.unit === "string" && /^pimate-host-\d+-\d+$/.test(state.unit)) {
			await systemctl("stop", state.unit).catch(() => {});
		} else if (health && state.pid === health.pid && Number.isInteger(state.pid) && state.pid > 1) {
			process.kill(state.pid, "SIGTERM");
		}
		rmSync(statePath(), { force: true });
	}
	for (let i = 0; i < 20; i++) {
		if (!(await hostHealth())) return;
		await delay(250);
	}
	throw new Error("Host still running (possibly launched manually). Stop it in its original terminal.");
}
/** User command dir in uv's order; Pi's own installer also links ~/.local/bin/pi. XDG paths must be absolute. */
export function commandStatus(env = process.env, target = cliPath) {
	const xdg = (v?: string) => (v && isAbsolute(v) ? v : undefined);
	const dataHome = xdg(env.XDG_DATA_HOME);
	const dir = xdg(env.XDG_BIN_HOME) ?? (dataHome ? resolve(dataHome, "../bin") : join(homedir(), ".local/bin"));
	const path = join(dir, "pimate");
	let linked = false;
	let conflict = false;
	try {
		linked = lstatSync(path).isSymbolicLink() && readlinkSync(path) === target;
		conflict = !linked;
	} catch {
		/* absent */
	}
	const onPath = (env.PATH ?? "").split(delimiter).some((p) => p && resolve(p) === dir);
	return { dir, path, linked, conflict, onPath };
}
/** Links the `pimate` command; never replaces a file or link that is not ours. */
export function installCommand(env = process.env, target = cliPath): void {
	const status = commandStatus(env, target);
	if (status.linked) return;
	if (status.conflict) throw new Error(`${status.path} already exists and is not PiMate's link; left unchanged`);
	mkdirSync(status.dir, { recursive: true });
	symlinkSync(target, status.path);
}
/** Removes the `pimate` link only if it points to this package's CLI. */
export function removeCommand(env = process.env, target = cliPath): boolean {
	const status = commandStatus(env, target);
	if (status.linked) rmSync(status.path);
	return status.linked;
}
export async function uninstallService(): Promise<void> {
	if (existsSync(unitPath())) ensureOwnedUnit();
	await stopHost();
	if (existsSync(unitPath())) {
		await systemctl("disable", SERVICE);
		rmSync(unitPath());
		await systemctl("daemon-reload");
	}
}
