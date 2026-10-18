import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import type { SubagentTranscript, TranscriptItem } from "@pimate/protocol";
import { normalizeMessage } from "../transcript.ts";
import { record, string } from "./normalize.ts";

export const TRANSCRIPT_LIMIT = 256 * 1024;
function content(message: Record<string, any>): string {
	return typeof message.content === "string"
		? message.content
		: Array.isArray(message.content)
			? message.content
					.filter((c: any) => c?.type === "text")
					.map((c: any) => c.text ?? "")
					.join("")
			: "";
}
function item(message: unknown, id: string, task?: string): TranscriptItem | null {
	const m = record(message);
	if (
		!["user", "assistant", "toolResult"].includes(m.role) ||
		(m.role === "user" && (content(m) === task || content(m) === `Task: ${task}`))
	)
		return null;
	// Child images have no entry_image endpoint and must not crowd out the bounded transcript text.
	return normalizeMessage(m, id, 0);
}
export function exampleTranscript(messages: unknown[], task: string | undefined, cursor?: string): SubagentTranscript {
	let offset = 0;
	try {
		offset = Number(Buffer.from(cursor ?? "", "base64url").toString());
	} catch {
		/* restart */
	}
	if (!Number.isSafeInteger(offset) || offset < 0 || offset > messages.length) offset = 0;
	const reply: SubagentTranscript = { task: task?.slice(0, 32768), items: [], cursor: "" };
	let bytes = Buffer.byteLength(JSON.stringify(reply));
	for (; offset < messages.length; offset++) {
		const normalized = item(messages[offset], `message:${offset}`, task);
		if (!normalized) continue;
		const size = Buffer.byteLength(JSON.stringify(normalized));
		if (bytes + size > TRANSCRIPT_LIMIT - 1024) {
			reply.truncated = true;
			if (!reply.items.length) continue;
			break;
		}
		reply.items.push(normalized);
		bytes += size + 1;
	}
	reply.cursor = Buffer.from(String(offset)).toString("base64url");
	return reply;
}

/** Cursor contains only a file identity hash and byte offset, never a client-selected path. */
export async function tailTranscript(path: string, cursor?: string, knownTask?: string): Promise<SubagentTranscript> {
	const file = await open(path, "r");
	try {
		const stat = await file.stat();
		const key = createHash("sha256")
			.update(`${path}:${stat.dev}:${stat.ino}:${stat.birthtimeMs}`)
			.digest("hex")
			.slice(0, 24);
		let old: Record<string, any> = {};
		try {
			old = record(JSON.parse(Buffer.from(cursor ?? "", "base64url").toString()));
		} catch {
			/* restart */
		}
		let offset =
			old.key === key && Number.isSafeInteger(old.offset) && old.offset >= 0 && old.offset <= stat.size
				? old.offset
				: 0;
		let skip = offset > 0 && old.skip === true;
		const buffer = Buffer.alloc(Math.min(TRANSCRIPT_LIMIT, stat.size - offset));
		const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
		const data = buffer.subarray(0, bytesRead);
		const reply: SubagentTranscript = { items: [], cursor: "", task: knownTask?.slice(0, 32768) };
		let bytes = Buffer.byteLength(JSON.stringify(reply));
		let position = 0;
		while (position < data.length) {
			const end = data.indexOf(10, position);
			if (end < 0) {
				// A normal partial line stays unread until its newline arrives. Oversized records are discarded in bounded chunks.
				if (skip || (position === 0 && data.length === TRANSCRIPT_LIMIT)) {
					offset += data.length - position;
					skip = true;
					reply.truncated = true;
				}
				break;
			}
			const length = end - position + 1;
			if (!skip) {
				try {
					const r = record(JSON.parse(data.subarray(position, end).toString("utf8")));
					if (r.recordType === "truncated") reply.truncated = true;
					if (r.recordType === "message") {
						if (r.sourceEventType === "initial_prompt") {
							knownTask = string(r.text) ?? content(record(r.message));
							reply.task = knownTask.slice(0, 32768);
							bytes += Buffer.byteLength(JSON.stringify(reply.task));
						} else {
							const message = record(r.message);
							// Newer builds redact initial_prompt, but may still record the initial user message.
							if (
								knownTask?.startsWith("[prompt redacted]") &&
								message.role === "user" &&
								content(message).startsWith("Task: ")
							) {
								knownTask = content(message).slice(6);
								reply.task = knownTask.slice(0, 32768);
								bytes = Buffer.byteLength(JSON.stringify(reply));
							}
							const normalized = item(r.message, `${key}:${offset}`, knownTask);
							if (normalized) {
								const size = Buffer.byteLength(JSON.stringify(normalized));
								if (bytes + size > TRANSCRIPT_LIMIT - 1024) {
									reply.truncated = true;
									if (reply.items.length) break;
									// A single record cannot fit even on an empty page: skip it, do not stall the cursor.
									position = end + 1;
									offset += length;
									continue;
								}
								reply.items.push(normalized);
								bytes += size + 1;
							}
						}
					}
				} catch {
					reply.truncated = true;
				}
			}
			skip = false;
			position = end + 1;
			offset += length;
		}
		if (offset < stat.size && data.length === TRANSCRIPT_LIMIT) reply.truncated = true;
		reply.cursor = Buffer.from(JSON.stringify({ key, offset, ...(skip ? { skip } : {}) })).toString("base64url");
		return reply;
	} finally {
		await file.close();
	}
}
