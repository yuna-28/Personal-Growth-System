# 🔧 技術規格說明（SPEC）

給想看懂／修改程式的人。一般使用者只需要 README 和 CUSTOMIZE。

## 架構總覽

```
┌─────────────────────────┐        ┌──────────────────────────┐
│  前端 PWA（GitHub Pages）  │  HTTPS │  Google Apps Script       │
│  index.html（單一檔案）    │ ◄────► │  網頁應用程式（doGet/doPost）│
│  sw.js（離線快取）         │        │        │                  │
│  資料主體：localStorage    │        │        ▼                  │
└─────────────────────────┘        │  Google Sheet（備份資料庫）  │
                                   │  Google Drive（照片檔案）    │
                                   └──────────────────────────┘
```

- **本機優先**：所有操作先寫進 localStorage，雲端是非同步備份；離線也能完整使用
- **單一使用者**：一組 Sheet＋通行碼＝一個人的資料，沒有多人帳號概念

## 檔案清單

| 檔案 | 職責 |
|---|---|
| `index.html` | 全部的 UI＋邏輯（HTML/CSS/JS 都在裡面，約 4700 行） |
| `sw.js` | Service Worker：network-first 快取（GAS API 一律不快取）；改版時 `CACHE_NAME` 數字 +1 |
| `manifest.json` | PWA 設定（名稱、圖示、加入主畫面） |
| `GAS後端程式碼.txt` | 貼到 Apps Script 的後端（不會被網頁載入，放在 repo 只是備份） |

## localStorage 鍵值

| key | 內容 |
|---|---|
| `grandol_v7` | 主狀態物件 `S`（JSON），所有資料都在這裡 |
| `grandol_gas_url` | GAS 網頁應用程式 URL |
| `grandol_code` | 通行碼 |
| `grandol_last_sync` | 上次同步時間戳 |
| `grandol_cal_remind` | 日曆提醒設定 |
| `grandol_notif_fired` | 今日已觸發過的通知（防重複） |
| `grandol_view_*` | 各頁面的檢視模式偏好 |

> 鍵名有歷史前綴 `grandol_`，改掉會讓既有使用者資料讀不到，**請保留**。

## 主狀態 `S` 的重要欄位

```js
{
  dayKey,            // 本工作階段認定的「今天」（跨日防呆的核心，見下方）
  exp, streak,       // 經驗值、連續天數
  apples[], flowers[], bigApples, goldFruits, seedlings, trees,  // 成長資產
  checked{},         // 今天已打卡的習慣 {習慣k: true}
  diary{hl,rf,gr,quote},   // 今天的小記
  todayTDL[], tdlDone{},   // 今天的 TDL 與完成狀態
  tomorrowTDL[],           // 明天的 TDL 規劃
  entries[],         // 歷史每日紀錄（見下）
  calNotes{}, quotes[], achievements[], ...
}
```

### entries（每日紀錄）schema

```js
{ date:'YYYY-MM-DD', checked:[], diary:{hl,rf,gr,quote}, exp, streak,
  tdl:[],                 // 當天「規劃給隔天」的 TDL（注意：不是當天的！）
  tdlTotal, tdlDone,      // 當天 TDL 統計
  tdlItems:[{task,theme,done}],  // 當天 TDL 逐項明細（週/月分析的資料來源）
  photos:[] }
```

## 跨日處理（重要設計）

- `S.dayKey`＝開頁時決定的「今天」。**寫入一律用 `curDay()`（＝dayKey），絕不用即時時鐘**——避免頁面跨午夜開著時「畫面顯示昨天、卻存進今天」。
- `rolloverToToday()` 負責換日：把舊日資料落地到 entry → 清空當日狀態 → dayKey 前進。在「開頁時」「按回到今天」「頁面重新可見（visibilitychange）」三個時機都會執行。

## GAS API

所有請求都帶 `code` 參數（通行碼），驗證失敗回 `{ok:false,error:'unauthorized'}`。

**doGet（讀取）**

| action | 回傳 |
|---|---|
| `getEntries` | 全部每日紀錄 |
| `getState` | 主狀態備份 |
| `getCalEvents&start=&end=` | 期間內的 Google 日曆事件（掃使用者所有日曆） |

**doPost（寫入）**

| action | 功能 |
|---|---|
| `saveEntry` | 寫入／更新一筆每日紀錄 |
| `saveState` | 備份主狀態 |
| `uploadImage` | 照片上傳到 Drive「小森林圖片庫」資料夾，回傳 URL |
| `clearAll` | 清空 Sheet（不刪 Drive 圖片） |
| `addCalEvent` / `editCalEvent` / `delCalEvent` | Google 日曆事件增改刪（支援重複規則與次數 repeatCount） |
| `syncReminders` | 同步提醒 |

**Google Sheet 結構**：兩張工作表 `entries`（一天一列）與 `state`（單列主狀態），欄位由 GAS 的 `ENTRY_COLS`／`STATE_COLS` 定義，缺欄會自動補上（向後相容）。

## 前端維護注意事項（改壞最常見的原因）

1. **`<script>` 區塊是依序同步執行的**：前面區塊的「頂層」程式碼，不能呼叫定義在後面區塊的函式／常數——會拋錯並讓該區塊剩餘程式碼整段中止（畫面看起來像「某功能默默消失」）。除錯技巧：在 `<head>` 最前面暫時插入 `window.addEventListener('error',e=>console.log(e.message,e.lineno))` 抓第一時間的錯誤。
2. **popup 元素（`#cal-popup` 等）必須放在 `<body>` 開頭、所有 `<script>` 之前**：既避開 `.wrap` 的 zoom 造成 `position:fixed` 錯位，又確保前面的 script 綁事件時元素已存在。
3. **桌面版樣式一律包在 `@media(min-width:768px)`**：手機版是基準設計，桌面調整不應影響手機。
4. **每次改版都要 bump `sw.js` 的 `CACHE_NAME`**，否則使用者裝置會停在舊快取。
5. GAS 改動要在「管理部署作業」中選「**新版本**」重新部署才會生效。

## 已知限制

- 通知：iPhone 需 iOS 16.4+ 且從主畫面 PWA 開啟；系統可能在 app 完全關閉太久後不觸發
- 照片：存在使用者自己的 Drive，刪除 app 資料不會刪 Drive 檔案
- 多裝置：以「最後同步的雲端資料」為準，沒有衝突合併機制——同時在兩台裝置寫入可能互相覆蓋
