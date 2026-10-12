# Pi Native Mobile — アプリケーション仕様書 v1.1（abduco本線）

**Version:** 1.1 — abduco First / Codex PoC Handoff  
**更新日:** 2026-10-12  
**状態:** 製品方針は確定、abduco・Pi TUIの成立性はPoC Gateを通過するまで未検証  
**対象:** iOS/Android Native App、Pi Remote Control Extension、macOS/Linux Host Service、abduco  
**前版:** `pi_native_mobile_spec_v1_0.md`（tmux案。履歴として保存し、本書が後継）

> **Codexへ渡す際の最重要指示：** 先に本書の「Phase 0 — Go/No-Go PoC」を実行し、ログ・結果・リスクを報告すること。**abduco方式の成立を実測するまで、製品全体の実装に着手しないこと。** 未検証APIを実装済み・確定済みとして扱わないこと。
>
> 本書の `決定` は合意済み製品方針、`設計提案` は実装時の推奨、`要検証` は実験で確認する項目を表す。パッケージ名・アプリ名・CLI名は仮称。

---

## 0. v1.0からの変更点（差分概要）

| 項目 | v1.0 | v1.1（本書） |
|---|---|---|
| スマホからのPi新規作成 | tmux必須 | **abducoを本線**に変更 |
| プロセスのPTY保持 | 専用tmux server / 1 session / 複数window | **1 Piにつき1 abducoセッション/PTY** |
| Host→Piの作成 | `tmux new-window` | **`abduco -n <name> <pi executable>`** |
| PCから実行中Piに接続 | `tmux attach` | **`abduco -a <name>`** または同梱CLIのラッパー |
| 外部依存 | tmuxを別途インストール | **abduco実行ファイルをパッケージに同梱する方針**（配布検証は必須） |
| 複数Piの一覧 | tmux window ID | HostのInstance IDとabducoセッション名（ソケット） |
| Host再起動後の生存性 | tmux serverに依存 | abduco daemon生存に依存。**launchd/systemdで要検証** |
| セッション操作・通信 | 共通Extension | **変更なし**。RPC/SDK不使用を継続 |
| PC通常起動Pi | 同じExtensionで直接接続 | **変更なし**。あとからabducoへ取り込む機能はない |

**注意：** `abduco -c` は「作成して即Attach」、`abduco -n` は「作成してAttachしない」。スマホ発のヘッドレス起動では**`-n`を用いる**。abduco自体はユーザー向けTUIではなくPTYの維持・再接続だけを担う。

---

## 1. プロダクトの目的と設計原則

### 1.1 目的

PC（macOSまたはLinux）上で動く**通常のPi coding agent**を、React Native製のスマホ最適化UIから操作する。ターミナル画面をスマホへミラーリングするのではなく、会話・ツール呼び出し・履歴・モデル・Thinking・状態を**構造化データ**で表示・操作する。

次の2つを**同じMobile操作プロトコル**で実現する。

1. **PCで通常起動したPi TUIへリアルタイム接続**する。PCでの入力・セッション切替がスマホに追従する。
2. **スマホから独立した通常Pi TUIを新規起動**する。PC側の表示端末がないときもPiを実行し、必要なときにPCから同じTUIへAttachできる。

### 1.2 合意済み原則（決定）

1. **Pi本体の改造や専用フォークを前提としない。** PCには通常の `pi` コマンドを使う。
2. **Pi RPCモードとPi SDKによる別エージェント実行を使わない。** 全PiをTUIモードで起動し、Mobileとの制御は共通Remote Control Extensionで統一。
3. スマホ発Piは、**abduco管理下の独立Piプロセス**として作る。tmuxは必須にせず、初期実装の依存から除く。
4. abducoは実行継続とAttach/Detachに専念させる。**Prompt送信にTTYキー入力や`abduco -p`を使わない**。Piへの入力・イベントはExtension APIのみ。
5. ユーザー向け導入は、**Pi Extensionを1パッケージとしてインストール → 初回セットアップ → スマホQRペアリング**を目標にする。
6. ExtensionとHost Serviceは同梱するが**別プロセス**。Piがゼロになっても、明示設定されたHostが稼働していればスマホから新規作成可能。
7. **スマホはPi Instance（プロセス）を選択し、そのInstanceが現在開いているPi Sessionへ追従する。** `/new`・`/resume`・`/fork` でInstanceを別物として扱わない。
8. Pi標準機能を可能な限りネイティブUIで提供。第三者Extensionのツール実行互換と独自TUI UI互換は分けて扱う。
9. 接続失敗・セッション競合・未対応のUIでは、安全側に倒す。勝手な再送・自動承認・別Sessionへの誤配信を禁止する。

### 1.3 初期スコープ外

- iOS/Android端末上でのPi実行、スマホ内ファイルシステムでのエージェント実行
- PCターミナル映像のネイティブ描画/ターミナルエミュレーターをメインUIとする機能
- tmux、Pi RPC、Pi SDKへの自動フォールバック（PoC失敗なら**設計再検討の意思決定**を挟む）
- 任意の第三者`ctx.ui.custom()`の自動ネイティブ化
- 異なるマシン間のPiプロセス移動
- 無条件のクラウドRelay提供、E2EE未実装の状態での「完全なE2E暗号化」表示
- PCで**通常起動済み**のPiを後からabduco管理下へ取り込むこと

---

## 2. 利用体験（ユースケース）

**UC-01 既存PC Piへ接続**：ユーザーがPC端末で通常どおり `pi` 実行 → グローバルに導入されたRemote ExtensionがHostに登録 → スマホに表示 → スマホからプロンプト送信／応答表示 → PC側も同じPi Instanceの状態を共有。

**UC-02 スマホから独立Piを作成**：スマホでPC・ワークスペース・モデル等を指定 → Hostがabducoセッション名を割り当て → `abduco -n` で通常Pi TUIを起動 → そのPiのExtensionがHostへ登録 → スマホに新規Instanceを表示・接続。

**UC-03 スマホ発PiをPCで操作**：PC端末で専用CLIからInstanceを選択 → 内部で `abduco -a <name>` → **同じPiプロセス**のTUIを操作 → DetachしてもPi実行継続 → スマホへのイベント配信も継続。

