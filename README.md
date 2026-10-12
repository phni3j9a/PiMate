# PiMate

Pi Coding Agentを、iOS/AndroidのネイティブUIから操作するためのプロジェクトです。

## プロダクト方針

**[docs/SPEC.md — 合意済みの要件と開発方針](docs/SPEC.md)**

仕様書は意図的に簡潔にしています。ユーザー体験と技術的な前提だけを定め、詳細設計・実装・テスト計画はCodex / Claude Codeなどのコーディングエージェントに任せます。

## 現在の段階

技術検証（PoC）から着手します。abducoによる通常Pi TUIのバックグラウンド起動、同一TUIへの再接続、Remote Control Extensionからの操作、Hostとのライフサイクル分離、macOS/Linuxへの同梱配布の成立性を検証します。

PoCで根本的な問題が見つかった場合は、合意済みのアーキテクチャを独断で変更せず、検証結果と代替案を示します。

以前の詳細仕様書はGit履歴から参照できますが、**現在の設計方針の正本は [docs/SPEC.md](docs/SPEC.md)** です。
