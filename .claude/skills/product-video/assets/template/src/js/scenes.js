// 動画の中身。mount() で部品を置き、animate() で動きを積む。動画ごとに書き換える。
// ここにあるのは見本（架空の製品 Tasklet の 30 秒）。部品の使い方の例として読める。
//
// 書き方の決まり:
//   - 時刻は秒。場面の頭は plan.js の T（小節の頭）を使い、場面の中は「T.demo + 2.0」のように書く
//   - 動きは tl.*（いつ・何を・どこへ）で積む。文字送りや数字は label / typed などで時刻から決める
//   - 音は cue("種類", 時刻) で積む。動きと同じ行の近くに書くと、ずれない
//   - 1 場面ぶん書いたら「node render.mjs --sheet 開始:終了:0.5」で並べて見て、直してから次へ進む
import { brand } from "./brand.js";
import { cue } from "./kit/cue.js";
import { $, $$, ease, onFrame, prog, set, tl } from "./kit/engine.js";
import { closeNow, flash, label, openRow, swap, toggle, typed, typedEnd } from "./kit/helpers.js";
import { animateMarks, browser, capIn, capOut, caption, chapters, connector, endCard, fadeFromBlack, fadeToBlack, logoLockup, logoReveal, logoToCorner, mountLogo, mountStage, palette, phone, pointer, pose, taglineIn, taglineOut, tap, tiles, tilesIn, tilesOut, wipe } from "./kit/stage.js";
import { T } from "./plan.js";

/* ---------------- 製品の画面（作り直し） ---------------- */

const check = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;
const state = `<span class="state"><span data-state="doing">進行中</span><span data-state="done">完了</span></span>`;
const TASKS = [
	{ id: "a", name: "キャンペーンの告知文", who: "佐藤" },
	{ id: "b", name: "LP のデザイン確認", who: "鈴木" },
	{ id: "c", name: "計測タグの設置", who: "田中" },
	{ id: "d", name: "バナーの入稿", who: "自分" }, // 途中で追加される
];

const boardHTML = `
<div class="ui-board">
	<div class="top"><b>春のキャンペーン</b><span id="w-count"></span><span class="meter"><i id="w-meter"></i></span></div>
	<div class="list">
		${TASKS.map((t) => `<div class="row" id="w-${t.id}"><span class="box">${check}</span><span class="name">${t.name}</span><span class="who">${t.who}</span>${state}</div>`).join("")}
		<div class="add" id="w-add"><span>＋</span><span class="typed" id="w-typed"></span><i class="caret" id="w-caret" data-solid="1"></i><span id="w-hint">タスクを追加</span></div>
	</div>
</div>`;

const appHTML = `
<div class="screen ui-app">
	<div class="head">春のキャンペーン</div>
	<div class="items">${TASKS.map((t) => `<div class="item" id="p-${t.id}"><span class="box">${check}</span><span class="name">${t.name}</span>${state}</div>`).join("")}</div>
	<div class="foot"><b id="p-count"></b> 件が完了</div>
</div>`;

let win;
let ph;
let link;
let grid;

/* ---------------- 部品を置く ---------------- */

export function mount() {
	mountStage({ theme: "dark" }); // 冒頭は暗い場面から始める
	const world = $("#world");

	// 冒頭の吹き出し（困りごと）
	world.insertAdjacentHTML(
		"beforeend",
		`<div class="hook-msg"><small>営業 · 10:02</small>あの件、どうなりました？</div>
		<div class="hook-msg"><small>部長 · 10:40</small>進捗、教えてもらえますか？</div>
		<div class="hook-msg"><small>デザイン · 11:15</small>これ、誰が持ってます？</div>`,
	);

	// 見出し。1 場面に 1 つ。言いたいことは 1 つに絞る
	caption("c0", { center: true, size: "sm", lines: ["その進捗、また聞いてる。"], en: "ASKING FOR STATUS. AGAIN." });
	caption("c1", { no: "01", tag: "SYNC", lines: ["PC で進めると、", "スマホにもすぐ届く。"], en: "UPDATE ON YOUR PC. SEE IT ON YOUR PHONE." });
	caption("c2", { no: "02", tag: "MORE", size: "sm", lines: ["ほかにも、チームに必要なものを。"], en: "AND THE REST YOUR TEAM NEEDS." });

	// 製品の画面を入れる入れ物
	// 中の文字が画面上で 18px 以上になるよう、小さめに作って 1.3 倍で置く（ブラウザを拡大表示した状態）
	win = browser("win", boardHTML, { url: "tasklet.example.com/spring", w: 720, h: 408 });
	ph = phone("ph", appHTML);
	palette([win.node, ph.node], brand.app);
	link = connector("link");

	// 機能のタイル
	grid = tiles("more", {
		cols: 3,
		w: 540,
		h: 330,
		y: 440,
		items: [
			{ title: "通知", tag: "NOTIFICATIONS", body: `<div class="t-note"><i style="background:var(--c3)"></i>期限が明日です</div><div class="t-note"><i style="background:var(--c1)"></i>確認をお願いします</div>`, foot: "必要なときだけ、必要な人に届く" },
			{ title: "今週の進み具合", tag: "PROGRESS", body: `<div class="t-ring"><svg width="130" height="130" viewBox="0 0 130 130" fill="none" stroke-width="12"><circle cx="65" cy="65" r="54" stroke="var(--well)"/><circle id="ring" cx="65" cy="65" r="54" stroke="var(--c1)" stroke-linecap="round" transform="rotate(-90 65 65)" stroke-dasharray="0 400"/></svg><b id="ring-n"></b></div>`, foot: "聞かなくても、数字で分かる" },
			{ title: "つながる", tag: "INTEGRATIONS", body: `<div class="t-chips"><span>カレンダー</span><span>チャット</span><span>メール</span><span>API</span></div>`, foot: "いつもの道具から、そのまま" },
		],
	});

	mountLogo();
	chapters(2);
	animateMarks();
}

