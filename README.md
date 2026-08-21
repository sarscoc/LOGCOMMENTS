# TRPG LOG MARKER

Tekeyの全タブHTMLログを読み込み、秘密の共有URL上で本文へマーカーと感想を付けるCloudflare Pagesアプリです。

## 主な機能

- Tekey全タブHTMLの読み込み
- Tekey元HTMLのタブ一覧順をそのまま保持
- 白背景・黒文字／黒背景・白文字への表示統一
- タブ絞り込み・ログ内検索
- 全タブを横につないだ無限ページカルーセル（閲覧中の時刻を保って別タブへ移動）
- カルーセルは現在・前・次の3ページだけを生成し、移動先を直前に遅延読込
- 左右の矢印キーで、端から端へ途切れず循環移動
- 共有時間軸モード（タブを別ページのまま同じ時刻の高さへ配置）と詰めたモード
- 現在地が分かるクリック可能な全タブ一覧
- 半透明のガラス調UIと右端の薄い時刻表示
- 秘密URLを現在開いている人をPL名・アイコンで表示
- コメントを書いているPLを「入力中…」で表示
- Durable Objects＋WebSocketで、入退室・入力中・投稿・編集・削除・♡をイベント発生時だけ即時通知
- WebSocket切断時は自動再接続し、再接続時に取りこぼしたコメントを復旧
- リアルタイム機能が未接続の間だけ、60秒間隔の軽量な保険確認へ自動切替
- コメントのPL名と同じ行の右端に投稿日時を表示
- コメント日時の前に対象タブ名を表示
- PL・PC・NPCごとのマーカー色とコメント端のカラーライン
- コメント欄は発言者と本文だけの最小表示（欄外クリックで投稿）
- 不足しているD1列と入室者テーブルを自動補完
- コメント一覧をマーカー対象のログ時系列順に表示
- 任意のメインタブを設定し、戻った時だけ同時刻付近の別タブ発言を半透明表示
- 共有時間軸で画面内の空白位置にある別タブ発言を優先表示
- メインタブの各空白時間へ、別タブ名つきの描写を直接表示
- マーカー色変更を同じ発言者の過去マーカーへ一括反映
- 入室中PLを最上部ブランド横へ表示
- PL設定は全ページ共通、PC・NPCは部屋URLごとに保存
- 部屋ごとに最後に使った発言者を記憶
- コメントへの返信と入れ子表示
- 別タブ描写は移動リンクにせず、タブ名と内容の案内だけを表示
- タブ名クリック時にカルーセルを再構築せず直接移動
- コメント一覧のログ時系列位置へ、選択中キャラの入力中表示
- ログ本文をCloudflare R2へ保存し、D1には部屋情報・コメント・♡などだけを保存
- 旧版でD1に保存されたログは、最初に開いたとき安全にR2へ自動移行
- Tekeyの文字色を保持
- PL・PC・NPCごとのアイコン登録
- 同じ発言者アイコンはR2へ1画像だけ保存し、各コメントは参照だけを保持
- アイコン画像を切らずに丸枠内へ全体表示
- 発言者名から複数のPL・PC発言をまたいで選択可能
- 本文選択の横に背景を暗くしない最小の感想欄を表示し、欄外クリックで投稿
- 選択範囲へのマーカーとコメント
- 本文と右コメント欄の相互ジャンプ
- PL名と任意のPC・NPC発言者
- 接続中の定期的なコメント確認・入室確認を廃止
- 別タブ候補は画面内に見えている時刻行だけ遅延生成
- 推測困難な共有URL
- 通常利用者はクラウド上に1人1部屋まで作成可能
- 部屋は最終更新から7日で期限切れになり、自動削除
- 部屋を、閲覧用HTMLと再読込用データをまとめたZIPとして保存
- 削除前に「保存して削除／削除だけ／キャンセル」を選択可能

## 保存・リアルタイムの役割分担

このアプリは、保存とリアルタイム通知を分離しています。

- **D1**: 部屋情報、コメント、返信、♡などの確実に残すデータ
- **R2**: ログ本文と、重複排除した発言者アイコン
- **Durable Object**: その部屋を今開いている人、入力中状態、更新通知だけを担当
- **WebSocket**: 開いているブラウザへイベントを即時配信

