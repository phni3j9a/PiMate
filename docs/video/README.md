# PiMate 紹介動画

PiMate を 90 秒で紹介する動画と、その作り方一式です。

| ファイル | 内容 |
|---|---|
| [pimate-intro.mp4](pimate-intro.mp4) | 完成した動画（1920×1080・60fps・H.264 / AAC・約 90 秒） |
| [pimate-intro-web.mp4](pimate-intro-web.mp4) | 軽量版（1280×720・30fps）。README や Issue への貼り付け用（10 MB 未満） |
| [poster.png](poster.png) | 動画の見出し用の静止画 |

画面はアプリのスクリーンショットではなく、[画面モック](../design/README.md)と同じ色・寸法で組み直した HTML です。実際のアプリとは細部が異なることがあります。モデル名・ファイル名・時刻などは例です。

## 構成

120 BPM（1 小節 2 秒）に合わせ、場面は小節の頭で切り替わります。

| 秒 | 場面 | 伝えること |
|---|---|---|
| 0–8 | 冒頭 | PC の Pi が質問を出したまま待っている。でも席にいない |
| 8–14 | ロゴ | PC の Pi を、ポケットに。 |
| 14–26 | 01 SAME PI | PC の Pi をそのままスマホで。画面の転送ではなく、スマホのための UI |
| 26–32 | 02 STEER | 作業中でも、その場で割り込む |
| 32–40 | 03 REVIEW | 変更は、差分で確かめる |
| 40–48 | 04 FLEET | 複数の PC・複数の Pi を、ひとつの一覧に |
| 48–58 | 05 HANDOFF | スマホで始めて、PC で続ける（`pimate attach`） |
| 58–66 | 06 TOOLKIT | サブエージェント、モデルと Thinking、利用枠、通知、Issue と PR、画像、セッション操作、テーマ |
| 66–72 | 07 RESILIENT | 切れても、Pi は止まらない |
| 72–78 | 08 PRIVATE | Pi はそのまま。データは PC のまま（Tailscale の中だけで通信） |
| 78–84 | 09 SETUP | はじめるのは、3 ステップ |
| 84–90 | 最後のカード | ロゴ、ひとこと、リポジトリの URL |

## 作り直す

Node.js 22.18 以降と ffmpeg が必要です。依存はこのフォルダだけのもので、アプリや PC パッケージには追加しません。

```sh
cd docs/video
npm install --ignore-scripts
npx playwright install chromium   # Chromium が未導入のときだけ
npm run render                    # out/pimate-intro.mp4 を書き出す（2 倍で撮影して縮小。4 コアで 30 分ほど）
node render.mjs                   # 等倍で撮影する（15 分ほど。確認用）
```

`render.mjs` は `src/` のページを開き、時刻を 1/60 秒ずつ進めながら 1 枚ずつ撮影して、ffmpeg で動画にします。音も同じページの中（OfflineAudioContext）で合成するため、素材ファイルはありません。

```sh
node render.mjs --shot 16.6,43,87      # その時刻の静止画を out/shots に書き出す
node render.mjs --sheet 14:26:1        # 14〜26 秒を 1 秒おきに並べた一覧を out/sheet.png に書き出す
node render.mjs --from 14 --to 26      # 一部だけを動画にする（音声なし）
node render.mjs --audio                # 音だけを書き出す（--stems pad,bass,drums,arp,melody,fx,sfx で系統ごと）
node render.mjs --scale 2 --size 3840:2160   # 4K で書き出す
node render.mjs --scale 2 --keep-frames --resume --reuse-audio   # 途中で止まった撮影を続きから行う
```

撮影したフレームを残しておけば（`--keep-frames`）、軽量版・静止画・4K 版をそこから作れます。

```sh
node tools/extras.mjs web            # out/pimate-intro-web.mp4（1280×720・30fps・10 MB 未満）
node tools/extras.mjs poster 15.9    # out/poster.png（15.9 秒の 1 枚）
node tools/extras.mjs uhd            # out/pimate-intro-4k.mp4（3840×2160・60fps）
```

