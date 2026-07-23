BUSAN TRIP WALLET V7 - Railway 完整部署版

功能：
1. 所有人使用同一個 Railway 網址，多手機同步。
2. 每位成員擁有自己的獨立帳本與個人總額。
3. 成員可設定 4-8 位 PIN；未解鎖時不顯示總額與明細。
4. 管理者 PIN 可進入任何已鎖定帳本。
5. 預設管理者 PIN：0723。
6. 記帳資料儲存在 Railway Volume 的 /data/state.json。
7. 網站重新部署後資料仍會保留。
8. 交通「最後一段怎麼走」固定顯示，不會因重新計算而消失。

部署步驟：
1. 將本資料夾內全部檔案上傳到 GitHub 儲存庫最外層。
2. Railway 建立專案，選 Deploy from GitHub Repo。
3. 在 Railway 服務新增 Volume，Mount Path 必須填：/data
4. Railway Variables 建議新增：ADMIN_PIN=0723
5. 到 Settings / Networking 產生公開 Domain。
6. 部署完成後開啟：https://你的網域/api/health

健康檢查必須看到：
- "ok": true
- "storage_path": "/data"

重要：
- 不要刪除 Railway Volume，否則資料會消失。
- 更新網站只需修改 public/index.html；Volume 內的記帳資料不會被覆蓋。
- 管理者 PIN 建議在 Railway Variables 修改，不要只依賴預設值。
