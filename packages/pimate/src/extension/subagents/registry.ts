import { randomUUID } from "node:crypto";
import { type FSWatcher, watch } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ParamsOf, SubagentAction, SubagentRun, SubagentsState, SubagentTranscript } from "@pimate/protocol";
import { countSubagents, isSubagentActive } from "@pimate/protocol";
import { RcError } from "../dispatch.ts";
import type { Hub } from "../hub.ts";
import { classify, list, normalizeStatus, normalizeTool, number, record, string } from "./normalize.ts";
import { exampleTranscript, tailTranscript } from "./transcript.ts";

export function rpc(pi: ExtensionAPI, method: string, params: unknown = {}, timeoutMs = 15000): Promise<unknown> {
	const requestId = randomUUID();
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			off();
			reject(new RcError("timeout", "pi-subagents RPC timed out"));
		}, timeoutMs);
		timer.unref();
		const off = pi.events.on(`subagents:rpc:v1:reply:${requestId}`, (reply) => {
			clearTimeout(timer);
			off();
			resolve(reply);
		});
		try {
			pi.events.emit("subagents:rpc:v1:request", { version: 1, requestId, method, params });
		} catch (error) {
			clearTimeout(timer);
			off();
			reject(error);
		}
	});
}
async function json(path: string): Promise<Record<string, any>> {
	if ((await stat(path)).size > 2 * 1024 * 1024) throw new Error("Subagent status artifact too large");
	return record(JSON.parse(await readFile(path, "utf8")));
}
interface Source {
	dir?: string;
	children: Record<string, any>[];
	details?: unknown;
	parentRunId?: string;
	parallelTasks?: boolean;
}
export class SubagentRegistry {
	private h: Hub;
	private runs = new Map<string, SubagentRun>();
	private sources = new Map<string, Source>();
	private tools = new Map<string, { startedAt: number; running: boolean }>();
	private backends: SubagentsState["backends"] = [];
	private watchers = new Map<string, FSWatcher>();
	private pending = new Map<string, NodeJS.Timeout>();
	private lastEmitted = new Map<string, number>();
	private reading = new Set<string>();
	private reread = new Set<string>();
	private stopping = new Map<string, Set<string>>();
	private safety?: NodeJS.Timeout;
	private refreshTimer?: NodeJS.Timeout;
	private refreshing = false;
	private refreshAgain = false;
	private disposed = false;
	private counts = "";
	private projected = new Map<string, SubagentRun>();
	private sessionId?: string;
	private sessionFile?: string;
	constructor(h: Hub) {
		this.h = h;
		this.sessionId = h.session?.id;
		this.sessionFile = h.session?.file;
	}
	snapshot(): SubagentsState {
		return { runs: this.project(), backends: this.backends };
	}
	/** Resolve only explicit backend references; never infer a child run or transcript filename. */
	private target(runId: string, index: number) {
		const source = this.sources.get(runId)?.children.find((s, i) => (s.index ?? i) === index) ?? {};
		const nested = typeof source.runId === "string" && source.runId !== runId ? this.runs.get(source.runId) : undefined;
		if (nested?.mode === "single" && nested.children.length === 1) {
			const child = nested.children[0]!;
			return {
				run: nested,
				child,
				source: this.sources.get(nested.id)?.children.find((s, i) => (s.index ?? i) === child.index) ?? {},
				nested: true,
			};
		}
		return {
			run: this.runs.get(runId)!,
			child: this.runs.get(runId)?.children.find((c) => c.index === index),
			source,
			nested: false,
		};
	}
	private project(): SubagentRun[] {
		const hidden = new Set<string>();
		for (const [id, source] of this.sources) {
			if (source.parentRunId && source.parentRunId !== id && this.runs.has(source.parentRunId)) hidden.add(id);
			if (this.runs.get(id)?.mode === "workflow")
				for (const child of source.children) {
					if (typeof child.runId === "string" && child.runId !== id) hidden.add(child.runId);
				}
		}
		return [...this.runs.values()]
			.filter((r) => !hidden.has(r.id))
			.map((run) => {
				if (run.mode !== "workflow") return run;
				const children = run.children.map((child) => {
					const target = this.target(run.id, child.index);
					if (!target.nested || !target.child)
						return typeof target.source.runId === "string" ? { ...child, actions: [] } : child;
					const actions: SubagentAction[] = [...target.child.actions];
					if (target.run.actions.includes("stop") && isSubagentActive(target.child.state)) actions.push("stop_child");
					return {
						...target.child,
						id: child.id,
						index: child.index,
						state:
							run.state === "stopping" && isSubagentActive(target.child.state)
								? ("stopping" as const)
								: target.child.state,
						actions: run.state === "stopping" ? [] : actions,
					};
				});
				// Child totals replace the wrapper's totals, not add to them. Cost may arrive on the wrapper first.
				const usage = { ...run.usage };
				for (const key of ["input", "output", "total", "costUsd"] as const) {
					if (children.length && children.every((c) => c.usage?.[key] !== undefined))
						usage[key] = children.reduce((sum, c) => sum + c.usage![key]!, 0);
				}
				return {
					...run,
					mode: this.sources.get(run.id)?.parallelTasks ? ("parallel" as const) : ("workflow" as const),
					children,
					usage: Object.keys(usage).length ? usage : undefined,
				};
			});
	}