**UC-04 PC側で会話を切替**：PCで `/new` `/resume` `/fork` → Extensionが切替を検知／必要なら再登録 → スマホは**同じInstanceの新しいPi Session**をSnapshotで再同期。古い会話の下書きは保持し、無断で送らない。

**UC-05 スマホの切断・復帰**：アプリのバックグラウンド化・ネットワーク断の間もPC上のPiは継続。復帰後にInstance ID・現Session ID・履歴Snapshot・現在状態を照合して再表示。

**UC-06 複数Piの同時稼働**：スマホ発の独立abducoセッションとPC通常起動Piを同じ一覧に表示。それぞれ別Piプロセス、別AgentSession。共通プロジェクトへの同時編集には警告とWorktree等を用意。

**UC-07 Host再起動**：Hostだけ再起動・更新してもPiの会話が極力中断しない。abducoへの接続可能性・Extensionの再登録・サービス管理下の生存性をPoCで実測し、達成できる条件を製品仕様として固定する。

---

## 3. システム構成

```text
┌─────────────────────────────────────────────────────────────┐
│ React Native App (iOS / Android)                            │
│ Sessions / Chat / Tools / Models / Attach guide / Settings  │
└──────────────────────────────┬──────────────────────────────┘
                               │ WSS + device auth
                               │ (MVP: LAN / private network)
┌──────────────────────────────▼──────────────────────────────┐
│ Host Service [independent process, bundled in Pi package]  │
│ • Pairing / authentication / WebSocket routing              │
│ • Pi Instance registry / discovery / health / diagnostics   │
│ • abduco launcher / process metadata / attach helper       │
│ • local IPC endpoint for all Pi Remote Extensions           │
│ • **not** the owner of Pi AgentSession / conversation log    │
└───────────────┬─────────────────────────┬───────────────────┘
                │ local IPC               │ spawn/observe
                ▼                         ▼
    ┌──────────────────────┐    ┌───────────────────────────┐
    │ PC terminal: pi      │    │ abduco session 'pm-<id>'  │
    │ normal Pi TUI        │    │ PTY: normal Pi TUI        │
    │ Remote Extension     │    │ Remote Extension          │
    └──────────────────────┘    └──────────────┬────────────┘
                                               │ UNIX socket
                                               ▼
                                 PC Terminal: abduco -a ...
                                 (only when user wants TUI)
```

### 3.1 コンポーネントの責務

| コンポーネント | 責務 | 保持しないもの |
|---|---|---|
| Mobile App | ネイティブUI、ユーザー操作、状態購読、最小ローカルキャッシュ | Pi認証トークン、AgentSession実行状態の正本 |
| Remote Extension | Pi events→プロトコル変換、Pi API操作、Snapshot、Session切替通知 | Host全体のプロセス管理 |
| Host Service | 認証、インスタンス登録、メッセージ中継、abduco起動・確認、Attach用メタデータ | 会話の独自正本、LLM実行、TTY入力によるPrompt送信 |
| abduco | 管理下PiへのPTY提供、Detach/Attach、独立プロセス存続 | Pi会話の管理、ネットワーク、スマホ認証 |
| 通常Pi | AgentSession、ツール、Skills、Extensions、セッションファイル、モデル実行 | スマホの表示実装 |

### 3.2 Piとabducoの区別

用語の衝突を避ける。

- **Pi Instance**：動作中の1つのPi OSプロセス。スマホが選択する単位。
- **Pi Session**：Pi内部の会話／セッションファイル。1 Instance内で `/resume` 等により現在値が切替可能。
- **abduco Session**：PTYと子プロセスを生かす「接続可能な端末コンテナー」。スマホ発Pi Instanceと1:1。
- **App Session表示**：UIでPi Instanceとその現在のPi Sessionを合わせて表示する。内部IDは混同しない。
- **PC通常Pi**：abduco Sessionを持たないPi Instance。Remote Extension経由のスマホ操作はできるが、後から `abduco -a` はできない。

---

## 4. abduco設計（本書の中心・採用方針）

### 4.1 基本方式（決定）

- **スマホ発Pi Instanceごとに独立したabduco Sessionを1つ作る。** 1つのabduco Session内に複数Piを詰め込まない。
- `abduco -n <session-name> <command> [args...]` で、新規作成時はAttachしない。
- PCから `abduco -a <session-name>` でそのセッションのPTYを表示・操作する。
- Detach後もPiはabducoのPTY上で継続する。Piの終了操作（通常 `exit` 等）とは区別する。
- Session名はHostが生成する。UUID由来の短い識別子にプレフィックスを付け、ユーザーが送ったラベルをそのまま実行引数にしない。
- Sessionが既に存在する場合は**勝手に再利用・上書きしない**。まず起動済みInstanceとの一致を確認する。
- Pi起動時には通常TUIモードを使い、Remote Extensionを確実に読み込む。Pi RPC/SDKモードは使用しない。

### 4.2 実行コマンド例（仕様検証用）

```bash
# 先に abduco が存在するか確認
abduco -v

# Piを新規起動（非Attach、Hostは内部でexecFile/spawnのargv配列を使用）
abduco -n pm-e9a12b pi

# abducoセッション一覧
abduco

# 同じPi TUIにPCからAttach
abduco -a pm-e9a12b

# PCからDetach：abduco既定キー Ctrl+\
# 必ずPi自身のquitとは区別する
```

**注意**：コマンド例は手動PoC用。実装では `pi` / `abduco` の解決済み絶対パス、`cwd`、`HOME`、`PATH`、`TERM`、サービス環境、ログを明示する。**シェル文字列の組み立ては禁止**。Pi実行時の作業ディレクトリはHostが`spawn`の`cwd`で固定し、`cd ... && pi`形式にしない。

### 4.3 ソケット・セッション名の方針（設計提案・要検証）

abducoはセッション識別にUnix Domain Socketを使う。通常はユーザーのabduco保存先に格納される。実装候補は次の2つ。

