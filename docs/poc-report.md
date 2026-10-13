# PoC報告: abduco + Remote Control Extension + Host（Linux）

- 対象: `docs/SPEC.md` §5 / Issue #2
- 環境: Ubuntu 24.04（x86_64）、Pi 1.2.0、Node 22、abduco 0.6（commit `8c32909`）、pi-subagents 0.78.0
- 検証コード: `poc/`（手順は `poc/README.md`）
- 範囲外: スマホアプリ本体、macOS、Relay、認証

## 結論

**SPECの構成（通常Pi TUI + Remote Control Extension + abduco + 別プロセスHost）はLinuxで成立する。** アーキテクチャ変更が必要な不成立項目はない。
ただし、次の制限はMVPの設計に織り込む必要がある。

1. Pi組み込みのスラッシュコマンド（`/new` など）は、テキスト送信では実行されない。RC自身のコマンドを経由する方式で回避できる（§2）。
2. `ctx.ui.editor()` と `ctx.ui.custom()` は、スマホで完結させられない（§5）。
3. HostからPiを起動するときは、Hostのサービス単位から切り離す必要がある（§4）。
4. 同じ端末サイズで再Attachすると画面が空白になる。RCで強制再描画して回避した（§1）。

| # | 項目 | 判定 |
|---|---|---|
| 1 | abduco管理下でPi TUIを非Attach起動し、後からAttach / Detach | 成立（再描画の回避策つき） |
| 2 | PC未Attach中のRC経由の状態取得・操作 | 成立（組み込みコマンドは回避策つき） |
| 3 | 複数Piの同時実行、PCで通常起動したPiとの共存 | 成立 |
| 4 | Host停止・再起動時のPi生存・再発見・復帰 | 条件付き成立（OS再起動ではPiプロセスは残らない） |
| 5 | Pi標準操作・第三者ExtensionのUI、サブエージェント | 一部制限つきで成立 |
| 6 | abducoの同梱（Linux） | x86_64は成立、arm64は未検証 |

## 1. abducoでの非Attach起動・Attach / Detach — 成立

