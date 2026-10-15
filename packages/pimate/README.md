# @pimate/pimate — Remote Control / Host / M5a install

通常の Pi TUI をそのまま操作する RC Extension と、同じマシン上で動く Host ライブラリ・CLIです。開発workspaceはprivateの `@pimate/pimate`、配布名は `pimate` です。
Pi は Host の子として使い捨てにせず、abduco の端末セッションで動かします。Host は Tailscale 上のスマホへ認証付き HTTP/WebSocket を提供します。

## 前提

- Node.js 22.23 以降（TypeScriptの型除去）、Pi **1.2.0**、Unix-domain socket 対応OS。
- リポジトリルートで `npm install` 済み。Pi関連パッケージは peer dependency（開発時の型は1.2.0固定）。
- 起動機能には abduco。`PIMATE_ABDUCO`（利用者が信頼するoverride）→ 同梱 `bin/<platform>-<arch>/abduco`（SHA-256照合）→ `PATH` の順に解決します。同梱が不在/不一致/未対応archなら警告してPATHへfallbackします。
- Linuxでは user systemd manager が利用可能なら `systemd-run --user --scope` を使用し、Hostのcgroupから分離します。それ以外は detached spawn。後者はHostのサービス終了時に同じcgroupごと終了される可能性があります。ログアウト後の生存には別途 linger 設定が必要です。

## 実行例（リポジトリルート）

```sh
# 既存PoCバイナリを使う場合
export PIMATE_ABDUCO="$PWD/poc/bin/linux-x64/abduco"

# PCで通常のPiを起動（RCを読み込んだプロセスのみ発見可能）
pi -e ./packages/pimate/src/extension/index.ts

# 別端末で一覧取得
node packages/pimate/src/host/cli.ts list

# abduco内に新しいPiを起動。RCは自動で追加される
node packages/pimate/src/host/cli.ts spawn --cwd "$PWD" -- --thinking off
# 出力のattachCommandでPCから接続する

node packages/pimate/src/host/cli.ts prompt <instanceId> '説明してください'
node packages/pimate/src/host/cli.ts prompt <instanceId> '方針を変更' --steer
node packages/pimate/src/host/cli.ts prompt <instanceId> '次に実行' --follow-up
node packages/pimate/src/host/cli.ts abort <instanceId>
node packages/pimate/src/host/cli.ts history <instanceId>
node packages/pimate/src/host/cli.ts watch <instanceId>
node packages/pimate/src/host/cli.ts ui <instanceId> <requestId> '回答'
node packages/pimate/src/host/cli.ts ui <instanceId> <requestId> --confirm
node packages/pimate/src/host/cli.ts ui <instanceId> <requestId> --cancel
```

`HostCore` / `RcClient` は `@pimate/pimate/host` からインポートできます。`await client.connect()` は `hello` も実行します。`client.request(method, params, guards?)` は型付きで、既定の待ち時間は5秒です。長時間RPCには `new RcClient(runDir, id, timeoutMs)` を使用してください。`onEvent()` の返り値で購読解除、`close()` で切断します。

runDir は `$PIMATE_RUN_DIR`、`$XDG_RUNTIME_DIR/pimate`、OSの一時ディレクトリ下の `pimate-<uid>`（通常 `/tmp/pimate-<uid>`）の順。所有者が自分で0700のディレクトリだけを使用し、socket/metaは0600です。メタはatomic renameで更新します。別Hostを試す際は異なるrunDirを指定できます。任意の外部パスをメタから信用せず、stale socketの掃除はメタのファイル名から導出します。

## スマホとの接続（M1）

```sh
node packages/pimate/src/host/cli.ts serve                  # 既定ポート47800
node packages/pimate/src/host/cli.ts pair                   # 別端末: URLとQR（10分・1回限り）
node packages/pimate/src/host/cli.ts devices                # token/hashを表示しない
node packages/pimate/src/host/cli.ts revoke <deviceId>      # 接続中の端末も約1.5秒で切断
# 必要時のみ: serve --port 47801 --listen 127.0.0.1 --listen 100.x.y.z
# pair --address my-host.tailnet-name.ts.net:47801 （または --port 47801）
```

`pimate` bin も同じCLIです。`HostServer` / `HostConfig` は `@pimate/pimate/host` から使用できます。
`await server.start()` は実際のlistenアドレス/ポートを返します（テストはport:0）。`await server.close()` はPiを終了しません。

### セキュリティと同期