- **候補A（MVP優先）**：`pm-<random-id>` の単純名。abduco既定のソケットディレクトリを利用し、`abduco` コマンドで一覧を確認。Hostはセッション名を永続記録。
- **候補B（配布品質）**：アプリ管理下の短い絶対ソケットパスをsession nameに指定。親ディレクトリを0700にし、`sun_path`最大長、権限、macOS/Linux差を検証。abducoマニュアルはパス形式のセッション名を許可している。

最初のPoCは候補Aで十分。配布時に候補Bが必要か決める。古いソケット、PID再利用、別ユーザーのセッションを**自動で接続先として信用しない**。

### 4.4 Hostの管理データ（最小限）

```ts
type ManagedPi = {
  instanceId: string;             // Hostで発行したランダムID
  source: 'mobile-abduco';
  abducoSessionName: string;      // 一意・Host管理、例 pm-e9a12b
  abducoSocketPath?: string;     // 採用方式・取得可否に依存
  cwd: string;
  requestedModel?: string;
  piExecutable: string;
  createdAt: string;
  pid?: number;                 // PIDだけを識別子として使わない
  processStartedAt?: string;    // PID再利用対策
  lastSeenAt?: string;
  state: 'creating' | 'online' | 'disconnected' | 'exited' | 'unknown';
};
```

- Host管理下のInstanceに限り、プロセス識別とabduco Sessionとのマッピングをローカルに永続保存する。
- **正本はPi自身**：Pi Sessionの履歴や会話内容をHost DBで重複管理しない。
- ローカル永続データは必要最小限のID・作業ディレクトリ・ソケット名・起動情報・端末認証など。個人情報・会話本文は記録しない。
- Host再起動後、Registryだけで生存と断定しない。**abduco可視性・ソケット生存性・Pi Extensionからの登録**を突合する。
- PCの通常起動Piは `source:'pc-tui'` としてExtensionから自己登録し、abduco属性は持たない。

### 4.5 PC Attach用ヘルパー

ユーザーに長いabducoセッション名やソケットパスを入力させない。理想UXは次の通り。

```bash
# 仮のCLI名。公開前に決定
pi-mobile list
pi-mobile attach <instance-id-or-alias>
pi-mobile status
```

- `list`：Hostまたはabducoの情報で実行中Instance一覧。
- `attach`：ID→abducoセッション名解決 → ユーザー自身の端末で `abduco -a ...` を**TTYを継承**して実行。
- `attach`は対話端末を必要とするため、スマホアプリのHost WebSocketから実行しない。
- abducoのDetachキー（既定 `Ctrl+\`）は初回接続時に案内。
- **Piパッケージのインストールだけで `pi-mobile` がPATHに必ず出現する保証はない**。PoCでPiパッケージから同梱CLIを呼び出す導線を確認し、必要なら初回setupでユーザー領域にshim作成を許可する。
- PC TUIでの再描画が崩れる場合は `SIGWINCH` / TUI再描画の検証を優先し、同じPiを再起動して誤魔化さない。

### 4.6 既存Pi・abducoの併用

- 普通の `pi` コマンド：Remote Extensionで操作。PCターミナルの閉鎖でPiが終了する可能性がある（通常通り）。
- Hostから作成した `pi`：abducoでPTY継続、PCからAttach可。
- UIでは `PC起動` / `モバイル起動` を表示してもよいが、操作UIと通信APIは同一。
- **起動後に任意のPC TUIプロセスをabducoへ移す機能は作らない**。

### 4.7 abduco同梱・配布（決定／検証条件）

**方針は「abducoを同梱し、原則ユーザーのパッケージマネージャー操作を不要にする」こと。配布可能性の最終判定はPoC対象。**

- upstream: `martanne/abduco`、**ISC License**。同梱時にはライセンス・著作権表示を製品パッケージに保持する。
- 少なくとも **macOS arm64/x64、Linux x64/arm64** のバイナリをCIでクロス環境ビルドまたはネイティブビルドし、テストする。
- 配布方法候補：`bin/<platform>-<arch>/abduco` 同梱。実行時に`process.platform`/`process.arch`で選択。**macOS/Linux両方でその実行ファイルが起動することをCIで検査**。
- Unix実行権限、macOS Gatekeeper/quarantine、アーキテクチャ・共有ライブラリ依存、Linux libc環境差を確認。
- サポート外OS/CPUではセットアップを失敗として説明し、**PATH上のシステムabducoを使う救済策はユーザー選択制**とする。黙ってtmuxへ変更しない。
- npm package更新時に参照先のabducoバイナリが消えないよう、setup時に**ユーザー管理下の安定したバイナリ保管先へコピー／バージョン固定する設計**を優先。既存セッションを終了せず、次回起動で新バージョンを使用する。
- `abduco` はメンテナンス間隔が長いため、既存版のOS互換・不具合対応とセキュリティパッチ取り込み方針を策定。

**Go/No-Go条件：** 「起動はできる」だけでなく、「非Attach TUIが正常動作」「macOS/Linux双方で配布」「PCからAttach」「Hostサービス更新／再起動で期待通り生存」を検証する。

---

## 5. Host Serviceライフサイクル

### 5.1 役割（決定）

Hostは**小さなサービス**にする。リモート認証、WebSocket/API、Pi ExtensionとのIPC、abduco起動とInstance一覧を担う。エージェントロジックやツール実行には介入しない。

### 5.2 起動・常駐

- **開発中**：Hostを手動で起動する方式を許容。
- **配布用**：macOS `launchd` LaunchAgent、Linux `systemd --user`を初回セットアップで明示同意のもと登録。
- 常駐登録はPi Extensionのインストールだけで無断実行しない。Pi Extension初回読み込み時にセットアップ導線を案内。
- Pi Extensionのファクトリ初期化中にはソケットや長時間プロセスを無条件起動しない。Pi公式のライフサイクル規約に従って`session_start`等から登録を開始し、`session_shutdown`で現在のExtension由来の接続を破棄する。
- **複数Piの同時起動でHostを重複起動させない**。既存HostのヘルスチェックとOSサービス起動の排他制御を用いる。

### 5.3 「Hostだけ落ちてもPiが残る」を過信しない（最重要リスク）

abducoはTerminalから分離できるが、**OSサービス管理のプロセスグループ／cgroup／ジョブの設定次第で、Host停止時にabducoやPiまで終了する可能性がある。**

- Linuxの`systemd --user`では、Unitのstop/restart時に同じcgroupの子プロセスまで終了し得る。**デフォルト設定のまま生存保証をしない**。`KillMode`や別scopeでの起動方法をPoCで比較し、残留プロセスの管理リスクを含めてADRに記録。
- macOSの`launchd`でも、Agent再起動・ログアウト・プロセスツリーの扱いを実測し、持続性を保証できる条件とできない条件を明示。
- **Hostクラッシュ、Hostの正常停止、OSログアウト、OS再起動、パッケージ更新**を別の事象として試験する。1つ通っても他を通ったことにしない。
- OS全体の再起動でPiの実行継続を保証しない。セッション履歴からの再開は別機能。
- 対応策が複雑になる場合は、生存性要件を限定するか、別のPTY管理方式への移行を**明示的な設計レビュー**で判断する。

### 5.4 Extension・Host・abducoの停止ルール

| ユーザーの操作・障害 | 原則 |
|---|---|
| スマホ画面を閉じる | Piを止めない |
| スマホ通信が切れる | Piを止めない |
| PC端末でabducoをDetach | Piを止めない |
| `Host disable` | リモート接続を止める。Piは原則継続（PoCで条件を確認） |
| Hostのクラッシュ／再起動 | Piを極力継続させ、再起動後に再発見 |
| ユーザーが`Stop Pi`を選ぶ | 対象Piを安全に停止、履歴維持。停止とAbortは別 |
| Pi自身が終了 | abducoセッションも終了扱い。HostにはExitedを通知 |
| OS再起動 | 生存は保証せず、Pi Session履歴から再開可能か検討 |
| Extensionの再ロード | そのPi Instanceを失わず再登録 |
| パッケージ削除 | 残存Host・abduco Session・秘密鍵の扱いをユーザーに明示してcleanup |

---

## 6. Pi Instance、履歴、同期

### 6.1 Piが唯一の会話の正本

- AgentSessionと履歴ファイルはPiが所有。Pi Sessionの同時書き込みは避ける。
- Hostは`instanceId`と`sessionId`の対応を中継するが、Piと別の会話エンジンは実装しない。
- PC側で通常Piがセッションを切り替えると、スマホも**同一Instanceの新しいセッション**に追従する。
- スマホからの「新規Pi Instance」と「既存Instance内の`/new`相当」は、UI上もAPI上も別操作とする。

### 6.2 Identity設計（設計提案）

```ts
type InstanceRecord = {
  instanceId: string;
  hostId: string;
  origin: 'pc-tui' | 'mobile-abduco';
  pid: number | null;
  processStartedAt: string | null;
  abducoSessionName: string | null;
  cwd: string;
  piSessionId: string | null;
  sessionFile: string | null;
  extensionGeneration: number;
  sessionEpoch: number;
  state: 'creating' | 'online' | 'switching' | 'disconnected' | 'exited' | 'unknown';
};
```

- **`instanceId`はPIDやPi Session IDと同一視しない**。Pid再利用対策に起動時刻やHost側生成トークンを併用。
- Extensionのreload時にはプロセスID/起動識別等から同じInstanceへ再登録。別Piに誤統合しない。
- `sessionEpoch`はPi Sessionの差し替えに使う。ブランチ表示切替は別revisionで扱う。
- requestには`instanceId`と期待する`piSessionId`/`sessionEpoch`を添える。

### 6.3 メッセージ型（初期案）

```ts
type MobileCommand = {
  requestId: string;
  instanceId: string;
  expectedSessionId?: string;
  expectedSessionEpoch?: number;
  type:
    | 'prompt.send' | 'run.abort' | 'run.steer' | 'run.followUp'
    | 'model.set' | 'thinking.set' | 'session.snapshot'
    | 'session.new' | 'session.switch' | 'session.fork';
  payload?: unknown;
};

