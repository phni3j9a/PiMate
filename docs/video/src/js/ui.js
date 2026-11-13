// 画面の部品（スマホ・ターミナル）の HTML を組み立てる。
// アイコンは画面モック（docs/design）と同じ単純な線画。

const S = (d, { w = 20, sw = 2, vb = 24, fill = "none", extra = "" } = {}) =>
	`<svg width="${w}" height="${w}" viewBox="0 0 ${vb} ${vb}" fill="${fill}" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;

export const ic = {
	menu: S('<path d="M4 8h16M4 16h10"/>', { w: 22, sw: 1.9 }),
	more: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>`,
	down: (w = 14) => S('<path d="M6 9l6 6 6-6"/>', { w }),
	up: (w = 14) => S('<path d="M6 15l6-6 6 6"/>', { w }),
	right: (w = 16) => S('<path d="M9 6l6 6-6 6"/>', { w }),
	back: S('<path d="M15 5l-7 7 7 7"/>', { w: 24, sw: 2.1 }),
	plus: (w = 20) => S('<path d="M12 5v14M5 12h14"/>', { w, sw: 1.9 }),
	send: S('<path d="M12 19V5M6 11l6-6 6 6"/>', { w: 18, sw: 2.2 }),
	stop: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" stroke="none"/></svg>`,
	x: (w = 22) => S('<path d="M6 6l12 12M18 6L6 18"/>', { w }),
	check: (w = 20, sw = 2.2) => S('<path d="M5 12.5l4.5 4.5L19 7.5"/>', { w, sw }),
	search: S('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>', { w: 16 }),
	bell: (w = 14) => S('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>', { w }),
	laptop: (w = 15) => S('<path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9H4z"/><path d="M2 19h20"/>', { w }),
	server: (w = 15) =>
		S('<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>', { w }),
	phone: (w = 15) => S('<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18h2"/>', { w }),
	gear: S(
		'<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
		{ w: 22, sw: 1.9 },
	),
	folder: S('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>', { w: 18, sw: 1.8 }),
	copy: S('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>', { w: 18, sw: 1.9 }),
	layers: (w = 12, sw = 2.4) => S('<path d="M12 3 3 8l9 5 9-5-9-5z"/><path d="M3 13l9 5 9-5"/>', { w, sw }),
	steer: S('<path d="M9 14l-4-4 4-4M5 10h9a5 5 0 0 1 5 5v3"/>', { w: 14 }),
	bulb: S('<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/>', { w: 13 }),
	shield: (w = 28) => S('<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2.2 2.2L15 10.5"/>', { w, sw: 1.9 }),
	issue: (w = 18) => S('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>', { w }),
	pr: (w = 18) =>
		S('<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M6 8.5v7M18 15.5V10a4 4 0 0 0-4-4h-2.5M13.5 3.5 11 6l2.5 2.5"/>', { w }),
	wifi: (w = 22) => S('<path d="M2.5 9a15 15 0 0 1 19 0M5.5 12.5a10 10 0 0 1 13 0M8.5 16a5.5 5.5 0 0 1 7 0"/><path d="M12 19.5h.01"/>', { w }),
	terminal: (w = 22) => S('<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M7 9l3 3-3 3M13 15h4"/>', { w }),
	branch: (w = 18) => S('<circle cx="6" cy="5" r="2.5"/><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="8" r="2.5"/><path d="M6 7.5v9M18 10.5c0 4-6 3-10.5 5.5"/>', { w }),
};

export const spin = (w = 13) =>
	`<svg class="spin" width="${w}" height="${w}" viewBox="0 0 16 16" fill="none" stroke-width="2"><circle class="trk" cx="8" cy="8" r="6"/><path class="arc" d="M8 2a6 6 0 0 1 6 6"/></svg>`;

