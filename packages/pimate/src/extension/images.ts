import { constants } from "node:fs";
import { type FileHandle, open } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ViewImage } from "@pimate/protocol";
import { RcError } from "./dispatch.ts";

export const MAX_VIEW_IMAGE_BYTES = 2 * 1024 * 1024;
// 5 MiB decoded leaves room below the Host's 8 MiB outbound slow-consumer cutoff after base64.
export const MAX_VIEW_IMAGE_FALLBACK_BYTES = 5 * 1024 * 1024;
export const MAX_FILE_IMAGE_BYTES = 20 * 1024 * 1024;

export function imageMimeType(bytes: Buffer): ViewImage["mimeType"] | undefined {
	if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
	if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
	if (bytes.length >= 12 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP")
		return "image/webp";
	if (["GIF87a", "GIF89a"].includes(bytes.toString("latin1", 0, 6))) return "image/gif";
	return undefined;
}

/** The file is explicitly requested by an authenticated client; absolute paths and symlinks are allowed. */
export function resolveImagePath(path: string, cwd: string): string {
	try {
		if (path.startsWith("file://")) return fileURLToPath(path);
		return resolve(cwd, path.startsWith("~/") ? resolve(homedir(), path.slice(2)) : path);
	} catch {
		throw new RcError("unsupported", "Invalid image path");
	}
}

export async function viewImage(bytes: Buffer, mimeType: string): Promise<ViewImage> {
	if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mimeType))
		throw new RcError("unsupported", "Unsupported image format");
	if (bytes.length > MAX_FILE_IMAGE_BYTES) throw new RcError("unsupported", "Image exceeds read limit");
	if (bytes.length > MAX_VIEW_IMAGE_BYTES) {
		try {
			const pi = await import("@earendil-works/pi-coding-agent");
			const resized = await pi.resizeImage?.(bytes, mimeType, {
				maxWidth: 2048,
				maxHeight: 2048,
				// Pi's maxBytes measures base64, not decoded bytes.
				maxBytes: Math.floor(MAX_VIEW_IMAGE_BYTES / 3) * 4,
			});
			if (resized && Buffer.byteLength(resized.data, "base64") <= MAX_VIEW_IMAGE_BYTES)
				return {
					mimeType: resized.mimeType as ViewImage["mimeType"],
					data: resized.data,
					width: resized.width,
					height: resized.height,
				};
		} catch {
			// Older Pi runtimes or unavailable codecs still allow bounded originals.
		}
		if (bytes.length > MAX_VIEW_IMAGE_FALLBACK_BYTES) throw new RcError("unsupported", "Image could not be resized");
	}
	return { mimeType: mimeType as ViewImage["mimeType"], data: bytes.toString("base64") };
}

export async function fileImage(path: string, cwd: string): Promise<ViewImage> {
	const resolved = resolveImagePath(path, cwd);
	let file: FileHandle | undefined;
	try {
		// Nonblocking open avoids hanging on FIFOs before the regular-file check.
		file = await open(resolved, constants.O_RDONLY | constants.O_NONBLOCK);
		const stat = await file.stat();
		if (!stat.isFile() || stat.size > MAX_FILE_IMAGE_BYTES)
			throw new RcError("unsupported", "Not a bounded regular file");
		const chunks: Buffer[] = [];
		let size = 0;
		for await (const chunk of file.createReadStream({ end: MAX_FILE_IMAGE_BYTES, autoClose: false })) {
			size += chunk.length;
			if (size > MAX_FILE_IMAGE_BYTES) throw new RcError("unsupported", "Image exceeds read limit");
			chunks.push(chunk);
		}
		const bytes = Buffer.concat(chunks);
		const mimeType = imageMimeType(bytes);
		if (!mimeType) throw new RcError("unsupported", "Unsupported image format");
		return await viewImage(bytes, mimeType);
	} catch (error) {
		if (error instanceof RcError) throw error;
		const code = (error as NodeJS.ErrnoException).code;
		throw new RcError(
			code === "ENOENT" || code === "ENOTDIR" ? "not_found" : "unsupported",
			"Image file is unavailable",
		);
	} finally {
		await file?.close();
	}
}