type HostCommand =
  | { requestId: string; type: 'instance.create'; hostId: string; cwd: string; model?: string }
  | { requestId: string; type: 'instance.stop'; instanceId: string }
  | { requestId: string; type: 'instance.list' };

type RemoteEvent = {
  instanceId: string;
  sessionId: string | null;
  extensionGeneration: number;
  sessionEpoch: number;
  eventId: string;
  type: string;
  payload: unknown;
};
```

- HostコマンドとPi Extensionコマンドを分離し、**`instance.create`がPiの`session.new`を暗黙に呼ばない**ようにする。
- Commandは受付・Piに配送・Piによる適用完了を区別。ネットワーク切断後に結果不明なPromptを勝手に再送しない。
- `requestId`重複は短期保存して抑止。Host再起動を跨ぐExactly-onceを安易に保証しない。
- 秘密鍵、APIキー、OAuthトークン、シェル環境変数の機密値をネットワークに漏らさない。

### 6.4 Snapshotとイベント購読

1. MobileがInstanceを選ぶ。
2. Extension経由で現在のPi Session ID・履歴ブランチ・直近メッセージ・生成中か否かを取得。
3. 後続の`message_start/update/end`、tool、model、session等のPiイベントを構造化して配信。
4. アプリ復帰時はSnapshotとイベントの重複をID/Revisionで除去。
5. 欠落イベントを補えない場合はSnapshotへフォールバック。**Host独自の恒久Event JournalはMVPに不要**。
6. Piの最終完了状態は `agent_settled` などバージョンに応じた正確なイベントで判定し、`agent_end`のみを完成判定としない。

### 6.5 セッション切替・Extension再ロード

- セッション変更を事前イベントと事後イベントから検知する。
- 切替中の入力は保留またはRejectし、切替先を明確に確認してから受け付ける。
- Piによる`session_shutdown`/Extension reload/`session_start`が発生する場合は、その間の通信切断を再登録処理で補う。
- セッション切替後、Mobileは古い下書きを保存したまま現在Sessionを表示。古いEpochの操作は拒否。
- **公式APIの存在＝あらゆるExtension handlerから呼べる、ではない。** `ctx.newSession`等のCommandContext制約や再生成後のStale ContextをPoCで確認する。

---

## 7. ユーザー向け機能要件

| ID | 機能 | 優先 | 実装方針・備考 |
|---|---|---|---|
| F01 | 1パッケージ導入 | P0 | Pi Extension・Host・abduco同梱。初回setupのみ明示実行 |
| F02 | QR/コードで端末ペアリング | P0 | 有効期限、端末認証、失効、設定診断 |
| F03 | 既存PC TUI Piの一覧と操作 | P0 | Remote Extension自動登録 |
| F04 | スマホから新規Pi Instance作成 | P0 | **abduco -n**、通常TUI起動 |
| F05 | Pi Instance一覧・複数選択 | P0 | PC起動とスマホ発を統合 |
| F06 | 会話履歴・Streaming表示 | P0 | Snapshot + Pi events |
| F07 | Tool UseとResultの折りたたみ | P0 | read/edit/bash/その他を共通カード化 |
| F08 | Prompt送信 / Abort / Steer / FollowUp | P0 | Remote Extension API |
| F09 | 接続断復帰、Host/Extension再接続 | P0 | StatusとSnapshotを再照合 |
| F10 | PCでのSession切替自動追従 | P0 | stale request拒否 |
| F11 | スマホ発Piのバックグラウンド継続 | P0 | abduco + Host生存性検証 |
| F12 | PCからAttach/Detach | P0（PoC）/ P1（UX） | `abduco -a`/ラッパーCLI。同じPi PIDを維持 |
| F13 | モデル/Thinking変更 | P1 | Pi API、利用可能Model一覧 |
| F14 | Pi Sessionのnew/resume/fork/tree | P1 | Capabilityに応じて表示、CommandContext制約あり |
| F15 | セッション名/Compact/履歴検索 | P1 | 公式API別に適用可否を判定 |
| F16 | Diff・ファイル参照 | P1 | PCの読み取り許可パスを限定 |
| F17 | Extension追加コマンド | P1 | 発見/呼出しの可否を調査 |
| F18 | Extensionの標準UI要求 | P1/要検証 | confirm/select/input/editorがTUI Extensionから横取り可能か |
| F19 | 独自Extension `ctx.ui.custom()` | P2 | 汎用保証はしない。個別アダプター |
| F20 | OS間配布・ワンパッケージ更新 | P1→GA必須 | abduco同梱4ターゲットの配布CI |
| F21 | Relay/遠隔接続 | P2 | MVPはLANまたはプライベートNW先行。運用/E2EEは別ADR |
| F22 | 終了履歴から新Instanceを再開 | P1 | 同一Pi Sessionの二重書込を防止 |

### 7.1 標準Pi機能の網羅性

Pi CLIの組み込み操作を一覧化し、**A=Extension APIで直接可能、B=Extension command context経由、C=Host補助が必要、D=現状不可能**に分類する。モデル・Thinking・会話の分岐・Compact・認証・設定画面・外部Editor・クリップボードなどを機能単位でPoCする。ネイティブUIを描画しただけでは機能完成とみなさない。

### 7.2 サードパーティExtension

| Level | 内容 | 方針 |
|---|---|---|
| L1 実行互換 | ツール、イベント、Skills、Prompt | PC上でそのまま実行。結果を構造化して表示 |
| L2 標準UI互換 | 追加コマンド/confirm/select/input/editor | Remote Extensionによる中継可否をPoC。自動互換と断定しない |
| L3 専用UI | `ctx.ui.custom()`、TUIウィジェット、特殊キー入力 | 汎用変換なし。個別対応かPC側Attach操作案内 |

- TUI上の標準UI呼び出しを、別Extensionから**無条件に横取りできるとは想定しない**。
- バックグラウンドのPiが入力待ちで停止するケースを検出・案内する。検出不能なら「応答待ち/PC操作が必要な可能性」と慎重に表示。
- 未対応承認をアプリが勝手に許可しない。

---

## 8. ネイティブUI・画面構成

**UI方針：** React Native / Expoを軸に、iOS・Android対応。Notion風のシンプルで洗練されたライトテーマを基本とし、ダークテーマも考慮。ターミナル画面は標準UIにしない。

1. **Hosts** — 登録PC一覧、オンライン状態、ペアリング、診断。
2. **Instances** — PC起動Piとabduco発Piを統合表示。プロジェクト、実行状態、最後のイベント、作成元。新規Pi起動ボタン。
3. **New Instance** — Host、workspace、model/Thinking（可能なら）、rootかworktree（後期機能）、作成／失敗復旧。
4. **Chat** — メッセージ、Markdown、thinking、Tool cards、Diff/ファイル参照、Stop/Steer/FollowUp。
5. **Pi Session** — Session名、現在Branch、履歴、New/Resume/Fork/Tree、Compact（対応可能なもの）。
6. **Attach on PC** — 「PCで開く」ガイド。Instance IDに基づくコマンドをコピーできる。
7. **Settings** — 通信方式、端末管理、権限、Hostのバージョン、デバッグ情報。

**UX上の注意：** スマホの一覧で選ぶのは基本Pi Instance。PCがそのInstanceのSessionを切り替えた場合、UIは自動追従し、ユーザーに変更を通知する。未送信ドラフトの宛先混同を防ぐ。

---

## 9. 導入・更新・アンインストール

### 9.1 理想の初期導入

```text
PCのPiで
  pi install npm:<package-name>    # 仮称
        ↓
  Piを再起動または/reload
        ↓
  /mobile setup                     # 仮のExtensionコマンド
        ↓
  OS・Pi・Node・同梱abducoを検証
        ↓
  明示同意→Hostをユーザー常駐サービスに登録
        ↓
  QRコードでスマホをペアリング
        ↓
  PC既存Piへの接続／スマホからPi新規作成