生成物は `out/`（Git の管理外）に出ます。完成した動画を差し替えるときは、`out/` の `pimate-intro.mp4`・`pimate-intro-web.mp4`・`poster.png` をこのフォルダへコピーして、ソースと一緒にコミットしてください。

音量は書き出し時に -15 LUFS へそろえ、ピークを抑えます（`render.mjs` の `master`）。

## ファイル構成

| パス | 内容 |
|---|---|
| `render.mjs` | 撮影・音の書き出し・エンコードを行うスクリプト |
| `tools/extras.mjs` | 撮影済みのフレームから、軽量版・静止画・4K 版を作るスクリプト |
| `tools/gen-qr.mjs` | `src/js/qr.js` を作り直すスクリプト |
| `src/index.html` | 舞台（1920×1080）の土台 |
| `src/css/` | `base.css`（舞台・見出し・タイル）、`phone.css`（スマホとアプリの画面）、`term.css`（PC のターミナル） |
| `src/js/cues.js` | 場面の開始時刻と、効果音の合図 |
| `src/js/engine.js` | 時刻だけで見た目を決めるための土台（GSAP のタイムラインと、毎フレームの関数） |
| `src/js/ui.js` | スマホの画面とターミナルの HTML |
| `src/js/stage.js` | 見出し・ロゴ・タイルなど舞台の部品と、共通の動き |
| `src/js/scenes.js` | 全場面の動き（ここを直すことが多い） |
| `src/js/audio.js` | 曲と効果音の合成 |
| `src/js/tokens.js` | 色。アプリの色は `apps/mobile/src/theme/tokens.ts`、舞台とマークの色は [icon kit](../design/icon-kit/README.md) と同じ値 |
| `src/js/qr.js` | 「はじめかた」の場面に出す QR のマス目（`tools/gen-qr.mjs` が生成。中身はこのリポジトリの URL） |

## 直すときの注意

- **文字をゆっくり動かさない。** ブラウザは文字の位置を画素にそろえるため、数秒かけて少しずつ動かすと文字が細かく震えます。ゆっくり動かすのは背景の光だけにし、文字のある部品は 1 秒ほどで動かしきります。本番を 2 倍で撮影するのも、この震えを半分にするためです。
- **見た目は時刻だけで決める。** CSS の animation / transition は止めてあります。動きは `tl`（GSAP のタイムライン）に時刻を指定して積むか、`onFrame((t) => …)` で t から直接求めます。こうしておくと、どの時刻から撮っても同じ絵になり、並列に撮影できます。
- **行の高さは組み立て時に測る。** 会話の行を開く `growIn` / `openRow` は、全部を表示した状態で測った高さを使います。文言を変えたら、その場面を `--sheet` で確認してください。
- **効果音は映像から決まる。** 場面を組むときに `cue("tap", 時刻)` のように合図を積み、`audio.js` がその時刻で鳴らします。動きの時刻をずらせば音もずれます。
- **文言はアプリと README に合わせる。** 通知の文（「Pi が入力を待っています」）や「この変更について依頼」の下書きの形は、アプリの実装と同じにしてあります。機能の説明を変えるときは、[README](../../README.md) と食い違わないようにしてください。
- 他社のロゴは描いていません（利用枠の輪は文字だけ）。

## 使っているもの

- フォント: [Inter](https://rsms.me/inter/)、[Noto Sans JP](https://fonts.google.com/noto/specimen/Noto+Sans+JP)、[JetBrains Mono](https://www.jetbrains.com/lp/mono/)（いずれも SIL Open Font License 1.1。Fontsource の npm パッケージから読み込み、リポジトリには含めません）
- 動き: [GSAP](https://gsap.com/)（[Standard License](https://gsap.com/standard-license)。npm から読み込み、リポジトリには含めません）
- 撮影: [Playwright](https://playwright.dev/)（Chromium）、エンコード: [ffmpeg](https://ffmpeg.org/)
- 音楽と効果音: このリポジトリのコードで合成したオリジナルです

Claude、Codex、Tailscale、GitHub、Android などの名称は各社の商標で、機能の説明のために文字で記載しています。提携や推奨を意味しません。
