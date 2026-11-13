// 舞台の上の部品（見出し・ロゴ・通知・タイルなど）を置き、シーンから使う共通の動きを用意する。
import { cue } from "./cues.js";
import { $, $$, clamp01, ease, el, gsap, maskLines, onFrame, prog, rectIn, rng, tl } from "./engine.js";
import { QR } from "./qr.js";
import { app, applyPalette, mix, stage } from "./tokens.js";
import { ic, mark, markMono, piLogo, spin } from "./ui.js";

export const W = 1920;
export const H = 1080;

/* ---------------- 見出し ---------------- */

const CAPS = {
	c1: { cls: "center", size: "sm", lines: ["Pi が、あなたの返事を待っている。"], en: "YOUR AGENT NEEDS AN ANSWER. YOU'RE AWAY FROM YOUR DESK." },
	c2: { no: "01", tag: "CONNECT", lines: ["PC の Pi に、", "スマホからつながる。"], en: "CONNECT TO THE PI RUNNING ON YOUR PC." },
	c3: { no: "02", tag: "LAUNCH", lines: ["新しい Pi を、", "スマホから起動。"], en: "START A NEW PI FROM YOUR PHONE." },
	c4: { no: "03", tag: "SYNC", lines: ["PC とスマホは、", "いつも同期。"], en: "YOUR PC AND PHONE, ALWAYS IN SYNC." },
	c5: { no: "04", tag: "RESILIENT", lines: ["切れても、", "Pi は止まらない。"], en: "CONNECTIONS DROP. YOUR PI KEEPS WORKING." },
	c6a: { no: "05", tag: "GROK BOT", cls: "center", size: "sm", lines: ["Grok Bot に頼めば、PC の Pi が動く。"], en: "ASK GROK BOT. PI RUNS ON YOUR PC." },
	c6b: { no: "05", tag: "GROK BOT", cls: "center", size: "sm", lines: ["Pi の質問も完了も、会話に届く。"], en: "QUESTIONS AND RESULTS COME BACK TO THE CHAT." },
	c7: { no: "06", tag: "TOOLKIT", size: "sm", lines: ["必要なものは、ぜんぶ手の中に。"], en: "EVERYTHING ELSE YOU NEED, BUILT IN." },
	c8: { no: "07", tag: "SETUP", cls: "center", size: "sm", lines: ["はじめるのは、3 ステップ。"], en: "UP AND RUNNING IN THREE STEPS." },
};
export const CHAPTERS = 7;

function capHTML(id, c) {
	const meta = c.no ? `<div class="cap-meta"><span class="no">${c.no}</span><i class="bar"></i><span>${c.tag}</span></div>` : "";
	return `
<div class="cap ${c.cls ?? ""}" id="${id}">
	${meta}
	<h2 class="cap-h ${c.size ?? ""}">${c.lines.map((l) => `<span class="ln">${l}</span>`).join("")}</h2>
	<div class="cap-en">${c.en}</div>
</div>`;
}

const capParts = {};
export const parts = (id) => capParts[id];