```

Pi Extension packageに含めるもの：Remote Extension、Host ServiceのJS配布物、CLI/セットアップ補助、バージョン付き共通プロトコル、各OS/CPU向けabducoバイナリ、ISCライセンス文面。

**ユーザーに要求しないもの：** tmuxのインストール、abducoの手動`brew install`/`apt install`、別Hostアプリの個別ダウンロード（対応環境で同梱成功した場合）。

**必要な可能性があるもの：** macOSサービス登録の承認、Linuxのユーザーサービス/linger設定、プライベートNW設定、OS側の権限。これらを「インストールだけで絶対に完全自動」とは宣言しない。

### 9.2 同梱バイナリの取り扱い

- インストール時に対象OS/CPUを判定し、実行権限・実行テストを行う。
- 対応バイナリをユーザー配下の**安定した参照先**に設置し、Host更新の瞬間にも既存管理セッションを破壊しない。
- package内のファイルはNode.js/Hostサービスから絶対パスで参照。Pi拡張機能のアンインストール/更新後の残骸を診断可能にする。
- OSSライセンスを配布物に同梱する。将来配布するApp Store/Google Playアプリにabducoを埋め込む必要はなく、**PC用Extension packageに含める**。

### 9.3 管理コマンド（仮）

- `/mobile setup` — 初期診断・Host設定・ペアリング
- `/mobile pair` — 端末追加
- `/mobile status` — Host / Pi / abduco稼働状態
- `/mobile doctor` — 詳細診断、ソケット、権限、バージョン
- `/mobile disable` — リモート停止（Piは原則残す）
- `/mobile uninstall` — service / binaries / credentials清掃（Pi Session削除は別の明示操作）
- `pi-mobile list/attach` — Hostが管理するabduco InstanceのPC操作

コマンド名は他Extensionとの競合回避を含めて最終決定する。`pi remove`がOSサービスを自動で削除するとは限らないので、**サービス残存を検出できる**仕組みを必須とする。

---

## 10. ネットワークとセキュリティ

- **MVP通信：** 同一LANまたはユーザーが用意したTailscaleなどのプライベートネットワーク。WSS/端末認証を構成。Relayは別フェーズ。
- **ホストの公開：** 初期はローカル/プライベートバインドを優先。0.0.0.0公開を無断で行わない。
- **ペアリング：** PCで明示承認、短寿命QR/ワンタイムコード、デバイス単位の秘密鍵またはトークン、失効機能。
- **Hostコマンド制限：** 新規起動できる実行ファイルは検証済みPiに限定。コマンドをshellに渡さずexecFile/spawnのargvで実行。
- **workdir：** allowlist配下のcanonical pathのみ許可。`..`・symlink escape・競合変更を検証。必要に応じてGit Worktreeで変更を隔離。
- **abduco UDS：** 同じUnixユーザーでのみ利用。ソケット権限/親ディレクトリ0700を確認。**abduco `-r`は誤入力防止でありセキュリティ境界ではない**。
- **セッション競合：** 1つのPi Session JSONLを複数Piから書き込まない。Host管理外Piの検出限界を文書化。
- **送信保護：** instanceId + expectedSessionId/Epoch + requestIdで誤送信・重複を抑制。送信結果不明なら勝手に再投入しない。
- **権限・入力待ち：** 不明な確認要求を自動承認しない。スマホで未対応ならPCのAttachを案内。
- **機密：** OAuth/APIキー、ローカルファイル本文、会話本文を平文ログや遠隔Relayへ不要に送らない。
- **中継：** 将来のRelayでE2EEを標榜するなら、本当に内容を中継者が復号できない設計・検証を行う。
- **Host停止時：** サービスを止めてもPiプロセスが残る場合があるため、ユーザーに可視化。終了の意思がないのに一括killしない。

---

## 11. 失敗時の挙動・復旧

| 異常 | 期待する動作 |
|---|---|
| abduco同梱バイナリが実行不能 | 新規作成を無効化。原因と診断/導入案内。既存PC Pi操作は継続 |
| abduco session名重複 | 新規IDを生成し、既存sessionを上書きしない |
| socketファイルだけ残存 | PID/Extension registration/abduco実体を照合。勝手にPiとして再接続しない |
| Hostだけ再起動 | 生存中abduco Sessionを再発見、Extensionが再登録。PoCで保証範囲確認 |
| Piが自主終了 | status=exited。履歴は残し、セッション復帰導線を提示 |
| PCでAttach/Detach | Pi Instance IDとPi Session履歴を維持 |
| PC TUI再描画が崩れる | 再描画/サイズ変更を検討。別Piとして起動し直して回避しない |
| 未表示TUIのconfirm待ち | PCでAttachする案内。無断の自動承認を禁止 |
| Pi `/resume` | 新Pi Sessionへ追従。古いEpochのコマンド拒否 |
| Extensionのreload | 接続世代を更新。Pi Instance同一性を確認して再登録 |
| Mobile断線 | Piは継続。復帰時にSnapshotで整合 |
| Host起動の途中でタイムアウト | creating→unknown/failed。誤って同じSessionを再起動しない |
| 2つのPiが同一workdirで編集 | UI警告/Worktree推奨。ファイル競合を自動的に解決しない |
| Service StopでPiまで終了 | **PoC不合格候補**。OSによる制約を報告し、改修か設計変更をADRで判断 |
| Pi/Host/abducoバージョン不一致 | 接続を拒否または機能制限し、復旧案内 |

---

## 12. Phase 0 — Codex実験計画（Go/No-Go PoC）

### 12.1 原則

- PoC対象はまず**PC側だけ**でよい。最初からReact Nativeの製品UIを作らない。
- Pi/abduco/Node/OSを実測してログ化する。ドキュメントで保証されていない挙動は推測で埋めない。
- 技術上の不確実性が高い順に検証し、**開発ホストでのP0 Gateを通過してから製品実装へ進む**。他OS/CPU向けの配布・サービス試験は未検証として記録し、正式サポート開始前のGateとする。
- ユーザーが望まない管理者権限付与や勝手なOSサービス登録を行わない。
- Piのバージョン差やAPI機能差はテスト表に記録し、API使用方法をピン留めする。

### Gate A — abduco単体PTY実験（P0）

**目的：** tmuxなしで通常Piを非Attach起動し、後から同じTUIに接続できることを確認。

1. `abduco -v`、`pi --version`、OS/arch/TERMを記録。
2. `abduco -n <unique-name> pi` を対象workspaceのcwdから実行。
3. 実行中Piプロセスとabduco sessionの存在を確認。
4. `abduco -a <unique-name>`で対話TUIが正しく表示されるか検証。
5. `Ctrl+\`でDetachし、Piが終了していないことを確認。
6. 画面サイズ変更、再Attach、スクロール、複数端末Attach、`SIGWINCH`、TUI再描画を検証。
7. Attachしていない状態でもPi Extensionからメッセージ受信→応答・ツール実行できることを確認。
8. 各PiのプロセスPID、Session ID、ログの一貫性を確認。

**合格条件：** Piが同一PID/会話のままAttach→Detach→再Attach可能。TUIの致命的な表示不具合や機能停止がない。Detach中の拡張機能によるPrompt実行が成功する。

### Gate B — 複数PiとPC既存Piの共存（P0）

1. `abduco -n`で**2個以上**のPiを並列起動。
2. 別のPCターミナルで通常の `pi` を1個起動。
3. すべてのPiに共通Remote Extensionが読み込まれていることを確認。
4. HostにInstance IDで3つが登録され、識別が混ざらないことを確認。
5. 各Piへメッセージ送信・Tool Useを実行して独立性を確認。
6. 特定abduco Sessionを終了しても他のPiに影響がないことを確認。

**合格条件：** 3 Instanceが独立して動作し、共通APIで操作できる。スマホ発PiからのイベントとPC起動Piからのイベントが混ざらない。

### Gate C — Host/OSサービスの生存性（P0・最大の不確実性）

まず**Codexを実行する開発ホストのOSで必須検証**する。macOS/Linuxの他方は対応環境が利用可能になり次第追加実測し、両OSでの正式サポートを謳う前に完了する。未実施をPASS扱いにしない。

| シナリオ | 記録すべき結果 |
|---|---|
| Hostプロセスを強制終了 | abduco Session/Piが生存するか |
| Hostプロセスを通常終了 | 同上 |
| Hostサービスをstop/restart | 同上。systemd cgroup、launchdの差を検証 |
| Host Serviceのバイナリを更新 | Piを中断せずHostを復旧できるか |
| ターミナル/SSHを閉じる | Piが生存するか |
| macOSユーザーログアウト | Piが生存するか（条件と制限を記録） |
| Linux user service/logout/linger | Piが生存するか（設定と残留プロセスリスクを記録） |
| ソケットの消失/残存 | 正常に復旧/異常を検出できるか |

**合格条件：** 少なくとも「Hostアプリクラッシュ → Pi存続 → Host復旧で再発見」が再現でき、製品の許容範囲でサービス再起動時の挙動を明確化できる。サービス再起動時にPiを維持できない場合は、そのまま隠さず**Gate C未達として代替案のADR**を作る。

### Gate D — Pi Extension操作・セッション切替（P0）

1. 通常TUIからのイベント：`message_update`、tool、model、agent完了、session切替。
2. Extension経由のPrompt送信、Abort、Steer、FollowUp、Snapshot。
3. PCの `/new` `/resume` `/fork` とExtension再初期化でInstance同一性を保持。
4. 旧Session宛のrequestは新Sessionへ適用しない。
5. 受信途中のプロトコル切断→Snapshot復元。
6. 選択/確認等の`ctx.ui`依存コマンドを、通常TUIの外部Extensionからどう扱えるか制約を記録。

**合格条件：** 同じPiプロセスへの双方向通信が成立し、主要なセッション切替で誤送信・二重送信を起こさない。

### Gate E — 同梱配布（P0）

1. upstream abducoソースのリビジョン/ライセンスを記録。
2. **Phase 0必須：開発ホスト向け**に同梱binの起動・再起動・ライセンス配置を検証。
3. **GAまでの必須条件：** CIでmacOS arm64/x64、Linux x64/arm64のバイナリをビルド/収集し、対象4ターゲットでclean install後の`abduco -v`、`-n`、`-a`を検証。
4. 実行権限、macOS security、libc、依存ライブラリ、署名/隔離、既存バイナリ更新をテスト。
5. **同梱binのパス解決がPiパッケージ更新後も破綻しない**ことを確認。

**Phase 0合格条件：** 現在の開発ホストで同梱方式が動き、他3ターゲット向けの配布設計・検証計画が具体化している。**GA合格条件：** 対象4ターゲットで合理的な導入パスが成立する。未検証ターゲットは「サポート」宣言をしない。

### Gate F — UX最低条件（P0）

- PoCクライアント（CLIまたは簡易Web）からPi一覧・新規作成・Prompt送信・Snapshot・停止が行える。
- PCからAttachしたPiの同じ内容がPoCクライアントにも同期される。
- セッション名/Instance IDが安定し、操作対象が誤らない。

### 12.2 Codexが提出すべきPoC成果物

```text
poc/
├── README.md                 # 再現方法・環境・準備/片付け
├── results.md                # Gate A〜FのPass/Fail/Not tested
├── diagnostics/              # 機密を除いた実測ログ
├── extension/                # 最小Extensionイベント送受信
├── host/                     # 簡易Host/abducoランチャー
├── attach/                   # 最小PC attach helper
└── adr/
    ├── 0001-abduco-selection.md
    └── 0002-host-lifecycle.md
