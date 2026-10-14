# サブエージェント（M4 RC）

RC は親セッションのブランチに属する子実行を正規化して `snapshot.subagents` と
`subagent_run` / `subagents_reset` で配信する。既存の raw `bus` 配信も維持する。

## 対応する情報源

- **Pi 1.2.0 公式 `examples/extensions/subagent`**：tool progress/result の
  `agentScope`・`projectAgentsDir`・`results[].agentSource/messages` を識別する。
  実行中の操作は **親全体の中断**のみ。同期 single の初期 `exitCode: 0` は完了扱いしない。
- **pi-subagents 0.78.0**：foreground は親 tool progress/result、background は
  RPC `status` の `asyncSnapshot` v1 と、バックエンドから受け取った `asyncDir/status.json` を使う。
  status artifact は version 3（またはバージョン未指定）を読む。
  同名 tool でも details が未知なら専用 run に変換せず、通常の tool 行として残す。

status.json は atomic replace されるため **ディレクトリを watch** する。
稼働中だけ5秒間隔の安全再読取りを行い、終端で watcher/timer を解除する。
run ごとの更新を約250msに合流するが、終端は即時に配信する。
履歴はトップレベルの最新30件を目安とし、実行中は上限を超えても消さない。
workflowと参照先の子runは一緒に保持・削除する。

再起動・reload・resume・fork では親の現在ブランチから tool result を再解釈する。
async launch のパスと、RCからのresumeで得た旧→新runのリンクは、モデルに渡らない
`pimate_subagent` custom entry に記録する。別ブランチの実行は混入させない。

## 制御と記録

`subagent_control` は最新の run/child `actions` に含まれる操作だけ受け付ける。
stop は受領後に `stopping` とし、最終 status を待つ。resume は元の実行を改変せず、
新しい run ID を返し `resumedFrom` / `resumedAs` を設定する。
backend RPC のエラー本文は呼び出し元へ返す。

`subagent_transcript` は子IDからRC内部で解決したパスのみを読む。クライアント指定の
パスは受け付けない。JSONLの完成行のみ、最大256KiBのページにして返す。
opaque cursor はファイル識別子とbyte offsetを持ち、縮小・inode交換時に先頭へ戻る。
公式exampleの記録は `results[].messages` とmessage-count cursorで取得する。
最初の依頼は `task` に分離し、system message は表示用項目に含めない。

## 制約

- 記録は **message境界**の更新であり、子のtoken streamingではない。
- ファイルが保持期限等で削除された場合、履歴runは残るが記録を開けない。
- backend不明・status artifactの未知versionは推測しない。RPC snapshotだけでは
  model/token/cost/pathが不足するため、観測前に開始されたrunは情報が限定される。
- supervisor質問は未回答requestファイルからbest-effort取得する。回答ファイルの直接書込みはしない。
- stoppedの再開はバックエンドが明示的にresumable、またはrunがpausedの場合のみ提供する。
- チェーン表示はbackendの `currentStep` / `chainStepCount` に従う。
  workflow内部の多段グラフ全体や成果受入れ判定はこのDTOでは展開しない。
- 子トークンをrun総量に重ねて加算しない。cacheトークンの二重加算もしない。

Hostのインスタンス一覧にはactive/waiting/paused/failed件数を載せる。
親がidleのままでも、既存のHost discovery周期による差分配信で件数の変更を通知する。

## workflow形式の並列実行

pi-subagents 0.78.0の `tasks` は内部ではworkflow親とsingle子runになる。
RCはworkflowの `steps[].runId` という明示的な参照で子を解決し、子runをトップ一覧から隠して
親のchildrenへstate/model/thinking/activity/usage/transcript/操作を集約する。
親のstep IDとindexはUI上の安定キーとして維持する。使用量は親と子を加算せず、
全子の値が揃う項目は子の合計で親の値を置き換える。
これによりインスタンス件数とアプリのrun合計に二重計上しない。
子が先に観測された場合も、親が参照を得た時点の `subagents_reset` で既存の重複行を消す。

`workflow.resource` が `name: "tasks", invocation: "named"` の場合のみ
アプリには `mode: "parallel"` として返す。他のworkflowは推測せず `workflow` を維持する。
参照先singleの子操作はそのrunIdと子index（通常0）へ送る。
`stop_child` は **参照先single全体の `stop {runId: childRunId}`**、
親のstop/interruptはworkflow runIdへ送る。参照先をまだ解決できない間は子操作を提供しない。

実Pi検証（1.2.0 / pi-subagents 0.78.0、openai/gpt-6-luna）では2子を1parallelに表示し、
active=2、両子transcript、片方へのsteer（backend delivered=1）、
片方stop→対象のみstopped・兄弟running、親stop→両子stopped・active=0を確認した。

## `pimate_subagent` の保存とPiの画面・文脈

`pi.appendEntry()` は `type: "custom"` を保存する。`custom_message` ではない。
Pi 1.2.0の `sessionEntryToContextMessages` / `buildSessionContext` はplain customを
モデル文脈へ変換しない。RCはentry rendererを登録しないため、通常のTUI会話にも表示されない。
Piの `addCustomEntryToChat` はrenderer未登録なら何も追加しない。

`/tree` の既定フィルターもcustomをbookkeepingとして隠す。ただし利用者が明示的に
**全entry表示**へ切り替えると、Piの仕様としてcustomの種別が表示される（会話本文ではない）。
隠れたentryも通常のid/parentIdを持つため、前後のメッセージを辿る木構造を壊さない。
`/fork` は選んだbranchのcustomを含めてコピーする。launch前へ戻るとそのrunはbranchから外れ、
launch後でforkすると保存参照は引き継がれる。

回帰テストでは実SDKのcontext構築、実TreeSelectorの既定描画、branchの往復、
`createBranchedSession` によるforkを確認した。別途registryのcustom-entry復元でも
workflowの集約と子transcriptへの参照が維持されることを検証している。
