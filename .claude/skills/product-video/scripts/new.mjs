#!/usr/bin/env node
// 雛形（assets/template）を作業先へ複製する。
//   node <このスキルのフォルダ>/scripts/new.mjs video        → ./video に作る
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const template = path.join(path.dirname(fileURLToPath(import.meta.url)), "../assets/template");
const dest = path.resolve(process.argv[2] ?? "video");
if (fs.existsSync(dest) && fs.readdirSync(dest).length) {
	console.error(`${dest} には既にファイルがあります。別の場所を指定してください`);
	process.exit(1);
}
const skip = new Set(["node_modules", "out"]);
fs.cpSync(template, dest, { recursive: true, filter: (src) => !skip.has(path.basename(src)) });
console.log(`${dest} に雛形を作りました。\n  cd ${path.relative(process.cwd(), dest) || "."}\n  npm install --ignore-scripts\n  node render.mjs --sheet 0:29:2      # 見本動画の一覧が out/sheet.png に出れば準備完了`);