/** PiMate のマーク（Mt）。形は docs/design/icon-kit/source/geometry.json と同じ。 */
export const MARK = {
	blue1: "M0,0L101,0L204,107L204,224L175,224L112,180L112,361L0,361Z",
	blue2: "M204,224L300,224L300,332L204,332Z",
	coral: "M204,107L313,0L388,0L388,224L300,224L300,134L204,134Z",
	yellow1: "M388,134L460,134L460,224L388,224Z",
	yellow2: "M300,224L388,224L388,320L460,320L460,408L300,408Z",
};
export const mark = (attrs = "") =>
	`<svg viewBox="0 0 460 408" ${attrs}><path class="mk-blue" data-p="blue1" d="${MARK.blue1}"/><path class="mk-blue" data-p="blue2" d="${MARK.blue2}"/><path class="mk-coral" data-p="coral" d="${MARK.coral}"/><path class="mk-yellow" data-p="yellow1" d="${MARK.yellow1}"/><path class="mk-yellow" data-p="yellow2" d="${MARK.yellow2}"/></svg>`;
export const markMono = (fill = "#fff") =>
	`<svg viewBox="0 0 460 408"><path fill="${fill}" d="${Object.values(MARK).join("")}"/></svg>`;

/** Pi のロゴ（4×4 のマス）。画面モックの「PC の Pi の見本」と同じ形。 */
export const piLogo = (c = { coral: "#FC7466", blue: "#329DFD", yellow: "#FDCA3D" }) =>
	`<svg viewBox="0 0 4 4"><rect x="0" y="0" width="3" height="1" fill="${c.coral}"/><rect x="2" y="1" width="1" height="1" fill="${c.coral}"/><rect x="0" y="1" width="1" height="3" fill="${c.blue}"/><rect x="1" y="2" width="1" height="1" fill="${c.blue}"/><rect x="3" y="2" width="1" height="2" fill="${c.yellow}"/></svg>`;

const statusbar = `
<div class="statusbar">
	<span class="time">9:41</span>
	<span class="sys">
		<svg width="18" height="12" viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>
		<svg width="16" height="12" viewBox="0 0 16 12"><path d="M8 2.2c2.3 0 4.4.9 6 2.4l1.2-1.3A10.4 10.4 0 0 0 8 .4C5.2.4 2.7 1.5.8 3.3L2 4.6a8.6 8.6 0 0 1 6-2.4zm0 3.6c1.3 0 2.5.5 3.4 1.3l1.2-1.3A6.7 6.7 0 0 0 8 4c-1.8 0-3.4.7-4.6 1.8l1.2 1.3c.9-.8 2.1-1.3 3.4-1.3zM8 9.4c.5 0 .9.2 1.2.5L8 11.6 6.8 9.9c.3-.3.7-.5 1.2-.5z"/></svg>
		<svg width="27" height="13" viewBox="0 0 27 13" fill="none"><rect x="0.5" y="0.5" width="23" height="12" rx="3.5" stroke="currentColor" opacity="0.4"/><rect x="2" y="2" width="20" height="9" rx="2" fill="currentColor"/><path d="M25 4.5v4c.8-.3 1.3-1.1 1.3-2s-.5-1.7-1.3-2z" fill="currentColor" opacity="0.4"/></svg>
	</span>
</div>`;

/** ツールの行。state: done | run（run は後で done に切り替えられるよう両方の印を持つ）。 */
export function tool({ id = "", name, arg, add, del, st }) {
	return `
<div class="tool" ${id ? `id="${id}"` : ""}>
	<span class="mk"><i class="dot done"></i>${spin(13)}</span>
	<span class="nm">${name}</span>
	<span class="arg">${arg}</span>
	${add ? `<span class="st add">+${add}</span>` : ""}
	${del ? `<span class="st del">−${del}</span>` : ""}
	${st ? `<span class="st" data-st>${st}</span>` : ""}
	<span class="chev">${ic.down(14)}</span>
</div>`;
}

const ring = (inner, id) =>
	`<span class="ring"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-width="2"><circle class="trk" cx="12" cy="12" r="10.5"/><circle class="val" ${id ? `id="${id}"` : ""} cx="12" cy="12" r="10.5" transform="rotate(-90 12 12)" stroke-dasharray="0 66"/></svg>${inner}</span>`;