/* ---------------- 動きを積む ---------------- */

export function animate() {
	hook();
	logo();
	demo();
	more();
	end();
}

/* 0. 困りごと: 同じことを何度も聞かれる（暗い場面・2 小節） */
function hook() {
	fadeFromBlack(0, 0.9);
	const spots = [
		[210, 150, -2.5],
		[1020, 300, 2],
		[420, 470, -1.5],
	];
	$$(".hook-msg").forEach((m, i) => {
		const at = 0.5 + i * 0.55;
		set(m, { x: spots[i][0], y: spots[i][1], rotate: spots[i][2] });
		tl.in(m, { y: 46, scale: 0.9 }, at, { duration: 0.5, ease: "back(1.8)" });
		cue("pop", at, { i, pan: i === 1 ? 0.4 : -0.3 });
	});
	capIn("c0", 1.9, { y: 760 });

	// 紙の色のマスで覆って、明るい場面へ。覆い終わる T.logo に、色と部品を切り替える
	wipe(T.logo - 0.55, { color: brand.light.paper, origin: [8, 4], seed: 7 });
	palette("#stage", brand.light, T.logo);
	tl.hide([".hook-msg", "#c0"], T.logo);
}

/* 1. ロゴとひとこと（2 小節） */
function logo() {
	const t0 = T.logo;
	// 暗い場面の上を飛んでくる間も、明るい場面の色で描く
	palette("#logo-mark", { c1: brand.light.c1, c2: brand.light.c2, c3: brand.light.c3 });
	logoReveal(t0); // 部品が 16 分音符ごとにはまる
	logoLockup(t0 + 0.9);
	taglineIn(t0 + 1.7);
	taglineOut(t0 + 3.0);
	logoToCorner(t0 + 3.1); // 左上に小さく収まり、最後まで残る
	tl.fromTo(["#bg-grid", "#bg-glow"], { opacity: 0 }, { opacity: 1, duration: 1.2, ease: "out2" }, t0);
	set(["#bg-grid", "#bg-glow"], { opacity: 0 });
}

