# PiMate

Pi Coding Agentを、iOS/AndroidのネイティブUIから操作するためのプロジェクトです。

## プロダクト方針

**[docs/SPEC.md — 合意済みの要件と開発方針](docs/SPEC.md)**

仕様書は意図的に簡潔にしています。ユーザー体験と技術的な前提だけを定め、詳細設計・実装・テスト計画はCodex / Claude Codeなどのコーディングエージェントに任せます。

## 現在の段階

Linuxでの技術検証（PoC）を完了し、SPECの構成が成立することを確認しました。次はMVP（Android優先、React Native + Expo）です。

- 検証結果・制限・MVPへの推奨: [docs/poc-report.md](docs/poc-report.md)
- 検証コードと再現手順: [poc/README.md](poc/README.md)
- 未検証: macOS、arm64 Linux

以前の詳細仕様書はGit履歴から参照できますが、**現在の設計方針の正本は [docs/SPEC.md](docs/SPEC.md)** です。
