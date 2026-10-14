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
履歴は最新30件を目安とし、実行中は上限を超えても消さない。

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
  workflow内部のネストされたグラフ全体や成果受入れ判定はこのDTOでは展開しない。
- 子トークンをrun総量に重ねて加算しない。cacheトークンの二重加算もしない。

Hostのインスタンス一覧にはactive/waiting/paused/failed件数を載せる。
親がidleのままでも、既存のHost discovery周期による差分配信で件数の変更を通知する。
