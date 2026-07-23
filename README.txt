Busan Trip Wallet V8.4

部署：將整個資料夾內容覆蓋至 GitHub 儲存庫，Railway 重新部署。
必要環境變數：DATABASE_URL、ADMIN_PIN（預設 0723）

V8.4 修復：
- 移除不完整的「附近熱門景點與美食」
- 保留中文操作、韓文轉換的智慧目的地搜尋
- 文件存放站完整接上 PostgreSQL API
- 每位成員獨立文件空間，可用成員 PIN 或管理 PIN 解鎖
- 支援 JPG、PNG、WEBP、GIF、PDF，單檔 15MB
- 捷運地圖改為獨立 PNG，不再使用損壞的 Base64
- 四分頁：記帳、文件、天氣、交通

注意：文件目前存入 PostgreSQL BYTEA，適合旅行憑證與少量備份；大量照片建議之後改用 R2。


V8.4：新增每位成員獨立的行前行李清單，可勾選、新增、刪除、重設與顯示完成進度。
