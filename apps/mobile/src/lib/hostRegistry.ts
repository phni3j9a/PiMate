/**
 * Paired hosts, persisted in a key-value store (expo-secure-store in the app, a Map in tests).
 *
 * Layout: an index key holding the hostIds, plus one key per host holding its record (incl. the device token).
 * SecureStore keys may only contain `[A-Za-z0-9._-]`, so hostIds outside that set are hex-encoded.
 */

export interface KeyValueStorage {
	getItem(key: string): Promise<string | null>;
	setItem(key: string, value: string): Promise<void>;
	deleteItem(key: string): Promise<void>;
}

export interface PairedHost {
	hostId: string;
	hostName: string;
	/** `host:port` */
	address: string;
	deviceId: string;
	token: string;
	pairedAt: number;
	/** The Host rejected the token (revoked / invalid): don't connect until paired again. */
	needsRepair?: boolean;
}

export interface Selection {
	hostId: string;
	instanceId: string;
}

export const INDEX_KEY = "pimate.hosts";
export const SELECTION_KEY = "pimate.selection";
export const SPAWN_PREFS_KEY = "pimate.spawnPrefs";

/** Last switch values of the New Pi screen (off until changed). */
export interface SpawnPrefs {
	askTool: boolean;
}

function hex(text: string): string {
	let out = "";
	for (const byte of new TextEncoder().encode(text)) out += byte.toString(16).padStart(2, "0");
	return out;
}

/** Storage key for one host's record; always within SecureStore's key charset. */
export function hostKey(hostId: string): string {
	return /^[A-Za-z0-9_-]{1,100}$/.test(hostId) ? `pimate.host.${hostId}` : `pimate.hostx.${hex(hostId).slice(0, 200)}`;
}

function isHost(value: unknown): value is PairedHost {
	const v = value as PairedHost;
	return (
		!!v &&
		typeof v.hostId === "string" &&
		typeof v.hostName === "string" &&
		typeof v.address === "string" &&
		typeof v.deviceId === "string" &&
		typeof v.token === "string"
	);
}

function parse(text: string | null): unknown {
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

export class HostRegistry {
	private readonly storage: KeyValueStorage;

	constructor(storage: KeyValueStorage) {
		this.storage = storage;
	}

	private async ids(): Promise<string[]> {
		const value = parse(await this.storage.getItem(INDEX_KEY));
		return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
	}

	/** All readable hosts in pairing order. Records that fail to load are skipped (and left in place). */
	async load(): Promise<PairedHost[]> {
		const hosts: PairedHost[] = [];
		for (const id of await this.ids()) {
			const value = parse(await this.storage.getItem(hostKey(id)));
			if (isHost(value) && value.hostId === id) hosts.push(value);
		}
		return hosts;
	}

	/** Adds or replaces (same hostId) a host. The record is written before the index. */
	async save(host: PairedHost): Promise<void> {
		await this.storage.setItem(hostKey(host.hostId), JSON.stringify(host));
		const ids = await this.ids();
		if (!ids.includes(host.hostId)) await this.storage.setItem(INDEX_KEY, JSON.stringify([...ids, host.hostId]));
	}

	async remove(hostId: string): Promise<void> {
		const ids = await this.ids();
		await this.storage.setItem(INDEX_KEY, JSON.stringify(ids.filter((id) => id !== hostId)));
		await this.storage.deleteItem(hostKey(hostId));
	}

	async loadSelection(): Promise<Selection | null> {
		const value = parse(await this.storage.getItem(SELECTION_KEY)) as Selection | null;
		return value && typeof value.hostId === "string" && typeof value.instanceId === "string" ? value : null;
	}

	async saveSelection(selection: Selection | null): Promise<void> {
		if (selection) await this.storage.setItem(SELECTION_KEY, JSON.stringify(selection));
		else await this.storage.deleteItem(SELECTION_KEY);
	}

	async loadSpawnPrefs(): Promise<SpawnPrefs> {
		const value = parse(await this.storage.getItem(SPAWN_PREFS_KEY)) as Partial<SpawnPrefs> | null;
		return { askTool: value?.askTool === true };
	}

	async saveSpawnPrefs(prefs: SpawnPrefs): Promise<void> {
		await this.storage.setItem(SPAWN_PREFS_KEY, JSON.stringify(prefs));
	}
}

/** In-memory storage for tests and previews. */
export class MemoryStorage implements KeyValueStorage {
	readonly map = new Map<string, string>();
	async getItem(key: string) {
		return this.map.get(key) ?? null;
	}
	async setItem(key: string, value: string) {
		if (!/^[A-Za-z0-9._-]+$/.test(key)) throw new Error(`Invalid key: ${key}`);
		this.map.set(key, value);
	}
	async deleteItem(key: string) {
		this.map.delete(key);
	}
}
