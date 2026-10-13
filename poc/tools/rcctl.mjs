#!/usr/bin/env node
// PoC用クライアント: Remote Control Extensionのソケットに接続してコマンド送信・イベント表示を行う。
// 使い方:
//   rcctl.mjs list
//   rcctl.mjs <instanceId|sockPath> <cmd> [json-args] [--watch <ms>]
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const dir = process.env.PIMATE_RUN_DIR || (process.env.XDG_RUNTIME_DIR ? path.join(process.env.XDG_RUNTIME_DIR, "pimate") : path.join(os.tmpdir(), `pimate-${process.getuid()}`));
const [target, cmd, argJson, ...rest] = process.argv.slice(2);

function alive(pid) {
	try { process.kill(pid, 0); return true; } catch { return false; }
}

if (target === "list") {
	const out = [];
	for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
		if (!f.endsWith(".json")) continue;
		const m = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
		out.push({ ...m, alive: alive(m.pid) });
	}
	console.log(JSON.stringify(out, null, 2));
	process.exit(0);
}

const sock = target.endsWith(".sock") ? target : path.join(dir, `${target}.sock`);
const watchIdx = rest.indexOf("--watch");
const watchMs = watchIdx >= 0 ? Number(rest[watchIdx + 1]) : 0;
const c = net.createConnection(sock);
let buf = "";
c.setEncoding("utf8");
c.on("connect", () => c.write(JSON.stringify({ id: 1, cmd, ...(argJson ? JSON.parse(argJson) : {}) }) + "\n"));
c.on("data", (d) => {
	buf += d;
	let i;
	while ((i = buf.indexOf("\n")) >= 0) {
		const line = buf.slice(0, i);
		buf = buf.slice(i + 1);
		console.log(line);
		const m = JSON.parse(line);
		if (m.type === "response" && !watchMs) c.end();
	}
});
c.on("error", (e) => { console.error("error:", e.message); process.exit(2); });
if (watchMs) setTimeout(() => c.end(), watchMs);
