# PiMate protocol v1

型と NDJSON helper は [`src/index.ts`](src/index.ts)、Host の wire 型は [`src/host.ts`](src/host.ts)。未知のフィールドは無視し、未知のイベントは読み飛ばす後方互換方式です。操作は自動再送せず、変更要求には `expectInstanceId` / `expectSessionId` を付けます。

## 親プロンプトの画像

- `InstanceSnapshot.promptImages?: boolean`: **厳密に `true` の場合だけ**画像を送信できます。未指定/false の古い RC は未知の `images` を捨てるため、画像の送信要求自体を抑止します。テキストのみは影響を受けません。
- `prompt.params`: 必須の `text: string` に任意の `images: PromptImage[]`。本文が空でも画像があれば有効。idle / steer / followUp とも同じ配列です。スマホは常に `deliverAs: "steer"` を指定し、RC は idle なら `deliveredAs: "prompt"`、busy なら `"steer"` を返します。省略時の busy followUp と明示 followUp は旧クライアント互換のため残します。
- `PromptImage`: `{ type: "image", mimeType: "image/jpeg" | "image/png" | "image/webp", data: string }`。`data` は data URI でない、パディングつき base64。最大1枚、decoded `MAX_PROMPT_IMAGE_BYTES = 512 * 1024` bytes。`validPromptImages` は配列数・形式・base64・decoded 上限を検査します（画像デコーダではありません）。
- 画像つき本文は `MAX_IMAGE_PROMPT_TEXT = 32 * 1024` UTF-16 code units まで。テキストのみの既存の制限は変更しません。この組み合わせで画像要求を Host の受信 WebSocket 上限 1 MiB 内に収めます。
- RC は画像非対応の現在モデルを `unsupported` で拒否し、Pi の標準 text/image content API に渡します。画像だけを無視してテキスト送信へフォールバックしません。

ユーザーの `TranscriptItem` には任意の `images` と `imageCount` が追加されます。`imageCount` は元の画像の総枚数、`images` は表示用の最初の対応画像（512 KiB 以下）。表示不能・複数画像の残りは件数を使った placeholder にします。RC の history は最新側を優先した decoded 合計 2 MiB の preview budget を持ち、省略時も本文と件数を保持します。Pi の元の履歴と live 画像は変更しません。

画像要求の ACK は RC の受付を示し、履歴への反映を保証しません。モバイルは受付後に仮の画像 outbox 表示を除去し、Pi の実履歴だけを表示します。Pi が画像を再変換し、本文に寸法注記を追加する場合があるためです。

結果が不明な送信の照合は text **と**画像 MIME/base64 **と**枚数、未知だった entryId、セッションで行います。変換で完全一致しなければ推測で成功とせず、下書きを保持して手動の履歴確認を案内します。成功/実履歴での確認前の optimistic insertion、unknown delivery の自動再送はしません。
