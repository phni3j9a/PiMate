# 動画のプロジェクト

HTML で組んだ場面を 1 フレームずつ撮影して動画にします。曲と効果音も同じページの中で合成するので、素材ファイルはありません。

必要なもの: Node.js 20 以上、ffmpeg、Chromium（`npx playwright install chromium`。入っている Chrome を使うなら `CHROME_CHANNEL=chrome`）。

```sh
npm install --ignore-scripts

node render.mjs --shot 3.5,12          # その時刻（秒）の静止画 → out/shots/
node render.mjs --sheet 0:30:2         # 2 秒おきに並べた一覧 → out/sheet.png
node render.mjs --lint                 # 文字切れ・重なりなどの検査
node render.mjs --audio                # 音だけ → out/audio-master.wav

node render.mjs                        # 全編を等倍で書き出す（下見）→ out/video.mp4
node render.mjs --scale 2 --keep-frames   # 2 倍で撮影して縮小する（完成版）
node tools/qa.mjs                      # できた動画の検品
node tools/extras.mjs web              # 10 MB 未満の軽量版 → out/video-web.mp4
node tools/extras.mjs poster 15.9      # 見出し用の静止画 → out/poster.png
```

## 直す場所

| ファイル | 内容 |
|---|---|
| `src/js/brand.js` | 名前、ひとこと、色、フォント、ロゴ |
| `src/js/plan.js` | 場面の開始時刻と、曲の区間 |
| `src/js/scenes.js` | 動画の中身（部品と動き） |
| `src/css/app.css` | 製品の画面の見た目 |

`src/js/kit/` と `render.mjs`、`tools/` は土台です。ふつうは触りません。

## 決まり

- 見た目は時刻だけで決める。CSS の animation / transition、`setTimeout`、`Math.random()` は使わない（撮るたびに絵が変わる）
- 文字のある部品を、数秒かけてゆっくり動かさない（文字が震える）。1 秒ほどで動かしきる
- 場面の境目は小節の頭に置く（`plan.js` の `bar(n)`）
- 直したら、その前後を `--sheet` で並べて見る

`out/` は生成物の置き場で、Git では管理しません。残したい動画は別の場所へ複製してください。