```

`results.md`には **環境、コマンド、観測事実、失敗条件、再現手順、Go/No-Go、残課題、推奨変更**を含むこと。ソースコードだけの提出はPoC完了扱いにしない。

---

## 13. 実装計画（PoC後）

### Phase 1 — PC側MVP

- TypeScript Host Service（Instance registry/IPC/WebSocket/認証最低限）
- Remote Control Extension（Piイベント転送、基本コマンド、Snapshot）
- abduco launcher + Hostからの独立Pi起動/停止・再接続
- PC attach helper `pi-mobile attach`（実装可能な配布導線を採用）
- macOS/Linux開発モード起動、操作ログ、診断CLI
- プロトコルVersioningと最低限の自動テスト

### Phase 2 — React NativeアプリMVP

- Hosts/Instances/Chat/Composer
- Pi一覧、スマホ発Pi作成、Prompt、Abort、Tool cards、モデル/Thinking（対応APIのみ）
- Session切替追従、断線復帰、Pi状態表示
- スマホ→PC Attachのガイド、失敗時の復旧UX

### Phase 3 — 標準Piのネイティブ操作

- Pi標準コマンド機能表に沿ったNew/Resume/Fork/Tree/Compact/設定等
- 標準Extension UI確認の実行可能範囲を拡大
- 履歴、Diff、ファイル参照、Git Worktree支援
- 複数Host/並行作業、サブエージェントやTool Useの高度な表示

### Phase 4 — 配布品質

- OS別abduco同梱CI、OSS表記、署名・配布試験
- launchd/systemdセットアップ、サービス管理、バイナリと設定更新
- セキュリティレビュー、デバイス失効、診断とuninstall
- 必要に応じRelay/E2EEを別仕様として導入

### MVPのDone条件

1. PC通常Piとabduco管理Piを**同じExtension通信API**で操作できる。
2. スマホから独立Piを2個以上同時起動できる（RPC/tmuxは使用しない）。
3. 同じスマホ発PiへPC TerminalでAttachし、その後Detachしてスマホ操作を続けられる。
4. PCのPi Session切替にスマホが追従し、stale requestを拒否する。
5. スマホ・Host接続断後もPiの許容された生存条件で処理を継続し、再発見・Snapshot復旧できる。
6. Pi標準Skills/Extensions/モデル認証をPC上で使い、ユーザーの設定を勝手に上書きしない。
7. Hostから任意シェルを実行できず、端末認証と許可workspace制限が機能する。
8. unsupported abduco環境とExtension独自TUI制約がUI上で説明できる。

---

## 14. 主要な未決定事項・リスク

| 優先 | 問題 | 判断ルール |
|---|---|---|
| P0 | **非Attachで通常Pi TUIが完全動作するか** | Gate Aの実測で判断。無理なら設計再検討 |
| P0 | **Host/systemd/launchdのStopでabducoを巻き込まないか** | Gate Cで条件を固定。未達なら「生存性保証」を縮退または方式変更 |
| P0 | **abducoの同梱・4ターゲット配布** | Gate Eで検証。完全自動前提の誇張をしない |
| P0 | **Session切替時にExtensionが再生成される問題** | セッション切替テスト。世代と再登録で制御 |
| P0 | **TUI拡張機能の外部UI呼出し制限** | 初期でCompatibility matrixを作り、不可を明記 |
| P1 | **同一Pi Sessionへの二重書き込み** | Host管理下では排他。管理外は制約表示 |
| P1 | **Socketの長さ/権限/衝突/復旧** | OS別PoCでセッション命名規約を決定 |
| P1 | **Pi Extension packageからCLI/Hostへの安定参照** | update/remove/pin機能を考慮しsetup設計を決定 |
| P1 | **複数クライアントAttach時のサイズと入力競合** | abduco優先順位・read-only指定の挙動を検証 |
| P1 | **Host停止後も残るプロセスを誰が清掃するか** | uninstallで明示的選択と確認が必要 |
| P2 | **Relay標準/セルフホストの扱い** | 安全なMVP確立後に別ADR |
| P2 | **アプリ名/パッケージ名/販売形態** | コード上は仮名・環境変数で切替可能にする |

---

## 15. Codexへの実行指示（コピペ利用可）

```text
添付の「pi_native_mobile_spec_v1_1_abduco.md」を唯一の最新設計ベースラインとして読んでください。
旧v1.0のtmux前提は破棄し、abducoを本線とします。

