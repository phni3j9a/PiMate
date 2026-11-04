import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
	GitHubCheck,
	GitHubDetail,
	GitHubErrorCode,
	GitHubQuery,
	GitHubResult,
	GitHubSummary,
	InstanceSummary,
} from "@pimate/protocol";

const execFileAsync = promisify(execFile);
export type GitHubExec = (
	file: string,
	args: string[],
	options: { cwd: string; env: NodeJS.ProcessEnv; timeout: number; maxBuffer: number; encoding: "utf8" },
) => Promise<{ stdout: string }>;

const SUMMARY = "number,title,state,author,labels,updatedAt,url";
const PR = "isDraft,reviewDecision,statusCheckRollup";
const DETAIL = `${SUMMARY},body,comments,createdAt`;
const BODY_LIMIT = 32 * 1024;
const COMMENT_LIMIT = 8 * 1024;
const COMMENTS = 30;
const CHECKS = 100;

/** Reject extra keys too: this is not a path/repo/command API. */
export function validGitHubQuery(value: unknown): value is GitHubQuery {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const q = value as GitHubQuery;
	if (q.kind === "list") return Object.keys(q).length === 1;
	return (
		(q.kind === "issue" || q.kind === "pr") &&
		Number.isSafeInteger(q.number) &&
		q.number > 0 &&
		Object.keys(q).length === 2
	);
}

const text = (value: unknown, limit = 1000): string => (typeof value === "string" ? value.slice(0, limit) : "");
const author = (value: any): string => text(value?.login, 100) || "（削除済み）";
const array = (value: unknown): any[] => (Array.isArray(value) ? value : []);

function checks(value: unknown): GitHubCheck[] {
	return array(value).map((check) => {
		const status = text(check.state || (check.status === "COMPLETED" ? check.conclusion : check.status)).toUpperCase();
		return {
			name: text(check.name || check.context) || "チェック",
			state: ["SUCCESS", "NEUTRAL", "SKIPPED"].includes(status)
				? "passed"
				: ["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STALE", "STARTUP_FAILURE"].includes(status)
					? "failed"
					: "pending",
		};
	});
}

function summary(raw: any, kind: "issue" | "pr"): GitHubSummary {
	if (!raw || !Number.isSafeInteger(raw.number) || raw.number < 1 || typeof raw.title !== "string")
		throw new Error("Invalid gh JSON item");
	const item: GitHubSummary = {
		kind,
		number: raw.number,
		title: text(raw.title),
		state: text(raw.state, 30),
		author: author(raw.author),
		url: text(raw.url, 2048),
		updatedAt: text(raw.updatedAt, 50),
		labels: array(raw.labels)
			.slice(0, 100)
			.map((label) => text(label.name, 100)),
	};
	if (kind === "pr") {
		item.isDraft = raw.isDraft === true;
		item.reviewDecision = text(raw.reviewDecision, 50);
		item.ci = { passed: 0, failed: 0, pending: 0 };
		for (const check of checks(raw.statusCheckRollup)) item.ci[check.state]++;
	}
	return item;
}

function detail(raw: any, kind: "issue" | "pr"): GitHubDetail {
	const comments = array(raw.comments);
	const item: GitHubDetail = {
		...summary(raw, kind),
		body: text(raw.body, BODY_LIMIT),
		bodyTruncated: typeof raw.body === "string" && raw.body.length > BODY_LIMIT,
		createdAt: text(raw.createdAt, 50),
		// The newest comments (review feedback, CI bots) matter most on a phone.
		comments: comments.slice(-COMMENTS).map((comment) => ({
			author: author(comment.author),
			body: text(comment.body, COMMENT_LIMIT),
			bodyTruncated: typeof comment.body === "string" && comment.body.length > COMMENT_LIMIT,
			createdAt: text(comment.createdAt, 50),
		})),
		commentsTruncated: comments.length > COMMENTS,
	};
	if (kind === "pr") {
		item.headRefName = text(raw.headRefName);
		item.baseRefName = text(raw.baseRefName);
		for (const key of ["additions", "deletions", "changedFiles"] as const)
			item[key] = Number.isSafeInteger(raw[key]) && raw[key] >= 0 ? raw[key] : 0;
		const normalized = checks(raw.statusCheckRollup);
		item.checks = normalized.slice(0, CHECKS);
		item.checksTruncated = normalized.length > CHECKS;
	}
	return item;
}

function failure(error: unknown): Extract<GitHubResult, { ok: false }> {
	const e = error as { code?: unknown; stderr?: unknown; message?: unknown };
	const stderr = text(e?.stderr, 4096);
	let code: GitHubErrorCode = "failed";
	if (e?.code === "ENOENT") code = "gh_missing";
	else if (e?.code === 4 || /gh auth login|not logged (in|into)/i.test(stderr)) code = "gh_auth";
	else if (
		/not a git repository|no git remotes|none of the git remotes|not (a |on )?github|could not determine.*repository/i.test(
			stderr,
		)
	)
		code = "not_github";
	else if (/not found|could not resolve to (a|an)|could not find|no pull requests found/i.test(stderr))
		code = "not_found";
	return { ok: false, code, message: (stderr || text(e?.message) || "GitHub query failed").trim().slice(0, 500) };
}

/** The caller supplies only its own discovered instance list. All CLI arguments below are fixed except a validated number. */
export async function queryGitHub(
	instances: Pick<InstanceSummary, "instanceId" | "cwd">[],
	instanceId: string,
	query: GitHubQuery,
	env: NodeJS.ProcessEnv = process.env,
	exec: GitHubExec = execFileAsync,
): Promise<GitHubResult> {
	if (!validGitHubQuery(query)) return { ok: false, code: "failed", message: "Invalid GitHub query" };
	const instance = instances.find((i) => i.instanceId === instanceId);
	if (!instance) return { ok: false, code: "not_found", message: "Pi instance not found" };
	const options = {
		cwd: instance.cwd,
		// GH_REPO would override the instance's repository even with a fixed cwd.
		env: { ...env, GH_REPO: "", GH_PROMPT_DISABLED: "1", NO_COLOR: "1", GH_NO_UPDATE_NOTIFIER: "1" },
		timeout: 15_000,
		maxBuffer: 4 * 1024 * 1024,
		encoding: "utf8" as const,
	};
	const json = async (args: string[]) => JSON.parse((await exec("gh", args, options)).stdout);
	try {
		if (query.kind === "list") {
			const repo = await json(["repo", "view", "--json", "nameWithOwner,url"]);
			const [issues, prs] = await Promise.all([
				json(["issue", "list", "--state", "open", "--limit", "30", "--json", SUMMARY]),
				json(["pr", "list", "--state", "open", "--limit", "30", "--json", `${SUMMARY},${PR}`]),
			]);
			if (!repo?.nameWithOwner || !Array.isArray(issues) || !Array.isArray(prs))
				throw new Error("Invalid gh JSON list");
			return {
				ok: true,
				data: {
					kind: "list",
					repo: { name: text(repo.nameWithOwner), url: text(repo.url, 2048) },
					issues: issues.slice(0, 30).map((raw) => summary(raw, "issue")),
					prs: prs.slice(0, 30).map((raw) => summary(raw, "pr")),
				},
			};
		}
		const raw = await json([
			query.kind,
			"view",
			String(query.number),
			"--json",
			query.kind === "pr" ? `${DETAIL},${PR},headRefName,baseRefName,additions,deletions,changedFiles` : DETAIL,
		]);
		return { ok: true, data: { kind: "detail", item: detail(raw, query.kind) } };
	} catch (error) {
		return failure(error);
	}
}
