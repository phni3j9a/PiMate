# スマホからのプロバイダー認証

**Android 0.1.10 / PC 0.1.15 以上が必要です。アプリ・PC パッケージの両方を更新し、Host を再起動してください。** ログイン専用の Pi（[#105](https://github.com/phni3j9a/PiMate/issues/105)）に対応していない古い Host では、設定の入口を無効にして更新を案内します。

## 使い方

1. 設定 →「プロバイダー」で、認証設定を変更する PC の **プロバイダーのログイン**へ進みます。チャットで Pi を開いている必要はありません。
2. Host が PC にログイン専用の Pi を起動します（通常数秒）。会話中の Pi や選択中の Pi は止めず、切り替えもしません。
3. プロバイダーと認証方法を選びます。ブラウザを開く場合は自分でボタンを押します。認証情報の取得・保存は PC のログイン専用の Pi が行います。
4. 起動中のほかの Pi には通知しません。新しく使えるようになったモデルは、その Pi で `/reload` するか再起動すると表示されます（再ログインは不要）。

| 行 | ボタン（保存先） | スマホでの操作 |
| --- | --- | --- |
| OpenAI | API キーを入力（`openai`） | API キー入力 |
| | ChatGPT でログイン（`openai-codex`） | デバイスコードをスマホのブラウザへ入力して承認。PC 側が完了を受け取る |
| Anthropic | Claude でログイン / API キーを入力（`anthropic`） | Claude 認証後に表示されたコードを貼り付け、または API キー入力 |
| OpenCode | Zen のキーを入力（`opencode`）/ Go のキーを入力（`opencode-go`） | API キー入力 |

1つの行に保存先が複数ある場合は、保存先ごとに状態を表示し、ログアウトも「ログアウト（ChatGPT）」のように個別に行います（[#104](https://github.com/phni3j9a/PiMate/issues/104)）。OpenCode の Zen と Go は Pi では別のプロバイダーなので、両方使う場合はそれぞれ保存してください（環境変数 `OPENCODE_API_KEY` は両方に効きます）。PC の Pi が知らないプロバイダー（古い Pi の OpenCode Go など）は一覧に出しません。OpenCode は PC パッケージの更新が必要で、古い PC では表示しません。

ChatGPT でのログインは、Pi で「OpenAI Codex (legacy)」と表示される `openai-codex` のデバイスコード方式を引き続き使います。`openai` の ChatGPT ログインは削除したままです（[#57](https://github.com/phni3j9a/PiMate/issues/57)）。既存の認証情報は自動削除せず、必要なら「ログアウト」で削除できます。古い PC が OpenAI の OAuth を返してもアプリには表示しません。将来の Pi で `openai-codex` が削除された場合、ChatGPT でのログインは使えなくなります。

Pi とプロバイダーが提供する認証方式を使います。アカウント・組織側で機能が制限されている場合や、Pi 更新で手順が変わった場合は利用できないことがあります。API キーを保存しただけではキーの有効性は検証しません。

## 保存先とログアウトの範囲

- 対象は **通常の Pi CLI/TUI 1.2.0以上**。`getAgentDir()` の `auth.json`（既定 `~/.pi/agent/auth.json`、`PI_CODING_AGENT_DIR` に対応）を公開 `ModelRuntime` API で更新します。SDK が独自の `credentials` / `authPath` を注入した実行は対象外です。
- 同じエージェントディレクトリを使う **PC の Pi・ほかの Pi にも共通**です。現在の会話だけの設定ではありません。ログインも、そのプロバイダーの既存の保存情報を置き換えます。
- ログアウトは確認後に **保存されたそのプロバイダーの情報だけを削除**します。環境変数・`models.json`・起動時指定は変更せず、プロバイダー側のトークンも失効させません。そのため削除後も利用できる場合があります。
- トークンや入力したキーをスマホへ返したり、チャット・outbox・アプリの永続ストレージへ保存したりしません。入力欄は一時メモリのみです。ただし、自分でコピーしたコード は OS のクリップボード・ブラウザ履歴に残る可能性があるため共有しないでください。
- API キーは文字どおりに扱い、先頭 `!` のコマンド指定は拒否します。Pi が `$` を環境変数として解釈しないよう、PC で保存直前だけ標準の `$$` エスケープを適用します。

## ログイン専用の Pi

- Host は `auth_session` を受けると、ログイン専用の Pi を1つだけ起動（起動済みなら再利用）し、RC が応答してから instanceId を返します。起動は `pi --no-session --no-extensions -e <PiMate 拡張> --no-skills --no-context-files --no-prompt-templates --no-themes --no-tools --no-mcp --no-approve` 相当で、会話を保存せず、ユーザーの拡張・スキル・ツール・プロジェクト設定を読み込みません（cwd は Host のホーム、エージェントディレクトリは **Host の環境**のもの）。拡張が登録するプロバイダーは対象外です。
- この Pi は `purpose: "auth"` で登録され、アプリの Pi 一覧・`pimate list`・Webhook の監視対象には出ません。Host はこの Pi へ `hello` と `auth_*` だけを転送し、ほかの要求は `unsupported` で拒否します。
- 開いている画面ごとに（`holdId`）この Pi を保持します。画面を閉じる（`auth_session_end`）か接続が切れると、最後の保持が外れてから60秒後に Host が終了させます。終了前に進行中の手続きを中止し、保存中（`saving`）なら終了を延期します。再接続時、アプリは `auth_session` を送り直して保持し直します。
- Host を再起動すると、以前の Host が起動したログイン専用の Pi は見つけ次第終了させます。Host の停止時（`/pimate stop` など）にも終了を試みます。
- 複数の端末で同時に開くと同じ Pi を共有し、進行できる手続きは1件だけです（ほかの端末には「別のログイン手続きが進行中」と表示）。

## 切断・中止・更新

- Host とログイン専用の Pi の両方の `providerAuth === true`、Host の `authSession === true` を確認します。古い Host にはログイン用のメッセージを送りません。
- 認証の進行情報は専用 RPC の応答だけで扱い、通常の会話イベントへ配信しません。クライアントは一度に1件の long-poll（最大25秒）を送り、変更または期限の応答後にだけ次を送ります。RC は再接続分を含め最大8件まで待機できます。
- 再接続時は認証状態を読み直します。開始応答を失っても `auth_list.flow` から進行中の処理を回復できます。キー・コード・ログアウト要求を自動で再送しません。
- 対話は最大15分です。画面を離れると中止を試みますが、すでに保存が始まっていれば中止できません。ログイン専用の Pi が終了すると進行中の認証は破棄され、「状態を確認」で起動し直せます。保存中に切断・失敗した場合は「結果不明」として状態を確認します。
- 起動中の Pi のモデル一覧は自動では更新しません。`/reload` または再起動で反映されます。

ワイヤー定義は [`packages/protocol/src/auth.ts`](../packages/protocol/src/auth.ts)、PC 側は [`auth.ts`](../packages/pimate/src/extension/auth.ts)、アプリ側は [`providerAuth.ts`](../apps/mobile/src/lib/providerAuth.ts) と [`provider-auth.tsx`](../apps/mobile/src/app/provider-auth.tsx) です。

## 検証

- 一時ファイル・fake provider による公開 `ModelRuntime` の保存・削除、入力検証、キャンセル・期限・保存競合・秘密情報の非配信を自動テストします。OAuth の開始直後のキャンセルでも後処理へ到達する回帰テストを含みます。
- アプリの宛先固定、旧 Host/RC、状態回復、結果不明時の非再送、複数フローの遅延応答と非永続化を単体テストします。開発用 fake Host のプロバイダーのフローも通信テストします。
- ログイン専用の Pi: Host の取得・再利用・一覧からの除外・転送の制限・保持解除後の終了・保存中の延期・以前の Host が残した Pi の終了、アプリの取得・再接続時の再取得・画面終了時の中止と解放を単体テストします。実際の Pi（`test/auth-session.e2e.test.ts`、一時エージェントディレクトリ）で起動・非表示・OpenCode Go の API キー保存・終了を確認します。
- OpenAI OAuth の拒否・旧 PC が返す認証方式の除外・既存認証情報の保持とログアウト、Codex / Anthropic / API キーの継続動作を回帰テストします。
- OpenAI・OpenCode の行のまとめ方、OpenCode Zen / Go の API キー保存、Pi が知らないプロバイダーの除外を単体テスト・fake Host の通信テストで確認します。
- ChatGPT ログイン削除後に `npm run lint`・`npm run typecheck`・`npm test`（485件）が成功しました。
- Android API 35 エミュレーター（幅360dp）+ fake Host で、PCごとの入口（会話中の Pi なしでも可）、OpenAI / OpenCode の行、Go の偽キー保存と個別ログアウト、ChatGPT のダミーのデバイスコード、起動失敗・旧 Host の案内、ライト / ダークを確認しました（[PR #107](https://github.com/phni3j9a/PiMate/pull/107)）。実アカウント認証・物理スマホ・iOS は未検証です。既存のユーザー認証情報・物理スマホは変更していません。初回実装時の検証は [PR #52](https://github.com/phni3j9a/PiMate/pull/52) に記録しています。
