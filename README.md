# PiMate

Pi Coding AgentをiOS/AndroidからネイティブUIで操作するためのプロジェクトです。

## プロジェクトの状態

現在は設計・技術検証（PoC）段階です。アプリやHostの実装が完成しているわけではありません。

- [アプリケーション仕様書 v1.1（abduco本線）](docs/pi_native_mobile_spec_v1_1_abduco.md)
- 最初の作業: 仕様書の **Phase 0 — Go/No-Go PoC** を実施
- 方針: 通常のPi TUI + 共通Remote Control Extension、Host Service、abducoによるPTY保持・再接続
- 対象: iOS/Android、macOS/Linux
- Pi RPC・SDKは通常の実行経路には採用しない

> 仕様書内の「要検証」事項は未検証です。特にabducoの同梱配布・Pi TUIの再接続・Host再起動時の生存性はPoCで確認します。