- **既定のbindは127.0.0.1とTailscaleアドレスのみ**。Tailscaleのアドレスは `tailscale ip` が返し、かつ手元のインターフェースにあるものだけを使います（100.64.0.0/10は携帯回線などでも使われるため、範囲だけでは判定しません）。Tailscaleがない・止まっている場合はloopbackのみで警告。`--listen` は明示的な上書きで、公開IP/全インターフェースを指定すると外部公開になります。TLSはHostではなくTailscale/WireGuardに依存します。Tailscale ACLも別途設定してください。
- 設定は `$PIMATE_CONFIG_DIR` → `$XDG_CONFIG_HOME/pimate` → `~/.config/pimate`。ディレクトリは自分所有の0700、host/device/codeファイルは0600。端末tokenは256bitの乱数で、保存するのはSHA-256 hashのみ。認証はtiming-safe比較。
- `pair` のコードは192bitの乱数で、10分・single-use。CLIとHostはprivateなpairingファイルを共有し、atomic renameでコードを消費します。URL/QRを第三者に渡さないでください。発行済みtokenは取り消すまで有効です。
- `/pair` はJSONのみ・4KB上限、WebSocketは1MB上限。HTTP pairingではOriginを拒否し、CORSを許可しません（ネイティブWS実装もOriginを付ける場合があるため、WSはtokenで認証）。認証は最初のフレーム・5秒以内。未知/不正なWSメッセージは4400、認証失敗4401、認証待ちtimeout4408、失効4403。低速クライアント（送信待ち8MB超）は切断します。
- `devices.json` はatomic更新・排他lockでCLIとの更新競合を防ぎます。競合時は失敗するためコマンドを再実行してください。プロセスが書き込み中に強制終了した場合は、Host/CLIが停止していることを確認して残った`devices.lock`を削除してください。
- subscribe/reconnectでsnapshot（途中のassistant text/thinkingを含む）+historyを送り、同期中のイベントは順序を保って後送します。通常の連続deltaは約50msで結合するため、WSのseqは増加しますが連番ではありません。history/liveの重複はentryIdで除去してください。RC再接続はbackoff付き、操作要求は**再送しません**。
- `RcClient.send(request)` はid/guardsを保持してRCの成功/エラーResponseを返します。rejectはtransport/timeoutのみ。同じ共有link上でin-flight idを再利用しないでください（アプリはUUIDを使う）。

## 日常操作とスマホからの起動（M2）

- RC `models`: Piの認証済みモデル一覧。thinkingLevelsはPi 1.2.0と同じ `getSupportedThinkingLevels()` で求め、非reasoningモデルはoffのみ、xhigh/maxはモデルの対応表に従います。
- RC `sessions`: 現在のcwdと **Piが実際に使用中のsessionDir** から保存会話を更新日時降順で返します。`limit` は任意の正整数、日時はミリ秒、`current` で現在の会話を識別。切替は `session_op` のswitchへpathを渡します。
- RC `shutdown`: `ctx.shutdown()` による正常終了。Host終了と異なり対象Piが終了します。
- snapshotに `context` と `pcPrompt`。contextイベントはassistant終了・compaction・モデル/セッション変更後。回答できないTUI promptはPCで操作し、再接続でも開いたpromptが分かります。中断assistantはlive/history共通で `stopReason:"aborted"` に正規化し、通常のAPIエラーはerrorのままです。
- 認証済みWSの `folders` はhome、保存セッションのcwd、稼働中cwd/台数、最寄り親を含む保存trust判断を返します。既存ディレクトリのみ、最大200件、5秒キャッシュ。`$PI_CODING_AGENT_DIR/sessions`（既定 `~/.pi/agent/sessions`）の更新が新しい200フォルダを対象に、各最大2000ファイルのmtimeと最新ヘッダ先頭16KiBだけを読みます。全履歴は解析しません。独自sessionDirの会話は稼働中cwdには出ますが、停止後の候補探索対象外です。
- WS `spawn` は絶対パス/`~/...` の既存ディレクトリ、model、thinking、trust、任意の初回messageのみ受け付けます。リモート任意CLI引数やOSコマンドは公開しません。Host全体で同時起動1件、起動間隔3秒。自動retry/resendはありません。
- 初回messageをPiのCLI引数には渡しません。RCがreadyになるまで最大30秒待ち、`prompt` をsession/instance guard付き・template展開なしで **1回だけ** 送ります。message指定時のspawn_resultはその応答まで待ちます。起動後に送信できなかった場合は `ok:true` のまま `messageError` を付けて返し、再送しません（届いたかは一覧・履歴で確認）。
- Host起動Piへ `PIMATE_TRUST=yes|no` を渡し、RCの `project_trust` handlerが**今回のみ**決定します。trust省略はnoで、保存判断にかかわらず自動承認しません。環境変数はRCロード時に消し、ツールの子プロセスへ引き継ぎません。PCから通常起動したPiのtrustフローは変更せず、trust.jsonも書き換えません。Piのtrustはsandboxではありません。PiのCLI `--approve/--no-approve` や先に決定する別のuser extensionは優先されるため、起動コマンド/拡張設定は信頼できるものにしてください。

