import type { SubagentTranscript, TranscriptItem } from "@pimate/protocol";
import { describe, expect, it, vi } from "vitest";
import type { Result } from "../src/lib/store";
import { RECORD_PAGE_LIMIT, SubagentRecordLoader } from "../src/lib/subagentRecord";

const item = (id: string): TranscriptItem => ({ kind: "user", entryId: id, text: id });
const page = (cursor: string, items: TranscriptItem[] = [], truncated = false): Result<SubagentTranscript> => ({
	ok: true,
	value: { cursor, items, truncated },
});
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe("subagent work record lifecycle", () => {
	it.each(["run", "child", "session", "A → B → A"])(
		"drops in-flight results and pending refresh on %s change",
		async () => {
			const response = deferred<Result<SubagentTranscript>>();
			const oldChange = vi.fn();
			const oldFetch = vi.fn(() => response.promise);
			const old = new SubagentRecordLoader(oldFetch, oldChange);
			const loading = old.load();
			await old.load(); // A run update queues another fetch while this one is pending.
			old.dispose();

			const nextChange = vi.fn();
			const nextFetch = vi.fn(async (cursor?: string) => page(cursor ?? "new-cursor", [item("new")]));
			const next = new SubagentRecordLoader(nextFetch, nextChange);
			await next.load();
			response.resolve(page("old-cursor", [item("old")], true));
			expect(await loading).toBe(false);
			expect(oldChange).not.toHaveBeenCalled();
			expect(oldFetch).toHaveBeenCalledTimes(1);
			expect(await old.load()).toBe(false);
			expect(nextFetch.mock.calls).toEqual([[undefined], ["new-cursor"]]);
			expect(nextChange.mock.lastCall?.[0]).toMatchObject({ cursor: "new-cursor", items: [item("new")] });
		},
	);

	it("drops stale errors too", async () => {
		const response = deferred<Result<SubagentTranscript>>();
		const change = vi.fn();
		const loader = new SubagentRecordLoader(() => response.promise, change);
		const loading = loader.load();
		loader.dispose();
		response.resolve({ ok: false, title: "old error", text: "old" });
		await loading;
		expect(change).not.toHaveBeenCalled();
	});

	it("drains finished records without run updates, including pages with no displayable items", async () => {
		const fetch = vi
			.fn<(cursor?: string) => Promise<Result<SubagentTranscript>>>()
			.mockResolvedValueOnce({
				ok: true,
				value: { task: "task", cursor: "a", items: [item("first")], truncated: true },
			})
			.mockResolvedValueOnce(page("b", [], true))
			.mockResolvedValueOnce(page("c", [item("first"), item("last")]))
			.mockResolvedValueOnce(page("c"));
		const change = vi.fn();
		const loader = new SubagentRecordLoader(fetch, change);
		expect(await loader.load()).toBe(false);
		expect(fetch.mock.calls).toEqual([[undefined], ["a"], ["b"], ["c"]]);
		expect(change.mock.calls.every(([record]) => !record.hasMore)).toBe(true);
		expect(change.mock.lastCall?.[0]).toEqual({
			task: "task",
			cursor: "c",
			items: [item("first"), item("last")],
			truncated: true,
			loaded: true,
			hasMore: false,
			error: null,
		});
	});

	it("caps advancing pages and exposes manual continuation from the last cursor", async () => {
		let count = 0;
		const fetch = vi.fn(async (_cursor?: string) => {
			count++;
			return page(`cursor-${count}`, [item(`${count}`)], true);
		});
		const change = vi.fn();
		const loader = new SubagentRecordLoader(fetch, change);
		await loader.load();
		expect(fetch).toHaveBeenCalledTimes(RECORD_PAGE_LIMIT);
		expect(change.mock.lastCall?.[0]).toMatchObject({ hasMore: true, cursor: `cursor-${RECORD_PAGE_LIMIT}` });
		await loader.load();
		expect(fetch.mock.calls[RECORD_PAGE_LIMIT]).toEqual([`cursor-${RECORD_PAGE_LIMIT}`]);
		expect(change.mock.lastCall?.[0].items).toHaveLength(RECORD_PAGE_LIMIT * 2);
	});

	it.each(["fixed", ""])("stops when the cursor does not advance (%s), even if truncated", async (cursor) => {
		const fetch = vi.fn(async () => page(cursor, [], true));
		const change = vi.fn();
		await new SubagentRecordLoader(fetch, change).load();
		expect(fetch).toHaveBeenCalledTimes(cursor ? 2 : 1);
		expect(change.mock.lastCall?.[0].hasMore).toBe(false);
	});

	it("preserves the record and cursor on error so retry can continue", async () => {
		const fetch = vi
			.fn<(cursor?: string) => Promise<Result<SubagentTranscript>>>()
			.mockResolvedValueOnce(page("a", [item("first")], true))
			.mockResolvedValueOnce({ ok: false, title: "failed", text: "retry" })
			.mockResolvedValueOnce(page("b", [item("last")]))
			.mockResolvedValueOnce(page("b"));
		const change = vi.fn();
		const loader = new SubagentRecordLoader(fetch, change);
		await loader.load();
		expect(change.mock.lastCall?.[0]).toMatchObject({
			cursor: "a",
			items: [item("first")],
			error: { title: "failed" },
		});
		await loader.load();
		expect(fetch.mock.calls).toEqual([[undefined], ["a"], ["a"], ["b"]]);
		expect(change.mock.lastCall?.[0]).toMatchObject({ items: [item("first"), item("last")], error: null });
	});

	it("coalesces concurrent updates into one re-fetch request, then clears it", async () => {
		const response = deferred<Result<SubagentTranscript>>();
		const fetch = vi.fn(() => response.promise);
		const loader = new SubagentRecordLoader(fetch, vi.fn());
		const loading = loader.load();
		await loader.load();
		await loader.load();
		response.resolve(page(""));
		expect(await loading).toBe(true);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(await loader.load()).toBe(false);
	});
});
