#!/usr/bin/env node
// mock/*.dc.html から、ブラウザで直接開ける html/*.html と png/*.png を作り直す。
// 使い方: node docs/design/export.mjs   （Chrome / Chromium が必要。CHROME で実行ファイルを指定できる）
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const mockDir = join(root, 'mock');
const htmlDir = join(root, 'html');
const pngDir = join(root, 'png');

const chrome = process.env.CHROME
	?? ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser',
		'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
		.find((c) => {
			try {
				execFileSync(c, ['--version'], { stdio: 'ignore' });
				return true;
			} catch {
				return false;
			}
		});
if (!chrome) {
	console.error('Chrome / Chromium が見つかりません。CHROME=<実行ファイル> を指定してください。');
	process.exit(1);
}

const canvas = JSON.parse(readFileSync(join(mockDir, 'canvas.json'), 'utf8'));
const profile = join(tmpdir(), `pimate-design-export-${process.pid}`);
const run = (args) => execFileSync(chrome, [
	'--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
	`--user-data-dir=${profile}`, '--virtual-time-budget=5000', ...args,
], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });

mkdirSync(htmlDir, { recursive: true });
mkdirSync(pngDir, { recursive: true });

for (const file of canvas.order) {
	const { w, h, title } = canvas.boards[file];
	const name = file.replace(/\.dc\.html$/, '');
	const url = pathToFileURL(join(mockDir, file)).href;

	// support.js で展開した後の DOM を、ランタイムなしで表示できる HTML に整える
	let dom = run(['--dump-dom', url]);
	dom = dom
		.replace(/<script src="\.\/support\.js"><\/script>\s*/, '')
		.replace(/<script type="text\/x-dc"[\s\S]*?<\/script>\s*/, '')
		.replace(/<helmet>\s*<\/helmet>\s*/, '')
		.replace(/<\/?x-dc>/g, '')
		.replace(/<\/head>/, `<meta name="viewport" content="width=${w}">\n</head>`);
	if (!dom.startsWith('<!DOCTYPE')) dom = `<!DOCTYPE html>\n${dom}`;
	writeFileSync(join(htmlDir, `${name}.html`), `${dom.trimEnd()}\n`);

	run([`--window-size=${w},${h}`, '--force-device-scale-factor=2',
		`--screenshot=${join(pngDir, `${name}.png`)}`, pathToFileURL(join(htmlDir, `${name}.html`)).href]);
	console.log(`${name}  ${w}×${h}  ${title}`);
}

if (existsSync(profile)) rmSync(profile, { recursive: true, force: true });

// 一覧ページ。canvas.json の見出し（notes）の下にあるボードを、その見出しのグループにまとめる
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const notes = Object.values(canvas.notes).sort((a, b) => a.y - b.y);
const groups = notes.map((n) => ({ title: n.text, boards: [] }));
for (const file of canvas.order) {
	const b = canvas.boards[file];
	const i = notes.findLastIndex((n) => n.y < b.y);
	groups[Math.max(i, 0)].boards.push({ ...b, name: file.replace(/\.dc\.html$/, '') });
}
const card = (b) => `      <a class="card${b.w > 390 ? ' wide' : ''}" href="html/${b.name}.html">
        <img src="png/${b.name}.png" width="${b.w / 2}" height="${b.h / 2}" alt="" loading="lazy">
        <span class="title">${esc(b.title)}</span>
        <span class="file">${b.name}</span>
      </a>`;
const index = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PiMate 画面モック</title>
<!-- export.mjs が生成するファイル。直接編集しない -->
<style>
:root{--bg:#FFFFFF;--fill:#F1F3F4;--text:#1F2326;--muted:#5E686D;--accent-ink:#155A7A}
html{background:var(--bg)}
body{margin:0;padding:40px 20px 64px;color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Noto Sans JP',system-ui,sans-serif;font-size:14px;line-height:1.5;word-break:auto-phrase}
main{max-width:1180px;margin:0 auto}
h1{margin:0;font-size:22px;font-weight:600}
.lead{margin:8px 0 0;color:var(--muted)}
.lead a{color:var(--accent-ink)}
h2{margin:48px 0 16px;font-size:15px;font-weight:600}
.grid{display:flex;flex-wrap:wrap;gap:32px 24px}
.card{display:flex;flex-direction:column;gap:2px;width:195px;color:inherit;text-decoration:none}
.card.wide{width:min(665px,100%)}
.card img{display:block;width:100%;height:auto;margin-bottom:10px;border-radius:20px;background:var(--fill);outline:1px solid #E6E9EB;outline-offset:-1px}
.card.wide img{border-radius:12px}
.card:hover .title{color:var(--accent-ink)}
.title{font-size:13px;font-weight:600}
.file{font-size:12px;color:var(--muted);font-family:'JetBrains Mono',ui-monospace,Menlo,monospace}
@media (max-width:460px){.grid{gap:28px 16px}.card{width:calc(50% - 8px)}.card.wide{width:100%}}
</style>
</head>
<body>
<main>
  <h1>PiMate 画面モック</h1>
  <p class="lead">画面を選ぶと、実寸（${canvas.boards[canvas.order[0]].w}×${canvas.boards[canvas.order[0]].h}）の HTML を開きます。仕様の正本は <a href="../SPEC.md">docs/SPEC.md</a>、このモックの使い方は <a href="README.md">README.md</a> を参照してください。</p>
${groups.filter((g) => g.boards.length).map((g) => `  <h2>${esc(g.title)}</h2>
  <div class="grid">
${g.boards.map(card).join('\n')}
  </div>`).join('\n')}
</main>
</body>
</html>
`;
writeFileSync(join(root, 'index.html'), index);
console.log('index.html');
