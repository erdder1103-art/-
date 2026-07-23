Busan Trip Wallet V8 - Railway PostgreSQL 版
============================================

這一版不使用 Volume，也不使用 state.json。
所有成員、PIN、匯率與記帳資料都存在 Railway PostgreSQL。
更新 GitHub 或重新部署 Railway，不會清除資料。

部署方式
--------
1. 將本資料夾內所有檔案上傳到 GitHub 儲存庫最外層：
   - server.js
   - package.json
   - public/index.html
   - .gitignore

2. Railway 專案右上角按：
   + Add -> Database -> PostgreSQL

3. PostgreSQL 建立完成後，將它與目前網站服務放在同一個 Environment。
   Railway 通常會自動把 DATABASE_URL 提供給網站服務。

4. 點網站服務 -> Variables，確認存在：
   DATABASE_URL=${{Postgres.DATABASE_URL}}

   PostgreSQL 服務名稱若不是 Postgres，請用介面提供的 Reference Variable 選擇它，
   不要手動複製公開網址。

5. 在網站服務 Variables 新增：
   ADMIN_PIN=0723

6. 重新部署。啟動紀錄應顯示：
   Busan Trip Wallet V8 running on port ...
   Persistent storage: Railway PostgreSQL

7. 開啟：
   https://你的網址/api/health

   正確結果包含：
   "ok": true
   "version": "8.0.0"
   "storage": "postgresql"
   "persistent_storage": true

重要提醒
--------
- 不用新增 Volume。
- 不要刪除 Railway PostgreSQL 服務，否則資料庫也會被刪除。
- ADMIN_PIN 可以在 Railway Variables 更換，不必修改 HTML。
- 首次啟動會自動建立資料表，不需要執行 SQL。
