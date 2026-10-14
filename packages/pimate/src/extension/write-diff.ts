import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { PimateWriteDetails } from "@pimate/protocol";
import { createPatch } from "diff";

export const MAX_WRITE_BYTES = 256 * 1024;
type Snapshot = {
	tool: "write" | "edit";
	path?: string;
	/** Another write/edit to the same path was in flight: Pi runs a parallel batch's tool_call hooks before any
	 * execution, so this snapshot may predate an earlier mutation of the same file. */
	concurrent?: boolean;
	existed: boolean;
	text?: string;
	omitted?: PimateWriteDetails["pimate"]["omitted"];
};

/** Pi 1.2's resolveToCwd is not exported; mirror its normalization on our supported Unix hosts. */
export function resolveWritePath(path: string, cwd: string): string {
	const expand = (value: string) => {
		if (value === "~") return homedir();
		if (value.startsWith("~/")) return join(homedir(), value.slice(2));
		return value.startsWith("file://") ? fileURLToPath(value) : value;
	};
	return resolve(expand(cwd), expand(path.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ").replace(/^@/, "")));
}

async function capture(state: Snapshot): Promise<void> {
	// O_NONBLOCK avoids hanging on FIFOs; only regular files may be read for a display diff.
	const file = await open(state.path!, constants.O_RDONLY | constants.O_NONBLOCK);
	try {
		const stat = await file.stat();
		if (!stat.isFile()) return;
		if (stat.size > MAX_WRITE_BYTES) {
			state.omitted = "too_large";
			return;
		}
		// Read at most limit+1 even if another process grows the file after stat().
		const buffer = Buffer.alloc(MAX_WRITE_BYTES + 1);
		let size = 0;
		while (size < buffer.length) {
			const { bytesRead } = await file.read(buffer, size, buffer.length - size, size);
			if (!bytesRead) break;
			size += bytesRead;
		}
		if (size > MAX_WRITE_BYTES) state.omitted = "too_large";
		else if (buffer.subarray(0, size).includes(0)) state.omitted = "binary";
		else {
			state.text = buffer.toString("utf8", 0, size);
			state.omitted = undefined;
		}
	} finally {
		await file.close();
	}
}

/** Display metadata only: never replace tool content, block execution, or throw into Pi. */
export function registerWriteDiff(pi: ExtensionAPI): (() => void)[] {
	const pending = new Map<string, Snapshot>();
	const clear = () => pending.clear();
	return [
		pi.on("tool_call", async (event, ctx) => {
			if (event.toolName !== "write" && event.toolName !== "edit") return;
			// Unknown existence is conservatively true; false means confirmed ENOENT only.
			const state: Snapshot = { tool: event.toolName, existed: true, omitted: "unreadable" };
			pending.set(event.toolCallId, state);
			try {
				if (typeof event.input.path !== "string") return;
				state.path = resolveWritePath(event.input.path, ctx.cwd);
				// Synchronously, before any await: any same-path mutation still in flight makes the prior state inexact.
				for (const other of pending.values())
					if (other !== state && other.path === state.path) other.concurrent = state.concurrent = true;
				if (state.tool === "write") await capture(state);
			} catch (error) {
				if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
					state.existed = false;
					state.text = "";
					state.omitted = undefined;
				} else state.omitted = "unreadable";
			}
		}),
		pi.on("tool_result", (event, ctx) => {
			const state = pending.get(event.toolCallId);
			pending.delete(event.toolCallId);
			if (!state || event.toolName !== "write" || event.isError) return;
			// Only a plain object can carry our field without destroying another extension's details.
			const details = event.details;
			if (details !== undefined && (details === null || typeof details !== "object" || Array.isArray(details))) return;
			const pimate: PimateWriteDetails["pimate"] = {
				kind: "write_diff",
				existed: state.existed,
				omitted: state.concurrent ? "concurrent" : state.omitted,
			};
			try {
				const { path, content } = event.input;
				if (typeof path !== "string" || typeof content !== "string" || resolveWritePath(path, ctx.cwd) !== state.path)
					pimate.omitted = "unreadable";
				else if (Buffer.byteLength(content, "utf8") > MAX_WRITE_BYTES) pimate.omitted = "too_large";
				else if (content.includes("\0")) pimate.omitted = "binary";
				else if (!pimate.omitted && !state.concurrent) {
					// A pathological diff must not stall Pi for seconds despite the byte limit.
					pimate.patch = createPatch(path, state.text!, content, undefined, undefined, { context: 3, timeout: 100 });
					if (pimate.patch === undefined) pimate.omitted = "unreadable";
				}
			} catch {
				pimate.patch = undefined;
				pimate.omitted = "unreadable";
			}
			try {
				return { details: { ...details, pimate } };
			} catch {
				// A third-party details object may contain getters that throw during the merge: leave it untouched.
				return;
			}
		}),
		pi.on("session_start", clear),
		pi.on("session_shutdown", clear),
		// A later extension can block a call before Pi emits tool_result.
		pi.on("agent_settled", clear),
		clear,
	];
}
