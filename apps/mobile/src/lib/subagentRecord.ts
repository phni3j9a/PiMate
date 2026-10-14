import type { SubagentTranscript, TranscriptItem } from "@pimate/protocol";
import type { Result } from "./store";
import { mergeTranscript } from "./subagentRows";

export interface WorkRecord {
	task?: string;
	items: TranscriptItem[];
	cursor?: string;
	truncated: boolean;
	loaded: boolean;
	hasMore: boolean;
	error: { title: string; text: string } | null;
}

export const EMPTY_RECORD: WorkRecord = {
	items: [],
	truncated: false,
	loaded: false,
	hasMore: false,
	error: null,
};

export const RECORD_PAGE_LIMIT = 8;

/** One target's fetch/merge lifecycle. Dispose when leaving it, even if the next target has the same IDs. */
export class SubagentRecordLoader {
	private record = EMPTY_RECORD;
	private disposed = false;
	private fetching = false;
	private again = false;

	constructor(
		private readonly fetchPage: (cursor?: string) => Promise<Result<SubagentTranscript>>,
		private readonly onChange: (record: WorkRecord) => void,
	) {}

	dispose(): void {
		this.disposed = true;
		this.again = false;
	}

	/** Returns whether an update arrived during the fetch and needs a throttled re-fetch. */
	async load(): Promise<boolean> {
		if (this.disposed) return false;
		if (this.fetching) {
			this.again = true;
			return false;
		}
		this.fetching = true;
		try {
			for (let page = 0; page < RECORD_PAGE_LIMIT; page++) {
				const cursor = this.record.cursor;
				const res = await this.fetchPage(cursor);
				if (this.disposed) return false;
				if (!res.ok) {
					this.record = { ...this.record, loaded: true, error: { title: res.title, text: res.text } };
					this.onChange(this.record);
					break;
				}
				// `truncated` also marks dropped records, not just page boundaries. Never decode the opaque cursor.
				const hasMore = !!res.value.cursor && res.value.cursor !== cursor;
				this.record = {
					task: res.value.task ?? this.record.task,
					items: cursor ? mergeTranscript(this.record.items, res.value.items) : res.value.items,
					cursor: res.value.cursor || cursor,
					truncated: this.record.truncated || res.value.truncated === true,
					loaded: true,
					hasMore: hasMore && page === RECORD_PAGE_LIMIT - 1,
					error: null,
				};
				this.onChange(this.record);
				if (!hasMore) break;
			}
		} finally {
			this.fetching = false;
		}
		const again = this.again;
		this.again = false;
		return again;
	}
}
