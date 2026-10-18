/** Folder completion for the new Pi screen: list the typed parent on the Host, filter by the last segment here. */

/** "~/code/pr" -> { parent: "~/code/", prefix: "pr" }. Null until an absolute or `~/` folder is typed. */
export function splitPath(text: string): { parent: string; prefix: string } | null {
	const i = text.lastIndexOf("/");
	const parent = text.slice(0, i + 1);
	if (i < 0 || !(parent.startsWith("/") || parent.startsWith("~/"))) return null;
	return { parent, prefix: text.slice(i + 1) };
}

/** Names starting with the prefix (case-insensitive); hidden folders only once a "." is typed, as in a shell. */
export function matchDirs(names: string[], prefix: string, limit = 8): string[] {
	const p = prefix.toLowerCase();
	return names
		.filter((n) => (p.startsWith(".") || !n.startsWith(".")) && n.toLowerCase().startsWith(p))
		.slice(0, limit);
}