function composer(k, { placeholder, model = "Opus 5.5 · high" }) {
	return `
<div class="ft">
	<div class="queued" id="queued${k}">${ic.steer}<span class="lb">割り込み待ち</span><span class="tx" id="queuedTx${k}"></span></div>
	<div class="comp">
		<div class="comp-in"><span class="ph" id="ph${k}">${placeholder}</span><span><span id="in${k}"></span><i class="caret" id="caret${k}"></i></span></div>
		<div class="comp-row">
			<span class="cb plus">${ic.plus(20)}</span>
			<span class="model">${model}${ic.down(12)}</span>
			<span class="gauges">${ring(ic.layers(12), `g1${k}`)}</span>
			<span class="grow"></span>
			<span class="cb stop" id="stop${k}">${ic.stop}</span>
			<span class="send" id="send${k}">${ic.send}</span>
		</div>
	</div>
</div>`;
}

function header(k, title) {
	return `
<div class="hd">
	<span class="ib">${ic.menu}</span>
	<div class="hd-title" id="title${k}">${title}</div>
	<div class="hd-status" id="st${k}">
		<span class="st-wait" data-k="wait"><i class="dot wait"></i>入力待ち</span>
		<span data-k="work">${spin(13)}作業中 · <span data-tm>0:00</span></span>
		<span data-k="idle"><i class="dot idle"></i>待機</span>
		<span data-k="reconn">${spin(13)}再接続中</span>
	</div>
	<span class="ib dim">${ic.more}</span>
</div>`;
}

const chatA = `
<div class="screen" id="chatA">
	${header("A", "ログイン画面の改修")}
	<div class="tr" id="trA">
		<div class="u first"><div>ログインをメールリンク認証にして</div></div>
		<div class="sum">52秒 作業 · ツール 7 回 · 読み取りのみ ${ic.down(14)}</div>
		<div class="asst">
			<p>現状の構成を確認しました。</p>
			<ul><li><code>LoginForm.tsx</code> はパスワード入力のみ</li><li>認証は <code>/api/session</code> に集約</li></ul>
			<p>実装方針を選んでください。</p>
		</div>
		<section class="q" id="qA">
			<div class="q-lb"><i class="dot wait"></i>選択してください</div>
			<div class="q-t">メールリンクの実装方式は？</div>
			<div class="q-opts">
				<div class="q-opt" id="qA1"><i class="radio"></i><span><span>既存の認証 API を拡張</span><span class="d">変更は 3 ファイル程度</span></span></div>
				<div class="q-opt"><i class="radio"></i><span><span>外部の Magic Link サービスを使う</span><span class="d">SDK の追加と環境変数が必要</span></span></div>
				<div class="q-opt"><i class="radio"></i><span><span>今回は UI の整理だけ</span><span class="d">認証方式は変更しない</span></span></div>
			</div>
			<div class="q-in">その他（自由に入力）</div>
			<div class="q-act"><span class="tb">キャンセル</span><span class="pb" id="qAgo">回答する</span></div>
		</section>
		<div class="tools" id="toolsA">
			${tool({ id: "a-ask", name: "ask", arg: "既存の認証 API を拡張" })}
			${tool({ id: "a-t1", name: "edit", arg: "src/auth/LoginForm.tsx", add: 24, del: 3 })}
			${tool({ id: "a-t2", name: "write", arg: "src/api/magic-link.ts", add: 41 })}
			${tool({ id: "a-t3", name: "write", arg: "src/auth/magic-link.test.ts", add: 32 })}
			${tool({ id: "a-t4", name: "bash", arg: "npm test", st: "0秒" })}
		</div>
		<div class="u" id="a-steer"><div>テストは vitest に合わせて</div></div>
		<div class="tools" id="toolsA2">
			${tool({ id: "a-t5", name: "edit", arg: "src/auth/magic-link.test.ts", add: 6, del: 6 })}
			${tool({ id: "a-t6", name: "bash", arg: "npx vitest run", st: "0秒" })}
			<div class="out" id="a-out"><span> ✓ src/auth/magic-link.test.ts (4 tests)</span>
<span> Test Files  1 passed (1)</span></div>
		</div>
		<div class="asst" id="a-ans"><p>メールリンク認証を追加し、テストを <code>vitest</code> に合わせました。</p></div>
		<div class="meta" id="a-meta">claude-opus-5-5 · 21k in · 1.4k out · $0.38</div>
	</div>
	${composer("A", { placeholder: "上の質問に回答すると入力できます" })}
</div>`;

