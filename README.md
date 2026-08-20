# TRPG LOG MARKER

Tekeyの全タブHTMLログを読み込み、秘密の共有URL上で本文へマーカーと感想を付けるCloudflare Pagesアプリです。

## 主な機能

- Tekey全タブHTMLの読み込み
- 白背景・黒文字／黒背景・白文字への表示統一
- タブ絞り込み・ログ内検索
- 全タブを横につないだ無限ページカルーセル（閲覧中の時刻を保って別タブへ移動）
- Tekeyの文字色を保持
- PL・PC・NPCごとのアイコン登録
- 本文選択の横に感想欄を表示し、欄外クリックで投稿
- 選択範囲へのマーカーとコメント
- 本文と右コメント欄の相互ジャンプ
- PL名と任意のPC・NPC発言者
- 3秒間隔でのコメント同期
- 推測困難な共有URL

## Cloudflare Pagesへの公開

### 1. GitHubへ入れる

このフォルダの中身を、新しいGitHubリポジトリへアップロードします。

### 2. Pagesプロジェクトを作る

Cloudflare Dashboardで `Workers & Pages` → `Create` → `Pages` → `Connect to Git` と進み、上のリポジトリを選びます。

- Framework preset: `None`
- Build command: 空欄
- Build output directory: `public`

### 3. D1データベースを作る

Dashboardで `Storage & Databases` → `D1 SQL database` → `Create`。
名前は `trpg-log-marker-db` などで構いません。

作成したデータベースのConsoleへ `schema.sql` の内容を貼り付けて実行します。

### 4. PagesとD1を接続する

Pagesプロジェクトの `Settings` → `Bindings` → `Add` → `D1 database`。

- Variable name: `DB`
- D1 database: 手順3で作ったもの

保存したら `Deployments` から再デプロイします。

## 注意

共有URLは十分長く推測困難ですが、URLを転送された相手も閲覧できます。ログ本文や感想はCloudflare D1へ保存されます。

## v0.4以前から更新する場合

D1のConsoleで `migration-v0.5.sql` の内容を一度だけ実行してから再デプロイしてください。
