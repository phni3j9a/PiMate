#!/usr/bin/env node
// PiMate PoC — Host Service（最小）
// - Piインスタンスの発見（runDirのメタ + pid生存 + ソケット疎通）
// - スマホ発Piの起動（abduco -n で非Attach起動）
// - 127.0.0.1:PORT のHTTPで list / spawn を受ける（PoC用・認証なし）
//
// 環境変数:
//   PIMATE_RUN_DIR   インスタンス情報の置き場（Extensionと共通）
//   PIMATE_ABDUCO    abducoバイナリのパス（既定: 同梱想定の ../bin/<platform>/abduco → PATH）
//   PIMATE_PI_ARGS   起動するpiへの追加引数（JSON配列）
//   PIMATE_SPAWN_MODE  direct | systemd-scope （Hostのcgroupから切り離すか）
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const runDir = process.env.PIMATE_RUN_DIR || (process.env.XDG_RUNTIME_DIR ? path.join(process.env.XDG_RUNTIME_DIR, "pimate") : path.join(os.tmpdir(), `pimate-${process.getuid()}`));
const port = Number(process.env.PIMATE_HOST_PORT || 47800);
const bundled = path.join(here, "..", "bin", `${process.platform}-${process.arch}`, "abduco");
const abduco = process.env.PIMATE_ABDUCO || (fs.existsSync(bundled) ? bundled : "abduco");
const extPath = path.resolve(here, "..", "rc-extension", "index.ts");
const piArgs = JSON.parse(process.env.PIMATE_PI_ARGS || "[]");
const spawnMode = process.env.PIMATE_SPAWN_MODE || "direct";

function alive(pid) {
	try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

function probe(sock, timeoutMs = 1000) {
	return new Promise((resolve) => {
		const c = net.createConnection(sock);
		let buf = "";
		const t = setTimeout(() => { c.destroy(); resolve(null); }, timeoutMs);
		c.on("connect", () => c.write(JSON.stringify({ id: 1, cmd: "hello" }) + "\n"));
		c.on("data", (d) => {
			buf += d;
			const i = buf.indexOf("\n");
			if (i >= 0) {
				clearTimeout(t);
				c.end();
				try { resolve(JSON.parse(buf.slice(0, i)).state); } catch { resolve(null); }
			}
		});
		c.on("error", () => { clearTimeout(t); resolve(null); });
	});
}

function abducoSessions() {
	const r = spawnSync(abduco, [], { encoding: "utf8" });
	// 出力例: "  Tue\t 2026-10-13 19:40:04\t585368\tpm-a"（先頭が * ならAttach中）
	return (r.stdout || "").split("\n").slice(1).filter(Boolean).map((l) => {
		const cols = l.split("\t");
		return { attached: l.trimStart().startsWith("*"), pid: Number(cols[2]), name: cols[3] };
	});
}

async function list() {
	const out = [];
	const sessions = abducoSessions();
	for (const f of fs.existsSync(runDir) ? fs.readdirSync(runDir) : []) {
		if (!f.endsWith(".json")) continue;
		const p = path.join(runDir, f);
		let meta;
		try { meta = JSON.parse(fs.readFileSync(p, "utf8")); } catch { continue; }
		if (!alive(meta.pid)) {
			// 異常終了で残ったメタ・ソケットを掃除する
			fs.rmSync(p, { force: true });
			fs.rmSync(meta.socket, { force: true });
			continue;
		}
		const state = await probe(meta.socket);
		const ab = meta.abducoSession ? sessions.find((s) => s.name === meta.abducoSession) : undefined;
		out.push({ ...meta, reachable: !!state, status: state?.status ?? meta.status, session: state?.session ?? meta.session, pcAttached: ab?.attached ?? null });
	}
	return out;
}

function spawnPi(cwd) {
	const instanceId = randomUUID();
	const name = `pimate-${instanceId.slice(0, 8)}`;
	const env = { ...process.env, PIMATE_INSTANCE_ID: instanceId, PIMATE_ORIGIN: "mobile", PIMATE_ABDUCO_SESSION: name, PIMATE_RUN_DIR: runDir };
	const cmd = [abduco, "-n", name, "pi", "-e", extPath, ...piArgs];
	// systemd-scope: Hostのサービス停止でcgroupごとPiが殺されないよう、別スコープで起動する
	const argv = spawnMode === "systemd-scope" ? ["systemd-run", "--user", "--scope", "--quiet", `--unit=${name}`, ...cmd] : cmd;
	const child = spawn(argv[0], argv.slice(1), { cwd, env, stdio: "ignore", detached: true });
	child.unref();
	return { instanceId, abducoSession: name, attachCommand: `abduco -a ${name}` };
}

http
	.createServer(async (req, res) => {
		const url = new URL(req.url, "http://x");
		const json = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body, null, 2)); };
		try {
			if (req.method === "GET" && url.pathname === "/instances") return json(200, await list());
			if (req.method === "POST" && url.pathname === "/spawn") {
				const cwd = url.searchParams.get("cwd") || os.homedir();
				if (!fs.existsSync(cwd)) return json(400, { error: "no_such_cwd" });
				return json(200, spawnPi(cwd));
			}
			json(404, { error: "not_found" });
		} catch (e) {
			json(500, { error: String(e) });
		}
	})
	.listen(port, "127.0.0.1", () => console.log(`pimate host pid=${process.pid} port=${port} abduco=${abduco} mode=${spawnMode}`));