const inst = ({ id = "", cls = "", mk, t, s, sCls = "", tm }) => `
<div class="inst ${cls}" ${id ? `id="${id}"` : ""}>
	<i class="hl"></i>
	<span class="mk">${mk}</span>
	<span class="bd"><span class="t">${t}</span><span class="s ${sCls}">${s}</span></span>
	<span class="tm">${tm}</span>
</div>`;
const idle = '<i class="dot idle"></i>';
const path = (p, extra = "") => `<span class="mono">${p}</span>${extra}`;

const drawer = `
<div class="scrim" id="scrim"></div>
<div class="drawer" id="drawer">
	<div class="search">${ic.search}<span>Instance・フォルダを検索</span></div>
	<div class="dw-list">
		<div class="grp att">${ic.bell(14)}<span>要対応</span></div>
		${inst({ id: "dw-1", cls: "att", mk: '<i class="dot wait"></i>', t: "決済フォームの検証", s: "質問: 金額の丸め方は？", sCls: "w", tm: "今" })}
		${inst({ id: "dw-2", cls: "att", mk: '<i class="dot fail"></i>', t: "依存パッケージの更新", s: "失敗: npm ci が終了コード 1", sCls: "f", tm: "3時間" })}
		<div class="grp">${ic.laptop(15)}<span>dev-laptop</span><span class="conn"><i class="dot done"></i>接続中</span></div>
		${inst({ id: "dw-3", cls: "sel", mk: idle, t: "ログイン画面の改修", s: path("~/work/web"), tm: "今" })}
		${inst({ id: "dw-4", mk: spin(13), t: "認証まわりのレビュー", s: path("~/work/api", " · サブエージェント 2 実行中"), tm: "作業中" })}
		${inst({ id: "dw-5", mk: idle, t: "API クライアントのリファクタ", s: path("~/work/api"), tm: "12分" })}
		<div class="grp">${ic.server(15)}<span>home-server</span><span class="conn"><i class="dot done"></i>接続中</span></div>
		${inst({ id: "dw-6", mk: spin(13), t: "夜間バッチの調査", s: path("~/ops/batch"), tm: "作業中" })}
		${inst({ id: "dw-7", mk: idle, t: "README の整理", s: path("~/code/website", " · スマホで起動"), tm: "昨日" })}
	</div>
	<div class="dw-ft"><span class="ib dim">${ic.gear}</span><span class="newpi" id="dw-new">${ic.plus(18)}新しい Pi</span></div>
</div>`;

const newpi = `
<div class="screen" id="newpi">
	<div class="hd">
		<span class="ib">${ic.x(22)}</span>
		<div class="hd-title" style="text-align:center">新しい Pi</div>
		<span style="width:44px"></span>
	</div>
	<div class="np">
		<div class="lbl">マシン</div>
		<div class="mrow"><i class="dot done"></i><span>dev-laptop</span><span class="ck" id="np-ck">${ic.check(20)}</span></div>
		<div class="mrow"><i class="dot done"></i><span>home-server</span></div>
		<div class="lbl" style="margin-top:20px">フォルダ</div>
		<div class="fld"><span><span id="np-folder"></span><i class="caret" id="np-caret1"></i></span><span class="ib dim">${ic.folder}</span></div>
		<div style="margin-top:14px;font-size:12px;line-height:18px;color:var(--text2)">最近使ったフォルダ</div>
		<div class="recent" id="np-r1"><span class="mono">~/work/site</span><span class="r">昨日</span></div>
		<div class="recent"><span class="mono">~/work/api</span><span class="r">Pi 2 件実行中</span></div>
		<div class="trust"><div><span class="t1">このフォルダを信頼する</span><span class="t2">フォルダ内の設定と Extension を読み込みます。<br>起動時の Pi の確認は省かれます。</span></div><span class="sw"><i></i></span></div>
		<div class="nav-row"><span>モデル</span><span class="v">Opus 5.5 · high</span><span style="color:var(--text2)">${ic.right(16)}</span></div>
		<div class="lbl" style="margin-top:20px">最初のメッセージ（任意）</div>
		<div class="ta"><span class="ph" id="np-ph">起動したらすぐに送るメッセージ</span><span><span id="np-msg"></span><i class="caret" id="np-caret2"></i></span></div>
	</div>
	<div class="np-ft">
		<span class="hint">起動後は PC の <code>pimate attach</code> で同じ Pi に接続できます</span>
		<div class="pb big" id="np-go">起動</div>
	</div>
</div>`;

