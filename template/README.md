# 🌱 魔法小森林 · 個人成長習慣系統（Template 2.0）

一個溫柔的習慣養成 PWA：每天打卡習慣、寫 TDL（待辦）和小記，看著自己的小樹長出蘋果、花園開出花朵。內建週回顧／月回顧儀表板（含自動洞察分析）、日曆行程、資源書、成就系統。

- **前端**：單一 `index.html`，部署在 GitHub Pages（免費、不用寫程式）
- **後端**：Google Apps Script（GAS）＋ Google Sheet，資料存在**你自己的** Google 帳號裡
- **資料**：平常存在裝置本機（localStorage），並自動同步備份到你的 Google Sheet

> 📦 這個資料夾就是完整的 app，照下面步驟做一次（約 30 分鐘）就能擁有自己的小森林。
> 想改習慣清單、名稱、顏色 → 看 [CUSTOMIZE.md](CUSTOMIZE.md)
> 想了解技術架構與資料格式 → 看 [SPEC.md](SPEC.md)

---

## 🚀 部署步驟

### 你需要準備
- 一個 GitHub 帳號（免費註冊：https://github.com/signup）
- 一個 Google 帳號

### 步驟 1：建立 GitHub repo 並上傳檔案

1. 登入 GitHub → 右上角「＋」→「New repository」
2. Repository name 取一個名字（例如 `my-forest`），選 **Public**，按「Create repository」
3. 進到新 repo → 「uploading an existing file」（或 Add file → Upload files）
4. 把這個資料夾裡的**所有檔案**拖進去上傳（包含 `pic` 資料夾；`GAS後端程式碼.txt` 和說明文件一起傳上去也沒關係）
5. 按「Commit changes」

### 步驟 2：開啟 GitHub Pages（讓網頁上線）

1. repo 頁面 → Settings → 左邊選單「Pages」
2. Source 選「Deploy from a branch」，Branch 選 `main`、資料夾選 `/ (root)`，按 Save
3. 等 1～2 分鐘，頁面上方會出現你的網址：
   `https://你的帳號.github.io/repo名字/`
4. 打開網址——app 已經可以用了！（此時資料只存在本機，還沒有雲端備份）

### 步驟 3：建立 Google Sheet（你的資料庫）

1. 到 https://sheets.new 建一個新的空白試算表，隨意取名（例如「小森林資料庫」）
2. 看網址列：`https://docs.google.com/spreadsheets/d/【這一長串就是 Sheet ID】/edit`
3. 複製那串 Sheet ID，等一下要用

### 步驟 4：部署 Apps Script（後端）

1. 在剛剛的 Sheet 裡 → 上方選單「擴充功能」→「Apps Script」
2. 把編輯器裡原本的內容全部刪掉，打開 `GAS後端程式碼.txt`，**全選複製貼上**
3. 改最上面兩行設定：
   - `const SHEET_ID = ''` → 引號中貼上步驟 3 的 Sheet ID
   - `const APP_CODE = ''` → 引號中填一串你自己想的通行碼（建議像 `my-forest-2026-abc` 這樣，不要太短）
4. 按「儲存」（磁片圖示）→ 右上角「部署」→「新增部署作業」
5. 類型選「**網頁應用程式**」，設定：
   - 執行身分：**我**
   - 誰可以存取：**任何人**
6. 按「部署」→ 第一次會要求授權：選你的 Google 帳號 →「進階」→「前往（專案名稱）(不安全)」→「允許」
   （這是正常流程——因為這是你自己寫／部署的程式，Google 才會這樣提示）
7. 複製出現的「網頁應用程式 URL」（`https://script.google.com/macros/s/...../exec`）

### 步驟 5：把前端和後端接起來

1. 打開你的 app 網址 → 右上角「⚙️ 設定」
2. 「☁️ 雲端同步」區：貼上步驟 4 的網頁應用程式 URL
3. 「通行碼」欄：填入你在 `APP_CODE` 設定的那串
4. 重新整理頁面 → 右上角同步狀態變綠點就成功了！之後每次紀錄都會自動備份到你的 Sheet

### 步驟 6（建議）：手機加入主畫面

- **iPhone**：用 Safari 打開網址 → 分享按鈕 → 「加入主畫面」→ 從主畫面圖示開啟（通知功能需要 iOS 16.4+，且必須從主畫面開啟）
- **Android**：用 Chrome 打開 → 選單 → 「加到主畫面」

---

## 🔄 之後更新檔案時的注意事項

改了 `index.html`（例如照 CUSTOMIZE.md 客製）並重新上傳後，**記得把 `sw.js` 裡的版本號 +1**：

```js
const CACHE_NAME = 'forest-cache-v1';   // ← v1 改成 v2、v3⋯⋯
```

沒有改版本號的話，手機會一直用舊的快取畫面。改完一樣上傳覆蓋，然後把 app **完全關閉再重開**。

## 🩹 疑難排解

| 狀況 | 解法 |
|---|---|
| 畫面一直是舊的 | `sw.js` 版本號 +1 重新上傳，app 完全關掉重開 |
| 同步紅點／失敗 | 檢查設定裡的 URL 是否完整（結尾是 `/exec`）、通行碼是否和 `APP_CODE` 一模一樣 |
| 改了 GAS 程式碼沒生效 | GAS 的「部署」→「管理部署作業」→ 鉛筆 → 版本選「**新版本**」→ 部署（沿用舊版本不會更新！） |
| 手機收不到通知 | iPhone 必須 iOS 16.4+ 且從主畫面圖示開啟；通知在 app 開著或掛背景時最可靠 |
| 換手機／換瀏覽器資料不見 | 本機資料不會跟著走，但只要在新裝置的設定填入同一組 URL＋通行碼，雲端資料會自動同步回來 |
