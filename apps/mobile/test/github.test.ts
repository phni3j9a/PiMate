import type { GitHubErrorCode, GitHubQuery, GitHubResult, InstanceSummary } from "@pimate/protocol";
import { afterEach, beforeEach, expect, it } from "vitest";
import { HostConnection } from "../src/lib/hostConnection";
import { HostRegistry, MemoryStorage } from "../src/lib/hostRegistry";
import { AppStore } from "../src/lib/store";
import { authenticate, FakeSocket } from "./fakes";

beforeEach(() => FakeSocket.reset());
const cleanup: (() => void)[] = [];
afterEach(() => {
	for (const close of cleanup.splice(0)) close();
});
const instance = (id: string): InstanceSummary => ({
	instanceId: id,
	cwd: `/repo/${id}`,
	origin: "pc",
	abducoSession: null,
	pcAttached: null,
	session: null,
	status: "idle",
	startedAt: 0,
	updatedAt: id === "pi" ? 2 : 1,
});
const target = { hostId: "h1", instanceId: "pi" };
const item = { number: 12, title: "題名", url: "https://github.com/o/r/issues/12" };
const list: GitHubResult = {
	ok: true,
	data: { kind: "list", repo: { name: "o/r", url: "https://github.com/o/r" }, issues: [], prs: [] },
};

async function setup(github?: boolean, packageUpdate?: boolean) {
	const storage = new MemoryStorage();
	await new HostRegistry(storage).save({
		hostId: "h1",
		hostName: "PC",
		address: "localhost:47800",
		deviceId: "d1",
		token: "tok",
		pairedAt: 0,
	});
	let id = 0;
	const store = new AppStore({
		storage,
		fetch: async () => {
			throw new Error("unused pairing");
		},
		createSocket: (url) => new FakeSocket(url),
		randomUUID: () => `req-${++id}`,
		deviceName: () => "Android",
		app: { version: "test", platform: "android" },
	});
	await store.init();
	cleanup.push(() => store.dispose());
	const socket = FakeSocket.last();
	authenticate(socket, [instance("pi"), instance("other")], {
		...(github === undefined ? {} : { github }),
		...(packageUpdate === undefined ? {} : { packageUpdate }),
	});
	return { store, socket };
}

it("HostConnection matches github_result by requestId for all queries and error responses", async () => {
	const conn = new HostConnection("localhost:47800", "token", {
		createSocket: (url) => new FakeSocket(url),
		app: { version: "test", platform: "android" },
	});
	cleanup.push(() => conn.stop());
	conn.start();
	const socket = FakeSocket.last();
	authenticate(socket, [], { github: true });
	const queries: GitHubQuery[] = [{ kind: "list" }, { kind: "issue", number: 12 }, { kind: "pr", number: 13 }];
	const pending = queries.map((query, i) => conn.github(`gh-${i}`, "pi", query));
	expect(socket.sentOfType("github")).toEqual(
		queries.map((query, i) => ({ type: "github", requestId: `gh-${i}`, instanceId: "pi", query })),
	);
	socket.receive({ type: "github_result", requestId: "gh-2", ok: false, code: "not_found", message: "missing" });
	socket.receive({ type: "github_result", requestId: "unknown", ...list });
	socket.receive({
		type: "github_result",
		requestId: "gh-1",
		ok: true,
		data: { kind: "detail", item: { ...item, kind: "issue", body: "body", comments: [] } },
	});
	socket.receive({ type: "github_result", requestId: "gh-0", ...list });
	const results = await Promise.all(pending);
	expect(results[0]).toMatchObject(list);
	expect(results[1]).toMatchObject({ ok: true, data: { kind: "detail", item } });
	expect(results[2]).toMatchObject({ ok: false, code: "not_found" });
	const dropped = conn.github("drop", "pi", { kind: "list" });
	socket.drop();
	await expect(dropped).rejects.toMatchObject({ code: "outcome_unknown" });
	expect(socket.sentOfType("github")).toHaveLength(4);
});

it.each([undefined, false])("store never sends github to an older Host (%s)", async (capability) => {
	const { store, socket } = await setup(capability);
	expect(await store.github(target, { kind: "list" })).toMatchObject({ ok: false, title: "PC の更新が必要です" });
	expect(socket.sentOfType("github")).toEqual([]);
	expect(store.getState().hosts[0].github).toBe(false);
});

it("store gates on connection and preserves the captured request target", async () => {
	const { store, socket } = await setup(true);
	expect(store.getState().hosts[0].github).toBe(true);
	store.select("h1", "other");
	const pending = store.github(target, { kind: "list" });
	const request = socket.sentOfType("github")[0];
	expect(request.instanceId).toBe("pi");
	socket.receive({ type: "github_result", requestId: request.requestId, ...list });
	await expect(pending).resolves.toEqual({ ok: true, value: list.ok ? list.data : null });
	socket.drop();
	expect((await store.github(target, { kind: "list" })).ok).toBe(false);
	expect(socket.sentOfType("github")).toHaveLength(1);
});

