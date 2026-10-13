import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { closeSync, linkSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join, resolve } from "node:path";
import type { PairResponse } from "@pimate/protocol";
import { privateRunDir } from "../runtime.ts";

export interface Device {
	deviceId: string;
	name: string;
	tokenHash: string;
	createdAt: number;
	lastSeenAt: number;
}
export const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
export function resolveConfigDir(env = process.env): string {
	return resolve(env.PIMATE_CONFIG_DIR || join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "pimate"));
}
function atomicWrite(path: string, value: unknown): void {
	const temp = `${path}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temp, JSON.stringify(value), { mode: 0o600, flag: "wx" });
		renameSync(temp, path);
	} finally {
		rmSync(temp, { force: true });
	}
}
export class PairingError extends Error {
	readonly code: "invalid_code" | "expired_code";
	constructor(code: "invalid_code" | "expired_code") {
		super(code);
		this.code = code;
	}
}
export class HostConfig {
	readonly dir: string;
	readonly host: { hostId: string; name: string };
	constructor(dir = resolveConfigDir()) {
		this.dir = dir;
		privateRunDir(dir);
		privateRunDir(join(dir, "pairing"));
		const path = join(dir, "host.json");
		const temp = `${path}.${randomUUID()}.tmp`;
		try {
			writeFileSync(temp, JSON.stringify({ hostId: randomUUID(), name: hostname() }), { mode: 0o600, flag: "wx" });
			try {
				linkSync(temp, path);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			}
		} finally {
			rmSync(temp, { force: true });
		}
		this.host = JSON.parse(readFileSync(path, "utf8"));
	}
	devices(): Device[] {
		try {
			return JSON.parse(readFileSync(join(this.dir, "devices.json"), "utf8"));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
			throw error;
		}
	}
	private update<T>(fn: (devices: Device[]) => T): T {
		// Serialize CLI/server writers across processes; fail rather than overwrite a concurrent revocation.
		const lock = join(this.dir, "devices.lock");
		const fd = openSync(lock, "wx", 0o600);
		try {
			const devices = this.devices();
			const result = fn(devices);
			atomicWrite(join(this.dir, "devices.json"), devices);
			return result;
		} finally {
			closeSync(fd);
			rmSync(lock, { force: true });
		}
	}
	createCode(expiresAt = Date.now() + 10 * 60_000): string {
		const code = randomBytes(24).toString("base64url");
		writeFileSync(join(this.dir, "pairing", `${hash(code)}.json`), JSON.stringify({ expiresAt }), {
			mode: 0o600,
			flag: "wx",
		});
		return code;
	}
	pair(code: string, name: string): PairResponse {
		return this.update((devices) => {
			const path = join(this.dir, "pairing", `${hash(code)}.json`);
			const claimed = `${path}.${randomUUID()}.claimed`;
			try {
				renameSync(path, claimed);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new PairingError("invalid_code");
				throw error;
			}
			try {
				const pending = JSON.parse(readFileSync(claimed, "utf8"));
				if (!Number.isFinite(pending.expiresAt) || pending.expiresAt <= Date.now())
					throw new PairingError("expired_code");
			} finally {
				rmSync(claimed, { force: true });
			}
			const token = randomBytes(32).toString("base64url");
			const deviceId = randomUUID();
			devices.push({ deviceId, name, tokenHash: hash(token), createdAt: Date.now(), lastSeenAt: Date.now() });
			return { hostId: this.host.hostId, hostName: this.host.name, deviceId, token };
		});
	}
	authenticate(token: string): Device | undefined {
		const digest = Buffer.from(hash(token), "hex");
		return this.devices().find((device) => {
			const stored = Buffer.from(device.tokenHash, "hex");
			return stored.length === digest.length && timingSafeEqual(stored, digest);
		});
	}
	touch(deviceId: string): void {
		const current = this.devices().find((device) => device.deviceId === deviceId);
		if (!current || Date.now() - current.lastSeenAt < 60_000) return;
		this.update((devices) => {
			const device = devices.find((d) => d.deviceId === deviceId);
			if (device) device.lastSeenAt = Date.now();
		});
	}
	revoke(deviceId: string): void {
		this.update((devices) => {
			const i = devices.findIndex((device) => device.deviceId === deviceId);
			if (i >= 0) devices.splice(i, 1);
		});
	}
}
