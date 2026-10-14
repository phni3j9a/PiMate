# @pimate/pimate — Remote Control / M1 Host

通常の Pi TUI をそのまま操作する RC Extension と、同じマシン上で動く Host ライブラリ・開発用CLIです。
Pi は Host の子として使い捨てにせず、abduco の端末セッションで動かします。M1 Host は Tailscale 上のスマホへ認証付き HTTP/WebSocket を提供します。

## 前提

- Node.js 22.23 以降（TypeScriptの型除去）、Pi **1.2.0**、Unix-domain socket 対応OS。
- リポジトリルートで `npm install` 済み。Pi関連パッケージは peer dependency（開発時の型は1.2.0固定）。
- 起動機能には abduco。`PIMATE_ABDUCO` → `packages/pimate/bin/<platform>-<arch>/abduco` → `PATH` の順に解決します。
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

## 構成

- `src/extension/index.ts`: Pi lifecycle・イベント・session command trampoline
- `src/extension/hub.ts`: プロセス単位のhub、private socket、snapshot/seq、meta
- `src/extension/dispatch.ts`, `handlers.ts`: リクエスト検証、guards、全RCメソッド
- `src/extension/ui.ts`: TUI/remoteの先着回答、AbortSignal、終了通知・状態復元
- `src/extension/transcript.ts`: 履歴とliveメッセージの共通DTO正規化
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

E2Eは実Piをabduco内に起動し、discovery/hello、CLIのlist/prompt/abort、text_delta/message_end/agent_settled、history、new/reload後の同一socket・instanceIdと重複しないイベントを検証します。Piまたはabducoがなければ自動skip。テスト用の設定・作業ディレクトリを一時作成し、Piとabducoサーバーも終了します（abducoはPi終了後も端末バッファを保持するため、両方の清掃が必要）。

`test/fixtures/faux.ts` は pi-ai 1.2.0の `fauxProvider()` と `fauxAssistantMessage()` を使い、`pi.registerProvider(faux.provider)` で `pimate-faux/scripted` を登録します。このバージョンの公開APIは `registerFauxProvider()` ではありません。応答は固定文字列、2回目は中断確認用の長い低速応答で、**LLMネットワークアクセスも料金も発生しません**。テストは `--no-extensions` と明示したRC/fixtureだけをロードし、skills/context/templates/themesも無効化します。

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

DockerのAlpine/muslでコミット固定のソースを静的ビルドし、`bin/linux-x64/abduco` または `bin/linux-arm64/abduco` とISCの `LICENSE.abduco` を出力します。`bin/` はgit管理外。バイナリ配布時はライセンスを必ず同梱してください。arm64は対応ホスト/QEMUが必要、macOSビルド・署名は未対応です。

## 既知の制約（PoCから継承）

- `ctx.ui` の共有オブジェクト差し替えはPi実装構造に依存します。Pi更新時は回帰検証が必要。
- select/confirm/input はremote回答でTUIもAbort。editorにはAbortSignalがなくPC側に残ります（`tuiStaysOpen:true`）。custom UIは発生通知のみでPC操作が必要。
- `/new` 等のPi組み込みコマンドをprompt文字列として送るとLLMへ送られます。`session_op`（new/switch/fork/reload）や`compact`の専用メソッドを使ってください。Extensionコマンド・templates実行は `expandTemplates:true` を明示します。
- subagents RPC/busは生の中継のみ。サブエージェントDTO正規化、問い合わせへの専用回答、capability依存UIはM4。第三者extension自身の実装・バージョンに依存します。
- tool_resultの本文は32Ki文字に制限し `truncated:true` を付けます。tool details/他のメッセージは完全なサイズ制限をしません。Hostはdeltaをbatchingしbackpressureを制限しますが、history pagingは未対応。極端に遅いsocketクライアントは切断します。
- snapshotを正とし、seqに欠落があればhello/historyを取り直します。要求を自動再送しません。Hostの生存probe失敗は `reachable:false` として返し、PIDが生きているインスタンスは掃除しません。
- 通常PC起動のPiにはabduco attachはありません（`pcAttached:null`）。PC/remote同時操作は先着、排他制御はありません。
- SIGWINCH時の全再描画はabducoインスタンスだけに適用。Windows非対応、macOS/arm64・detachキー衝突は未検証。OS再起動後の自動復元はありません。