const chatB = `
<div class="screen" id="chatB">
	${header("B", "トップページを速くして")}
	<div class="tr" id="trB">
		<div class="u first" id="b-u"><div>トップページを速くして</div></div>
		<div class="tools" id="toolsB">
			${tool({ id: "b-t1", name: "read", arg: "app/page.tsx", st: "118 行" })}
			${tool({ id: "b-t2", name: "bash", arg: "npm run build", st: "14秒" })}
			${tool({ id: "b-t3", name: "read", arg: "components/Hero.tsx", st: "86 行" })}
			${tool({ id: "b-t4", name: "edit", arg: "components/Hero.tsx", add: 9, del: 14 })}
			${tool({ id: "b-t4b", name: "read", arg: "app/layout.tsx", st: "42 行" })}
			${tool({ id: "b-t5", name: "edit", arg: "app/page.tsx", add: 12, del: 4 })}
			${tool({ id: "b-t6", name: "write", arg: "app/loading.tsx", add: 18 })}
			${tool({ id: "b-t7", name: "edit", arg: "next.config.ts", add: 3 })}
			${tool({ id: "b-t8", name: "bash", arg: "npm run build", st: "0秒" })}
		</div>
	</div>
	${composer("B", { placeholder: "Pi にメッセージ" })}
</div>`;

export function phoneHTML() {
	return `
<div class="phone" id="phone">
	<div class="phone-body"></div>
	<div class="phone-screen" id="pscreen">
		${chatA}
		${drawer}
		${newpi}
		${chatB}
		${statusbar}
	</div>
	<i class="phone-cam"></i>
</div>`;
}

/* ---------------- ターミナル ---------------- */

const tTool = (id, name, arg, extra = "") =>
	`<div class="t-tool" ${id ? `id="${id}"` : ""}><b>${name}</b><span>${arg}</span>${extra}</div>`;

const tuiHead = `<div class="t-head">${piLogo()}<span>pi</span></div>`;
const tuiEdit = (k) =>
	`<div class="t-edit"><div class="t-rule"></div><div class="t-in"><span id="tin${k}"></span><i class="t-caret"></i></div><div class="t-rule"></div></div>`;
const tuiFoot = (cwd, right) => `<div class="t-foot"><span>${cwd}</span><span>${right}</span></div>`;

const tvA = `
<div class="term-view" id="tvA">
	${tuiHead}
	<div class="t-scroll" id="tsA">
		<div class="t-user" id="ta-u">ログインをメールリンク認証にして</div>
		${tTool("ta-1", "read", "src/auth/LoginForm.tsx")}
		${tTool("ta-2", "read", "src/api/session.ts")}
		${tTool("ta-3", "bash", 'rg "session" src/api')}
		<div class="t-text" id="ta-x">現状の構成を確認しました。実装方針を選んでください。</div>
		<div class="t-ask" id="ta-ask">
			<div class="tt">メールリンクの実装方式は？</div>
			<div class="op on"><i>❯</i>既存の認証 API を拡張</div>
			<div class="op"><i></i>外部の Magic Link サービスを使う</div>
			<div class="op"><i></i>今回は UI の整理だけ</div>
			<div class="ask-ft"><span>↑↓ 選択 · Enter 決定</span><b id="ta-wait"></b></div>
		</div>
		<div class="t-text t-dim" id="ta-ans">メールリンクの実装方式は？ → <span style="color:#f2f4f7">既存の認証 API を拡張</span></div>
		${tTool("ta-4", "edit", "src/auth/LoginForm.tsx", '<em><span class="p">+24</span> <span class="m">−3</span></em>')}
		${tTool("ta-5", "write", "src/api/magic-link.ts", '<em><span class="p">+41</span></em>')}
		${tTool("ta-6", "write", "src/auth/magic-link.test.ts", '<em><span class="p">+32</span></em>')}
		${tTool("ta-7", "bash", "npm test")}
		<div class="t-work" id="ta-work"><span class="t-spin"></span><span>Working…</span></div>
	</div>
	${tuiEdit("A")}
	${tuiFoot("~/work/web (main)", "claude-opus-5-5 · high")}
</div>`;