### 起動コマンド設定とPCへのattach

Hostの環境変数で起動設定を変更できます（shell評価なし）。

| 変数 | 既定 / 用途 |
| --- | --- |
| `PIMATE_PI` | PATH上の `pi`。別バイナリ/ローカルwrapperのパスも可。引数を混ぜない |
| `PIMATE_EXTENSION` | このpackageの絶対パス `dist/extension.js`（開発時 `src/extension/index.ts`）を `-e` で追加。別パスへ変更可能。`none` は追加しない（ユーザー設定でRC登録済みの場合のみ） |
| `PIMATE_ABDUCO` | 使用するabduco実行ファイル（既存解決順は前述） |

開発時の既定は `pi -e <repo>/packages/pimate/src/extension/index.ts` です。二重ロードしないようRCのglobal登録と `-e` はどちらか一方にしてください。

```sh
pimate attach                         # abducoセッション一覧
pimate attach pimate-01234567          # スマホが表示するコマンドで接続
# 開発用: node packages/pimate/src/host/cli.ts attach pimate-01234567
```

detachキーは **Ctrl+\**（CLIにも表示）。attachはPCターミナルのstdin/outをabducoへ直接接続するだけで、リモート制御にTTYキー注入は使用しません。

## 書き込み差分の表示（M3）

RCはPi組み込み `write` の実行前にファイルを読み、成功時の `details.pimate` に `{ kind: "write_diff", existed, patch }` を追加します。`patch` は前後3行付きunified diffで、Piのセッションにも保存されます。tool結果の `content`（LLMが見る本文）は変更しません。旧/新内容が256 KiBを超える場合は `omitted: "too_large"`、NULを含む場合は `"binary"`、読み取り失敗や差分計算の時間上限（100ms）超過は `"unreadable"` としてpatchを省略します。`existed: false` はファイル不存在を確認できた場合だけです。同時の外部書き換え・別extensionによるwriteの上書き実装は正確な差分を保証しません。

history/liveのtool_resultでは `details` のJSONが256 KiB超（またはJSON化不能）の場合だけ省略し `detailsOmitted: true` を付けます。通常サイズの `edit` の `details.patch` はそのままです。`tool_end` イベントは従来どおり結果/detailsを持ちません。これらの転送制限で元のPiセッションは書き換えません。

## 構成

- `src/extension/index.ts`: Pi lifecycle・イベント・session command trampoline
- `src/extension/hub.ts`: プロセス単位のhub、private socket、snapshot/seq、meta
- `src/extension/dispatch.ts`, `handlers.ts`: リクエスト検証、guards、全RCメソッド
- `src/extension/ui.ts`: TUI/remoteの先着回答、AbortSignal、終了通知・状態復元
- `src/extension/transcript.ts`: 履歴とliveメッセージの共通DTO正規化
- `src/extension/write-diff.ts`: write実行前の取得と結果への表示用差分追加
- `src/runtime.ts`: Host/RC共通runDir・権限確認
- `src/host/`: discovery、RcClient、abduco spawn、開発CLI
- `test/`: 単体テストと実Piの無課金E2E

## 検証

```sh
npm run typecheck -w @pimate/pimate
npm test -w @pimate/pimate
npm run test:e2e -w @pimate/pimate
npx biome check packages
```

E2Eは実Piをabduco内に起動し、WS spawn/初回messageの単発送信、未信頼project拡張の抑止、独自sessionDir、models/sessions/shutdown/attach一覧、shutdown後のabduco片付けに加え、discovery/hello、CLIのlist/prompt/abort、text_delta/message_end/agent_settled、history、new/reload後の同一socket・instanceIdと重複しないイベントを検証します。Piまたはabducoがなければ自動skip。テスト用の設定・作業ディレクトリを一時作成し、Piとabducoサーバーも終了します（abducoはPi終了後も端末バッファを保持するため、両方の清掃が必要）。

