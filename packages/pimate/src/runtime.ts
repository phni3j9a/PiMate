import { lstatSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export function resolveRunDir(env = process.env): string {
	return resolve(
		env.PIMATE_RUN_DIR ||
			(env.XDG_RUNTIME_DIR
				? join(env.XDG_RUNTIME_DIR, "pimate")
				: join(tmpdir(), `pimate-${process.getuid?.() ?? "u"}`)),
	);
}
export function privateRunDir(dir: string): void {
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const st = lstatSync(dir);
	if (!st.isDirectory() || st.uid !== process.getuid?.() || (st.mode & 0o777) !== 0o700)
		throw new Error(`run dir is not private (owned 0700 directory required): ${dir}`);
}
export function validInstanceId(id: string): boolean {
	return /^[a-zA-Z0-9_-]{1,100}$/.test(id);
}
