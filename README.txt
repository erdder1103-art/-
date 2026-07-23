Railway 部署方式

1. 把這個資料夾內所有檔案上傳到一個 GitHub 儲存庫根目錄。
2. Railway 建立 New Project -> Deploy from GitHub Repo。
3. 選擇這個儲存庫。
4. 在 Railway 專案畫布對網站服務按右鍵，新增 Volume。
5. Volume Mount Path 設定為：/data
6. 到網站服務 Settings -> Networking -> Generate Domain。
7. 使用 Railway 產生的網址。所有手機都打開同一網址即可同步。

重要：沒有掛載 Volume 時，重新部署後資料可能消失。