Durable Objectにはコメント本文やログ本文を保存しません。リアルタイム通知が一時的に切れてもD1/R2側の保存データは失われず、再接続後に取りこぼした更新を取得します。

### なぜ定期ポーリングより軽いのか

以前の3秒・20秒ごとの定期確認は廃止し、通常時はWebSocketを1本だけ接続します。

- 接続時にWebSocket Upgradeが発生
- 入室・入力中・コメント投稿・編集・削除・♡など、何か起きた時だけ通信
- サーバーから接続中クライアントへのWebSocket送信はDurable Objectsのリクエスト課金対象外
- Durable Objectsへ入るWebSocketメッセージは、リクエスト課金上20メッセージ＝1リクエスト相当で計算
- Hibernation APIを使っているため、アイドル状態でhibernate可能な時間はDurable ObjectのDuration課金対象外
- 何も操作されていない間に3秒ごとの確認を繰り返さない

Cloudflare Workers Free planのDurable Objectsはリクエストが1日100,000までです。WebSocketの初回接続は1リクエストとして数えられ、受信WebSocketメッセージには20:1の課金比率が適用されます。なお、このアプリではD1保存成功後にPagesからDurable Objectへ更新通知を送る処理もあるため、コメント等の各更新がすべて20:1になるわけではありません。それでも、常時ポーリングする方式より通信回数を大幅に抑えられます。

Cloudflare公式: https://developers.cloudflare.com/durable-objects/platform/pricing/

## 部屋数と7日自動削除

通常利用者は、クラウド上に**有効な部屋を1部屋だけ**持てます。サイト所有者は `SITE_OWNER_KEY` によりこの部屋数制限を回避できます。

部屋は `last_activity_at` を基準に、**最後の内容更新から7日**で期限切れになります。コメント投稿・返信・編集・削除・♡・色変更が成功すると最終更新日時が延長されます。部屋を開いただけの閲覧、入退室、入力中表示では期限は延長しません。期限切れになった部屋はAPI上ですぐ利用不可になり、Realtime WorkerのCronが1時間ごとに期限切れ部屋を掃除します。削除対象はR2の部屋ログ、D1のコメント、♡、presence、旧ログチャンク、部屋情報です。重複排除されたアイコン本体は複数部屋から参照される可能性があるため、部屋削除時には直接削除しません。

### 既存部屋を持っている場合

既存の複数部屋を突然削除することはしません。既存部屋の `last_activity_at` は、保存済みの最新コメントまたは♡の日時を優先し、それらがなければ作成日時を初期値として引き継ぎます。その最終更新日時から7日までは利用でき、その後に期限切れになります。ただし、通常利用者は有効な既存部屋が1つでも残っている間、新しい部屋を追加作成できません。

保存したい部屋は、期限前に「部屋を保存」からZIPを作成してください。保存ZIPはクラウドの部屋数やD1/R2容量を消費せず、オフラインで閲覧できます。

## Cloudflare Pagesへの公開

### Twitterカード画像

好きな1200×630pxのPNG画像を `public/twitter-card.png` という名前で追加すると、Twitter/Xなどの共有カードへ使用されます。画像を差し替える場合も、同じファイル名で上書きします。

### 1. GitHubへ入れる

このフォルダの中身をGitHubリポジトリへアップロードします。

### 2. Pagesプロジェクトを作る

Cloudflare Dashboardで `Workers & Pages` → `Create` → `Pages` → `Connect to Git` と進み、リポジトリを選びます。

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

### 5. R2ログストレージを作って接続する

Dashboardで `Storage & Databases` → `R2 Object Storage` → `Create bucket` と進み、`trpg-log-marker-logs` などの名前でバケットを作成します。

Pagesプロジェクトの `Settings` → `Bindings` → `Add` → `R2 bucket`。

- Variable name: `LOGS`
- R2 bucket: 作成したバケット

必ず `LOGS` という大文字のBinding名にしてください。接続後、`Deployments` から再デプロイします。新しい部屋のログ本文は最初からR2へ保存され、既存のD1内ログは部屋を開いたときにR2へ順次移行します。

### 6. リアルタイムWorkerを作る

