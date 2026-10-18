# PiMate protocol v1

型と NDJSON helper は [`src/index.ts`](src/index.ts)、Host の wire 型は [`src/host.ts`](src/host.ts)。未知のフィールドは無視し、未知のイベントは読み飛ばす後方互換方式です。操作は自動再送せず、変更要求には `expectInstanceId` / `expectSessionId` を付けます。

## プロバイダー認証

`HostInfo.providerAuth === true` **かつ** `InstanceSnapshot.providerAuth === true` の場合だけ、[`src/auth.ts`](src/auth.ts) の `auth_list` / `auth_begin` / `auth_wait` / `auth_respond` / `auth_cancel` / `auth_logout` を使えます。対象は OpenAI（API キーのみ）/ OpenAI Codex（OAuth）/ Anthropic（OAuth・API キー）の3つです。OpenAI（`openai`）の OAuth は提供しません。認証は会話ではなく、その Pi の標準 CLI agent directory に共通のため `expectInstanceId` で対象を固定します。

`auth_list` は秘密を含まない保存状態・利用可能方式と、最新の一時 `flow`（完了済みを含む）を返します。`auth_wait` は revision の変化を最大25秒待ち、クライアントごとに1本、RC ごとに最大8本です。認証キー・コードは `auth_respond` だけで渡し、イベント・履歴へ流したり自動再送したりしません。`saving` は中止不可、`storage_failed` や保存中の runtime 消失は結果不明の可能性があります。詳細は [プロバイダー認証](../../docs/provider-auth.md) を参照してください。

## 親プロンプトの画像

- `InstanceSnapshot.promptImages?: boolean`: **厳密に `true` の場合だけ**画像を送信できます。未指定/false の古い RC は未知の `images` を捨てるため、画像の送信要求自体を抑止します。テキストのみは影響を受けません。
- `InstanceSnapshot.promptImageLimit?: number`: 最大枚数。`promptImages: true` で limit 未指定なら旧仕様の1枚、新 RC は4枚です。
- `prompt.params`: 必須の `text: string` に任意の `images: PromptImage[]`。本文が空でも画像があれば有効。idle / steer / followUp とも同じ配列です。スマホは常に `deliverAs: "steer"` を指定し、RC は idle なら `deliveredAs: "prompt"`、busy なら `"steer"` を返します。省略時の busy followUp と明示 followUp は旧クライアント互換のため残します。
- `PromptImage`: `{ type: "image", mimeType: "image/jpeg" | "image/png" | "image/webp", data: string }`。`data` は data URI でない、パディングつき base64。最大 `MAX_PROMPT_IMAGES = 4` 枚、decoded 1枚 `MAX_PROMPT_IMAGE_BYTES = 512 * 1024` bytes・合計 `MAX_PROMPT_TOTAL_IMAGE_BYTES = 600 * 1024` bytes。`validPromptImages` は配列数・形式・base64・decoded 上限を検査します（画像デコーダではありません）。
- 画像つき本文は `MAX_IMAGE_PROMPT_TEXT = 32 * 1024` UTF-16 code units まで。テキストのみの既存の制限は変更しません。この組み合わせで画像要求を Host の受信 WebSocket 上限 1 MiB 内に収めます。
- RC は画像非対応の現在モデルを `unsupported` で拒否し、Pi の標準 text/image content API に渡します。画像だけを無視してテキスト送信へフォールバックしません。

`user` / `tool_result` の `TranscriptItem` は共通の `TranscriptImages` フィールドを持ちます。`imageCount?: number` は元画像の総枚数、`images?: PromptImage[]` は各512 KiB以下の対応 preview 全て（送信時の合計600 KiB・4枚制限とは独立）、`imageIndices?: number[]` は `images` と同じ長さで各 preview の元画像の0始まり index です。旧 RC の indices 未指定時は配列位置を使います。GIF・サイズ超過などの省略画像は `imageCount` を使った placeholder にします。history は user / tool_result 共通で最新側から decoded 合計2 MiB、単一 live `message_end` も2 MiBまで。Pi の原本は変更しません。

