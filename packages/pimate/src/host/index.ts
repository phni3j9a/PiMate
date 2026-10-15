import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { accessSync, constants, lstatSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { countSubagents, type InstanceMeta, PROTOCOL_VERSION } from "@pimate/protocol";
import { extensionPath, packageDir } from "../package.ts";
import { privateRunDir, resolveRunDir, validInstanceId } from "../runtime.ts";
import { RcClient } from "./client.ts";

export { resolveRunDir } from "../runtime.ts";
export { RcClient } from "./client.ts";
export { HostConfig, resolveConfigDir } from "./config.ts";
export { defaultListenAddresses, HostServer, listenAddresses, tailscaleIps } from "./server.ts";

export function findExecutable(
	name: string,
	path = process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
): string | undefined {
	for (const candidate of name.includes("/") ? [resolve(name)] : path.split(delimiter).map((dir) => join(dir, name))) {
		try {
			accessSync(candidate, constants.X_OK);
			if (statSync(candidate).isFile()) return candidate;
		} catch {
			/* try next PATH entry */
		}
	}
	return undefined;
}
export function resolveAbduco(env = process.env, root = packageDir, warn = console.warn): string | undefined {
	if (env.PIMATE_ABDUCO) return findExecutable(env.PIMATE_ABDUCO, env.PATH);
	const relative = `bin/${process.platform}-${process.arch}/abduco`;
	const bundled = join(root, relative);
	try {
		const checksums = JSON.parse(readFileSync(join(root, "bin/SHA256SUMS.json"), "utf8"));
		if (
			findExecutable(bundled) &&
			checksums[relative] === createHash("sha256").update(readFileSync(bundled)).digest("hex")
		)
			return bundled;
	} catch {
		/* Missing or invalid bundles must never be executed. */
	}
	warn("PiMate: bundled abduco missing, unsupported, or checksum mismatch; falling back to system abduco (PATH).");
	return findExecutable("abduco", env.PATH);
}
function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === "EPERM";
	}
}
export interface AbducoSession {
	name: string;
	pid: number;
	attached: boolean;
	/** The command exited while no client was attached; abduco keeps the server until someone attaches. */
	terminated: boolean;
}
export function parseAbducoList(output: string): AbducoSession[] {
	return output.split("\n").flatMap((line) => {
		const cols = line.split("\t");
		if (cols.length < 4) return [];
		const mark = line.trimStart()[0];
		return [{ name: cols[3].trim(), pid: Number(cols[2]), attached: mark === "*", terminated: mark === "+" }];
	});
}
/** Session names created by {@link HostCore.spawn}; only these are reaped. */
const SPAWNED_SESSION = /^pimate-[0-9a-f]{8}$/;
function isMeta(value: unknown, id: string): value is InstanceMeta {
	if (!value || typeof value !== "object") return false;
	const m = value as InstanceMeta;
	return (
		m.protocol === PROTOCOL_VERSION &&
		m.instanceId === id &&
		Number.isInteger(m.pid) &&
		m.pid > 0 &&
		typeof m.cwd === "string" &&
		["pc", "mobile"].includes(m.origin) &&
		(m.abducoSession === null || typeof m.abducoSession === "string") &&
		typeof m.startedAt === "number" &&
		["idle", "running", "waiting_input"].includes(m.status) &&
		(m.session === null || (typeof m.session === "object" && typeof m.session.id === "string"))
	);
}
export interface DiscoveredInstance extends InstanceMeta {
	reachable: boolean;
	pcAttached: boolean | null;
}
export interface HostOptions {
	runDir?: string;
	env?: NodeJS.ProcessEnv;
	probeTimeoutMs?: number;
}
export class HostCore {
	readonly runDir: string;
	readonly env: NodeJS.ProcessEnv;
	readonly abduco?: string;
	readonly probeTimeoutMs: number;
	readonly incompatible = new Map<string, number>();
	constructor(options: HostOptions = {}) {
		this.env = { ...process.env, ...options.env };
		this.env.PATH ||= "/usr/local/bin:/usr/bin:/bin";
		this.runDir = resolve(options.runDir ?? resolveRunDir(this.env));
		this.abduco = resolveAbduco(this.env);
		this.probeTimeoutMs = options.probeTimeoutMs ?? 1000;
		privateRunDir(this.runDir);
	}
	client(id: string): RcClient {
		return new RcClient(this.runDir, id);
	}
	async list(): Promise<DiscoveredInstance[]> {
		privateRunDir(this.runDir);
		const sessions = this.abduco
			? parseAbducoList(spawnSync(this.abduco, [], { encoding: "utf8", env: this.env, timeout: 2000 }).stdout ?? "")
			: [];
		// A phone-spawned Pi that exited (e.g. shut down from the app) leaves its abduco server, socket and
		// systemd scope behind until a client attaches. Nobody is attached, so release them here.
		for (const s of sessions)
			if (s.terminated && SPAWNED_SESSION.test(s.name) && Number.isInteger(s.pid) && s.pid > 0)
				try {
					process.kill(s.pid, "SIGTERM"); // abduco's atexit handler removes the socket
				} catch {
					/* already gone */
				}
		const instances: DiscoveredInstance[] = [];
		const files = readdirSync(this.runDir);
		for (const id of this.incompatible.keys()) if (!files.includes(`${id}.json`)) this.incompatible.delete(id);
		for (const file of files) {
			if (!file.endsWith(".json")) continue;
			const id = file.slice(0, -5);
			if (!validInstanceId(id)) continue;
			const metaPath = join(this.runDir, file);
			const socketPath = join(this.runDir, `${id}.sock`);
			let meta: InstanceMeta;
			try {
				const st = lstatSync(metaPath);
				if (!st.isFile() || st.size > 1024 * 1024) continue;
				const value: unknown = JSON.parse(readFileSync(metaPath, "utf8"));
				if (
					value &&
					typeof value === "object" &&
					"protocol" in value &&
					typeof value.protocol === "number" &&
					value.protocol !== PROTOCOL_VERSION
				) {
					if (this.incompatible.get(id) !== value.protocol)
						console.warn(`PiMate: skipping RC ${id}: protocol ${value.protocol}, expected ${PROTOCOL_VERSION}`);
					this.incompatible.set(id, value.protocol);
					continue;
				}
				this.incompatible.delete(id);
				if (!isMeta(value, id)) continue;
				meta = value;
			} catch {
				continue;
			}
			if (!alive(meta.pid)) {
				// Derive paths from the filename, never a socket path supplied by the metadata.
				for (const path of [metaPath, socketPath]) {
					try {
						rmSync(path, { force: true });
					} catch {
						/* one stale entry must not hide other instances */
					}
				}
				continue;
			}
			const client = new RcClient(this.runDir, id, this.probeTimeoutMs);
			let reachable = false;
			try {
				const snapshot = await client.connect();
				meta = {
					...meta,
					status: snapshot.status,
					session: snapshot.session,
					subagents: snapshot.subagents ? countSubagents(snapshot.subagents.runs) : meta.subagents,
				};
				reachable = true;
			} catch {
				/* live Pi can be starting or temporarily unreachable */
			} finally {
				client.close();
			}
			instances.push({
				...meta,
				reachable,
				pcAttached: meta.abducoSession ? (sessions.find((s) => s.name === meta.abducoSession)?.attached ?? null) : null,
			});
		}
		return instances;
	}
	async spawn(options: { cwd: string; args?: string[]; trust?: boolean }): Promise<{
		instanceId: string;
		abducoSession: string;
		attachCommand: string;
		isolation: "systemd-scope" | "detached";
	}> {
		privateRunDir(this.runDir);
		const cwd = resolve(options.cwd);
		if (!statSync(cwd).isDirectory()) throw new Error(`Not a directory: ${cwd}`);
		if (!this.abduco) throw new Error("abduco not found; set PIMATE_ABDUCO or build the bundled binary");
		const pi = findExecutable(this.env.PIMATE_PI || "pi", this.env.PATH);
		if (!pi) throw new Error("pi not found on PATH");
		const instanceId = randomUUID();
		const name = `pimate-${instanceId.slice(0, 8)}`;
		const env: NodeJS.ProcessEnv = {
			...this.env,
			PIMATE_RUN_DIR: this.runDir,
			PIMATE_INSTANCE_ID: instanceId,
			PIMATE_ORIGIN: "mobile",
			PIMATE_TRUST: options.trust === true ? "yes" : "no",
			PIMATE_ABDUCO_SESSION: name,
		};
		const command = [
			this.abduco,
			"-n",
			name,
			pi,
			...(this.env.PIMATE_EXTENSION === "none" ? [] : ["-e", this.env.PIMATE_EXTENSION || extensionPath]),
			...(options.args ?? []),
		];
		const systemd = findExecutable("systemd-run", env.PATH);
		// A binary alone is insufficient: containers/macOS may have no user manager.
		const scoped =
			!!systemd &&
			spawnSync("systemctl", ["--user", "show-environment"], { env, stdio: "ignore", timeout: 2000 }).status === 0;
		const argv = scoped ? [systemd!, "--user", "--scope", "--quiet", `--unit=${name}`, ...command] : command;
		await new Promise<void>((resolve, reject) => {
			const child = spawn(argv[0], argv.slice(1), { cwd, env, stdio: "ignore", detached: true });
			child.once("error", reject);
			child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`Pi launcher exited ${code}`))));
			// Keep the CLI alive until the launcher acknowledges success; abduco detaches Pi itself.
		});
		return {
			instanceId,
			abducoSession: name,
			attachCommand: `pimate attach ${name}`,
			isolation: scoped ? "systemd-scope" : "detached",
		};
	}
}
