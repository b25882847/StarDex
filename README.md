# 星圖鑑 StarDex｜楓星全功能圖鑑

StarDex 是只針對「楓星 MapleStar」的繁體中文玩家資料庫。它是純 HTML、CSS、JavaScript PWA，不需後端、帳號、npm build 或付費服務，可直接用 VS Code Live Server 執行。

> 非官方玩家工具，與 Nexon、MapleStar 營運方無關。未取得可信來源的數值會保持空白或標示「待驗證」，不會把 Artale、楓之谷正式服或其他版本資料當成楓星資料。

## 功能

- 全站搜尋：名稱、等級、分類、說明與關聯名稱皆可搜尋，另有類型、驗證狀態、等級範圍與排序。
- 關聯圖鑑：怪物、物品、地圖、NPC、職業、技能、任務、BOSS、攻略皆使用穩定 ID。
- 雙向查詢：怪物可查掉落物；物品會反向列出來源怪物；地圖會列出怪物與 NPC。
- 職業與攻略：轉職階段、武器、技能、前置技能、推薦配點、任務與攻略欄位。
- 楓幣行情：手動輸入物品 ID、伺服器、價格、時間、資料來源與備註，依物品與伺服器顯示中位數和歷史。
- 收藏與自建資料：localStorage 持久保存，可新增、編輯、刪除並支援所有圖鑑類型。
- JSON 管理：匯出完整 schema v2 備份；匯入前驗證版本、欄位、重複 ID、外鍵與測試資料標示。
- 舊資料遷移：第一次啟動會讀取 `stardex.user.v1`、`stardex.prices.v1`、`stardex.fav.v1`，轉成 schema v2；舊 key 不會刪除。
- PWA：HTTPS 部署後可加入 iPhone 主畫面，已快取 HTML、CSS、JavaScript 與種子資料供離線使用。

## 用 Live Server 執行

1. 在 VS Code 開啟本資料夾。
2. 在 `index.html` 上按右鍵，選擇 **Open with Live Server**。
3. 瀏覽器應開啟類似 `http://127.0.0.1:5500/index.html` 的網址。

也可以使用任何靜態伺服器，例如：

```powershell
npx serve .
```

請不要直接用 `file://` 開啟，因為瀏覽器會阻擋模組與 JSON 載入；這不是 StarDex 資料錯誤。

## 資料結構

主要檔案：

- `data/maplestar.seed.json`：內建楓星種子資料與來源，`schemaVersion: 2`。
- `js/schema.js`：集合定義、驗證狀態、外鍵規則與完整資料驗證。
- `js/storage.js`：localStorage、v1 → v2 遷移、匯入合併與完整備份。
- `js/app.js`：搜尋、分類、詳情、關聯、收藏、價格、自建資料與資料管理介面。
- `styles.css`：保留原 StarDex 色彩與版型，加入桌面、平板與 iPhone 響應式樣式。
- `sw.js`：PWA 離線快取。

資料庫集合：`monsters`、`items`、`maps`、`npcs`、`jobs`、`skills`、`quests`、`bosses`、`guides`、`prices`、`sources`。

關聯一律使用 ID，例如：

```json
{
  "id": "monster-cloud-fox",
  "dropItemIds": ["item-cloud-fox-tail"],
  "mapIds": ["map-mushroom-shrine-vicinity"],
  "sourceIds": ["source-update-2026-05-21"]
}
```

空值代表未知，不代表 0。測試資料必須同時設定 `testData: true` 與 `verificationStatus: "測試資料"`，介面會以不同底色與標籤呈現。

## 備份與匯入

在「我的」→「資料工具」：

- **匯出完整備份**：包含 schema v2 資料庫、價格和收藏。
- **選擇 JSON**：先顯示驗證結果；有錯誤時不會寫入 localStorage。
- 合併時以 ID 更新自建資料，內建資料不允許被匯入檔覆寫。
- 原 StarDex v1 備份仍可匯入並自動遷移。

## 測試

需要 Node.js 18 以上：

```powershell
npm test
```

測試涵蓋內建資料驗證、穩定 ID 關聯、重複 ID、無效外鍵、測試資料隔離、v1 遷移、內建資料防覆寫與備份再匯入。

## 還原修改前版本

本次升級前已建立本機 Git 基準 commit：

```text
a502ad0 chore: baseline before MapleStar database upgrade
```

請先自行備份目前修改，再以 Git 檢視或還原該 commit。不要用會清除未提交工作的指令，除非你確定不需要目前變更。