`test/fixtures/faux.ts` は pi-ai 1.2.0の `fauxProvider()` と `fauxAssistantMessage()` を使い、`pi.registerProvider(faux.provider)` で `pimate-faux/scripted` を登録します。このバージョンの公開APIは `registerFauxProvider()` ではありません。応答は固定文字列、2回目は中断確認用の長い低速応答です。RC E2Eでは `PIMATE_E2E_WRITE_DIFF=1` で途中にwrite/edit呼び出しを追加し、historyの両patchとwrite差分のセッション保存も検証します。**LLMネットワークアクセスも料金も発生しません**。テストは `--no-extensions` と明示したRC/fixtureだけをロードし、skills/context/templates/themesも無効化します。

手動でも上記CLIのspawnに以下を渡すと同じfixtureを使用できます（最初の応答後、2回目を送りabortする）。終了時はattachしてPiを終了し、abducoセッションも閉じてください。

```sh
node packages/pimate/src/host/cli.ts spawn --cwd "$PWD" -- \
  --no-extensions -e "$PWD/packages/pimate/test/fixtures/faux.ts" \
  --model pimate-faux/scripted --thinking off --no-skills --no-context-files
```

## abducoビルド

```sh
packages/pimate/scripts/build-abduco-linux.sh amd64
# arm64: packages/pimate/scripts/build-abduco-linux.sh arm64
```

DockerのAlpine/muslでコミット固定のソースを静的ビルドし、`bin/linux-x64/abduco` または `bin/linux-arm64/abduco` とISCの `LICENSE.abduco` を出力します。`bin/` はgit管理外。バイナリ配布時はライセンスを必ず同梱してください。ビルド後に `bin/SHA256SUMS.json` も生成します。arm64はネイティブホストを推奨（release CIは `ubuntu-24.04-arm`）、この作業のためにQEMU/binfmtを導入しません。macOSビルド・署名は未対応です。

## 配布パッケージとリリース（M5a）

```sh
packages/pimate/scripts/build-abduco-linux.sh amd64
npm run build -w @pimate/pimate          # dist/package/ を再生成
npm run test:pack -w @pimate/pimate      # clean npm install + 実Pi 1.2.0のロード/faux会話
cd packages/pimate/dist/package && npm pack
```

esbuildでRC/CLIと `@pimate/protocol` / ws / qrcode / diffをinlineし、Piのパッケージはexternal + peer `*` にします。
バージョン・ライセンスの正本は `packages/pimate/package.json`。生成manifestは `pimate`、Node >=22、
`pi.extensions: ["./dist/extension.js"]`、`bin.pimate: ./dist/cli.js`。
利用者READMEは `PACKAGE_README.md`、MITのroot `LICENSE`、abduco ISCとbundle依存ライセンスを
`THIRD_PARTY_NOTICES` に同梱します。`npm publish` はprivateなworkspaceではなく生成tarballに対して実行します。

ローカルbuildは存在するarchだけで検証でき、不足を警告します。**公開用は `npm run build -w @pimate/pimate -- --release`**
でx64/arm64両方が必須。各binaryのSHA-256 manifestを生成します（署名ではなく破損/差し替え検知）。
通常CIはx64をビルドしてpack smoke、tag `v*` のrelease CIは各ネイティブrunnerで両archをビルドします。

### 公開手順

1. `packages/pimate/package.json` のversionを更新し、`npm install --package-lock-only` でlockも同期。
2. lint / typecheck / unit / E2E / pack smoke、レビューを通し、通常の承認手順で統合。
3. versionと一致するtag（例: `v0.1.0`）をpush。`.github/workflows/release.yml` が両archを集約しGitHub Releaseへtarballをupload。
4. Releaseの `pimate-<version>.tgz` を取得し内容確認、**人が `npm publish ./pimate-<version>.tgz --access public`**。
   CIはnpmへpublishしません。tagとmanifest不一致や片arch不足は失敗します。
5. `pi install npm:pimate` → `/pimate setup` を確認。更新時は `pi update npm:pimate` とPi再ロード後、
   `/pimate status` の不一致表示からHostを再起動（unitの絶対Node/CLIパスも更新）。

### 未公開tarballを隔離Piで検証

Pi 1.2.0のlocal installは**ディレクトリ**を指定します。tarballは先にnpmで展開します。

```sh
VERIFY=$(mktemp -d)
npm install --prefix "$VERIFY" --ignore-scripts --legacy-peer-deps /absolute/path/pimate-0.1.0.tgz
export PI_CODING_AGENT_DIR="$VERIFY/agent" PIMATE_CONFIG_DIR="$VERIFY/config" PIMATE_RUN_DIR="$VERIFY/run"
pi install "$VERIFY/node_modules/pimate"
pi                                  # /pimate setup, pair, devices, status, restart, uninstall
# cleanup: /pimate uninstall を実行してから
pi remove "$VERIFY/node_modules/pimate"
rm -rf "$VERIFY"
unset PI_CODING_AGENT_DIR PIMATE_CONFIG_DIR PIMATE_RUN_DIR
```