const tvShell = `
<div class="term-view" id="tvShell">
	<div class="t-sh"><span class="pr">dev-laptop</span> <span class="t-dim">~</span> $ <span id="sh-cmd"></span><i class="t-caret" id="sh-caret"></i></div>
	<div class="t-sh t-dim" id="sh-out">Detach: Ctrl+\\ (Pi keeps running)</div>
</div>`;

const tvB = `
<div class="term-view" id="tvB">
	${tuiHead}
	<div class="t-scroll" id="tsB">
		<div class="t-user" id="tb-u">トップページを速くして</div>
		${tTool("tb-1", "read", "app/page.tsx")}
		${tTool("tb-2", "bash", "npm run build")}
		${tTool("tb-3", "read", "components/Hero.tsx")}
		${tTool("tb-4", "edit", "components/Hero.tsx", '<em><span class="p">+9</span> <span class="m">−14</span></em>')}
		${tTool("tb-4b", "read", "app/layout.tsx")}
		${tTool("tb-5", "edit", "app/page.tsx", '<em><span class="p">+12</span> <span class="m">−4</span></em>')}
		${tTool("tb-6", "write", "app/loading.tsx", '<em><span class="p">+18</span></em>')}
		${tTool("tb-7", "edit", "next.config.ts", '<em><span class="p">+3</span></em>')}
		${tTool("tb-8", "bash", "npm run build")}
		<div class="t-work" id="tb-work"><span class="t-spin"></span><span>Working…</span></div>
	</div>
	${tuiEdit("B")}
	${tuiFoot("~/work/site (main)", "claude-opus-5-5 · high")}
</div>`;

const tvG = `
<div class="term-view" id="tvG">
	${tuiHead}
	<div class="t-scroll" id="tsG">
		<div class="t-user" id="tg-u">週次レポートを作って</div>
		${tTool("tg-1", "read", "docs/weekly-template.md")}
		${tTool("tg-2", "bash", "git log --oneline -20")}
		<div class="t-ask" id="tg-ask">
			<div class="tt">どの期間をまとめますか？</div>
			<div class="op on"><i>❯</i>先週</div>
			<div class="op"><i></i>今月</div>
			<div class="ask-ft"><span>↑↓ 選択 · Enter 決定</span><b>入力待ち</b></div>
		</div>
		<div class="t-text t-dim" id="tg-ans">どの期間をまとめますか？ → <span style="color:#f2f4f7">先週</span></div>
		${tTool("tg-3", "bash", 'git log --since="1 week ago"')}
		${tTool("tg-4", "write", "reports/weekly.md", '<em><span class="p">+48</span></em>')}
		<div class="t-text" id="tg-done">先週分を reports/weekly.md にまとめました。</div>
		<div class="t-work" id="tg-work"><span class="t-spin"></span><span>Working…</span></div>
	</div>
	${tuiEdit("G")}
	${tuiFoot("~/work/reports (main)", "claude-opus-5-5 · high")}
</div>`;

export function termHTML() {
	return `
<div class="term" id="term">
	<div class="term-bar"><i></i><i></i><i></i><span class="term-title" id="term-title">pi — ~/work/web</span></div>
	<div class="term-body">${tvA}${tvShell}${tvB}${tvG}</div>
</div>`;
}
