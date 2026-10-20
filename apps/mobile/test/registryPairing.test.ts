import type { PairingLink } from "@pimate/protocol";
import { describe, expect, it } from "vitest";
import {
	HostRegistry,
	hostKey,
	INDEX_KEY,
	MemoryStorage,
	type PairedHost,
	SPAWN_PREFS_KEY,
} from "../src/lib/hostRegistry";
import { formatPairingLink, type PairingFailure, pairWithHost, parsePairingLink } from "../src/lib/pairing";

const host = (id: string, patch: Partial<PairedHost> = {}): PairedHost => ({
	hostId: id,
	hostName: `name-${id}`,
	address: "127.0.0.1:47800",
	deviceId: "dev",
	token: "secret",
	pairedAt: 1,
	...patch,
});

describe("HostRegistry", () => {
	it("persists hosts under an index key plus one key per host", async () => {
		const storage = new MemoryStorage();
		const reg = new HostRegistry(storage);
		await reg.save(host("6f1c2a8e-0000-4000-8000-000000000001"));
		await reg.save(host("b"));
		await reg.save(host("b", { hostName: "renamed" }));
		expect(JSON.parse(storage.map.get(INDEX_KEY)!)).toEqual(["6f1c2a8e-0000-4000-8000-000000000001", "b"]);
		const loaded = await new HostRegistry(storage).load();
		expect(loaded.map((h) => h.hostName)).toEqual(["name-6f1c2a8e-0000-4000-8000-000000000001", "renamed"]);
		await reg.remove("6f1c2a8e-0000-4000-8000-000000000001");
		expect((await reg.load()).map((h) => h.hostId)).toEqual(["b"]);
		expect([...storage.map.keys()].sort()).toEqual(["pimate.host.b", INDEX_KEY]);
	});

	it("keeps storage keys within the SecureStore charset", async () => {
		const storage = new MemoryStorage();
		const reg = new HostRegistry(storage);
		await reg.save(host("weird id/ä:1"));
		expect(hostKey("weird id/ä:1")).toMatch(/^[A-Za-z0-9._-]+$/);
		expect((await reg.load())[0].hostId).toBe("weird id/ä:1");
	});

	it("skips unreadable records and remembers the selection", async () => {
		const storage = new MemoryStorage();
		await storage.setItem(INDEX_KEY, JSON.stringify(["x", "y"]));
		await storage.setItem(hostKey("x"), "{not json");
		await storage.setItem(hostKey("y"), JSON.stringify(host("y")));
		const reg = new HostRegistry(storage);
		expect((await reg.load()).map((h) => h.hostId)).toEqual(["y"]);
		expect(await reg.loadSelection()).toBeNull();
		await reg.saveSelection({ hostId: "y", instanceId: "i" });
		expect(await reg.loadSelection()).toEqual({ hostId: "y", instanceId: "i" });
		await reg.saveSelection(null);
		expect(await reg.loadSelection()).toBeNull();
		expect(await reg.loadSpawnPrefs()).toEqual({ askTool: false });
		await reg.saveSpawnPrefs({ askTool: true });
		expect(await reg.loadSpawnPrefs()).toEqual({ askTool: true });
		await storage.setItem(SPAWN_PREFS_KEY, "{not json");
		expect(await reg.loadSpawnPrefs()).toEqual({ askTool: false });
	});
});

const link: PairingLink = {
	address: "127.0.0.1:47800",
	code: "AbCdEfGhIjKlMnOpQrStUvWx",
	hostName: "server",
	hostId: "h1",
};

function reply(status: number, body: unknown) {
	return async () => ({ status, json: async () => body });
}

describe("pairing", () => {
	it("parses the pairing link from the QR code", () => {
		expect(parsePairingLink(formatPairingLink(link))).toEqual(link);
		expect(parsePairingLink("https://example.com")).toBeNull();
	});

	it("posts the code and device name", async () => {
		let seen: { url: string; body: unknown } | null = null;
		const res = await pairWithHost(link, "Pixel 9", async (url, init) => {
			seen = { url, body: JSON.parse(init.body) };
			return { status: 200, json: async () => ({ hostId: "h1", hostName: "srv", deviceId: "d1", token: "t" }) };
		});
		expect(seen).toEqual({ url: "http://127.0.0.1:47800/pair", body: { code: link.code, deviceName: "Pixel 9" } });
		expect(res).toEqual({ hostId: "h1", hostName: "srv", deviceId: "d1", token: "t" });
	});

	it("maps Host errors", async () => {
		const kind = async (fetch: Parameters<typeof pairWithHost>[2]) => {
			try {
				await pairWithHost(link, "p", fetch, 50);
				return "ok";
			} catch (e) {
				return (e as PairingFailure).kind;
			}
		};
		expect(await kind(reply(401, { error: "invalid_code" }))).toBe("invalid_code");
		expect(await kind(reply(410, { error: "expired_code" }))).toBe("expired_code");
		expect(await kind(reply(400, { error: "bad_request" }))).toBe("bad_request");
		expect(await kind(reply(410, null))).toBe("expired_code");
		expect(await kind(reply(500, {}))).toBe("unexpected");
		expect(await kind(reply(200, { hostId: "other", hostName: "x", deviceId: "d", token: "t" }))).toBe("host_mismatch");
		expect(await kind(reply(200, { nope: 1 }))).toBe("unexpected");
		expect(
			await kind(async () => {
				throw new TypeError("Network request failed");
			}),
		).toBe("unreachable");
		expect(await kind(() => new Promise(() => {}))).toBe("timeout");
	});
});
