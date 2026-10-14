import { open, readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { FolderInfo, InstanceSummary, SpawnErrorCode, SpawnParams } from "@pimate/protocol";

export class SpawnError extends Error {
	readonly code: SpawnErrorCode;
	constructor(code: SpawnErrorCode, message: string) {
		super(message);
		this.code = code;
	}
}
export function hostHome(env: NodeJS.ProcessEnv): string {
	return env.HOME || homedir();
}
export async function validateSpawn(value: unknown, home: string): Promise<SpawnParams> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new SpawnError("bad_request", "Invalid spawn params");
	const p = value as SpawnParams;
	if (
		typeof p.cwd !== "string" ||
		!p.cwd ||
		p.cwd.includes("\0") ||
		(p.trust !== undefined && typeof p.trust !== "boolean") ||
		(p.message !== undefined &&
			(typeof p.message !== "string" || !p.message.trim() || p.message.length > 128 * 1024)) ||
		(p.thinking !== undefined && !["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(p.thinking)) ||
		(p.model !== undefined &&
			(!p.model ||
				typeof p.model.provider !== "string" ||
				!p.model.provider ||
				typeof p.model.id !== "string" ||
				!p.model.id ||
				/[\s\0/]/.test(p.model.provider) ||
				/[\s\0]/.test(p.model.id)))
	)
		throw new SpawnError("bad_request", "Invalid spawn params");
	const cwd = p.cwd === "~" ? home : p.cwd.startsWith("~/") ? join(home, p.cwd.slice(2)) : p.cwd;
	if (!isAbsolute(cwd)) throw new SpawnError("bad_request", "cwd must be absolute or ~/...");
	try {
		if (!(await stat(cwd)).isDirectory()) throw new SpawnError("not_directory", "cwd is not a directory");
	} catch (e) {
		if (e instanceof SpawnError) throw e;
		throw new SpawnError("not_found", "cwd does not exist or is inaccessible");
	}
	return { ...p, cwd: await realpath(cwd) };
}

/** Only read one bounded session header per folder; never parse complete transcripts. */
export async function listFolders(env: NodeJS.ProcessEnv, instances: InstanceSummary[]): Promise<FolderInfo[]> {
	const agentDir = env.PI_CODING_AGENT_DIR || join(hostHome(env), ".pi/agent");
	const folders = new Map<string, FolderInfo>();
	const add = async (path: string, lastUsed?: number, running = 0) => {
		try {
			if (!isAbsolute(path) || !(await stat(path)).isDirectory()) return;
			path = await realpath(path);
			const old = folders.get(path);
			folders.set(path, {
				path,
				running: (old?.running ?? 0) + running,
				lastUsed: Math.max(old?.lastUsed ?? 0, lastUsed ?? 0) || undefined,
			});
		} catch {
			/* stale session cwd */
		}
	};
	for (const instance of instances) await add(instance.cwd, instance.updatedAt, 1);
	try {
		const root = join(agentDir, "sessions");
		const dirs = (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory());
		const dated = await Promise.all(
			dirs.map(async (d) => ({ path: join(root, d.name), time: (await stat(join(root, d.name))).mtimeMs })),
		);
		for (const dir of dated.sort((a, b) => b.time - a.time).slice(0, 200)) {
			try {
				const files = (await readdir(dir.path))
					.filter((f) => f.endsWith(".jsonl"))
					.sort()
					.reverse();
				if (!files[0]) continue;
				const datedFiles = await Promise.all(
					files.slice(0, 2000).map(async (name) => {
						const path = join(dir.path, name);
						return { path, time: (await stat(path)).mtimeMs };
					}),
				);
				const path = datedFiles.sort((a, b) => b.time - a.time)[0].path;
				const file = await open(path, "r");
				try {
					const buffer = Buffer.alloc(16 * 1024);
					const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
					const header = JSON.parse(buffer.toString("utf8", 0, bytesRead).split("\n")[0]);
					if (header.type === "session" && typeof header.cwd === "string")
						await add(header.cwd, (await file.stat()).mtimeMs);
				} finally {
					await file.close();
				}
			} catch {
				/* malformed or disappearing session */
			}
		}
	} catch {
		/* no saved sessions */
	}
	let trust: Record<string, unknown> = {};
	try {
		const path = join(agentDir, "trust.json");
		if ((await stat(path)).size < 1024 * 1024) {
			const value: unknown = JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, ""));
			if (value && typeof value === "object" && !Array.isArray(value)) trust = value as Record<string, unknown>;
		}
	} catch {
		/* unavailable trust is unknown, never implicitly approved */
	}
	for (const folder of folders.values()) {
		let path = resolve(folder.path);
		while (true) {
			if (typeof trust[path] === "boolean") {
				folder.trusted = trust[path] as boolean;
				break;
			}
			const parent = dirname(path);
			if (path === parent) break;
			path = parent;
		}
	}
	return [...folders.values()].sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0)).slice(0, 200);
}
