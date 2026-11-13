# 雛形の使い方

場面を書く前に読む。実例は `src/js/scenes.js`（見本の動画）にある。

- [1. ファイルの役割](#1-ファイルの役割)
- [2. 考え方](#2-考え方)
- [3. タイムライン（tl）](#3-タイムラインtl)
- [4. 時刻から直接決める（onFrame と補助）](#4-時刻から直接決めるonframe-と補助)
- [5. 舞台の部品](#5-舞台の部品)
- [6. よく使う書き方](#6-よく使う書き方)
- [7. つまずきやすい点](#7-つまずきやすい点)

## 1. ファイルの役割

| ファイル | 役割 | 触るか |
|---|---|---|
| `src/js/brand.js` | 名前、ひとこと、色、フォント、ロゴ | 書き換える |
| `src/js/plan.js` | 場面の開始時刻 `T`、曲の区間 `music` | 書き換える |
| `src/js/scenes.js` | 動画の中身。`mount()` で部品を置き、`animate()` で動きを積む | 書き換える |
| `src/css/app.css` | 製品の画面の見た目 | 書き換える |
| `src/js/kit/engine.js` | タイムライン。時刻から絵を決める土台 | 触らない |
| `src/js/kit/helpers.js` | 行の開閉、文字送り、状態の切り替え | 触らない |
| `src/js/kit/stage.js` | 見出し、入れ物、指とカーソル、ロゴ、タイル、切り替え | 足りない部品は足してよい |
| `src/js/kit/audio.js` | 曲と効果音の合成 | 音量や音色は変えない（測って決めた値） |
| `src/js/kit/lint.js` | レイアウトの機械検査 | 触らない |
| `src/css/stage.css` `devices.css` | 舞台と入れ物の見た目 | 色は変数で入る。寸法は必要なら調整 |
| `render.mjs` `tools/*.mjs` | 撮影、検品、配布用の版 | 触らない |

舞台にない部品（図、グラフ、独自のカード）が要るときは、`scenes.js` の `mount()` で HTML を `#world` に足し、見た目を `app.css` に書く。

### brand.js に書くこと

| 項目 | 内容 |
|---|---|
| `name` / `tagline` / `url` / `meta` / `fine` | 最初のロゴと最後のカードに出る文字。`tagline.sub` と `meta` は省ける |
| `light` / `dark` | 舞台の色。両方に同じ名前を持たせる。`c1`〜`c3` はブランドの色（ロゴ、章の印、流れるマス、切り替えの波に使う）。ブランドの色が 1 つだけなら、その色と濃淡 2 つにする |
| `app` | 製品の画面の色（`app.css` が `var(--app-…)` で使う）。名前は自由に足してよい。ダークモードも見せるなら `appDark` を足し、`palette(ph.node, brand.appDark, 時刻)` で切り替える |
| `logo.svg` | マークの SVG（`viewBox` つき）。`<img src="/src/assets/logo.png">` でもよい。`ratio` は 幅 ÷ 高さ |
| `logo.assemble` | `true` にすると、SVG の直下の要素が 1 つずつ飛んできて組み上がる（部品が 2〜6 個のマーク向き）。1 つの絵や画像なら `false` |
| `logo.mono` | 通知のアイコン用の白 1 色の SVG |
| `fonts` | 見出し（`display`）、本文（`ui`）、等幅（`mono`）の書体名と、読み込むスタイルシート（`css`）、先読みする書体と太さ（`load`） |

**フォントを変える。** 製品の書体を使うときは、フォントのファイルを `src/fonts/` に置き、`@font-face` を書いた CSS を作って `fonts.css` に足し、`fonts.load` に書体名と太さを書く。npm にある書体（`@fontsource/…`）なら `npm install` して、見本と同じ形でスタイルシートの場所を並べる。使ってよい書体かどうか（ライセンス）は依頼者に確かめる。

画像（ロゴ、写真）は `src/assets/` に置き、`/src/assets/…` で参照する。

## 2. 考え方

- **見た目は時刻 t（秒）だけで決まる。** `seek(t)` でどの時刻の絵にもなる。だから並列に撮れて、一部だけ撮り直せる
- **`mount()` で全部の部品を置き、`animate()` で動きを積む。** 置く → フォントを読む → 動きを積む（ここで高さを測る）の順に `main.js` が呼ぶ
- **部品は最初、隠れている。** 見出し、入れ物、タイル、カードは CSS で `visibility: hidden`。`tl.in` か `tl.show` で出す
- **時刻は絶対の秒で書く。** 場面の頭は `T.xxx`（小節の頭）、場面の中は `t0 + 2.0` のように書く。前の動きからの相対では書かない（1 つずらすと後ろが全部ずれるのを防ぐ）

## 3. タイムライン（tl）

```js
import { $, $$, set, tl } from "./kit/engine.js";

tl.to(target, { x: 100, opacity: 1, duration: 0.6, ease: "swift" }, at);  // 今の値 → 指定の値
tl.fromTo(target, { scale: 1.05 }, { scale: 1, duration: 0.24 }, at);     // from → to（at より前は元の値のまま）
tl.from(target, { opacity: 0 }, at);                                       // from → 今の値（at より前は元の値のまま）
tl.set(target, { autoAlpha: 0 }, at);                                      // at の瞬間に切り替える
tl.in(target, { y: 40, scale: 0.94 }, at, { duration: 0.6, ease: "back(1.6)" });  // 登場（at まで隠れている）
tl.out(target, { y: -30 }, at, { duration: 0.35 });                        // 退場（動きながら消える）
tl.show(target, at);  tl.hide(target, at);                                 // その瞬間に出す / 隠す
set(target, { x: 128, y: 490, scale: 1.3 });                               // 最初の状態（時刻なし。その場で設定）
```

- `target` は セレクター文字列・要素・その配列
- `at` は開始時刻（秒）。必ず書く
- 動かせる性質: `x` `y`（px）、`xPercent` `yPercent`（要素自身の大きさに対する %）、`scale` `scaleX` `scaleY`、`rotate`（度）、`opacity`、`autoAlpha`（opacity と visibility をまとめて）、そのほか CSS の性質（キャメルケース。`height: 120`、`backgroundColor: "var(--c1)"`、`clipPath: "inset(0% 0% 0% 50%)"`、`boxShadow`、`strokeDashoffset`、`"--独自の値": 1` など）
- オプション: `duration`（秒。既定 0.6）、`ease`（既定 `"out3"`）、`stagger`（複数の対象を何秒ずつずらすか）、`repeat`、`yoyo`
- 同じ性質を続けて動かすと、後から始まるほうが前の値を引き継ぐ。積む順番は自由（開始時刻の順に並べ直される）
- `x` と `scale` のように別々の性質は、時間が重なっても混ざらない

**`tl.in` と `tl.out` の x / y / rotate は「ずれ」。** `tl.in(card, { y: 40 }, at)` は「本来の位置より 40px 下から現れる」。本来の位置を `set(card, { x: 500, y: 300 })` で決めていても、そのまま使える。`scale` や色などは、その値から本来の値へ動く。

**イージング**

| 名前 | 動き | 使いどころ |
|---|---|---|
| `swift` | 素早く入り、長くなめらかに止まる | 見出し、部品の登場 |
| `glide` | ゆっくり動き出して、ゆっくり止まる | 入れ物の移動（寄る、引く） |
| `settle` | 少し行きすぎて収まる | 落ちてくる通知 |
| `back(1.6)` | 弾む。数字が大きいほど大きく | タイル、チェック、小さな部品 |
| `out2`〜`out5` | 止まる側がなめらか（数字が大きいほど急） | 汎用 |
| `in2`〜`in4` | 動き出しがなめらか | 退場、はまる瞬間へ向かう動き |
| `inOut2`〜`inOut4`、`sineInOut` | 両端がなめらか | 行き来する動き |
| `none` | 一定の速さ | 進み具合の棒など |

`[0.2, 0.9, 0.2, 1]` のように配列で書くと cubic-bezier になる。`power3.out`、`back.out(1.6)` など GSAP 風の名前も受け付ける。

## 4. 時刻から直接決める（onFrame と補助）

タイムラインに積みにくいもの（文字、数字、クラス、SVG の属性）は、時刻から直接決める。

```js
import { ease, onFrame, prog } from "./kit/engine.js";
import { closeNow, closeRow, flash, growIn, label, mmss, openRow, stream, swap, toggle, typed, typedEnd, useText } from "./kit/helpers.js";

onFrame((t) => { ring.setAttribute("stroke-dasharray", `${C * 0.67 * ease.out5(prog(t, 20, 21.3))} ${C}`); });
label(node, (t) => `作業中 · ${mmss(t - 17.8)}`);                 // 文字を時刻から決める
label(input, (t) => typed("テストも書いて", t, 26.4, 12));         // 26.4 秒から毎秒 12 文字で打つ
const end = typedEnd("テストも書いて", 26.4, 12);                  // 打ち終わる時刻
toggle(button, "on", [26.4, 28.1], [39.3]);                      // クラス on を 26.4〜28.1 秒と 39.3 秒以降に付ける
swap(statusNode, [[0, "wait"], [17.8, "work"], [31.5, "idle"]]); // 重ねた表示から 1 つ選ぶ（子の data-state で選ぶ）
const done = stream(answerNode, 30.9, { cps: 52 });              // 文章を先頭から流す。返り値は終わる時刻
growIn(row, 18.8);            // 行を閉じておき、18.8 秒に開く（上の行は押し上げられる）
closeNow(row); openRow(row, 18.8); closeRow(row, 25.0);          // 同じことを分けて書く
flash(row, 19.0);             // 行が届いた瞬間に光らせる
```

- `prog(t, a, b)` は t が a→b のどこにいるか（0〜1）。`ease.out3(p)` などで曲げる
- `onFrame` の中では、乱数・現在時刻・前のフレームの状態を使わない。使うなら `rng(seed)`
- `typed` は打つ文字を自動でフォントの先読みに登録する。`label` で後から出す文字に、画面に無い漢字や記号が入るときは `useText("…")` で知らせる（知らせないと、その文字だけ別のフォントになることがある）
- `swap` の子は `<span data-state="wait">入力待ち</span>` のように書く。同じ場所に重ねたいので、親を `display: grid`、子を `grid-area: 1 / 1` にする

## 5. 舞台の部品

```js
import { animateMarks, browser, capIn, capOut, caption, chapters, connector, endCard, fadeFromBlack, fadeToBlack, logoLockup, logoReveal, logoToCorner, mountLogo, mountStage, notification, palette, phone, pointer, pose, sparks, taglineIn, taglineOut, tap, terminal, tiles, tilesIn, tilesOut, wipe } from "./kit/stage.js";
```

### 舞台と色

| 関数 | 内容 |
|---|---|
| `mountStage({ theme: "dark" })` | 舞台を作る。`mount()` の最初に呼ぶ。`theme` は最初の明暗 |
| `palette(target, colors, at?, dur?)` | 色の変数を当てる。`palette("#stage", brand.dark, T.more)` で舞台を暗く切り替える。`at` を省くと最初から。入れ物に製品の色を当てるのもこれ: `palette([win.node, ph.node], brand.app)` |
| `wipe(at, { color, origin, seed })` | マスの波で画面を覆う（0.55 秒）。覆い終える `at + 0.55` に、`palette` で舞台を `color` に切り替え、前の場面の部品を `tl.hide` する。`origin` は波の出どころ（横 0〜15、縦 0〜8） |
| `fadeFromBlack(0, 0.9)` / `fadeToBlack(T.total - 1.3)` | 最初の明けと最後の暮れ |
| `animateMarks()` | 回る印（`.spin`）と点滅するカーソル（`.caret` `.t-caret`）を動かす。部品を全部置いた後、`mount()` の最後に呼ぶ |

### 見出し

```js
caption("c1", { no: "01", tag: "SYNC", lines: ["PC で進めると、", "スマホにもすぐ届く。"], en: "UPDATE ON YOUR PC. SEE IT ON YOUR PHONE." });
caption("c0", { center: true, size: "sm", lines: ["その進捗、また聞いてる。"] });   // 中央寄せ・小さめ・番号なし
capIn("c1", t0, { y: 116 });      // 出す。y は見出しの上端（x は既定で左 128px）
capOut("c1", T.more - 0.9);       // 消す
chapters(5, { showAt: T.demo, hideAt: T.end - 0.8 });   // 右端に章の数だけマスを並べる（任意）。no を持つ見出しが出ると、その番号が点く
```

`size`: `"sm"` 68px、省略 82px、`"xl"` 96px。2 行の見出しの高さは、標準で約 320px（番号と英語の行を含む）。左上に置くなら `y: 116`、左の中段なら `y: 318`、中央寄せで上に置くなら `y: 112〜200`。

見出しの下に要点を並べるときは `<ul class="pts"><li><i class="dot" style="background:var(--c1)"></i>…</li></ul>` を `#world` に足し、`li` を `tl.in` で出す。

### 入れ物

```js
const ph = phone("ph", `<div class="screen ui-chat">…</div><div class="screen ui-detail">…</div>`);  // 390×844 の画面を重ねて入れる
const win = browser("win", `<div class="ui-board">…</div>`, { url: "app.example.com", w: 720, h: 408 });
const term = terminal("term", `<div>$ npm test</div>…`, { title: "~/work/web", w: 900, h: 540 });
set(ph.node, pose(ph, 1500, 540, 1.1));   // 中心 (1500, 540)、1.1 倍
set(win.node, { x: 128, y: 486, scale: 1.3 });
tl.in(ph.node, { y: 300 }, t0 - 0.45, { duration: 0.95, ease: "swift" });    // 下から登場
tl.to(ph.node, { ...pose(ph, 1420, 449, 1.5), duration: 1.0, ease: "glide" }, t0);   // 寄る
```

- 返り値は `{ node（入れ物全体）, screen（中身の根。指やカーソルの基準）, w, h }`
- スマホの中の 1 画面は `.screen` で包む（上にステータスバーの余白が付く）。複数の画面を重ねておき、`tl.in(next, { x: 390 }, at)` と `tl.to(prev, { x: -120 }, at)` で画面の移動を作る
- ターミナルの中身は下ぞろえで、上にあふれた行は薄く消える。色は `.dim` `.ok` `.warn` `.bad`、カーソルは `<i class="t-caret"></i>`

### 指とマウス

```js
tap(ph, $("#send"), 28.05);                       // 指で押す印（位置はその時刻の配置から求める）
tap(ph, $("#row-2"), 16.6, { dx: -90, press: false });   // 中央からずらす。押したときに縮めない

const mouse = pointer(win).show(t0 + 1.1, [520, 300]);   // カーソルを出す（入れ物の中の座標）
mouse.click($("#save"), t0 + 2.0, { dur: 0.7 });         // 0.7 秒かけて動いて、t0+2.0 に押す
mouse.move($("#field"), t0 + 3.0);                       // 動くだけ
mouse.hide(t0 + 6.0);
```

押した結果（状態が変わる、画面が進む）は、押した時刻の 0.05〜0.3 秒後に置く。効果音は自動で積まれる。

### つながりの線

```js
const link = connector("link");
link.shape(x1, y1, x2, y2);          // 出発側 → 到着側（舞台の座標）
link.draw(t0 + 0.6);                 // 描く
link.packet(at, { color: 0, dur: 0.3 });           // マスが流れる（color 0〜2 はブランドの色）
link.packet(at, { dir: -1 });                      // 逆向き
link.draw(T.more - 0.9, { dur: 0.35, out: true }); // 消す
```

「こちらで起きたことが、あちらに届く」を見せる。届く側の変化は、流れ終わる時刻（`at + dur`）に置く。

### ロゴと最後のカード

```js
mountLogo();                    // mount() で呼ぶ。brand.js のロゴ・名前・ひとこと・URL を置く
const last = logoReveal(T.logo);    // ロゴの登場。T.logo に最初の部品がはまる。返り値は最後の部品がはまる時刻
logoLockup(T.logo + 0.9);       // マークが左に寄り、名前が出る
taglineIn(T.logo + 1.7);  taglineOut(T.logo + 3.0);
logoToCorner(T.logo + 3.1);     // 左上に小さく収まる（本編のあいだ残る）
endCard(T.end);                 // 左上のロゴが中央へ戻り、T.end ではまる。ひとこと・URL・補足が続けて出る
```

暗い場面から明るい場面へ切り替わりながらロゴが出るときは、見本のように `palette("#logo-mark", { c1: brand.light.c1, … })` で、ロゴだけ先に明るい場面の色にしておく。

### タイル

```js
const grid = tiles("more", { cols: 3, w: 540, h: 330, y: 440, items: [{ title: "通知", tag: "NOTIFICATIONS", body: `<div …>`, foot: "ひとこと" }, …] });
const at = tilesIn(grid, t0 + 0.5, 0.5);     // 0.5 秒（1 拍）おきに 1 枚ずつ。at(i) は i 枚めが出る時刻
set($$(".row", grid.items[0]), { opacity: 0, x: 30 });                                 // 中身も少し動かす（最初の状態を set で決めてから）
tl.to($$(".row", grid.items[0]), { opacity: 1, x: 0, stagger: 0.18 }, at(0) + 0.2);
tilesOut(grid, T.end - 0.75);
```

4 列なら `w: 400`、3 列なら `w: 540`、2 列なら `w: 820` くらいが収まる。1 枚に入れるのは 1 つのことだけ。中身は製品の画面の断片を、実物の 1.3 倍くらいの大きさで。

### そのほか

- `notification("n1", { title: "…", body: "…" })`: スマホの通知。`set("#n1", { x: 650, y: 40 })` → `tl.in("#n1", { y: -280 }, at, { ease: "settle" })` で上から落とす
- 手順のカード: `<div class="step"><span class="n" style="background:var(--c1)">1</span><div class="t">題</div><div class="e">LABEL</div><div class="v">中身</div></div>` を並べ、`set` で位置、`tl.in` で登場
- 確認の印つきの一言: `<div class="checks"><div class="check">✓の SVG と文</div>…</div>`。`set(".checks", { y: 838 })`、`.check` を `tl.in` で 0.5 秒おきに
- `sparks(at, cx, cy)`: 小さなマスが散る。大きな部品がはまった瞬間に

### 効果音の合図

```js
import { cue } from "./kit/cue.js";
cue("row", at, { pan: -0.4 });     // 種類と時刻。一覧は references/audio.md
```

`tap` `pointer.click` `wipe` `tilesIn` `logoReveal` `logoLockup` `taglineIn` `logoToCorner` `endCard` は自分で合図を積む。それ以外の出来事（行が出る、打つ、完了する、失敗する）は `cue` を書く。

## 6. よく使う書き方

**場面の骨組み**

```js
function demo() {
	const t0 = T.demo;
	// 1. この場面で初めて出る行などを、最初から閉じておく
	// 2. 登場（入れ物 → 見出し → 線）
	// 3. 出来事を順に（押す → 変わる → 届く）
	// 4. 退場して次へ（次の場面の頭 T.next の 0.9〜0.5 秒前から）
}
```

**2 つの画面に同じ行が届く**

```js
openRow($("#pc-row"), at, { dur: 0.28 });      cue("row", at, { pan: -0.4 });
link.packet(at + 0.02, { dur: 0.3 });
openRow($("#phone-row"), at + 0.16);           cue("row", at + 0.2, { hi: true, pan: 0.5 });
flash($("#phone-row"), at + 0.3);
```

**入力欄に打って送る**

```js
label(input, (t) => (t < sendAt ? typed(text, t, typeAt, 12) : ""));
onFrame((t) => { placeholder.style.visibility = t >= typeAt && t < sendAt ? "hidden" : "visible"; });
toggle(sendButton, "on", [typeAt + 0.05, sendAt]);
cue("type", typeAt, { dur: typedEnd(text, typeAt, 12) - typeAt, n: [...text].length });
tap(ph, sendButton, sendAt);                   cue("send", sendAt + 0.02);
openRow(bubble, sendAt + 0.1);
```

**作業中の印を、完了の印に変える**: 回る印と点を重ねて置き、`tl.set` で `autoAlpha` を入れ替える（または親に `toggle(row, "done", [at])` して CSS で出し分ける）。

**一度消した部品を、もう一度出す**: `tl.in` は最初の登場用（最初から隠すため）。2 度めは `tl.set(node, { autoAlpha: 0 }, at - 0.05)` の後に `tl.fromTo(node, { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0 }, at)`。

## 7. つまずきやすい点

| 症状 | 原因と直し方 |
|---|---|
| 部品が、出番の前に一瞬見える | `tl.fromTo` / `tl.from` は開始前に元の値のまま。登場は `tl.in` を使うか、`set(node, { opacity: 0 })` で最初から隠す |
| 出したはずの部品が見えない | 部品は最初 `visibility: hidden`。`tl.show` / `tl.in` が要る。親（タイルの格子、見出し）を出していないことも多い |
| 行の高さがおかしい、開いても中身が切れる | 高さは組み立て時に測る。行が `display: none` の中にあると 0 になる。隠すなら `visibility` か `closeNow` |
| 別の部品まで見た目が変わった | CSS のクラス名がぶつかっている。製品の画面の CSS は、画面の根のクラスの下に書く |
| 文字が豆腐（□）や別の書体になる | 後から JS で入れる文字が先読みされていない。`useText("…")` で知らせる。`brand.fonts.load` に書体と太さがあるかも確かめる |
| 動きが撮るたびに違う / 並列で撮るとずれる | CSS の animation、`setTimeout`、`Math.random()`、前のフレームに頼る処理を使っている |
| 指やカーソルの位置がずれる | 位置は入れ物の中の配置から求める。対象が `transform` で動いている最中だとずれる。止まってから押す |
| ゆっくり動く文字が震える | 文字のある部品は 1 秒ほどで動かしきる。じわじわ動かさない |
| `タイムラインは build() の前に積んでください` | `animate()` の外（`onFrame` の中など）で `tl.*` を呼んでいる |
| 色の切り替えで、一部の部品だけ色が変わらない | 色を値で直接書いている。`var(--ink)` などの変数で書く |