/* 2. 本編: PC で動かすと、スマホにも届く（5 小節） */
function demo() {
	const t0 = T.demo;
	const WIN = { x: 128, y: 486, scale: 1.3 };
	const PH = pose(ph, 1500, 540, 1.1);

	// 最初の状態: a は完了済み、d はまだ無い
	for (const where of ["w", "p"]) closeNow($(`#${where}-d`));
	const doneAt = { a: 0, b: t0 + 2.0, c: t0 + 6.9, d: Number.POSITIVE_INFINITY };
	const addAt = t0 + 5.1;
	for (const [id, at] of Object.entries(doneAt)) {
		for (const [where, lag] of [["w", id === "c" ? 0.3 : 0], ["p", id === "c" ? 0 : 0.3]]) {
			const row = $(`#${where}-${id}`);
			toggle(row, "done", [at + lag]);
			swap($(".state", row), [[0, "doing"], [at + lag, "done"]]);
		}
	}
	const count = (t, lag) => (t >= doneAt.c + lag ? 3 : t >= doneAt.b + lag ? 2 : 1);
	const total = (t, lag) => (t >= addAt + lag ? 4 : 3);
	label($("#w-count"), (t) => `${total(t, 0)} 件中 ${count(t, 0.3)} 件が完了`);
	label($("#p-count"), (t) => `${count(t, 0)} / ${total(t, 0.3)}`);
	onFrame((t) => {
		// 進み具合の棒は、なめらかに伸びる
		const p = (1 + ease.out3(prog(t, doneAt.b, doneAt.b + 0.5)) + ease.out3(prog(t, doneAt.c + 0.3, doneAt.c + 0.8))) / (3 + ease.out3(prog(t, addAt, addAt + 0.5)));
		$("#w-meter").style.transform = `scaleX(${p.toFixed(4)})`;
	});

	// 登場: 入れ物は 1 秒ほどで動かしきる（文字をゆっくり動かすと震える）
	set(win.node, WIN);
	set(ph.node, PH);
	tl.in(win.node, { x: -1100 }, t0 - 0.6, { duration: 0.95, ease: "swift" });
	tl.in(ph.node, { y: 300 }, t0 - 0.45, { duration: 0.95, ease: "swift" });
	cue("whoosh", t0 - 0.6);
	tl.to("#chapters", { opacity: 1, duration: 0.5 }, t0);
	capIn("c1", t0, { y: 116 });
	link.shape(WIN.x + win.w * WIN.scale + 12, WIN.y + 300, PH.x - 12, 540);
	link.draw(t0 + 0.6);

	// PC で「完了」にすると、スマホの同じ行も変わる
	const mouse = pointer(win).show(t0 + 1.1, [520, 300]);
	mouse.click($("#w-b .box"), doneAt.b, { dur: 0.7 });
	link.packet(doneAt.b + 0.02, { color: 0, dur: 0.3 });
	flash($("#p-b"), doneAt.b + 0.3);
	cue("row", doneAt.b + 0.3, { hi: true, pan: 0.5 });

	// PC でタスクを足すと、スマホにも現れる
	const text = TASKS[3].name;
	const typeAt = t0 + 3.6;
	mouse.click($("#w-add"), t0 + 3.3, { dur: 0.7, press: false });
	label($("#w-typed"), (t) => (t < addAt ? typed(text, t, typeAt, 7) : ""));
	onFrame((t) => {
		const editing = t >= t0 + 3.3 && t < addAt;
		$("#w-hint").style.display = editing ? "none" : "";
		$("#w-caret").style.opacity = editing ? 1 : 0;
	});
	cue("type", typeAt, { dur: typedEnd(text, typeAt, 7) - typeAt, n: [...text].length, key: true, pan: -0.4 });
	cue("enter", addAt, { pan: -0.4 });
	openRow($("#w-d"), addAt);
	link.packet(addAt + 0.02, { color: 1, dur: 0.3 });
	openRow($("#p-d"), addAt + 0.3);
	flash($("#p-d"), addAt + 0.45);
	cue("row", addAt + 0.3, { hi: true, pan: 0.5 });
	mouse.hide(t0 + 6.0);

	// スマホで「完了」にすると、PC の行も変わる（逆向きにも届く）
	tap(ph, $("#p-c .box"), doneAt.c);
	link.packet(doneAt.c + 0.02, { dir: -1, color: 2, dur: 0.3 });
	flash($("#w-c"), doneAt.c + 0.3);
	cue("row", doneAt.c + 0.3, { pan: -0.4 });
	cue("done", doneAt.c + 0.5, { pan: 0.4 });

	// 退場して、暗い場面へ
	capOut("c1", T.more - 0.9);
	link.draw(T.more - 0.9, { dur: 0.35, out: true });
	wipe(T.more - 0.55, { color: brand.dark.paper, origin: [13, 4], seed: 23 });
	palette("#stage", brand.dark, T.more);
	tl.hide([win.node, ph.node], T.more);
}

/* 3. ほかの機能をタイルで畳みかける（3 小節・曲はいちばん盛り上がる） */
function more() {
	const t0 = T.more;
	capIn("c2", t0 + 0.1, { y: 196 });
	const at = tilesIn(grid, t0 + 0.5, 0.5); // 1 拍ごとに 1 枚

	// タイルの中も少し動かす（止まった絵にしない）
	set($$(".t-note", grid.items[0]), { opacity: 0, x: 30 });
	tl.to($$(".t-note", grid.items[0]), { opacity: 1, x: 0, duration: 0.45, ease: "out3", stagger: 0.18 }, at(0) + 0.2);
	const C = 2 * Math.PI * 54;
	onFrame((t) => {
		const p = (8 / 12) * ease.out5(prog(t, at(1) + 0.2, at(1) + 1.5));
		$("#ring").setAttribute("stroke-dasharray", `${(C * p).toFixed(2)} ${C.toFixed(2)}`);
		$("#ring-n").textContent = `${Math.round(p * 12)} / 12`;
	});
	set($$(".t-chips span", grid.items[2]), { opacity: 0, scale: 0.7 });
	tl.to($$(".t-chips span", grid.items[2]), { opacity: 1, scale: 1, duration: 0.4, ease: "back(1.8)", stagger: 0.08 }, at(2) + 0.2);

	capOut("c2", T.end - 0.75);
	tilesOut(grid, T.end - 0.75);
	tl.to("#chapters", { opacity: 0, duration: 0.3 }, T.end - 0.75);
	cue("whoosh", T.end - 0.7);
}

/* 4. 最後のカード（3 小節） */
function end() {
	endCard(T.end);
	fadeToBlack(T.total - 1.3);
}