最初のタスクは製品実装ではなく、§12 Phase 0 Go/No-Go PoCです。
具体的には以下の順に取り組んでください。
  (1) 使用中OS/CPU/abduco/PiのバージョンとAPIを確認
  (2) abduco -nで通常Piを非Attach起動し、abduco -aで同一Pi TUIへAttach/Detach
  (3) Pi Remote Extensionを通じて非Attach時にもPromptとイベントを送受信
  (4) 2つ以上のabduco Piと通常PC Piの同時管理
  (5) Host停止/再起動/サービス停止とabducoの生存性、再発見
  (6) macOS/Linuxバイナリ同梱の方法と動作条件
  (7) 検証結果、ログ、リスク、未達点をpoc/results.mdに記載

未検証の箇所を「対応済み」と書かないでください。
Pi本体をforkしない、Pi RPC/SDK/tmuxへ黙って切り替えない、TTYへのキー入力でPromptを送らない、
セキュリティのため勝手な権限付与やサービス登録をしない、という制約を守ってください。

開発ホストでのP0 Gateで不合格が出たらそこで作業を止め、原因と代替設計のADRを提案してください。
開発ホストでの必須Gateが合格し、設計上の重大ブロッカーが解消されたら、
Phase 1以降の実装計画をPR/Issue単位に分解して報告してください。
```

---

## 16. 出典・確認先

- abduco upstream README：<https://github.com/martanne/abduco>
- abduco man page（`-n`、`-a`、socket、TERM、サイズ変更等）：<https://github.com/martanne/abduco/blob/master/abduco.1>
- abduco Homebrew formula（macOS/Linux提供状況の参考）：<https://formulae.brew.sh/formula/abduco>
- Pi公式 Packages：<https://pi.dev/docs/latest/packages>
- Pi公式 Extensions：<https://pi.dev/docs/latest/extensions>
- Pi公式 CLI：<https://pi.dev/docs/latest/cli>
- Pi公式 repository：<https://github.com/badlogic/pi-mono>
- 先行製品 — Remote Pi：<https://github.com/jacobaraujo7/remote_pi>
- 先行製品 — PI Dashboard：<https://github.com/BlackBeltTechnology/pi-agent-dashboard>
- 先行製品 — pi-super：<https://github.com/pasky/pi-super>
- 先行製品 — T3 Code：<https://github.com/pingdotgg/t3code>

**設計上の重要な但し書き：** 本仕様書は「abduco方式で実現する」という合意を反映するが、macOS/Linux各環境での生存性・TUI再描画・バイナリ同梱・Pi Extension API対応の実験完了を意味しない。Codexは必ずPoC結果に基づいてGo/No-Goを判定すること。