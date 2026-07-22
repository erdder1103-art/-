釜山旅行助手－共同記帳修正版

使用者畫面：
- 沒有管理者模式
- 沒有雲端同步按鈕
- 沒有 Email、登入、房間碼或 Supabase 設定
- 大家使用同一個網址
- 自己新增名字或刪除名字
- 密碼可設定，也可以留空
- 所有手機共用同一份記帳資料

Cloudflare Pages 部署一次：
1. 上傳本資料夾到 Cloudflare Pages。
2. 建立 D1 資料庫並執行 schema.sql。
3. Pages 設定中新增 D1 Binding，變數名稱必須為 DB。
4. 重新部署。
