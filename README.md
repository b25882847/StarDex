# 星圖鑑 StarDex｜楓星全功能圖鑑

StarDex v5.0.0 Public Beta 是只針對「楓星 MapleStar」的繁體中文玩家資料庫。專案是純 HTML、CSS、JavaScript PWA，不需後端或付費服務；原始碼可直接用 VS Code Live Server 執行，正式部署則由 GitHub Actions 產生白名單 `dist`。

> 非官方玩家工具，與 Nexon、MapleStar 營運方無關。未取得可信來源的數值保持空白或標示「待驗證」，不得把 Artale、楓之谷正式服或其他版本資料當成楓星資料。

## Public Beta 內容

- 全站搜尋與關聯圖鑑：怪物、物品、地圖、NPC、職業、技能、任務、BOSS、攻略皆使用穩定 ID。
- 雙向查詢：怪物可查掉落物；物品可反查怪物、BOSS 與任務；地圖會合併怪物與 NPC 的雙向關聯。
- 欄位級驗證：關鍵欄位與個別關聯分別保存官方／玩家／待驗證狀態、來源、證據與日期。
- 玩家證據：從詳情指定欄位，附遊戲截圖、網址、觀察日期與代稱；預覽確認後才進入本機待審核區。
- 回報交換：可匯出獨立玩家回報 JSON；管理者匯入時一律重設為待審核，通過人工審核才更新欄位，衝突證據不會被覆蓋。
- JSON／CSV 管理：匯入前預覽並檢查 schema、欄位型別、重複 ID、外鍵、來源與測試資料標記。
- 收藏、價格與自建資料：以 localStorage 保存；schema v1～v3 可遷移，v4 儲存鍵在 v5 應用更新後保持不變。
- PWA：Android Chrome 可在瀏覽器提供時安裝；iPhone／iPad Safari 可用「分享 → 加入主畫面」。第一次在線快取後可離線開啟內建圖鑑。
- 更新保護：新 Service Worker 等待使用者確認才接管；更新公開程式快取，不刪除收藏、價格、證據或自建資料。

目前內建資料仍為 109 筆：怪物 6、物品 19、地圖 12、NPC 4、職業 15、技能 8、任務 22、BOSS 14、攻略 9；另有 14 筆來源。資料集版本 `2026.10.11.3`，本階段沒有為了增加數量而加入未查證內容。

## 本機使用

1. 在 VS Code 開啟專案資料夾。
2. 在 `index.html` 按右鍵，選擇 **Open with Live Server**。
3. 開啟類似 `http://127.0.0.1:5500/index.html` 的網址。

也可用任何靜態伺服器；不要直接使用 `file://`，因為瀏覽器會阻擋 JavaScript 模組與 JSON 載入。

```powershell
npx serve .
```

Live Server、GitHub Pages、不同網域或瀏覽器的 localStorage 不會自動同步。移動前請在「我的」匯出完整備份，到新網址後再匯入。

## GitHub Pages 部署準備

`.github/workflows/deploy.yml` 會在 `master` 或 `main` push 後：

1. 執行單元測試與 JavaScript 語法檢查。
2. 用明確白名單建立 `dist`，不包含測試、README、備份、私有截圖或本機檔案。
3. 掃描常見憑證格式、禁止的檔名、種子資料中的價格／證據／截圖與 `/StarDex/` 子路徑。
4. 驗證通過才上傳 Pages artifact 並部署。

此本機 repository 尚未設定 remote，專案也不會自行建立公開儲存庫。要上線時由儲存庫擁有者：

1. 在 GitHub 建立或選擇儲存庫並加入 remote。
2. 確認欲公開的歷史與檔案後，以一般 push 推送 `master` 或 `main`（不要 force push）。
3. 到 **Settings → Pages → Build and deployment → Source** 選擇 **GitHub Actions**。
4. 查看 Actions 的 Test and deploy workflow；成功後再以該 run 的 Pages URL 驗收。

所有網站資源使用相對 URL，manifest 與 Service Worker scope 也依所在目錄計算，因此同時支援根網址與 `/StarDex/` 類型的 repository 子路徑。

## 備份、玩家回報與審核

在「我的」→「資料工具」：

- **匯出完整備份**：含 schema v4 資料庫、欄位驗證、玩家證據、價格與收藏。
- **匯出玩家回報 JSON**：只含玩家證據、相關來源與目標索引，不含收藏與價格。
- **匯入備份／玩家回報／CSV**：先顯示驗證結果與差異預覽；有錯誤時不寫入 localStorage。
- 玩家回報的既有「已採用」狀態不受信任，匯入時會改回「待審核」。管理者必須檢視原始證據後，再按「採用證據」。
- 目前沒有共用後端；按下本機回報不會傳送給任何人。玩家需下載 JSON 並透過管理者另行公布的管道傳遞。

## 資料與安全界線

- 公開種子：`data/maplestar.seed.json`，schema v4。
- 本機資料：`stardex.database.v4` 與 `stardex.favorites.v4`；v5 不更名、不清除。
- 輸出不可信文字前會 HTML escaping；網址只接受 HTTP／HTTPS；圖片只接受 PNG／JPEG／WebP data URL 並限制大小。
- `dist` 是唯一部署目錄；`.gitignore` 另排除環境檔、金鑰、備份、私人資料與截圖目錄。
- Service Worker 只攔截同 origin 且位於自身 scope 下的 GET 請求，不處理或清除 localStorage。

## 測試

需要 Node.js 18 以上：

```powershell
npm test
npm run check:syntax
npm run build
npm run validate:public
```

一次執行完整靜態檢查：

```powershell
npm run check
```

測試涵蓋 v1～v4 本機資料保留、搜尋關聯所需穩定 ID、玩家證據審核與衝突、回報 JSON 權限降級、CSV／JSON 匯入、PWA manifest、Service Worker 更新策略、GitHub Pages 子路徑與部署白名單。

完整版本紀錄請見 `CHANGELOG.md`。
