# 習慣追蹤 PWA — 套用你自己的資料 設定指南

這是一個可安裝到手機桌面的習慣追蹤 App（PWA），資料存在你自己的 Google Sheet，透過 Google Apps Script 當後端，部署在 GitHub Pages 上完全免費。跟著以下步驟，大約 20~30 分鐘可以架好一份完全屬於你自己的版本。

## 你需要準備

- 一個 Google 帳號（用來建 Sheet 和 Apps Script）
- 一個 GitHub 帳號（用來放程式碼、開網站）

## 資料夾裡有什麼

```
template/
├── index.html          主程式（網頁本體，之後要改名叫 index.html 放進你的 repo 根目錄）
├── manifest.json        PWA 安裝設定
├── sw.js                離線快取用的 Service Worker
├── gas_template.txt      後端程式（貼到 Google Apps Script）
└── SETUP.md             就是這份文件
```

---

## 步驟 1：把程式碼放進你自己的 GitHub repo

1. 在 GitHub 建立一個新的 repo（名稱隨意，例如 `my-habit-app`）
2. 把這個 `template/` 資料夾裡的 4 個檔案（`index.html`、`manifest.json`、`sw.js`）上傳到 repo **根目錄**
3. 你還需要準備 4 張圖片放進 repo 根目錄（沒有的話 App 大部分功能還是能動，只是圖示會變成陽春的 emoji）：
   - `puppy.png` — 首頁場景裡的主角圖案（建議正方形、透明背景 PNG，約 300~500px）
   - `puppy_icon.png` — 手機安裝後的 App 圖示（建議 512x512 正方形 PNG）
   - `background.png` — 手機版背景圖（建議直式，例如 1080x1920）
   - `background_web.png` — 電腦網頁版背景圖（建議橫式，例如 1920x1080）

## 步驟 2：建立你自己的 Google Sheet

1. 到 [Google Sheets](https://sheets.google.com) 新增一份試算表
2. 從網址列複製 Sheet ID（網址長這樣：`https://docs.google.com/spreadsheets/d/【這一段就是 Sheet ID】/edit`）
3. 這份 Sheet 需要兩個分頁，**名稱要一模一樣**：`entries` 和 `state`（沒建立也沒關係，程式第一次執行時會自動建立空白分頁＋標題列，你可以先跳過這步，等部署完 GAS 之後隨便呼叫一次會自動生成）

## 步驟 3：部署後端（Google Apps Script）

1. 到 [script.google.com](https://script.google.com) 新增專案
2. 把 `gas_template.txt` 的**全部內容**複製貼上，取代預設的程式碼
3. 找到第 30 行左右的 `const SHEET_ID = 'PASTE_YOUR_GOOGLE_SHEET_ID_HERE';`，把裡面的文字換成你步驟2複製的 Sheet ID
4. 存檔（Cmd/Ctrl + S）
5. **授權 Google Drive 權限**（讓「上傳圖片」功能能用）：
   - 在編輯器上方函式下拉選單，選 `testDriveAuth`
   - 點「▶ 執行」
   - 會跳出 Google 帳號選擇 → 選你的帳號
   - 如果看到「這個應用程式未經 Google 驗證」的警告 → 點左下角「進階」→「前往 xxx（不安全）」→ 點「允許」
   - 執行完成後，下方「執行記錄」會顯示一行「資料夾建立/找到成功：格蘭朵圖片庫」，代表成功
6. 部署：右上角「部署」→「新增部署作業」
   - 類型選「網頁應用程式」
   - 執行身分：**我**
   - 誰可以存取：**所有人**
   - 點「部署」
7. 複製部署完成後顯示的網址（長得像 `https://script.google.com/macros/s/xxxxxxxxx/exec`），下一步會用到

⚠️ **重要**：之後如果要更新 GAS 程式碼，記得從「管理部署作業 → 編輯（鉛筆）→ 版本選『新版本』→ 部署」，網址才不會變。如果選「新增部署作業」會產生一個全新的網址，App 就連不到舊資料了。

## 步驟 4：把網址填進 index.html

打開你 repo 裡的 `index.html`，搜尋 `PASTE_YOUR` 找到這兩行，換成你自己的資料：

```js
const DEFAULT_GAS_URL='PASTE_YOUR_GAS_WEB_APP_URL_HERE'; // 換成步驟3拿到的網址
const SHEET_ID='PASTE_YOUR_GOOGLE_SHEET_ID_HERE'; // 換成步驟2的 Sheet ID（這裡只是顯示用，不影響同步）
```

存檔、上傳回 GitHub。

## 步驟 5：開啟 GitHub Pages

1. 到你的 repo → Settings → Pages
2. Source 選 `main` 分支、根目錄 `/ (root)`
3. 存檔，等 1~2 分鐘，網址會是 `https://你的帳號.github.io/repo名稱/`

## 步驟 6：安裝到手機

用手機瀏覽器（iPhone 用 Safari，Android 用 Chrome）打開你的網址：

- **iPhone**：分享按鈕 →「加入主畫面」
- **Android**：瀏覽器選單 →「安裝應用程式」或「加到主畫面」

⚠️ 通知功能在 iPhone 需要 iOS 16.4 以上，且一定要先「加入主畫面」用 App 圖示打開才能用。

---

## 想要客製化？（選做）

以下都是外觀/文字，不影響功能，找到後直接改文字即可：

- **App 名稱**：`manifest.json` 裡的 `name`、`short_name`；`index.html` 裡 `<title>` 和頁面裡出現的文字（可搜尋目前預設的中文字樣，直接替換成你想要的名字）
- **主題色**：`manifest.json` 的 `theme_color`、`background_color`；`index.html` 裡 CSS `:root` 區塊的顏色變數
- **習慣項目**：`index.html` 裡搜尋 `const HABITS=[` 這個陣列，可以改成你自己想追蹤的習慣（每一項有代表 emoji、名稱、對應長出來的花朵）
- **成就清單**：搜尋 `const ACHIEVEMENTS=[`，可以增減或改文案

## 疑難排解

| 問題 | 可能原因 |
|---|---|
| 打開網頁一直顯示「連線中...」 | GAS_URL 沒填對，或 GAS 部署時「誰可以存取」沒選「所有人」 |
| 上傳圖片失敗 | GAS 忘記執行 `testDriveAuth` 授權 Drive 權限，或部署的是舊版程式碼 |
| 改了 GAS 程式碼後功能沒變 | 部署時要選「編輯現有部署 → 新版本」，不是「新增部署作業」 |
| 手機上看不到最新的修改 | 靜態檔案（index.html等）有快取，把 `sw.js` 裡 `CACHE_NAME` 的版本數字 +1 再重新整理 |
| 通知功能沒反應（iPhone） | 一定要先「加入主畫面」安裝成 App、從 App 圖示打開才能用，且需要 iOS 16.4+ |

---

祝你架設順利 🌱 有任何問題都可以把這份 SETUP.md 和你遇到的錯誤訊息一起貼給 Claude Code 問。
