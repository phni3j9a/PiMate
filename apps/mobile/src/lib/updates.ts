/** Version compare and the app release check against GitHub (no React Native imports). */

// shortcut: one page only (app and PC releases alternate, so 100 covers ~50 PC releases between app ones), paginate if that ever stops holding.
const RELEASES_URL = "https://api.github.com/repos/phni3j9a/PiMate/releases?per_page=100";

/** `latest` is a newer `x.y.z` than `current`; anything else (pre-release suffixes, garbage) is not newer. */
export function newer(latest: string, current: string): boolean {
	if (!/^\d+\.\d+\.\d+$/.test(latest) || !/^\d+\.\d+\.\d+$/.test(current)) return false;
	const a = latest.split(".").map((n) => n.replace(/^0+/, "") || "0");
	const b = current.split(".").map((n) => n.replace(/^0+/, "") || "0");
	for (let i = 0; i < 3; i++)
		if (a[i] !== b[i]) return a[i].length !== b[i].length ? a[i].length > b[i].length : a[i] > b[i];
	return false;
}

export type AppUpdate = { kind: "latest" } | { kind: "available"; version: string; url: string } | { kind: "error" };

type FetchLike = (
	url: string,
	init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<{
	ok: boolean;
	json(): Promise<unknown>;
}>;

/** The newest published `app-vX.Y.Z` release compared with `current`; any failure is `error`. */
export async function checkAppUpdate(current: string, fetch: FetchLike, timeoutMs = 10_000): Promise<AppUpdate> {
	const abort = new AbortController();
	const timer = setTimeout(() => abort.abort(), timeoutMs);
	try {
		const res = await fetch(RELEASES_URL, {
			headers: { Accept: "application/vnd.github+json" },
			signal: abort.signal,
		});
		if (!res.ok) return { kind: "error" };
		const list = await res.json();
		if (!Array.isArray(list)) return { kind: "error" };
		for (const r of list) {
			if (!r || typeof r !== "object" || r.draft !== false || r.prerelease !== false) continue;
			const version = /^app-v(\d+\.\d+\.\d+)$/.exec(String(r.tag_name))?.[1];
			if (!version) continue;
			if (!newer(version, current)) return { kind: "latest" };
			// Only ever open this repository's release page.
			const url = String(r.html_url);
			return url.startsWith("https://github.com/phni3j9a/PiMate/")
				? { kind: "available", version, url }
				: { kind: "error" };
		}
		return { kind: "error" };
	} catch {
		return { kind: "error" };
	} finally {
		clearTimeout(timer);
	}
}