	private emitReset(): void {
		this.h.emit({ type: "subagents_reset", state: this.snapshot() });
	}
	private backend(backend: "pi-subagents" | "example", supported: boolean): void {
		const prior = this.backends.find((b) => b.backend === backend);
		if (prior?.supported === supported) return;
		this.backends = [...this.backends.filter((b) => b.backend !== backend), { backend, supported }];
		this.emitReset();
	}
	async start(branch: readonly unknown[]): Promise<void> {
		// Branch, not all session entries: forks must not inherit runs from abandoned branches.
		for (const entry of branch) {
			const e = record(entry);
			if (e.type === "message" && e.message?.role === "toolResult")
				this.tool(e.message.toolCallId, e.message.details, false, !!e.message.isError, number(e.message.timestamp));
			if (e.type === "custom" && e.customType === "pimate_subagent") this.learn(record(e.data), false);
		}
		this.emitReset();
		await Promise.all([...this.sources.keys()].map((id) => this.readStatus(id)));
		await this.detect();
	}
	async detect(): Promise<void> {
		try {
			const data = await this.call("ping", {}, 1500);
			if (this.disposed) return;
			this.backend("pi-subagents", data.capabilities?.asyncStatusSnapshot?.version === 1);
			await this.refresh();
		} catch {
			/* A missing optional backend is normal. */
		}
	}
	private async call(method: string, params: unknown = {}, timeout?: number): Promise<Record<string, any>> {
		if (!this.h.pi || this.disposed) throw new RcError("not_ready");
		const reply = record(await rpc(this.h.pi, method, params, timeout));
		if (this.disposed) throw new RcError("session_changed");
		if (!reply.success)
			throw new RcError("unsupported", string(record(reply.error).message) ?? "pi-subagents RPC failed", reply.error);
		const data = record(reply.data);
		if (data.isError) throw new RcError("unsupported", string(data.text) ?? "pi-subagents RPC failed");
		return data;
	}
	toolStart(id: string): void {
		this.tools.set(id, { startedAt: Date.now(), running: true });
	}
	tool(id: string, details: unknown, running: boolean, isError = false, timestamp?: number): void {
		if (this.disposed || typeof id !== "string") return;
		const d = record(details);
		const backend = classify(d);
		const existing = [...this.runs.values()].find((r) => r.toolCallId === id);
		const source = existing && this.sources.get(existing.id);
		const actual = backend ? d : source?.details;
		if (!actual) {
			if (!running) this.tools.delete(id);
			return;
		}
		if (backend === "example") this.backend(backend, true);
		if (d.asyncDir || d.asyncId) {
			this.learn({ ...d, toolCallId: id });
			if (!running) this.tools.delete(id);
			return;
		}
		const tool = this.tools.get(id);
		const run = normalizeTool(actual, id, running, tool?.startedAt ?? existing?.startedAt ?? timestamp, isError);
		if (!running) this.tools.delete(id);
		if (!run) return;
		if (!running) run.endedAt = timestamp ?? Date.now();
		this.sources.set(run.id, { children: list(record(actual).results), details: actual });
		this.put(run);
	}
	private learn(d: Record<string, any>, persist = true): void {
		const id = string(d.runId ?? d.asyncId);
		if (!id || this.disposed) return;
		const previous = this.runs.get(id);
		const dir = string(d.asyncDir) ?? this.sources.get(id)?.dir;
		const source = this.sources.get(id) ?? { children: [] };
		if (dir) source.dir = dir;
		if (typeof d.parentWorkflowRunId === "string") source.parentRunId = d.parentWorkflowRunId;
		this.sources.set(id, source);
		if (persist && (!previous || (!previous.resumedFrom && d.resumedFrom)))
			this.h.pi?.appendEntry("pimate_subagent", {
				runId: id,
				asyncDir: dir,
				toolCallId: d.toolCallId,
				parentWorkflowRunId: source.parentRunId,
				resumedFrom: d.resumedFrom,
				resumedAs: d.resumedAs,
			});
		this.put({
			...previous,
			id,
			backend: "pi-subagents",
			background: true,
			mode: previous?.mode ?? "unknown",
			state: previous?.state ?? "queued",
			children: previous?.children ?? [],
			actions: previous?.actions ?? [],
			toolCallId: previous?.toolCallId ?? string(d.toolCallId),
			resumedFrom: string(d.resumedFrom) ?? previous?.resumedFrom,
			resumedAs: string(d.resumedAs) ?? previous?.resumedAs,
		});
		if (dir) void this.readStatus(id);
	}
	bus(channel: string, value: unknown): void {
		if (this.disposed) return;
		if (channel === "subagents:rpc:v1:ready") {
			void this.detect();
			return;
		}
		const d = record(value);
		// Some backend events use the session file instead of the UUID.
		if (d.sessionId && d.sessionId !== this.sessionId && d.sessionId !== this.sessionFile) return;
		const e = record(d.event);
		const id = string(d.runId ?? d.asyncId ?? d.id ?? e.runId);
		if (id && (d.asyncDir || channel === "subagent:async-started")) this.learn({ ...d, runId: id });
		if (id) void this.readStatus(id);
		this.scheduleRefresh();
	}
	private scheduleRefresh(): void {
		if (this.refreshTimer || this.disposed) return;
		this.refreshTimer = setTimeout(() => {
			this.refreshTimer = undefined;
			void this.refresh();
		}, 150);
		this.refreshTimer.unref();
	}
	private async refresh(): Promise<void> {
		if (this.disposed) return;
		if (this.refreshing) {
			this.refreshAgain = true;
			return;
		}
		this.refreshing = true;
		try {
			const data = await this.call("status");
			if (data.asyncSnapshot?.version !== 1) return;
			this.backend("pi-subagents", true);
			for (const node of list(data.asyncSnapshot.runs)) {
				const id = string(node.id);
				if (!id) continue;
				if (this.sources.get(id)?.dir) {
					await this.readStatus(id);
					continue;
				}
				const previous = this.runs.get(id);
				const sources = list(node.children).map((c, index) => ({
					...c,
					childId: c.id,
					agent: c.label,
					status: c.state,
					index,
					currentTool: c.activity?.currentTool,
					activityState: c.activity?.state,
				}));
				const run = normalizeStatus(
					{ ...node, runId: id, mode: previous?.mode, steps: sources, activityState: node.activity?.state },
					previous,
				);
				this.sources.set(id, { ...this.sources.get(id), children: sources });
				this.put(run);
			}
		} catch {
			/* Discovery/refresh is best effort. Explicit controls surface errors. */
		} finally {
			this.refreshing = false;
			if (this.refreshAgain) {
				this.refreshAgain = false;
				this.scheduleRefresh();
			}
		}
	}
	private async readStatus(id: string): Promise<void> {
		const source = this.sources.get(id);
		if (!source?.dir || this.disposed) return;
		if (this.reading.has(id)) {
			this.reread.add(id);
			return;
		}
		this.reading.add(id);
		try {
			const d = await json(join(source.dir, "status.json"));
			// The directory was learned from this session's branch or a scoped bus event.
			// Forks legitimately reference an artifact whose original parent session differs.
			if (this.disposed || d.runId !== id) return;
			if (d.lifecycleArtifactVersion !== undefined && d.lifecycleArtifactVersion !== 3) return;
			source.children = list(d.steps);
			source.parallelTasks =
				d.mode === "workflow" && d.workflow?.resource?.name === "tasks" && d.workflow?.resource?.invocation === "named";
			const run = normalizeStatus(d, this.runs.get(id));
			for (const child of run.children) {
				if (child.state === "waiting") child.question = await this.question(source.dir, id, child.agent, child.index);
			}
			if (this.disposed) return;
			this.put(run);
		} catch {
			/* Atomic replacement, retention and startup can temporarily remove artifacts. */
		} finally {
			this.reading.delete(id);
			if (this.reread.delete(id)) void this.readStatus(id);
		}
	}
	private async question(dir: string, id: string, agent: string, index: number): Promise<string | undefined> {
		const safe = (s: string) =>
			s
				.trim()
				.replace(/[^A-Za-z0-9._-]+/g, "-")
				.replace(/^-+|-+$/g, "") || "unknown";
		const channel = join(dirname(dirname(dir)), "supervisor-channels", `${safe(id)}-${safe(agent)}-${index}`);
		try {
			const files = (await readdir(join(channel, "requests"))).filter((f) => f.endsWith(".json")).slice(-30);
			const requests = await Promise.all(
				files.map(async (file) => {
					try {
						await stat(join(channel, "replies", file));
						return undefined;
					} catch {
						/* No reply yet. */
					}
					try {
						return await json(join(channel, "requests", file));
					} catch {
						return undefined;
					}
				}),
			);
			return requests
				.filter((r) => r?.runId === id && r.expectsReply && (!r.expiresAt || r.expiresAt > Date.now()))
				.sort((a, b) => b!.createdAt - a!.createdAt)
				.map((r) => string(r!.message)?.slice(0, 8192))[0];
		} catch {
			return undefined;
		}
	}
	private put(run: SubagentRun): void {
		if (this.disposed) return;
		const stop = this.stopping.get(run.id);
		if (stop) {
			for (const child of run.children)
				if ((stop.has("*") || stop.has(child.id)) && isSubagentActive(child.state)) {
					child.state = "stopping";
					child.actions = [];
				}
			if (stop.has("*") && isSubagentActive(run.state)) {
				run.state = "stopping";
				run.actions = [];
			}
			if (!isSubagentActive(run.state)) this.stopping.delete(run.id);
		}
		const previous = this.runs.get(run.id);
		if (JSON.stringify(previous) === JSON.stringify(run)) {
			this.publish();
			return;
		}
		this.runs.set(run.id, run);
		// Cap top-level history, retaining each wrapper and its referenced artifacts as one group.
		const visible = this.project();
		let excess = visible.length - 30;
		for (const old of visible) {
			if (excess <= 0) break;
			const group = new Set([old.id]);
			for (const id of group)
				for (const ref of this.sources.get(id)?.children ?? [])
					if (typeof ref.runId === "string" && this.runs.has(ref.runId)) group.add(ref.runId);
			for (const [id, source] of this.sources) if (source.parentRunId && group.has(source.parentRunId)) group.add(id);
			if (group.has(run.id) || [...group].some((id) => isSubagentActive(this.runs.get(id)!.state))) continue;
			for (const id of group) {
				this.runs.delete(id);
				this.sources.delete(id);
				clearTimeout(this.pending.get(id));
				this.pending.delete(id);
				this.lastEmitted.delete(id);
				this.watchers.get(id)?.close();
				this.watchers.delete(id);
			}
			excess--;
		}
		this.watchActive();
		this.publish();
	}
	private publish(): void {
		const visible = this.project();
		const next = new Map(visible.map((r) => [r.id, r]));
		const removed = [...this.projected.keys()].some((id) => !next.has(id));
		const changed = visible.filter((r) => JSON.stringify(this.projected.get(r.id)) !== JSON.stringify(r));
		const finalChanges = new Set(
			changed
				.filter(
					(r) =>
						!isSubagentActive(r.state) ||
						r.children.some(
							(c) =>
								!isSubagentActive(c.state) &&
								this.projected.get(r.id)?.children.find((old) => old.id === c.id)?.state !== c.state,
						),
				)
				.map((r) => r.id),
		);
		this.projected = next;
		for (const [id, timer] of this.pending)
			if (!next.has(id)) {
				clearTimeout(timer);
				this.pending.delete(id);
			}
		const counts = JSON.stringify(countSubagents(visible));
		if (counts !== this.counts) {
			this.counts = counts;
			this.h.writeMeta();
		}
		// A reset removes children that may have been observed before the workflow learned their runIds.
		if (removed) this.emitReset();
		for (const run of changed) {
			const send = () => {
				this.pending.delete(run.id);
				const latest = this.projected.get(run.id);
				if (!latest || this.disposed) return;
				this.lastEmitted.set(run.id, Date.now());
				this.h.emit({ type: "subagent_run", run: latest });
			};
			if (finalChanges.has(run.id)) {
				clearTimeout(this.pending.get(run.id));
				send();
			} else if (!this.pending.has(run.id)) {
				const wait = Math.max(0, 250 - (Date.now() - (this.lastEmitted.get(run.id) ?? 0)));
				if (!wait) send();
				else {
					const timer = setTimeout(send, wait);
					timer.unref();
					this.pending.set(run.id, timer);
				}
			}
		}
	}

