# 会話中の画像: Android エミュレーター確認（#66）

## 対象と環境

- Issue [#66](https://github.com/phni3j9a/PiMate/issues/66)、マージ済み PR [#67](https://github.com/phni3j9a/PiMate/pull/67)・[#68](https://github.com/phni3j9a/PiMate/pull/68)、未マージ PR [#69](https://github.com/phni3j9a/PiMate/pull/69)。2026-10-18 にアプリコード `db5fb9a` を確認。アプリの修正は不要だった。
- Expo SDK 57 / React Native 0.86.3。署名済み universal release APK（0.1.6、未公開）。SHA-256: `32f9c8899e5e3268255ce1b874bc6142a4c7da1c3c110a52d1d7c87319e23bc2`。
- Android 15 / API 35 / Google APIs / x86_64、既存 AVD `pimate35`、1080×2400、480dpi（幅360dp）。KVM、headless / SwiftShader。ADB は常に `-s emulator-5566` を指定し、接続中の実機は操作していない。
- `ANDROID_HOME=/usr/lib/android-sdk JAVA_HOME=/home/server/.local/share/pimate-jdk21 npm run build:android -w @pimate/mobile` でビルドし、APK v2 署名検証も成功。最初の試行は既定 Java が JRE のため失敗し、既存の JDK 21 指定で解消した。署名鍵は既存のリポジトリ外のものを使用。
- loopback の `dev-fake-host.mjs`（47866番）へ ADB reverse で接続。履歴は合成 checkerboard、OS ピッカーには合成 JPEG 4枚だけを追加。HTTPS も生成された placeholder 画像を使用。実 Pi・商用モデルは接続していない。

## 確認したこと

| 操作 | 結果 |
| --- | --- |
| user / tool_result のサムネイル | OK。両方2×2、6枚中の最後の tile は「+3」。tool の本文を開かなくても画像が見える |
| 欠損 preview の自動取得 | OK。user の `imageIndices: [0, 2]`、tool の `[1, 3]` を元位置に配置。欠損位置は操作なしで `entry_image` の `thumbnail: true` を要求し、正しい色で表示 |
| tile / +N をタップ | OK。user・tool とも viewer が開く。「+3」は4枚目から開き、5・6枚目まで左右にめくれる。`4 / 6` → `5 / 6` → `6 / 6` を UI 階層でも確認 |
| viewer の画像取得 | OK。履歴画像・PC画像とも全画面用は別途 `thumbnail: false` を要求。fixture はサムネイル240×160、原本1200×800 |
| ダブルタップ / 拡大中 pan | OK。ADB で素早く2回 tap して拡大、横 swipe で画像が移動しページ番号は維持。再度2回 tap で等倍へ戻る。画像領域のpixel比較でも拡大・移動・等倍への完全復帰を確認 |
| viewer を閉じる | OK。等倍から下 swipe、上部の「閉じる」、Android の戻るでチャットへ戻る |
| Markdown HTTPS / data URI | OK。エミュレーターのネットワークで `https://placehold.co/600x400/png` を自動表示。PNG data URI も表示。両方 viewer でも表示 |
| Markdown PC path | OK。`/home/dev/qa-image.png` を `file_image` で自動表示し、タップ後は原本を取得。同じ回答の3画像を `3 / 3` → `2 / 3` とめくれる |
| 旧 RC の capability 欠落 | OK。`entryImages` / `fileImages` / `promptImageLimit` を省略して再接続。履歴は「画像 6 枚（残りは表示対象外）」、PC画像は説明文 `PC checkerboard` に戻る。HTTPS / data は表示を維持、添付上限は1枚 |
| OS の複数写真選択 / 個別削除 | OK。1回のピッカーで4枚選択し、入力欄に4サムネイル。2枚目だけ削除すると3枚になり、残る順序を維持。入力欄の画像も viewer の `3 / 3` で開く |
| 2・3・4枚の画像のみ送信 | OK。fake Host の実際の要求ログで各枚数、JPEG、`textLength: 0`、`deliverAs: "steer"` を確認。合計はそれぞれ134,145 / 200,778 / 270,789 bytes（600 KiB以下）。受付後は入力欄の添付をクリア |
| outbox の画像枚数 | OK。busy を保持して2枚と4枚を別々に送信。「割り込み待ち 画像2枚」「割り込み待ち 画像4枚」と各行の全サムネイルを表示 |
| ライト / ダーク | OK。OS 設定変更後にアプリを再起動。Markdown・user/tool grid・入力欄の複数添付と削除ボタンを確認。viewer はどちらも黒背景で表示 |

## 再確認の手順

1. [mobile README](../apps/mobile/README.md#pcのpiなしで画面を確認する) の手順で fake Host を起動し、対象エミュレーターだけに reverse を設定してペアリングする。
2. `POST /_dev/images` で先頭の Pi を合成画像セッションにする（`?i=<instanceId>` でも指定可）。user / tool 各6枚、欠損 preview、HTTPS / data / PC path の Markdown を返す。PC path は上記の合成パスだけを許可し、実ファイルを読まない。
3. `POST /_dev/images?hold=1` で busy を保持し、ピッカーから2〜4枚送信して outbox と `prompt metadata` ログを確認する。ログは本文・base64を含めず、枚数・MIME・bytes・配送種別だけを出す。
4. `POST /_dev/images?old=1` の後 `POST /_dev/drop` で再接続すると旧 capability のフォールバックになる。通常へ戻すには `POST /_dev/images` の後に再接続する。

fake Host の WebSocket 自己検査では capability、非連続preview、PNG寸法、原本との区別、未知のファイルパス・範囲外indexの拒否、複数画像prompt、旧capabilityを assert した。native の要求ログ・UI階層・拡大前後の画像比較も assert し、`node --check`、変更スクリプトの Biome、mobile の型検査を通した。

## 記録と限界

- スクリーンショット・UI階層・要求ログ・ビルドログ・検証用スクリプトはローカル `/tmp/pimate-emulator-qa-66/`。Gitには含めない。ペアリングリンクを含むローカルファイル・ログは公開しない。
- **ピンチは未検証**。通常の `adb input` では複数pointerを再現できず、ダブルタップによる拡大で代用しただけでピンチ成功とは扱わない。
- 実機、iOS、TalkBack、文字拡大・他画面幅、GIF/WebP、実Piでの縮小処理・配送・実モデルの画像理解、切断/取得失敗の網羅、60fps性能・動画での滑らかさは未検証。今回の自動確認はスクリーンショットとUI階層によるもので、動画検査ではない。
- 検証後は追加した合成ギャラリー画像を除去し、night設定をライトへ戻し、対象reverse・fake Host・エミュレーターを終了。既存AVD自体は削除しない。検証APKは配布版と同じversionNameなので公開APKと混同しない。Releaseの差し替え・push・マージは行わない。