- `abduco -n <name> pi ...` で端末なしに起動できる。RC経由でプロンプトを送り、bashツールを実行して応答を得た。その後、疑似端末から `abduco -a` でAttachすると、同じ会話が表示された。`Ctrl-\` でDetachしても、Piは動き続けた。
- Attach中にPCで入力した `/new` も、RCの `session_changed(reason:"new")` として取得できた。
- **問題と回避策:** 前回と同じ端末サイズで再Attachすると、画面が空白のままになる。abducoはAttach時にSIGWINCHを送るが、サイズが変わらないとPi TUIは差分描画で何も出力しない。
  RCで空のwidgetを登録してTUIの参照を取得し、SIGWINCHを受けたら `tui.requestRender(true)` を呼ぶようにした。この対応で、同じサイズで2回目にAttachしたときも会話が表示された。
  この方法は `setWidget` のファクトリーにTUIが渡されるという実装の仕様に依存している。PiのAPIが変わった場合は、Pi側に「Attach時の再描画」を要望する。
- abducoのDetachキー `Ctrl-\` は `abduco -e` で変更できる。Piのキー割り当てと衝突しないかは、MVPで確認する。

## 2. PC未Attach中のRC経由の操作 — 成立

Extensionは、`$XDG_RUNTIME_DIR/pimate/<instanceId>.sock`（ディレクトリ0700、ソケット0600）で改行区切りJSONを受け付ける。

| 操作・取得 | 結果 |
|---|---|
| 状態（idle / running / waiting_input）、モデル、思考レベル、セッション | 取得できた |
| 会話履歴（`sessionManager.getBranch()`） | 取得できた |
| 逐次出力（text_delta、thinking_delta）、ツール開始・更新・終了、メッセージ完了 | 配信できた |
| プロンプト送信 | idle時は通常送信、実行中は既定でfollowUpにした。`steer` も指定できる |
| 中断（`ctx.abort()`） | 実行中のbashが `Command aborted` になり、`agent_settled(aborted:true)` を受け取った |
| Extensionコマンド、スキル、プロンプトテンプレート | `sendUserMessage(text, {expandPromptTemplates:true})` で実行できた（例: `/probe-select` でダイアログが出た） |
| **Pi組み込みコマンド（`/new`、`/compact` など）** | **テキスト送信では実行されず、LLMへの通常メッセージになる** |
| 組み込みコマンド相当の操作 | RCが内部コマンド `/pimate-session` を登録し、それを `expandPromptTemplates` で起動して、ハンドラー内の `ctx.newSession / switchSession / fork / reload` を呼ぶ方式で成立した。新規作成、元のセッションファイルへの切り替え、リロードを確認した |
| 圧縮 | `ctx.compact()` を呼べる。失敗理由（例: `Nothing to compact`）も取得できた |
| 誤送信防止 | 要求に `expectSessionId` を付けた。PC側で `/new` したあとに古いIDで送ると、`session_changed` で拒否された |
| `/new` `/resume` `/reload` 後の継続 | Extensionのランタイムは作り直されるが、ソケットとinstanceIdを `globalThis` に保持すると維持できた。リロード後もイベントは重複しなかった |

制限と注意点:

- **組み込みコマンドを、スマホからテキストのまま送ってはいけない**（誤ってLLMに送られる）。アプリは、組み込みコマンドを専用操作として扱う。
- text_deltaはトークン単位で大量に届く。MVPではRCまたはHostで間引き、まとめて送る。
- メッセージに `role:"system"` で本文が空のエントリーが混ざる。正規化の段階で除外する。

## 3. 複数Piの同時実行、PCで通常起動したPiとの共存 — 成立

- abducoで起動したPi 3つと、tmux内で通常起動（abducoなし）したPi 1つを同時に動かした。それぞれ別のinstanceIdとソケットで一覧化でき、個別に操作できた。通常起動したPiへのプロンプトは、PCの画面にも表示された。
- メタ情報には `origin`（`mobile` または `pc`）と `abducoSession` を記録した。Hostは `abduco` の一覧と照合し、PCがAttach中かどうかも返した。
- 制限: PCで通常起動したPiをスマホから扱うには、RC ExtensionがそのPiに読み込まれている必要がある（Piパッケージとしてグローバルにインストールする想定）。PCで通常起動したPiには、abducoの再Attachはない。

## 4. Host停止・再起動時の生存・再発見・復帰 — 条件付き成立

| 構成 | Host停止後のPi |
|---|---|
| Hostを `systemd --user` サービスで動かし、Piを直接spawnする | **Hostと同じcgroupのため、まとめて終了した** |
| 同上で、Piを `systemd-run --user --scope` で別スコープとして起動する | **生存した**。Host再起動後、メタ情報、pidの生存確認、ソケットへのhelloで再発見して操作できた |
| Hostを手動起動して停止する | Piは生存し、再発見できた |

- Piが正常終了するとメタ情報とソケットは削除される。異常終了で残ったものは、Hostが一覧取得時にpidの生存を確認して掃除する。
- ログアウト後もHostとPiを動かし続けるには、`loginctl enable-linger` が必要（この環境ではすでに `Linger=yes`）。
- OS再起動後は、Piプロセスとabducoセッションは残らない。Piのセッションファイルは残るため、アプリでは「終了済み（再開可能）」として扱い、再開時に新しいPiを起動する。
- サービス環境でも `node` と `pi` が見つかるよう、Hostで `PATH` を明示する必要がある。

推奨: Piは `systemd-run --user --scope` で起動する。代わりに、Hostのunitで `KillMode=process` を使う方法もある。macOS（launchd）は後で検証する。

## 5. UI対応とサブエージェント

### 5.1 Pi標準操作と第三者ExtensionのUI

runnerは、全Extensionで1つの `ctx.ui` オブジェクトを共有している。RCがこのオブジェクトの `select / confirm / input / editor / notify` を置き換え、PCのTUIとスマホのどちらか先に回答した方を採用するようにした。

| UI | 結果 |
|---|---|
| select / confirm / input（第三者Extensionのツールやコマンドから呼ぶもの） | **成立**。スマホで回答するとTUI側のダイアログも閉じた（`signal` を使用）。TUIで回答した場合は、スマホに `ui_request_end(by:"tui")` を送った |
| editor | **一部制限**。スマホの回答で処理は進むが、`editor()` は `signal` を受け取らないため、TUI側のエディターが開いたまま残る（PCのAttach時に確認） |
| custom | **スマホでは扱えない**。`ui_prompt_start(kind:"custom")` で発生は検知できるため、「PCで操作が必要」と表示するにとどめる |
| notify | 置き換えて中継できた。setStatus、setWidgetなどは未対応（同じ方法で追加できる） |

制限:

- `ctx.ui` の置き換えは、公開APIではなく実装の構造に依存している。Piの更新時に回帰テストが必要。
- editorの代替案: (a) PCがAttachしていないときだけスマホに出す（Hostはabducoの状態を把握している。ただしPCで通常起動したPiでは常にTUIがある）、(b) スマホでは閲覧のみにする、(c) Piに `editor` の `signal` 対応を要望する。

### 5.2 公式サンプル `subagent`

- 子は `pi --mode json` の別プロセスで、親のツール実行として動く。RCは `tool_execution_update` の `partialResult.details` から、子ごとの `agent / task / model / usage / messages / stopReason / exitCode` を取得できた。並列モードでは、実行前の子が `exitCode:-1` になる。単体モードでは実行中も `exitCode:0` のままなので、完了の判定には `tool_end` を使う。
- 操作は、親のツールを中断して子をすべて止めることだけ（`ctx.abort()`、SIGTERMから5秒後にSIGKILL。コード読解に基づく）。子ごとの指示や停止はできない。サンプルの仕様。

### 5.3 pi-subagents

- pi-subagentsのRPC（`subagents:rpc:v1:*`）は同じPiプロセス内の `pi.events` でしか届かない。そのため、RCに中継コマンド `subagents_rpc` を用意した。
- RC経由で `ping / spawn(async) / status / interrupt / resume / steer / stop` を実行して確認した。
  - status: `asyncSnapshot.runs[].state`（running / paused / stopped / complete など）、現在のツール、トークン数、子（step）を取得できた。
  - 一時停止: `interrupt` で `paused` になる。単独の一時停止操作はない。
  - 再開: `resume` は**新しいrunIdで再起動する**。アプリでは、元のrunと新しいrunをつなげて表示する必要がある。
  - 指示: `steer` が子へ届いたことを、子の `events.jsonl` で確認した。
  - 停止: `stop` で `stopping` から `stopped` になった。
- イベントバス（`subagent:async-started / control-event / process-terminal / async-complete` など）も、RCからそのまま中継できた。`async-started` のtask本文は `[prompt redacted]` に置き換えられる。statusの文字列は160文字に切り詰められる。
- **子から親への問い合わせ:** 子が `contact_supervisor` を呼ぶと、`subagent:control-event` が `type:"needs_attention", reason:"supervisor_request"` で届き、検知できた。
  pi-subagentsは、親Piに自動でfollowUpを送ってエージェントを起こす。この検証では、親のLLMが数秒で自分で回答した。
  - **スマホに「待ち」として表示する必要はある。** 親が別の作業中だったり、親がユーザーの判断を求めたりすると、待ちが長引くため。ただし、親が自動で処理することが多いので、強い通知ではなく、子の状態として表示する程度でよい。
  - RPCには問い合わせに回答するメソッドがない（親LLMの `subagent_supervisor` ツール経由のみ）。スマホからは「親への指示」として返すことになる。直接回答が必要な場合は、pi-subagentsへの機能追加を要望する。
- 正規化DTO案（MVPで決定）: `{id, name, status: queued|running|waiting|complete|failed|paused|stopped, task?, model?, usage?, capabilities[]}`。公式サンプルは `toolCallId` と子のindex、pi-subagentsは `runId` とstepをIDにする。pi-subagentsは更新が速いため、`ping` の `capabilities` を確認し、未知のフィールドは無視し、状態はイベントではなくsnapshotを正とする。

## 6. abducoの同梱（Linux） — x86_64は成立

- `poc/abduco/build-linux-static.sh`: Alpine 3.20とmuslで静的リンクし、abducoのコミットを固定してビルドする。サイズは80KB、依存ライブラリはない。
- **再現性:** 2回ビルドして、sha256 `bfdcf547…64cb8` が一致した。
- Ubuntu 20.04、Debian 12、Alpine 3.20、Fedora 40の各コンテナで、同じバイナリでセッションの作成と一覧取得ができた。
- glibcで静的リンクすると `getpwuid` の警告が出るため、muslを採用した。
- ライセンスはISC。バイナリと一緒に `LICENSE.abduco` を配布する。
- 未検証: arm64（この環境にqemuがない。スクリプトは対応済み）。macOS（静的リンク不可。universalビルド、署名、公証が必要で、後で検証する）。
- バイナリはgit管理外（`poc/bin/`）とした。MVPではCIでビルドし、ハッシュを公開する。

## MVPへの推奨

1. **RC ExtensionをPiパッケージとして作る。** PoCの構成（`globalThis` でのソケット維持、`ctx.ui` の置き換え、トランポリンコマンド、pi-subagentsへのRPC中継）を引き継ぐ。プロトコルにバージョンを付け、状態の正はsnapshot、イベントは差分という扱いにする。
2. **Hostを独立サービスとして作る**（Nodeで十分）。役割はインスタンス発見、abducoでの起動（`systemd-run --scope`）、RCソケットの中継、スマホ向けの認証付き通信。text_deltaの間引きもHostで行う。
3. アプリ（Expo、Android優先）の最初の縦断機能は、一覧、会話表示、送信・中断、select / confirm / inputへの回答、新規作成・切り替え。サブエージェントは閲覧とpi-subagentsの操作を2段階目にする。
4. editor、custom、Attach時の再描画は、Piへの要望候補として記録しておく。

## 残事項

- macOS（abducoのビルド・署名、launchd、Pi TUIの挙動）
- arm64 Linuxのビルド確認
- abducoのDetachキーとPiのキー割り当ての衝突確認
- Hostの認証と、スマホとの通信方式（MVPで設計）
