# 格蘭朵魔法森林 — 完整規格說明
## 給 Claude Code 的開發文件

---

## 🎯 任務目標

將現有的 `grandol_v7.html`（單一 HTML 檔案）升級為：
1. **PWA（漸進式網頁應用程式）**，可安裝到手機桌面，有 APP icon，全螢幕啟動
2. **背景圖片替換**：固定不動的背景（parallax 效果），卡片半透明玻璃風格
3. **通知設定功能**（規格見下方，請實作）
4. 手機與電腦網頁版**共用同一個 Google Sheet 資料**（已實現，維持現況）

---

## 📁 現有檔案說明

- `grandol_v7.html` — 完整的單頁應用，所有邏輯都在這一個檔案裡
- `gas_v2.gs` — Google Apps Script 後端，部署在 Google Apps Script

**目前部署方式**：GitHub Pages
- Repo：`https://github.com/yuna-28/Personal-Growth-System`
- 網址：`https://yuna-28.github.io/Personal-Growth-System/`
- 主檔案名稱必須是 `index.html`

---

## 🖼️ 圖片資源（已在 GitHub repo）

| 用途 | URL |
|---|---|
| 小狗主圖 | `https://raw.githubusercontent.com/yuna-28/Personal-Growth-System/refs/heads/main/puppy.png` |
| APP icon | `https://raw.githubusercontent.com/yuna-28/Personal-Growth-System/refs/heads/main/puppy_icon.png` |
| 手機背景 | `https://raw.githubusercontent.com/yuna-28/Personal-Growth-System/refs/heads/main/background.png` |
| 電腦網頁背景 | `https://raw.githubusercontent.com/yuna-28/Personal-Growth-System/refs/heads/main/background_web.png` |

---

## 🔧 PWA 設定需求

### 需要新增的檔案

**`manifest.json`**
```json
{
  "name": "格蘭朵魔法森林",
  "short_name": "格蘭朵",
  "description": "妳正在成為自己的見證者",
  "start_url": "/Personal-Growth-System/",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#D4EEFF",
  "theme_color": "#8B7FE8",
  "icons": [
    {
      "src": "puppy_icon.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "puppy_icon.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
}
```

**`sw.js`（Service Worker）**
- 快取所有靜態資源（html/css/js/圖片）
- 離線時顯示快取版本
- 更新策略：network first，失敗才用快取

**`index.html` 需要加的 meta tag**
```html
<link rel="manifest" href="manifest.json"/>
<meta name="apple-mobile-web-app-capable" content="yes"/>
<meta name="apple-mobile-web-app-status-bar-style" content="default"/>
<meta name="apple-mobile-web-app-title" content="格蘭朵"/>
<link rel="apple-touch-icon" href="puppy_icon.png"/>
<meta name="theme-color" content="#8B7FE8"/>
```

### 啟動畫面（Splash Screen）
- 背景圖：`background.png`（手機）
- 中央圖示：`puppy_icon.png`
- 用 CSS `@media` 控制，只在 PWA standalone 模式顯示

---

## 🎨 背景與視覺修改

### 背景替換
將現有的 CSS 漸層背景換成固定圖片：

```css
body {
  /* 電腦版 */
  background-image: url('https://raw.githubusercontent.com/yuna-28/Personal-Growth-System/refs/heads/main/background_web.png');
  background-size: cover;
  background-position: center;
  background-attachment: fixed;
  background-repeat: no-repeat;
}

/* 手機版 / PWA standalone */
@media (max-width: 768px),
(display-mode: standalone) {
  body {
    background-image: url('https://raw.githubusercontent.com/yuna-28/Personal-Growth-System/refs/heads/main/background.png');
    /* iOS 不支援 fixed，改用 scroll + pseudo element 模擬 */
    background-attachment: scroll;
  }
}
```

⚠️ iOS Safari 不支援 `background-attachment: fixed`，需要用 `::before` pseudo element 模擬：
```css
body::before {
  content: '';
  position: fixed;
  inset: 0;
  background-image: url('...');
  background-size: cover;
  background-position: center;
  z-index: -1;
}
```

### 卡片半透明調整
背景換成圖片後，gcard 需要微調讓背景透出來：

```css
/* 現有 gcard，調高透明度讓背景圖透出 */
.gcard {
  background: rgba(255, 255, 255, 0.45); /* 原本 .55，調低讓背景透出 */
  backdrop-filter: blur(16px);
}
.gcard-scene {
  background: rgba(240, 248, 255, 0.40);
}
.gcard-nb {
  background: rgba(255, 252, 235, 0.50);
}
```

效果：使用者滑動頁面時，卡片在固定背景上滑動，產生視差層次感。

---

## 🔔 通知設定頁面規格（新增功能，請實作）

### 加入說明頁或獨立為第7頁

導覽列新增「設定」頁（⚙️），或整合進現有「說明」頁的分頁 tab。

### 設定頁面包含以下區塊

#### 1. 每日提醒通知

UI 設計：
- 開關 toggle（啟用/關閉整體通知）
- 預設提醒項目（可開關、可編輯時間）：
  - 🌅 早起打卡提醒（預設 07:00）
  - 📝 填寫今日小記（預設 21:00）
  - 🌙 種下今天提醒（預設 22:00）
  - 💤 準備早睡提醒（預設 23:00）
