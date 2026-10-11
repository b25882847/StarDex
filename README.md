# 星圖鑑 StarDex（非官方楓星玩家資料站）

手機與電腦通用的 PWA 網頁 App 初版，不需 npm、不需資料庫即可執行。

## 現有功能

- 7 類資料：怪物、裝備道具、地圖、職業技能、任務、BOSS、練等攻略
- 全站關鍵字查詢、分類篩選、條目詳情、交叉關聯、收藏
- 自建／編輯／刪除條目，以及來源網址欄位
- 楓幣行情手動記錄、中位數整理、紀錄刪除
- JSON 備份與匯入合併
- iPhone「加入主畫面」與離線載入（需先部署在 HTTPS 網站）
- 23 筆以官方公告為基礎的示範條目（**不是完整遊戲資料庫**）

## 如何在本機啟動

### Windows（你已安裝 Node.js）

在此資料夾使用終端機：

```powershell
npx serve .
```

瀏覽器打開終端機顯示的網址。也可以直接用瀏覽器開啟 `index.html`，但離線 PWA 安裝需要 HTTPS 站點。

### 免費部署 GitHub Pages

1. 建立 GitHub Repository，例如 `stardex`。
2. 把本資料夾內所有檔案上傳到 Repository 根目錄。
3. 在 GitHub Repository 的 `Settings` → `Pages`，設 `Deploy from a branch` → `main` → `/ (root)`。
4. 發布完成後在 iPhone Safari 開啟 `https://<你的帳號>.github.io/stardex/`。
5. 點 Safari 分享圖示 →「加入主畫面」。

**注意**：本機資料只儲存在同一瀏覽器的 `localStorage`。不同裝置之間不會自動同步；請定期用「我的 → 匯出完整備份」。

## 資料準確性

目前僅收錄有官方公告支撐的內容。不知道的怪物等級、掉落率、完整裝備能力、物價不會虛構。若要變成真正完整的「全部都有」圖鑑，需要額外建立資料蒐集、標準化、玩家驗證、版本更新機制。

原始參考來源：
- https://www.tw.maplestar.io/news/notices/announcements/459f794f-f2a8-4d68-ad22-463c5570d341
- https://tw.maplestar.io/news/updates/50ff2803-41c4-4d21-a2b9-ac080b1d117f
- https://tw.maplestar.io/news/updates/9f13e677-3c09-4ea4-9ee9-4cd8d6d183a3
- https://ww.tw.maplestar.io/news/updates/1f11fb92-f058-47bc-8158-21dd8305f14a

StarDex 是非官方玩家工具，與 Nexon、MapleStar 營運方無關。不自動讀取玩家遊戲帳號、不使用遊戲封包或外掛。遊戲名稱、商標與內容屬權利人。