同じGitHubリポジトリ内の `realtime-worker` が、Durable Objects＋WebSocket専用のWorkerです。

Cloudflare Dashboardの `Workers & Pages` → `Create` からGitHubリポジトリ `sarscoc/LOGCOMMENTS` をもう一度選択し、Workerとして接続します。

- Worker name: `trpg-log-marker-realtime`
- Root directory: `realtime-worker`
- Deploy command: `npx wrangler deploy`

`realtime-worker/wrangler.jsonc` がDurable Object namespaceと1時間ごとのCron Triggerを作成します。Pagesプロジェクトとは別のWorkerとしてデプロイしてください。

### 7. PagesとDurable Objectを接続する

Pagesプロジェクト `logcomments` の `Settings` → `Bindings` → `Add` → `Durable Object`。

- Variable name: `ROOMS`
- Durable Object namespace: `trpg-log-marker-realtime` の `RoomHub`

必ず `ROOMS` という大文字のBinding名にしてください。Productionへ追加したあと、Pagesを再デプロイします。Realtime接続用URLや共有シークレットは不要です。

接続に成功すると、通常時の定期通信は止まり、入退室・入力中・コメント・編集・削除・♡・返信が起きた時だけ通信します。Bindingが未設定または一時切断中でも、コメント機能そのものは止まらず、60秒間隔の保険確認へ切り替わります。

### 8. 7日自動削除用Secretを設定する

期限切れ部屋の削除APIは外部から勝手に実行できないよう、PagesとRealtime Workerの両方へ同じSecretを設定します。

Pagesプロジェクトの `Settings` → `Variables and Secrets` でSecretを追加します。

- Variable name: `CLEANUP_SECRET`
- Value: 十分長いランダム文字列

次に `trpg-log-marker-realtime` Workerの `Settings` → `Variables and Secrets` にも、**同じ値**で追加します。

- Variable name: `CLEANUP_SECRET`
- Value: Pages側と同じ文字列

SecretはGitHubへ書かないでください。設定後、PagesとRealtime Workerを再デプロイします。`realtime-worker/wrangler.jsonc` のCronが毎時17分に削除APIを呼びます。

### 9. サイト所有者だけ部屋数を無制限にする

Pagesプロジェクトの `Settings` → `Variables and Secrets` で、暗号化したSecretを追加します。

- Variable name: `SITE_OWNER_KEY`
- Value: 自分だけが知っている十分長いランダム文字列

再デプロイ後、自分のブラウザで一度だけ `https://サイトURL/?owner=設定した文字列` を開きます。キーはブラウザへ保存され、URL欄から自動的に消えます。このURLやキーは他人へ共有しないでください。

## 部屋の保存と復元

- 部屋内の「部屋を保存」でZIPをダウンロードできます。
- ZIP内の `index.html` はアプリ本体・デザイン・部屋データ・アイコンを内包し、Cloudflareへ接続せず同じ閲覧機能で読めます。
- 保存時のライト／ダークテーマを保存版の初期表示へ引き継ぎます。
- コメント画像は保存時に取得できたものをHTML内へ埋め込みます。画像配信元が外部取得を禁止している場合は、元URLをリンクとして残します。
- ZIP内の `room.trpglog` は、トップページの「保存した部屋を開く」から同じ画面へ読み込めます。
- 保存版は読み取り専用で、クラウドの部屋数やD1容量を消費しません。

## 注意

共有URLは十分長く推測困難ですが、URLを転送された相手も閲覧できます。ログ本文と重複排除した発言者アイコンはCloudflare R2へ、部屋情報・感想本文・♡などはD1へ保存されます。Durable Objectはリアルタイム通知だけを担当し、コメント本文は保存しません。1部屋制限はアカウント認証ではなく、このブラウザ内の利用者IDを基準にする簡易的な制限です。

## 以前の版から更新する場合

不足している列やテーブルはアプリが自動補完します。新しいファイルをGitHubへ反映し、Cloudflareの再デプロイ完了後にサイトを再読み込みしてください。既存部屋は即時削除せず、保存済みの最新コメントまたは♡の日時（なければ作成日時）を最終更新として引き継ぎ、その日時から7日後に期限切れになります。