	private watchActive(): void {
		let active = false;
		for (const [id, run] of this.runs) {
			const dir = this.sources.get(id)?.dir;
			if (!isSubagentActive(run.state) || !run.background) {
				this.watchers.get(id)?.close();
				this.watchers.delete(id);
				continue;
			}
			active = true;
			if (!dir || this.watchers.has(id)) continue;
			try {
				const watcher = watch(dir, { persistent: false }, (_event, file) => {
					if (!file || file.toString() === "status.json") void this.readStatus(id);
				});
				watcher.on("error", () => {
					watcher.close();
					this.watchers.delete(id);
				});
				this.watchers.set(id, watcher);
			} catch {
				/* Safety reread retries missing directories. */
			}
		}
		if (active && !this.safety) {
			this.safety = setInterval(() => {
				for (const [id, run] of this.runs) if (isSubagentActive(run.state)) void this.readStatus(id);
				this.scheduleRefresh();
				this.watchActive();
			}, 5000);
			this.safety.unref();
		} else if (!active && this.safety) {
			clearInterval(this.safety);
			this.safety = undefined;
		}
	}
	async transcript(p: ParamsOf<"subagent_transcript">): Promise<SubagentTranscript> {
		const run = this.project().find((r) => r.id === p.runId);
		const child = run?.children.find((c) => c.id === p.childId);
		if (!run || !child) throw new RcError("not_found", "Subagent child not found in this session");
		const { source } = this.target(run.id, child.index);
		if (run.backend === "example")
			return exampleTranscript(Array.isArray(source.messages) ? source.messages : [], string(source.task), p.cursor);
		const path = string(source.transcriptPath ?? record(source.artifactPaths).transcriptPath);
		if (!path) throw new RcError("unsupported", "Child transcript is not available");
		try {
			const reply = await tailTranscript(path, p.cursor, source.pimateTask);
			if (this.disposed) throw new RcError("session_changed");
			if (reply.task) source.pimateTask = reply.task;
			return reply;
		} catch (error) {
			if (error instanceof RcError) throw error;
			throw new RcError("not_found", "Child transcript is not available (it may have been removed)");
		}
	}
	async control(p: ParamsOf<"subagent_control">): Promise<{ message?: string; newRunId?: string }> {
		const run = this.project().find((r) => r.id === p.runId);
		const child = p.childId === undefined ? undefined : run?.children.find((c) => c.id === p.childId);
		if (!run || (p.childId !== undefined && !child))
			throw new RcError("not_found", "Subagent not found in this session");
		if (!(child ? child.actions : run.actions).includes(p.action))
			throw new RcError("unsupported", "This action is not currently available");
		if (["steer", "follow_up", "resume"].includes(p.action) && !p.text?.trim())
			throw new RcError("bad_request", "A message is required");
		if (p.action === "abort_parent") {
			if (!run.toolCallId || !this.tools.get(run.toolCallId)?.running)
				throw new RcError("unsupported", "The parent tool call has already ended");
			this.h.ctx?.abort();
			return {};
		}
		const target = child ? this.target(run.id, child.index) : undefined;
		const targetId = target?.nested ? target.run.id : run.id;
		const params: Record<string, unknown> = { runId: targetId };
		let method: string = p.action;
		if (p.action === "steer" || p.action === "follow_up") {
			method = "steer";
			Object.assign(params, { index: target?.child?.index ?? child!.index, message: p.text, mode: p.action });
		}
		if (p.action === "resume") Object.assign(params, { index: target?.child?.index ?? child!.index, message: p.text });
		if (p.action === "stop_child") {
			method = "stop";
			if (!target?.nested) {
				if (!target?.source.childId) throw new RcError("unsupported", "Backend child identity is unavailable");
				params.childId = target.source.childId;
			}
		}
		const data = await this.call(method, params);
		if (method === "stop") {
			const targets = this.stopping.get(targetId) ?? new Set<string>();
			targets.add(target?.nested ? "*" : (child?.id ?? "*"));
			this.stopping.set(targetId, targets);
			// Do not mutate an object already held by snapshot/event consumers.
			const latest = this.runs.get(targetId)!;
			this.put({ ...latest, children: latest.children.map((c) => ({ ...c })) });
		}
		let newRunId: string | undefined;
		if (method === "resume") {
			const details = record(data.details);
			newRunId = string(details.asyncId ?? details.runId);
			if (!newRunId) throw new RcError("unsupported", "Backend did not return a resumed run ID");
			this.learn({ ...details, runId: newRunId, resumedFrom: run.id });
			this.h.pi?.appendEntry("pimate_subagent", {
				runId: run.id,
				asyncDir: this.sources.get(run.id)?.dir,
				resumedAs: newRunId,
			});
			this.put({ ...this.runs.get(run.id)!, resumedAs: newRunId });
		}
		this.scheduleRefresh();
		return { message: string(data.message ?? data.text), newRunId };
	}
	dispose(): void {
		this.disposed = true;
		clearInterval(this.safety);
		clearTimeout(this.refreshTimer);
		for (const timer of this.pending.values()) clearTimeout(timer);
		for (const watcher of this.watchers.values()) watcher.close();
		this.pending.clear();
		this.watchers.clear();
	}
}
