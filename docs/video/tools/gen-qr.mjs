#!/usr/bin/env node
// 最後のカードに置く QR（リポジトリの URL）のマス目を src/js/qr.js に書き出す。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";

const url = "https://github.com/phni3j9a/PiMate";
const qr = QRCode.create(url, { errorCorrectionLevel: "M" });
const n = qr.modules.size;
const rows = [];
for (let y = 0; y < n; y++) {
	let row = "";
	for (let x = 0; x < n; x++) row += qr.modules.get(x, y) ? "1" : "0";
	rows.push(row);
}
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/js/qr.js");
fs.writeFileSync(
	out,
	`// tools/gen-qr.mjs が生成するファイル。直接編集しない。\nexport const QR_URL = ${JSON.stringify(url)};\nexport const QR = ${JSON.stringify(rows, null, "\t")};\n`,
);
console.log(`${out}  ${n}×${n}`);
