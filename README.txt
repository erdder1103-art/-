Busan Trip Wallet V8.2

更新內容
1. 新增「旅遊文件」分頁。
2. 每位旅行成員使用獨立文件空間。
3. 支援成員 PIN 與管理 PIN 0723 解鎖。
4. 支援自訂資料夾、圖片、QR Code 截圖與 PDF。
5. 單檔上限 15MB；每位成員最多 200 個檔案、250MB。
6. 文件與資料夾儲存在 PostgreSQL，重新部署不會消失。
7. 附近推薦加入 GPS、半徑選擇與韓文多關鍵字 NAVER 搜尋。
8. GPS 座標會暫存；瀏覽器已保存定位權限時不會重複詢問。

部署方式
- 將整個專案上傳 GitHub，Railway 連接此儲存庫。
- 保留原本 DATABASE_URL。
- ADMIN_PIN 可自行設定；未設定時預設為 0723。
- Railway 重新部署時會自動建立文件資料表，不需要手動執行 SQL。

重要說明
- PostgreSQL 適合旅途中備用的少量機票、訂房、QR Code 與 PDF。
- 若未來要存放大量原始照片或影片，建議再升級 Cloudflare R2。
- 支援格式：JPG、PNG、WEBP、GIF、PDF。
