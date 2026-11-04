import type { GitHubQuery } from "@pimate/protocol";
import { describe, expect, it, vi } from "vitest";
import { type GitHubExec, queryGitHub, validGitHubQuery } from "../src/host/github.ts";

const instances = [{ instanceId: "pi", cwd: "/host/known/repo" }];
const summary = "number,title,state,author,labels,updatedAt,url";
const pr = "isDraft,reviewDecision,statusCheckRollup";
const raw = {
	number: 12,
	title: "題名",
	state: "OPEN",
	author: { login: "alice" },
	labels: [{ name: "bug" }],
	url: "https://github.com/o/r/issues/12",
	updatedAt: "2026-10-20T00:00:00Z",
};
const execJSON = (...values: unknown[]) => {
	const exec = vi.fn<GitHubExec>();
	for (const value of values) exec.mockResolvedValueOnce({ stdout: JSON.stringify(value) });
	return exec;
};

describe("read-only GitHub", () => {
	it("uses fixed list arguments, Host-known cwd, bounded execution and noninteractive env", async () => {
		const exec = execJSON({ nameWithOwner: "o/r", url: "https://github.com/o/r" }, [raw], [{ ...raw, isDraft: true }]);
		const result = await queryGitHub(instances, "pi", { kind: "list" }, { PATH: "/bin", GH_REPO: "other/repo" }, exec);
		expect(exec.mock.calls.map((call) => call.slice(0, 2))).toEqual([
			["gh", ["repo", "view", "--json", "nameWithOwner,url"]],
			["gh", ["issue", "list", "--state", "open", "--limit", "30", "--json", summary]],
			["gh", ["pr", "list", "--state", "open", "--limit", "30", "--json", `${summary},${pr}`]],
		]);
		for (const call of exec.mock.calls)
			expect(call[2]).toEqual({
				cwd: "/host/known/repo",
				timeout: 15000,
				maxBuffer: 4 * 1024 * 1024,
				encoding: "utf8",
				env: { PATH: "/bin", GH_REPO: "", GH_PROMPT_DISABLED: "1", NO_COLOR: "1", GH_NO_UPDATE_NOTIFIER: "1" },
			});
		expect(result).toMatchObject({
			ok: true,
			data: {
				kind: "list",
				repo: { name: "o/r" },
				issues: [{ kind: "issue", number: 12, author: "alice", labels: ["bug"] }],
				prs: [{ kind: "pr", isDraft: true }],
			},
		});
	});

	it.each(["issue", "pr"] as const)(
		"uses fixed %s detail fields and only a positive numeric argument",
		async (kind) => {
			const exec = execJSON(raw);
			expect((await queryGitHub(instances, "pi", { kind, number: 12 }, {}, exec)).ok).toBe(true);
			expect(exec.mock.calls[0][1]).toEqual([
				kind,
				"view",
				"12",
				"--json",
				kind === "pr"
					? `${summary},body,comments,createdAt,${pr},headRefName,baseRefName,additions,deletions,changedFiles`
					: `${summary},body,comments,createdAt`,
			]);
		},
	);

	it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, "12", "--web", "1; rm -rf /"])(
		"rejects unsafe number %s without executing",
		async (number) => {
			const exec = execJSON();
			const query = { kind: "issue", number } as GitHubQuery;
			expect(validGitHubQuery(query)).toBe(false);
			expect(await queryGitHub(instances, "pi", query, {}, exec)).toMatchObject({ ok: false, code: "failed" });
			expect(exec).not.toHaveBeenCalled();
		},
	);

	it("rejects extra fields and unknown instances without executing", async () => {
		for (const query of [
			null,
			[],
			{},
			{ kind: "list", repo: "o/r" },
			{ kind: "issue", number: 1, cwd: "/tmp" },
			{ kind: "shell" },
		])
			expect(validGitHubQuery(query)).toBe(false);
		const exec = execJSON();
		expect(await queryGitHub(instances, "missing", { kind: "list" }, {}, exec)).toEqual({
			ok: false,
			code: "not_found",
			message: "Pi instance not found",
		});
		expect(exec).not.toHaveBeenCalled();
	});

	it.each([
		[{ code: "ENOENT" }, "gh_missing"],
		[{ code: 4 }, "gh_auth"],
		[{ stderr: "To get started with GitHub CLI, please run: gh auth login" }, "gh_auth"],
		[{ stderr: "fatal: not a git repository (or any of the parent directories): .git" }, "not_github"],
		[{ stderr: "none of the git remotes configured for this repository point to a known GitHub host" }, "not_github"],
		[{ stderr: "no git remotes found" }, "not_github"],
		[{ stderr: "GraphQL: Could not resolve to an Issue with the number of 999" }, "not_found"],
		[{ stderr: "HTTP 404: Not Found" }, "not_found"],
		[{ stderr: "no pull requests found for branch" }, "not_found"],
		[{ code: "ETIMEDOUT", stderr: "x".repeat(1000) }, "failed"],
	])("classifies gh errors %o as %s", async (error, code) => {
		const exec = vi.fn<GitHubExec>().mockRejectedValue(error);
		const result = await queryGitHub(instances, "pi", { kind: "list" }, {}, exec);
		expect(result).toMatchObject({ ok: false, code });
		if (!result.ok) expect(result.message.length).toBeLessThanOrEqual(500);
	});

	it("normalizes CheckRuns and StatusContexts and summarizes all checks", async () => {
		const statusCheckRollup = [
			{ name: "test", status: "COMPLETED", conclusion: "SUCCESS" },
			{ name: "skipped", status: "COMPLETED", conclusion: "SKIPPED" },
			{ name: "neutral", status: "COMPLETED", conclusion: "NEUTRAL" },
			{ name: "lint", status: "COMPLETED", conclusion: "FAILURE" },
			{ name: "cancelled", status: "COMPLETED", conclusion: "CANCELLED" },
			{ name: "running", status: "IN_PROGRESS", conclusion: null },
			{ name: "queued", status: "QUEUED", conclusion: null },
			{ name: "unknown", status: "COMPLETED", conclusion: null },
			{ context: "external", state: "SUCCESS" },
			{ context: "error", state: "ERROR" },
			{ context: "waiting", state: "PENDING" },
		];
		const result = await queryGitHub(
			instances,
			"pi",
			{ kind: "pr", number: 12 },
			{},
			execJSON({
				...raw,
				statusCheckRollup,
				isDraft: false,
				reviewDecision: "APPROVED",
				headRefName: "feat",
				baseRefName: "main",
				additions: 2,
				deletions: 1,
				changedFiles: 1,
			}),
		);
		expect(result).toMatchObject({
			ok: true,
			data: {
				kind: "detail",
				item: {
					ci: { passed: 4, failed: 3, pending: 4 },
					reviewDecision: "APPROVED",
					headRefName: "feat",
					baseRefName: "main",
					additions: 2,
					deletions: 1,
					changedFiles: 1,
					checks: statusCheckRollup.map((check, i) => ({
						name: "name" in check ? check.name : check.context,
						state: [
							"passed",
							"passed",
							"passed",
							"failed",
							"failed",
							"pending",
							"pending",
							"pending",
							"passed",
							"failed",
							"pending",
						][i],
					})),
				},
			},
		});
	});

	it("bounds body, comments, lists and checks and explicitly marks truncation", async () => {
		const big = {
			...raw,
			body: "b".repeat(40000),
			comments: Array.from({ length: 31 }, (_, i) => ({ body: "c".repeat(10000), author: null, createdAt: `c${i}` })),
			statusCheckRollup: Array.from({ length: 101 }, () => ({ name: "test", state: "SUCCESS" })),
		};
		const result = await queryGitHub(instances, "pi", { kind: "pr", number: 12 }, {}, execJSON(big));
		if (!result.ok || result.data.kind !== "detail") throw new Error("expected detail");
		const item = result.data.item;
		expect(item.body.length).toBe(32768);
		expect(item.bodyTruncated).toBe(true);
		expect(item.comments).toHaveLength(30);
		expect(item.commentsTruncated).toBe(true);
		// The oldest comment is dropped; the newest stay in order.
		expect(item.comments[0]).toMatchObject({ author: "（削除済み）", bodyTruncated: true, createdAt: "c1" });
		expect(item.comments[29].createdAt).toBe("c30");
		expect(item.comments[0].body).toHaveLength(8192);
		expect(item.checks).toHaveLength(100);
		expect(item.checksTruncated).toBe(true);
		expect(item.ci).toEqual({ passed: 101, failed: 0, pending: 0 });
		const list = await queryGitHub(
			instances,
			"pi",
			{ kind: "list" },
			{},
			execJSON({ nameWithOwner: "o/r" }, Array(35).fill(raw), []),
		);
		if (!list.ok || list.data.kind !== "list") throw new Error("expected list");
		expect(list.data.issues).toHaveLength(30);
	});

	it("returns failed for invalid JSON, unexpected shape and buffer/timeout failures", async () => {
		for (const exec of [
			vi.fn<GitHubExec>().mockResolvedValue({ stdout: "invalid" }),
			execJSON({}),
			execJSON([]),
			vi.fn<GitHubExec>().mockRejectedValue(new Error("stdout maxBuffer length exceeded")),
		]) {
			expect(await queryGitHub(instances, "pi", { kind: "issue", number: 12 }, {}, exec)).toMatchObject({
				ok: false,
				code: "failed",
			});
		}
	});
});