it.each([
	["gh_missing", "インストール"],
	["gh_auth", "PC のターミナルで gh auth login"],
	["not_github", "GitHub のリポジトリではありません"],
	["not_found", "見つかりません"],
	["failed", "bounded stderr"],
] as [GitHubErrorCode, string][])("store shows distinct guidance for %s", async (code, guidance) => {
	const { store, socket } = await setup(true);
	const pending = store.github(target, { kind: "issue", number: 12 });
	const request = socket.sentOfType("github")[0];
	socket.receive({ type: "github_result", requestId: request.requestId, ok: false, code, message: "bounded stderr" });
	const result = await pending;
	expect(result).toMatchObject({ ok: false, code });
	if (!result.ok) expect(result.text).toContain(guidance);
});

it("inserts reference into empty draft or appends without losing draft/attachments or sending", async () => {
	const { store, socket } = await setup(true);
	expect(store.insertGitHubReference(target, item)).toBe(true);
	const reference = "#12「題名」 https://github.com/o/r/issues/12";
	expect(store.getState().drafts["h1/pi"]).toBe(reference);
	store.setDraft("既存の依頼  ");
	const attachments = store.getState().attachments;
	expect(store.insertGitHubReference(target, item)).toBe(true);
	expect(store.getState().drafts["h1/pi"]).toBe(`既存の依頼  \n${reference}`);
	expect(store.getState().attachments).toBe(attachments);
	expect(socket.sentOfType("rc").filter((m) => m.request.method === "prompt")).toEqual([]);
});

it("never inserts into another Pi or another Host, and preserves both drafts", async () => {
	const { store } = await setup(true);
	store.setDraft("元の下書き");
	store.select("h1", "other");
	store.setDraft("別 Pi の下書き");
	expect(store.insertGitHubReference(target, item)).toBe(false);
	expect(store.insertGitHubReference({ hostId: "another", instanceId: "other" }, item)).toBe(false);
	expect(store.getState().drafts).toMatchObject({ "h1/pi": "元の下書き", "h1/other": "別 Pi の下書き" });
});

it.each([undefined, false])("does not send update requests without capability (%s)", async (capability) => {
	const { store, socket } = await setup(undefined, capability);
	expect((await store.updateCheck("h1")).ok).toBe(false);
	expect((await store.update("h1")).ok).toBe(false);
	expect(socket.sentOfType("update_check")).toEqual([]);
	expect(socket.sentOfType("update")).toEqual([]);
});

it("routes update responses and never retries after a disconnect", async () => {
	const conn = new HostConnection("localhost:47800", "token", {
		createSocket: (url) => new FakeSocket(url),
		app: { version: "test", platform: "android" },
	});
	cleanup.push(() => conn.stop());
	conn.start();
	const socket = FakeSocket.last();
	authenticate(socket, [], { packageUpdate: true });
	const check = conn.updateCheck("check");
	const update = conn.update("update");
	expect(socket.sentOfType("update_check")).toEqual([{ type: "update_check", requestId: "check" }]);
	expect(socket.sentOfType("update")).toEqual([{ type: "update", requestId: "update" }]);
	socket.receive({
		type: "update_result",
		requestId: "update",
		ok: true,
		from: "1.0.0",
		to: "1.1.0",
		restarting: true,
	});
	socket.receive({
		type: "update_check_result",
		requestId: "check",
		current: "1.0.0",
		latest: "1.1.0",
		canUpdate: true,
	});
	await expect(check).resolves.toMatchObject({ latest: "1.1.0" });
	await expect(update).resolves.toMatchObject({ restarting: true });
	const dropped = conn.update("drop");
	socket.drop();
	await expect(dropped).rejects.toMatchObject({ code: "outcome_unknown" });
	expect(socket.sentOfType("update")).toHaveLength(2);
});

it("store exposes capability and version and routes both operations", async () => {
	const { store, socket } = await setup(undefined, true);
	expect(store.getState().hosts[0]).toMatchObject({ packageUpdate: true, version: "0.0.0" });
	const check = store.updateCheck("h1");
	const request = socket.sentOfType("update_check")[0];
	socket.receive({ type: "update_check_result", requestId: request.requestId, current: "1.0.0", canUpdate: true });
	expect(await check).toMatchObject({ ok: true, value: { current: "1.0.0" } });
	const update = store.update("h1");
	const sent = socket.sentOfType("update")[0];
	socket.receive({ type: "update_result", requestId: sent.requestId, ok: false, code: "busy" });
	expect(await update).toMatchObject({ ok: true, value: { code: "busy" } });
});
