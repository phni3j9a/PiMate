# PiMate mobile

Expo（SDK 57、expo-router）のアプリです。Android優先で作っています。見た目は [docs/design/](../../docs/design/README.md) のモックに合わせます。

## できること

M1:

- ペアリング: QR読み取り・リンク貼り付け・`pimate://pair?...` ディープリンク → 確認 → 登録（PC側は `pimate pair`。[packages/pimate](../../packages/pimate/README.md#スマホとの接続m1) を参照）
- ドロワー: マシンごとのPi一覧、入力待ちは「要対応」にまとめる、設定への入口
- チャット: 履歴、逐次表示、「考えた」行、ツール行（開閉）、箇条書き程度の簡易整形、送信・停止、作業中の送信は完了後に送信（followUp）
- 接続: 自動再接続（待ち時間を伸ばしながら）、前面復帰時の再接続と再購読。送れたか不明な送信は自動で再送しない
- 設定: ペアリング済みマシンの状態と削除

M2:

- 新しい Pi（ドロワーの鉛筆ボタン）: マシン、最近使ったフォルダ（実行中の件数・最終利用）か手入力のパス、「このフォルダを信頼する」、モデル（そのマシンで動いている Pi から取得。なければ「Pi の既定」）、最初のメッセージ。起動後は一覧に現れるのを待って開く。最初のメッセージが送れなかったときは再送せずにそう表示する
- 質問への回答: select / confirm / input / editor をチャット内のカードで回答（回答は1回だけ送り、送信先の Pi・セッションを確かめる）。PC で回答されたら短い注記を残す
- PC でしか操作できない画面（Extension の独自 UI など）は「PC のターミナルで操作が必要です」カードと `pimate attach` のコマンド（コピー可）を表示
- セッションのメニュー（ヘッダーの「…」）: 統計（メッセージ・トークン・コスト）、新しいセッション、過去のセッションを開く、ここから分岐（ユーザーのメッセージを選ぶ。選んだ文は入力欄に入る）、コンテキストを圧縮、起動元・PC の接続状態・attach コマンド、この Pi を終了（確認あり）
- モデル・Thinking（入力欄のモデル名）: プロバイダーごとのモデル、そのモデルで使える Thinking レベル、コンテキスト使用量とコスト、圧縮。変更は PC の Pi にも反映される
- PC 側の変化に追従: `/resume` などでセッションが変わったら区切りを表示し、下書きがあれば送信前に確認を求める。モデル・Thinking の変更も反映

M3（表示）:

- ターンの折りたたみ: 終わったターンの「考えた」行・ツール行・途中の文は「18秒 作業 · ツール 4 回」の1行にまとまり、タップで開閉する（最後の回答と使用量は常に表示。作業中のターンは開いたまま）。時間はアプリが開始から `agent_settled` までライブで観測できたターンだけ計測し、履歴・途中参加・途中の再接続では秒数を省く（assistant の時刻は生成開始であり、完了時刻ではない）。ファイルを変えたターンは「+a −b」（差分がなく書き込んだ内容しか分からないときは「N ファイル」）を添え、タップで変更画面を開く
- ツール行の右端: edit / write は「+a −b」、read は行数、bash などは所要時間、失敗は「エラー」。「考えた」の秒数はアプリが始まりから見ていたときだけ出す（履歴では数字を作らない）。edit / write を開くと出力の代わりに差分を表示する
- 変更画面（ターン要約の「+a −b」、セッションのメニューの「変更を見る」）: 「このターン」「セッション全体」の切り替え、ファイルごとの A/M・+/−・開閉、差分（行番号つき、追加は青・削除はコーラル）。同じファイルへの複数の変更は順に並べて表示し、1つの差分にまとめない。コピーは表示中の差分（unified diff）をまとめてコピー。「この変更について依頼」はチャットに戻り、「このターンの変更（src/greet.ts ほか 2 ファイル）について：」を入力欄に入れる（送信はしない）
- 差分の出どころ: edit は Pi の `details.patch`、write は RC が付ける `details.pimate`（`write_diff`）。それがない古い履歴や、大きすぎ・バイナリ・読めない・同時に複数の変更があった場合は、そう書いたうえで書き込んだ内容を表示する（新規ファイルとは言わない）
- 停止ボタンはターンの実行中だけ表示（ターン外の Extension の質問では出さない）。中断したメッセージの「0 in · 0 out」は出さない
- シートはキーボードを避ける。新しい Pi のモデル選択にも検索。セッションのメニューの操作が断られたときはシートの中に表示する

同じファイルへの変更は `./`・`..` を POSIX の規則で正規化して集約する。インスタンスの cwd が分かるときは絶対・相対パスも同一視する（シンボリックリンクの解決はしない）。同じ範囲内で新規作成したファイルは、後で編集しても A のまま。

M4（サブエージェント。RC が pi-subagents / 公式サンプルを正規化したもの。[docs/subagents.md](../../docs/subagents.md)）:

- 入力欄の上の要約1行「サブエージェント 2 実行中 · 1 完了」（待ち・一時停止・失敗・停止も数える）。どれかが動いている間は親の状態と関係なく出し、全部終わった後も次のプロンプトを送るまで残す。タップで一覧
- 一覧（シート）: トークン・コスト・バックエンド、実行中の実行ごとに「並列 · バックグラウンド」「チェーン 1 / 3」などの見出しと、バックエンドが許す停止だけ（停止… / 中断… / すべて停止…、確認あり）。子ごとに状態の印・名前・エージェント・経過時間（スマホの時計で計算し、開いている間だけ進める）・今の作業（`read  src/api/client.ts`）か「完了 / 失敗 · 理由 / 待ち · 質問 / 一時停止」。終わった実行は「以前の実行」に「完了 · 18分前」で並ぶ。pi-subagents のときだけ `/subagents-fleet` の案内
- 子の画面（`/subagent`）: 名前・エージェント・モデル・コスト（チェーンは「チェーン 1 / 3」）、状態と経過時間、「親の Pi からの依頼」とチェーンの並び、作業記録（チャットと同じ行。開くとき・その実行の更新が届いたとき（1秒に1回まで）・終わったときに cursor で差分だけ取る。一定間隔のポーリングはしない）。送った指示は「あなた · 割り込み」などの注記つき
- 操作は `actions` にあるものだけ: 割り込む（steer）/ 後で伝える（follow_up）の切り替え、停止（stop_child、なければ実行全体の stop / interrupt）、終わった子への「続きを依頼」（resume。新しい実行に移り、前後の実行へのリンクを出す）。失敗は画面内に表示する。公式サンプルは見るだけで、「すべて停止…」（abort_parent）は親の Pi も止まると明記する
- 質問中の子: 質問を黄色で表示し、回答は親の Pi を通す（「チャットで回答」で入力欄に下書きを入れて戻る。子に直接は答えない）。`waiting` にはidle-attentionも含まれるため、質問本文が分からない場合は「確認が必要です」として親のチャットへ案内する
- 操作成功は短い日本語で表示する（backendの長い返信・内部パス・送った依頼の再掲で入力欄を埋めない）。steerの受領と子への反映は別で、実際の受信は作業記録で確認できる
- チャットの `subagent` ツール行: RC が実行を知っているときは「subagent reviewer × 3 · 並列 … 2 実行中 ›」になり、終わったターンでも折りたたまない。タップで一覧（子が1人なら子の画面）。知らないときは普通のツール行
- ドロワー: 一覧の件数から「~/work/api · サブエージェント 2 実行中」。子が待ち状態なら親が待機中でも「要対応」に出す（開いている Pi なら質問の文も）。失敗は履歴の件数なので出さない

M5c（アプリ / Host 0.1.1）:

- 設定で明示的にオンにした場合だけ、入力待ち・完了・失敗を端末内に通知。通知権限もその時点で要求します。子の完了は通知しません。
- 接続中の全 Pi が対象。対象チャットを表示中は抑制。通知タップで対象の生存・セッションを確かめ、親チャットへ移動します。初期同期・履歴・再接続から通知を再発行しません。
- **アプリ終了・OS による休止・切断中は受信できません。** プッシュ配信や常時バックグラウンドサービスはありません。
- 古い Host ではチャットのみ。通知のためには PC パッケージを更新し Host を再起動してください。

詳しい通知対象・安全策・ネイティブ検証・未検証事項は [docs/notifications.md](../../docs/notifications.md)。

今後: Markdown の本格表示、`/tree`、画像の添付、作業中の「割り込む」。

## Android APK のビルドと配布（M5b）

Expo Go / Metro なしで動く、署名済み universal release APK をローカルで作ります。`android/` は CNG の生成物（Git 管理外）です。ネイティブ設定は `app.json` / `app.config.js` と config plugin に置き、生成後の手編集はしません。

### 準備

- Node.js 22.18 以上、`npm ci`（リポジトリルート）。
- **JDK 21**（JRE だけでは不可）。`JAVA_HOME` を JDK のディレクトリに設定。
- Android SDK: `platform-tools`、`platforms;android-36`、`build-tools;36.0.0`、`ndk;27.1.12297006`、`cmake;3.22.1`。SDK のライセンスに同意しておく。
- `ANDROID_HOME` を SDK の場所に設定（既定 `~/Android/Sdk`）。root 所有 SDK に不足がある場合は sudo で変更せず、ユーザー所有 SDK に cmdline-tools と必要なパッケージを入れる。

```sh
# リポジトリルート
npm ci
export JAVA_HOME=/path/to/jdk-21
export ANDROID_HOME="$HOME/Android/Sdk"
npm run build:android -w @pimate/mobile
```

スクリプトは `expo prebuild --platform android --clean --no-install` → Gradle `:app:assembleRelease` を実行し、署名検証結果・証明書 SHA-256・APK SHA-256 を表示します。初回は SDK/Gradle/Maven のダウンロードと全 ABI のコンパイルに時間がかかります。既定の Gradle 並列数は 2（`PIMATE_GRADLE_WORKERS` で変更可）。R8/resource shrink は現時点では有効化していません。

出力は `apps/mobile/dist/pimate-0.1.1.apk`。`versionName` は `app.json` の `expo.version`、`versionCode` は `major * 1_000_000 + minor * 1_000 + patch`（0.1.0 → 1000、各要素 0〜999 の安定版のみ）です。更新ごとに version を増やします。ソース・依存 lockfile・JDK/SDK・同じ署名鍵から再構築できますが、APK のバイト単位の一致を保証するものではありません。

### 署名鍵を必ずバックアップする

初回のみ `~/.config/pimate-release/`（`PIMATE_SIGNING_DIR` で変更可、**リポジトリ外必須**）に次を作ります。

- `pimate-release.jks`: RSA 3072 bit のリリース署名鍵
- `signing.properties`: keystore の絶対パス、alias、ランダム生成したパスワード

ディレクトリは 0700、両ファイルは 0600。パスワードはログや生成 Android プロジェクトへ書き出しません。既存の片方だけがある場合はエラーにして、鍵を勝手に再生成しません。`scripts/release-signing.gradle` がビルド時に外部 properties を読み、Expo の debug key による release 署名を置き換えます。

**この2ファイルを暗号化して安全な別の場所にバックアップしてください。失くすと、公開済み APK と互換の上書き更新を署名できません。** 別 PC に復元したら `signing.properties` の `storeFile` を復元先の絶対パスへ修正します。鍵・properties・パスワードは commit、Issue、CI ログ、Release 添付に含めません。

### インストール・リリース

利用者は [GitHub Releases](https://github.com/phni3j9a/PiMate/releases) の `app-v…` から APK を取得します。Android の「不明なアプリのインストール」を、使ったブラウザ／ファイルアプリに対して許可し、APK を開きます。Tailscale に PC とスマホを接続したら、PC の Pi で `/pimate setup` → PiMate で QR 読み取り → マシンを確認してペアリングしてください。カメラ権限は QR 読み取り時だけ要求します。通信は Tailscale 内の HTTP/WS のため Android の cleartext 許可を明示しています。Host を公共ネットワークに公開しないでください。

開発者の実機インストール:

```sh
adb -s <serial> install -r apps/mobile/dist/pimate-0.1.1.apk
```

公開担当者は検証済み commit を push し、APK と SHA-256・署名証明書 fingerprint を確認してから Release を作ります。

```sh
gh release create app-v0.1.1 apps/mobile/dist/pimate-0.1.1.apk \
  --target <検証済みcommit> --title 'PiMate Android 0.1.1' --notes-file <リリースノート>
```

タグは必ず **`app-v`** 接頭辞にします。PC パッケージ用 `v*` タグの release workflow を起動させないためです。新規版を出す前に既存 `app-v…` Release と署名を確認し、同じ version/tag の APK を黙って差し替えないでください。

実機検証結果と制限は [M5b 検証記録](../../docs/m5b-android-verification.md) を参照してください。

## 構成

- 画面: `src/app/`（expo-router）
- 部品: `src/components/`
- 接続・状態: `src/lib/`（HostConnection、reducer、store、pairing）
- デザイントークン: `src/theme/tokens.ts`
- テスト: `test/`（vitest）

```bash
npm run typecheck -w @pimate/mobile
npm test -w @pimate/mobile
npx expo start        # apps/mobile で実行
```

### PCのPiなしで画面を確認する

開発用の偽Host（アプリには含まれません）があります。決まった内容のPi一覧と会話の流れを返します。

```bash
node apps/mobile/scripts/dev-fake-host.mjs --port 47800   # ペアリング用リンクとExpo Go用ディープリンクを表示
adb reverse tcp:47800 tcp:47800
curl -X POST http://127.0.0.1:47800/_dev/turn             # PCで打ったときの1ターンを再生（read / edit / write / bash。drop / offline?s=20 なども）
curl -X POST "http://127.0.0.1:47800/_dev/ask?kind=select" # 質問を出す（select / confirm / input / editor）。answered で PC 側の回答
curl -X POST http://127.0.0.1:47800/_dev/custom            # PC でしか操作できない画面（?end=1 で終了）
curl -X POST http://127.0.0.1:47800/_dev/resume            # PC で /resume（model で PC 側のモデル変更）
curl -X POST "http://127.0.0.1:47800/_dev/refuse-shutdown?on=1" # 「この Pi を終了」を断らせる（on=0 で戻す）
curl -X POST "http://127.0.0.1:47800/_dev/sub?kind=waiting"  # サブエージェント（下を参照）
```

サブエージェント: 「認証まわりのレビュー」は、起動時から pi-subagents のバックグラウンド実行（reviewer × 3。約10秒ごとに作業が進み、1人が先に終わる）と以前の実行（完了・失敗）を持っています。操作は実行・子の `actions` に従い、割り込む（作業記録にあなたの発言が入る）、後で伝える（次の一歩で入る）、停止（停止中 → 停止）、続きを依頼（`resumedFrom` つきの新しい実行）を再現します。`/_dev/sub?kind=…`:

| kind | 内容 |
|---|---|
| `parallel` | reviewer × 3 のバックグラウンド実行をもう1つ（既定は「認証まわりのレビュー」） |
| `waiting` | 親に質問中の子（既定は「API クライアントのリファクタ」→ 要対応に出る） |
| `chain` | 公式サンプルのチェーン scout → planner → worker（見るだけ・すべて停止。既定は「PiMate」。親は実行中になる） |
| `answer` | 質問中の子を再開（親が答えたことにする） |
| `finish` | 動いている子を最後まで進める |
| `hold` | 進行を止める / 再開する（スクリーンショット用） |
| `reset` | `subagents_reset`（実行なし） |

対象の Pi は `?i=<instanceId>` で選べます（省略時は先頭）。「--shout フラグを追加」の履歴には、RC の差分がない古い write（書き込んだ内容だけの表示）が入っています。新しい Pi の起動でフォルダに `missing` を含めると「見つからない」、`fail-message` を含めると「起動したが最初のメッセージを送れなかった」を再現します。

ネイティブの依存を追加するときは `npx expo install <pkg>` を使います。詳しくは [AGENTS.md](AGENTS.md) を参照してください。