### 表示用画像の取得

- `InstanceSnapshot.entryImages === true`: `entry_image { entryId: string, index: number, thumbnail?: boolean }`。index は0以上の整数、元画像の index（preview の位置ではない）。現在セッション内の user / toolResult のみ。別の枝も取得可能。存在しない entry / index は `not_found`。
- `InstanceSnapshot.fileImages === true`: `file_image { path: string, thumbnail?: boolean }`。セッション cwd 相対、絶対、`~/`、`file://` URL を許可。symlink の先も含む通常ファイルを最大20 MiB読み、magic bytes で JPEG / PNG / WebP / GIF を判定。存在しないパスは `not_found`、読み取り不可・非通常ファイル・未対応形式・サイズ超過は `unsupported`。認証済みスマホが要求するPCファイルにsandbox制限はありません。対応モバイルではassistantのMarkdownに含まれるパスも自動取得します。
- 両メソッドの結果は `{ image: ViewImage }`。`ViewImage = { mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif", data: string, width?: number, height?: number }`。`data` は data URI ではない base64。2 MiB decoded 以下は原本、それを超えると Pi の `resizeImage` で最大2048px・2 MiB以下へ縮小し寸法を付けます。GIF の縮小は静止画になる場合があります。
- `entry_image` / `file_image` の `thumbnail: true` は小さい原本でも Pi の resize を必ず呼び、最大320px・decoded 64 KiB以下を目標にします（JPEG品質60、PiがPNGを選ぶ場合もあります）。resizeが使えない場合の原本fallbackは512 KiBまで、それ以上は `unsupported`。省略 / false は従来の全画面用画像です。
- 全画面用の resize API / codec が使えなければ5 MiB以下の原本へ fallback、それ以上は `unsupported`。5 MiB decoded は base64化後も Host の8 MiB送信制限に収まります。入力の絶対上限は20 MiB。
- 取得時も `expectInstanceId` / `expectSessionId` を使い、セッション変更後の別画像取得を防ぎます。子エージェント画像は対象外です。

画像要求の ACK は RC の受付を示し、履歴への反映を保証しません。モバイルは受付後に仮の画像 outbox 表示を除去し、Pi の実履歴だけを表示します。Pi が画像を再変換し、本文に寸法注記を追加する場合があるためです。

結果が不明な送信の照合は text **と**画像 MIME/base64 **と**枚数、未知だった entryId、セッションで行います。変換で完全一致しなければ推測で成功とせず、下書きを保持して手動の履歴確認を案内します。成功/実履歴での確認前の optimistic insertion、unknown delivery の自動再送はしません。

## セッションツリー

- `InstanceSnapshot.sessionTree === true` の RC だけが `session_tree`、`session_op` の `op: "tree"`、`set_label` に対応します。未指定/false の場合は入口を表示しません。
- `session_tree` は `SessionTree { nodes, leafId, truncated }`。nodes は親が先の表示順で、`parentId` は畳まれたツール/状態エントリを飛ばした表示上の親です。`onBranch` は現在の枝、`isCurrent` は現在の葉の最寄りの表示ノード、`isLeaf` は表示上の葉。元の葉は `leafId` です。本文・件数には上限があり、元の Pi セッションは変更しません。
- 移動要求は `session_op { op: "tree", arg: entryId, summarize?: boolean }`。受付応答とは別の `session_op_done` で取消/失敗/完了を通知します。成功時の任意の `editorText` は表示previewではなく入力欄へ戻す全文です。移動通知 `session_changed { reason: "tree" }` で同じセッションの履歴を再取得します。
- `set_label { entryId, label?: string }` の空文字・省略は解除。最大200文字。各要求は `expectInstanceId` / `expectSessionId` で元の宛先に固定し、自動再送しません。
