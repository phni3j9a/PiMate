/**
 * Unified diff parsing for display (pure, no React Native imports).
 *
 * Accepts what Pi and the RC produce: jsdiff's `createPatch` / `createTwoFilesPatch` output (with or without the
 * `Index:` / `===` preamble) and git-style diffs (`diff --git a/x b/x`). Hunk bodies are read by their line
 * counts, so a removed line that itself starts with `---` is not mistaken for a file header.
 */

export type DiffLineKind = "add" | "del" | "ctx";

export interface DiffLine {
	kind: DiffLineKind;
	text: string;
	/** Line number in the old file (null for added lines). */
	oldNo: number | null;
	/** Line number in the new file (null for removed lines). */
	newNo: number | null;
	/** `\ No newline at end of file` followed this line. */
	noNewline?: boolean;
}

export interface DiffHunk {
	/** The `@@ -a,b +c,d @@ section` line as written. */
	header: string;
	oldStart: number;
	oldLines: number;
	newStart: number;
	newLines: number;
	lines: DiffLine[];
}

export interface DiffFile {
	/** Paths from the `---` / `+++` headers; null for `/dev/null` or when the patch has no headers. */
	oldPath: string | null;
	newPath: string | null;
	hunks: DiffHunk[];
	add: number;
	del: number;
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function headerPath(line: string, git: boolean): string | null {
	// `--- path<TAB>timestamp` (diff -u) or `--- path` (jsdiff). Quoted git paths are left as written.
	let path = line.slice(4).split("\t")[0]!.trim();
	if (path === "/dev/null" || !path) return null;
	if (git && /^[ab]\//.test(path)) path = path.slice(2);
	return path;
}

export function parseUnifiedDiff(text: string): DiffFile[] {
	const files: DiffFile[] = [];
	const lines = text.split("\n");
	if (lines.at(-1) === "") lines.pop();
	let file: DiffFile | null = null;
	let git = false;
	let pendingOld: string | null | undefined;

	const newFile = (): DiffFile => {
		const f: DiffFile = { oldPath: null, newPath: null, hunks: [], add: 0, del: 0 };
		files.push(f);
		return f;
	};

	let i = 0;
	while (i < lines.length) {
		const line = lines[i]!.replace(/\r$/, "");
		if (line.startsWith("diff --git ")) {
			git = true;
			file = newFile();
			// Paths for blocks without ---/+++ headers (binary files, mode changes).
			const paths = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
			if (paths) {
				file.oldPath = paths[1]!;
				file.newPath = paths[2]!;
			}
			pendingOld = undefined;
			i++;
			continue;
		}
		if (line.startsWith("--- ") && lines[i + 1]?.startsWith("+++ ")) {
			const oldPath = headerPath(line, git);
			const newPath = headerPath(lines[i + 1]!.replace(/\r$/, ""), git);
			// A git block already opened the file; jsdiff patches start a new file at each header pair.
			if (!file || file.hunks.length > 0 || pendingOld !== undefined) file = newFile();
			file.oldPath = oldPath;
			file.newPath = newPath;
			pendingOld = oldPath;
			i += 2;
			continue;
		}
		const m = HUNK.exec(line);
		if (m) {
			if (!file) file = newFile();
			const hunk: DiffHunk = {
				header: line,
				oldStart: Number(m[1]),
				oldLines: m[2] === undefined ? 1 : Number(m[2]),
				newStart: Number(m[3]),
				newLines: m[4] === undefined ? 1 : Number(m[4]),
				lines: [],
			};
			file.hunks.push(hunk);
			let oldNo = hunk.oldStart;
			let newNo = hunk.newStart;
			let oldLeft = hunk.oldLines;
			let newLeft = hunk.newLines;
			i++;
			while (i < lines.length && (oldLeft > 0 || newLeft > 0 || lines[i]!.startsWith("\\"))) {
				const body = lines[i]!.replace(/\r$/, "");
				const mark = body[0];
				if (mark === "\\") {
					const last = hunk.lines.at(-1);
					if (last) last.noNewline = true;
				} else if (mark === "+" && newLeft > 0) {
					hunk.lines.push({ kind: "add", text: body.slice(1), oldNo: null, newNo: newNo++ });
					newLeft--;
					file.add++;
				} else if (mark === "-" && oldLeft > 0) {
					hunk.lines.push({ kind: "del", text: body.slice(1), oldNo: oldNo++, newNo: null });
					oldLeft--;
					file.del++;
				} else if ((mark === " " || body === "") && oldLeft > 0 && newLeft > 0) {
					// Some tools strip the space of an empty context line.
					hunk.lines.push({ kind: "ctx", text: body.slice(1), oldNo: oldNo++, newNo: newNo++ });
					oldLeft--;
					newLeft--;
				} else break;
				i++;
			}
			continue;
		}
		// Index:, ===, index abc..def, new file mode, Binary files ... and anything else outside hunks.
		i++;
	}
	return files;
}

/** `+6 −2` style counts of a set of files. */
export function diffStat(files: readonly Pick<DiffFile, "add" | "del">[]): { add: number; del: number } {
	let add = 0;
	let del = 0;
	for (const f of files) {
		add += f.add;
		del += f.del;
	}
	return { add, del };
}