/** 見出しを出す。行は下から、英語の行は少し遅れて出る。 */
export function capIn(id, at, { y, x } = {}) {
	const node = $(`#${id}`);
	const p = capParts[id];
	if (y !== undefined) gsap.set(node, { y });
	if (x !== undefined) gsap.set(node, { x });
	tl.set(node, { autoAlpha: 1 }, at);
	if (p.meta) {
		tl.fromTo(p.meta, { opacity: 0, x: -14 }, { opacity: 1, x: 0, duration: 0.5, ease: "power3.out" }, at);
		tl.fromTo(p.bar, { scaleX: 0 }, { scaleX: 1, duration: 0.6, ease: "power3.out" }, at + 0.1);
	}
	tl.fromTo(p.lines, { yPercent: 112 }, { yPercent: 0, duration: 0.85, ease: "swift", stagger: 0.1 }, at + 0.08);
	tl.fromTo(p.en, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" }, at + 0.42);
	const c = CAPS[id];
	if (c.no) chapter(Number(c.no), at);
}

export function capOut(id, at, { dur = 0.4 } = {}) {
	const node = $(`#${id}`);
	const p = capParts[id];
	tl.to(p.lines, { yPercent: -112, duration: dur, ease: "power3.in", stagger: 0.04 }, at);
	tl.to([p.meta, p.en].filter(Boolean), { opacity: 0, duration: dur * 0.8, ease: "power2.in" }, at);
	tl.set(node, { autoAlpha: 0 }, at + dur + 0.1);
}

function chapter(n, at) {
	const cells = $$("#chapters i");
	cells.forEach((c, i) => {
		const on = i === n - 1;
		const col = ["var(--blue)", "var(--coral)", "var(--yellow)"][i % 3];
		tl.to(c, { opacity: on ? 1 : i < n - 1 ? 0.42 : 0.16, backgroundColor: on ? col : "var(--ink)", scale: on ? 1.25 : 1, duration: 0.35, ease: "power2.out" }, at);
	});
}

/* ---------------- 舞台とスマホの配色 ---------------- */

export const theme = { stage: 1, phone: 0 };
let lastStage = -1;
let lastPhone = -1;
function applyTheme() {
	if (theme.stage !== lastStage) {
		applyPalette($("#stage"), stage.light, stage.dark, theme.stage);
		lastStage = theme.stage;
	}
	if (theme.phone !== lastPhone) {
		applyPalette($("#phone"), app.light, app.dark, theme.phone);
		lastPhone = theme.phone;
	}
}

/* ---------------- マスの波（場面の切り替え） ---------------- */

const COLS = 16;
const ROWS = 9;
const wipes = [];

/** at から dur 秒で、origin のマスから波のように color で画面を覆う。覆い終えた瞬間に消える。 */
export function wipe(at, { dur = 0.55, color, origin = [8, 4], seed = 1 } = {}) {
	const r = rng(seed);
	const accents = Array.from({ length: COLS * ROWS }, () => (r() < 0.16 ? Math.floor(r() * 3) : -1));
	const far = Math.max(...[0, COLS - 1].flatMap((c) => [0, ROWS - 1].map((w) => Math.hypot(c - origin[0], w - origin[1]))));
	wipes.push({ at, dur, color, origin, accents, far });
	cue("wipe", at, { dur });
}

function drawWipes(t) {
	const box = $("#wipe");
	const w = wipes.find((x) => t >= x.at && t < x.at + x.dur);
	if (!w) {
		if (box.style.display !== "none") box.style.display = "none";
		return;
	}
	box.style.display = "";
	const cells = box.children;
	const cellDur = w.dur * 0.42;
	const brand = [stage.dark.blue, stage.dark.coral, stage.dark.yellow];
	for (let row = 0; row < ROWS; row++) {
		for (let col = 0; col < COLS; col++) {
			const i = row * COLS + col;
			const d = Math.hypot(col - w.origin[0], row - w.origin[1]) / w.far;
			const acc = w.accents[i];
			const start = w.at + d * (w.dur - cellDur) - (acc >= 0 ? 0.07 : 0);
			const p = ease.out3(prog(t, start, start + cellDur));
			const node = cells[i];
			node.style.transform = `scale(${p * 1.02})`;
			node.style.background = acc >= 0 ? mix(brand[acc], w.color, prog(t, w.at + w.dur - 0.16, w.at + w.dur - 0.03)) : w.color;
		}
	}
}

/* ---------------- スマホとターミナルの位置 ---------------- */

/** スマホの中心 (cx, cy) と倍率から、GSAP に渡す値を作る。 */
export const pose = (cx, cy, s) => ({ x: cx - 207 * s, y: cy - 434 * s, scale: s });

/** ヘッダーの状態（入力待ち・作業中・待機・再接続中）を切り替える。 */
export function status(k, key, at) {
	for (const s of $$(`#st${k} > span`)) tl.set(s, { autoAlpha: s.dataset.k === key ? 1 : 0 }, at);
}

/** ツールの行の印を、回転（実行中）か点（完了）にする。 */
export function toolMark(id, state, at) {
	const row = $(`#${id}`);
	tl.set($(".mk .dot", row), { autoAlpha: state === "done" ? 1 : 0 }, at);
	tl.set($(".mk .spin", row), { autoAlpha: state === "run" ? 1 : 0 }, at);
}

/** 行が届いた瞬間に、うっすら光らせる。 */
export function flash(node, at, { color = "77,154,191", peak = 0.28, dur = 0.9 } = {}) {
	tl.fromTo(node, { boxShadow: `inset 0 0 0 100px rgba(${color},${peak})` }, { boxShadow: `inset 0 0 0 100px rgba(${color},0)`, duration: dur, ease: "power2.out", immediateRender: false }, at);
}

/* ---------------- タップ ---------------- */

/** target の中央をタップする印を出す。位置はその時刻の配置から求める。 */
export function tap(target, at, { dx = 0, dy = 0, press = true, sound = true, root = $("#pscreen") } = {}) {
	const dot = el('<div class="touch"><i></i><b></b></div>');
	root.appendChild(dot);
	const a = at - 0.24;
	onFrame((t) => {
		if (t < a - 0.05 || t > at + 0.6) return;
		const r = rectIn(target, root);
		gsap.set(dot, { x: r.x + r.w / 2 + dx, y: r.y + r.h / 2 + dy });
	});
	tl.fromTo(dot, { opacity: 0, scale: 1.5 }, { opacity: 1, scale: 1, duration: 0.2, ease: "power2.out" }, a);
	tl.to(dot, { scale: 0.8, duration: 0.07, ease: "power2.in" }, at - 0.03);
	tl.to(dot, { scale: 1, duration: 0.2, ease: "power2.out" }, at + 0.05);
	tl.to(dot, { opacity: 0, duration: 0.2, ease: "power1.in" }, at + 0.24);
	tl.fromTo($("b", dot), { opacity: 0.9, scale: 1 }, { opacity: 0, scale: 2.3, duration: 0.5, ease: "power2.out" }, at);
	if (press) {
		tl.to(target, { scale: 0.965, duration: 0.08, ease: "power2.out" }, at);
		tl.to(target, { scale: 1, duration: 0.28, ease: "power2.out" }, at + 0.09);
	}
	if (sound) cue("tap", at);
	return dot;
}

/* ---------------- つながりの線 ---------------- */

const packets = [];
let linkLen = 0;

const shapes = [];
let shapeNow = null;

/**
 * PC とスマホを結ぶ線の形を決める（x1,y1 が PC 側）。
 * 線は 1 本を使い回している。場面によって形を変えるときは、その形を使い始める時刻を from に渡す。
 */
export function linkShape(x1, y1, x2, y2, from = 0) {
	const dx = (x2 - x1) * 0.5;
	const shape = { from, d: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`, len: 0 };
	for (const p of $$("#link path")) p.setAttribute("d", shape.d);
	shape.len = $("#link-line").getTotalLength();
	shapes.push(shape);
	setShape(shape);
	return shape.len;
}

function setShape(shape) {
	for (const p of $$("#link path")) p.setAttribute("d", shape.d);
	$("#link-mask").setAttribute("stroke-dasharray", `${shape.len} ${shape.len}`);
	linkLen = shape.len;
	shapeNow = shape;
}

/** その時刻の形にする。どの時刻へ飛んでも同じ絵になるように、毎フレーム確かめる。 */
function applyShape(t) {
	let cur = shapes[0];
	for (const sh of shapes) if (t >= sh.from) cur = sh;
	if (cur && cur !== shapeNow) setShape(cur);
}

/** 線を PC 側から描く（reverse で消す）。 */
export function linkDraw(at, { dur = 0.7, out = false } = {}) {
	tl.set("#link", { autoAlpha: 1 }, at);
	tl.fromTo("#link-mask", { strokeDashoffset: out ? 0 : linkLen }, { strokeDashoffset: out ? -linkLen : 0, duration: dur, ease: "power2.inOut" }, at);
	if (out) tl.set("#link", { autoAlpha: 0 }, at + dur);
}

/** 線の上を小さなマスが流れる。dir: 1 は PC→スマホ、-1 は逆。 */
export function packet(at, { dir = 1, color = 0, dur = 0.42, sound = false } = {}) {
	packets.push({ at, dir, color, dur });
	if (sound) cue("blip", at + dur, { dir });
}

function drawPackets(t) {
	const pool = $$("#link rect");
	const line = $("#link-line");
	let used = 0;
	for (const p of packets) {
		if (t < p.at || t > p.at + p.dur || used >= pool.length) continue;
		const u = ease.inOut3((t - p.at) / p.dur);
		const pt = line.getPointAtLength(linkLen * (p.dir > 0 ? u : 1 - u));
		const r = pool[used++];
		const fade = Math.min(1, (t - p.at) / 0.06, (p.at + p.dur - t) / 0.08);
		r.setAttribute("x", pt.x - 7);
		r.setAttribute("y", pt.y - 7);
		r.setAttribute("fill", ["var(--blue)", "var(--coral)", "var(--yellow)"][p.color % 3]);
		r.style.opacity = clamp01(fade);
	}
	for (let i = used; i < pool.length; i++) pool[i].style.opacity = 0;
}

/* ---------------- 組み立て ---------------- */

const qrSVG = () => {
	const n = QR.length;
	let d = "";
	QR.forEach((row, y) => {
		[...row].forEach((c, x) => {
			if (c === "1") d += `M${x},${y}h1v1h-1z`;
		});
	});
	return `<svg viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" rx="1.6" fill="#f2f4f7"/><path d="${d}" fill="#0b111d"/></svg>`;
};

const bigRing = (id, label) => `
<div class="ug"><svg width="84" height="84" viewBox="0 0 84 84" fill="none" stroke-width="7"><circle class="trk" cx="42" cy="42" r="35"/><circle class="val" id="${id}" cx="42" cy="42" r="35" transform="rotate(-90 42 42)" stroke-dasharray="0 220"/></svg><b id="${id}-n">0%</b><span>${label}</span></div>`;

const tilesHTML = `
<div id="tiles">
	<div class="tile"><div class="tile-h"><b>サブエージェント</b><span>SUBAGENTS</span></div><div class="tile-b">
		<div class="sa"><span class="mk">${spin(16)}</span><span>正しさのレビュー</span><em data-sa="252">4:12</em></div>
		<div class="sa"><span class="mk">${spin(16)}</span><span>テストのレビュー</span><em data-sa="252">4:12</em></div>
		<div class="sa" id="sa3"><span class="mk"><i class="dot done"></i>${spin(16)}</span><span>複雑さのレビュー</span><em id="sa3t">2:38</em></div>
		<div class="im-cap">子の作業記録を見て、止めて、割り込める</div>
	</div></div>
	<div class="tile"><div class="tile-h"><b>モデルと Thinking</b><span>MODEL</span></div><div class="tile-b">
		<div class="md"><b>Claude Opus 5.5</b><span>${ic.check(22, 2.4)}</span></div>
		<div class="md-id">anthropic/claude-opus-5-5 · 200K</div>
		<div class="think"><i class="pill" id="think-pill"></i><span>off</span><span>min</span><span>low</span><span>med</span><span>high</span><span>xhigh</span></div>
		<div class="im-cap">切り替えは、PC の Pi にもそのまま反映</div>
	</div></div>
	<div class="tile"><div class="tile-h"><b>コンテキストと利用枠</b><span>USAGE</span></div><div class="tile-b">
		<div class="ugs">${bigRing("ug1", "コンテキスト")}${bigRing("ug2", "Claude")}${bigRing("ug3", "Codex")}</div>
		<div class="im-cap">使った量とリセットまでの時間を、ひと目で</div>
	</div></div>
	<div class="tile"><div class="tile-h"><b>通知</b><span>NOTIFICATIONS</span></div><div class="tile-b">
		<div class="nt"><i class="dot wait"></i>Pi が入力を待っています</div>
		<div class="nt"><i class="dot done"></i>Pi の作業が完了しました</div>
		<div class="nt"><i class="dot fail"></i>Pi の処理に失敗しました</div>
		<div class="im-cap">アプリが PC とつながっている間に届く</div>
	</div></div>
	<div class="tile"><div class="tile-h"><b>Issue と PR</b><span>GITHUB</span></div><div class="tile-b">
		<div class="gh"><span class="i">${ic.issue(20)}</span><em>#128</em><span>リダイレクト先が戻らない</span></div>
		<div class="gh"><span class="i">${ic.pr(20)}</span><em>#131</em><span>メールリンク認証を追加</span></div>
		<div class="gh-st"><span>${ic.check(16, 2.6)}CI 成功</span><span>+103 −9</span><span>レビュー待ち</span></div>
		<div class="im-cap">その Pi のリポジトリを読んで、Pi に依頼</div>
	</div></div>
	<div class="tile"><div class="tile-h"><b>画像の添付</b><span>IMAGES</span></div><div class="tile-b">
		<div class="imgs"><i class="im im1"></i><i class="im im2"></i><i class="im im3"></i><i class="im add">${ic.plus(26)}</i></div>
		<div class="im-cap">スクリーンショットをそのまま Pi へ。最大 4 枚</div>
	</div></div>
	<div class="tile"><div class="tile-h"><b>セッション操作</b><span>SESSIONS</span></div><div class="tile-b">
		<div class="cmds"><span>/new</span><span>/resume</span><span>/tree</span><span>/fork</span><span>/compact</span></div>
		<div class="im-cap">分岐・圧縮・ツリーも、PC の Pi と同じセッションで</div>
	</div></div>
	<div class="tile"><div class="tile-h"><b>変更の確認</b><span>REVIEW</span></div><div class="tile-b">
		<div class="tdiff"><div class="tdf"><em>M</em><span>src/auth/LoginForm.tsx</span><i class="p">+24</i><i class="m">−3</i></div>
			<div class="tdl m"><b>−</b>&lt;PasswordField /&gt;</div><div class="tdl p"><b>+</b>&lt;EmailField /&gt;</div><div class="tdl p"><b>+</b>&lt;SendLinkButton /&gt;</div></div>
		<div class="im-cap">ターンごとの差分を見て、そのまま Pi に依頼</div>
	</div></div>
</div>`;

// Grok Bot との会話（05 の場面）。xAI の画面の再現ではなく、会話の流れを示すための簡単なパネル。
const grokHTML = `
<div id="gchat">
	<div class="gc-hd"><span class="gc-av">${markMono("#fff")}</span><div><b>PiMate</b><span>Grok Bot</span></div></div>
	<div class="gc-body">
		<div class="gc-u" id="g-u1"><div>週次レポートを作って</div></div>
		<div class="gc-b" id="g-b1"><div>dev-laptop で Pi を起動しました。</div></div>
		<div class="gc-q" id="g-q"><div class="gc-card"><div class="lb"><i></i>Pi からの質問</div><div class="qt">どの期間をまとめますか？</div><div class="ops"><span id="g-o1">先週</span><span id="g-o2">今月</span></div></div></div>
		<div class="gc-b" id="g-b2"><div>終わりました。<br><code>reports/weekly.md</code> にまとめました。</div></div>
	</div>
	<div class="gc-ft"><span>メッセージ</span><i>${ic.send}</i></div>
</div>
<div class="gpill" id="gp1">${ic.check(18, 2.8)}Pi を起動</div>
<div class="gpill" id="gp2">${ic.check(18, 2.8)}質問を会話へ</div>
<div class="gpill" id="gp3">${ic.check(18, 2.8)}回答を Pi へ</div>
<div class="gpill" id="gp4">${ic.check(18, 2.8)}完了を報告</div>`;

const stepsHTML = `
<div class="step" id="step1"><span class="n" style="background:var(--blue)">1</span><div class="t">PC に PiMate を入れる</div><div class="e">INSTALL</div>
	<div class="v"><div><span class="dim">$ </span><span id="st1-a"></span></div><div><span class="dim">$ </span><span id="st1-b"></span><i class="t-caret" id="st1-c" style="height:19px;vertical-align:-3px"></i></div></div></div>
<div class="step" id="step2"><span class="n" style="background:var(--coral)">2</span><div class="t">Pi の中でセットアップ</div><div class="e">SET UP</div>
	<div class="v"><div class="pi-hd">${piLogo()}<span class="dim">pi</span></div><div class="t-rule"></div><div style="height:46px;display:flex;align-items:center"><span id="st2-a"></span><i class="t-caret" style="height:19px"></i></div><div class="t-rule"></div></div></div>
<div class="step" id="step3"><span class="n" style="background:var(--yellow)">3</span><div class="t">スマホで QR を読み取る</div><div class="e">PAIR</div>
	<div class="v" style="align-items:center"><div id="st3-qr">${qrSVG()}<i id="st3-scan"></i></div><div id="st3-ok">${ic.check(30, 2.8)}<span>ペアリング完了</span></div></div></div>
<div id="setup-note">はじめに、PC とスマホを<b>同じアカウントの Tailscale</b> につないでおきます</div>`;

export const extraText =
	"トップページを速くして pimate attach pimate-4f2a91c0 ~/work/site pi install npm:@phni3j9a/pimate /pimate setup 上の質問に回答すると入力できます Pi にメッセージ 入力待ち 完了 dev-laptop — bash pi — ~/work/web pi — ~/work/site pi — ~/work/reports 0123456789:%秒";

export function mount() {
	const world = $("#world");
	const over = $("#over");

	world.insertAdjacentHTML(
		"afterbegin",
		`<svg id="link"><defs><mask id="link-m" maskUnits="userSpaceOnUse" x="0" y="0" width="1920" height="1080"><path id="link-mask" stroke="#fff" stroke-width="14" fill="none" style="stroke-dasharray:none"/></mask></defs><g mask="url(#link-m)"><path id="link-line"/></g><rect width="14" height="14"/><rect width="14" height="14"/><rect width="14" height="14"/><rect width="14" height="14"/><rect width="14" height="14"/><rect width="14" height="14"/></svg>
		<svg id="link-x" class="abs" width="44" height="44" viewBox="0 0 44 44"><circle cx="22" cy="22" r="20"/><path d="M15 15l14 14M29 15L15 29"/></svg>`,
	);
	for (const [id, c] of Object.entries(CAPS)) world.insertAdjacentHTML("beforeend", capHTML(id, c));
	world.insertAdjacentHTML("beforeend", tilesHTML + stepsHTML + grokHTML);

	$("#wipe").innerHTML = Array.from({ length: COLS * ROWS }, (_, i) => `<i style="left:${(i % COLS) * 120}px;top:${Math.floor(i / COLS) * 120}px"></i>`).join("");

	over.insertAdjacentHTML(
		"beforeend",
		`<div id="logo"><div id="sparks">${Array.from({ length: 16 }, () => '<i class="spark"></i>').join("")}</div>${mark('id="logo-mark"')}<div id="logo-word"><span>PiMate</span></div>
		<div id="logo-tag"><div class="jp">PC の Pi を、ポケットに。</div><div class="en">YOUR PI CODING AGENT, IN YOUR POCKET.</div></div>
		<div id="end-url"><span>github.com/</span>phni3j9a/PiMate</div>
		<div id="end-meta"><span>Android アプリ</span><span>Pi 1.2.0 以上</span><span>Linux の PC</span><span>MIT License</span></div></div>
		<div id="chapters">${"<i></i>".repeat(CHAPTERS)}</div>
		<div id="fine">画面はデザインモックをもとにしたイメージです。実際のアプリとは細部が異なることがあります。<br>記載の会社名・製品名は、各社の商標または登録商標です。</div>`,
	);

	for (const id of Object.keys(CAPS)) {
		const node = $(`#${id}`);
		capParts[id] = { lines: maskLines(node), meta: $(".cap-meta", node), bar: $(".cap-meta .bar", node), en: $(".cap-en", node) };
	}
	applyPalette($("#tiles"), app.dark, app.dark, 0);

	// 背景の光だけを、ゆっくり動かす（文字は動かさない）
	const glow = $("#bg-glow");
	onFrame((t) => {
		const x = Math.sin(t * 0.21) * 70;
		const y = Math.cos(t * 0.17) * 40;
		glow.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(1.12)`;
	});
	onFrame(applyTheme);
	onFrame(drawWipes);
	onFrame(applyShape);
	onFrame(drawPackets);
	// 回転する印とカーソルの点滅は、時刻だけで決める。
	const spins = $$(".spin");
	const carets = $$(".caret, .t-caret");
	const tspins = $$(".t-spin");
	const braille = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
	onFrame((t) => {
		const deg = (t * 400) % 360;
		for (const s of spins) s.style.transform = `rotate(${deg.toFixed(1)}deg)`;
		const on = t % 1.06 < 0.6 ? 1 : 0;
		for (const c of carets) if (!c.dataset.solid) c.style.opacity = on;
		const ch = braille[Math.floor(t * 12.5) % braille.length];
		for (const s of tspins) if (s.textContent !== ch) s.textContent = ch;
	});
}