- 自訂提醒（可新增多個）：
  - 輸入：主題名稱、emoji icon（選擇器）、時間、頻率（每天/每週一~日可多選）
  - 可刪除

技術實作方式：
- 使用 **Web Notifications API** + **Service Worker** 的 `setInterval` 或 `setTimeout`
- PWA 安裝後，Service Worker 在背景定時觸發通知
- 通知內容：icon 用 `puppy_icon.png`，標題和內文根據設定顯示
- 注意：iOS 通知支援有限（iOS 16.4+ PWA 才支援），需在 UI 上說明

資料儲存：
- 存在 `localStorage` 的 `grandol_v7` key 裡的 `notifications` 欄位
- 同步到 Google Sheet state 分頁（在 supportCategories 後面新增 `notifications` 欄）

#### 2. 帳號與資料

- **Google Sheet ID 顯示**（唯讀，讓使用者確認連接的是哪個表格）
- **GAS 網址**（可編輯，方便換部署網址時不用改 HTML）
- **同步狀態**（最後同步時間）
- **手動同步按鈕**（立即觸發 syncState + loadCloud）

#### 3. 清除資料（從說明頁移過來）

- 清除本機資料按鈕（雙重確認）
- 說明文字：只清本機，Sheet 資料不受影響，重新載入後會同步回來
- 完全清零說明：需同時去 Sheet 刪除 entries 資料列和 state 第2列

#### 4. 關於

- 版本號：v7
- 格蘭朵的核心理念一句話：「格蘭朵不是目標管理工具，是妳正在成為自己的見證者 🌱」

---

## 📊 Google Sheet 同步（現有，維持不變）

**Sheet ID**：（已移除，見部署用檔案）
**GAS URL**：`https://script.google.com/macros/s/AKfycbw_gbuZtYiZjBusfWTNHPlOB20PMJLcb700u6pd5MIqoX7pCOAnthTjxym66nHTOK8G/exec`

### entries 分頁（11欄）
`date | checked | hl | rf | gr | quote | tdl | exp | streak | tdlTotal | tdlDone`

### state 分頁（17欄，未來加 notifications 變18欄）
`flowers | apples | bigApples | goldFruits | seedlings | trees | achievements | quotes | calNotes | myPeople | treasures | lastPlant | lastStreak | streak | exp | gardenPos | supportCategories`

**未來新增第18欄**：`notifications`（通知設定的 JSON）

### GAS actions
- `getEntries` — GET，回傳所有 entries
- `getState` — GET，回傳 state 第2列
- `saveEntry` — POST，寫入/覆蓋當天 entry
- `saveState` — POST，覆蓋 state 第2列

---

## 🏗️ 現有技術架構

- **單一 HTML 檔案**，所有 CSS/JS 內嵌
- **localStorage key**：`grandol_v7`
- **日期計算**：全部用本地時間（台灣 UTC+8），已修正 toISOString 時區 bug
- **Fluent Emoji CDN**：`https://cdn.jsdelivr.net/gh/shuding/fluentui-emoji-unicode/assets/{code}_3d.png`
- **字體**：Google Fonts — Baloo 2 + Quicksand
- **RWD 斷點**：768px（手機單欄 / 電腦雙欄）
- **最大寬度**：860px 置中

---

## 📱 頁面結構（現有6頁 + 新增設定頁）

底部導覽列：今天 / 週回顧 / 月回顧 / 內心花園 / 支持 / 說明 / **⚙️ 設定（新增）**

---

## ⚠️ 注意事項

1. **不要改動現有功能邏輯**，只做以下事項：
   - 加 PWA 相關檔案（manifest.json, sw.js）
   - 修改背景 CSS
   - 微調 gcard 透明度
   - 新增設定頁面

2. **iOS `background-attachment: fixed` 不支援**，必須用 `::before` pseudo element 處理

3. **Service Worker 快取**要排除 GAS API 請求（外部網址不快取）

4. **通知功能**在 iOS 需要 PWA 安裝後才能使用，且需要 iOS 16.4+，請在 UI 說明

5. **導覽列圖示數量**增加後（7個），注意手機底部 nav 不要太擠，考慮縮小字或隱藏文字標籤

6. GAS URL 和 Sheet ID 目前寫死在 HTML 裡，設定頁面實作後改為從 localStorage 讀取，讓使用者可以在設定頁修改

---

## 🔄 給 Claude Code 的執行順序建議

1. 先讀完 `grandol_v7.html` 理解現有結構
2. 修改 `index.html`（原 v7）：
   - 加 PWA meta tags
   - 換背景 CSS（用 pseudo element 處理 iOS）
   - 調整 gcard 透明度
   - 加設定頁面 HTML + JS
   - GAS URL 改從 localStorage 讀取
3. 新建 `manifest.json`
4. 新建 `sw.js`
5. 更新 `gas_v2.gs` 加入 notifications 欄位
6. 測試：用 Chrome DevTools 的 Application > Service Workers 確認 PWA 可安裝