47800を使う既存Host・`pimate-host.service`がないことを先に確認してください。
user unitは実際の `~/.config/systemd/user/pimate-host.service` に作成されます（XDG_CONFIG_HOMEで変更可）。
setupは既存Hostを検出すると追加pairingのみを提案。別configのHostや管理外unitは勝手に変更しません。
登録を断ると `systemd-run --user --collect --unit=pimate-host-…`、user managerがなければdetached起動。
停止用状態はconfig内 `host-process.json`、detachedログは `host.log`。
`/pimate stop` はHostだけを停止、`/pimate uninstall` はunitも削除します。
手動で `pimate serve` したHostは元のターミナルで停止してください。

`/pimate` はPC TUIのみ。RCのremote promptでは拒否し、セットアップの同意・QR・通知はremote UI bridgeを通しません。
Host/RCはpackage versionとprotocolを送信し、未知の追加fieldは許容、異なるRC protocolはログとstatusに表示してskipします。
管理UIは既定ポート47800専用。カスタムport/listenを使う開発Hostは従来CLIで管理してください。

### M5a実機確認

Linux x64 / Pi 1.2.0 / tarballの隔離installからtmux内の実TUIで、service登録・active、loopback/Tailscale両health、
QR表示とHTTP `/pair`（200、同一codeの再利用401）、devicesから失効、status、restart、uninstallを確認。
登録拒否のtransient HostがPi終了後も生存し、別Piからstopできることも確認しています。
旧Host version 0.1.1 / Extension 0.1.0の不一致からの再起動、protocol 99のRCをskipしてlog/statusに表示、
setup再実行時のpairingのみの提案も確認。作成したunit/transient/一時設定は削除し、47800の解放を確認しました。
arm64はrelease CIによるbuildのみ、macOSの常駐と実機動作・Android QRスキャンのこの変更での再検証は未実施です。

## 既知の制約（PoCから継承）

- `ctx.ui` の共有オブジェクト差し替えはPi実装構造に依存します。Pi更新時は回帰検証が必要。
- select/confirm/input はremote回答でTUIもAbort。editorにはAbortSignalがなくPC側に残ります（`tuiStaysOpen:true`）。custom UIは発生通知のみでPC操作が必要。
- `/new` 等のPi組み込みコマンドをprompt文字列として送るとLLMへ送られます。`session_op`（new/switch/fork/reload）や`compact`の専用メソッドを使ってください。Extensionコマンド・templates実行は `expandTemplates:true` を明示します。
- subagents RPC/busは生の中継のみ。サブエージェントDTO正規化、問い合わせへの専用回答、capability依存UIはM4。第三者extension自身の実装・バージョンに依存します。
- tool_resultの本文は32Ki文字に制限し `truncated:true` を付けます。tool detailsは前述の256 KiB制限がありますが、他のメッセージは完全なサイズ制限をしません。Hostはdeltaをbatchingしbackpressureを制限しますが、history pagingは未対応。極端に遅いsocketクライアントは切断します。
- snapshotを正とし、seqに欠落があればhello/historyを取り直します。要求を自動再送しません。Hostの生存probe失敗は `reachable:false` として返し、PIDが生きているインスタンスは掃除しません。
- スマホから起動したPiが終了すると（アプリからの終了を含む）、abducoはattachされるまでサーバー・ソケット・systemd scopeを残します。Hostは一覧更新のたびに、終了済み（`abduco` 一覧の `+`）でHostが命名した `pimate-xxxxxxxx` のセッションだけをSIGTERMで片付けます（終了コードは確認できなくなります）。
- 通常PC起動のPiにはabduco attachはありません（`pcAttached:null`）。PC/remote同時操作は先着、排他制御はありません。
- SIGWINCH時の全再描画はabducoインスタンスだけに適用。Windows非対応、macOS/arm64・detachキー衝突は未検証。OS再起動後の自動復元はありません。

### 実プロバイダーを使うM2スモークテスト（任意・課金あり）

```sh
PIMATE_E2E_REAL_MODEL=1 PIMATE_E2E_REQUIRED=1 npm run test:e2e -w @pimate/pimate -- test/m2.e2e.test.ts
```

`openai/gpt-6-luna --thinking off` を使い、一時agentDirから既存auth.jsonを参照して短い1応答を検証します。通常のE2E/CIは引き続きfaux providerで無課金です。実モデル用認証が必要です。テストで起動したPi/abducoと一時ディレクトリはfinallyで清掃します。
