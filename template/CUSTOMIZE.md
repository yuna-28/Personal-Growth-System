# 🎨 客製化指南（CUSTOMIZE）

所有客製都在 `index.html` 裡完成。用編輯器（VS Code、GitHub 網頁編輯器都可以）打開，**Ctrl/Cmd + F 搜尋**下面給的關鍵字就能跳到要改的位置。

> ⚠️ 改完任何東西，記得：
> 1. `sw.js` 裡的 `CACHE_NAME` 版本號 +1（不然看不到更新）
> 2. 兩個檔案都重新上傳到 GitHub
> 3. app 完全關閉重開

---

## 1. 改 App 名稱

預設叫「魔法小森林」。搜尋 `魔法小森林` 全部取代成你要的名字，另外這幾個地方也搜尋一下：

| 搜尋 | 位置 | 說明 |
|---|---|---|
| `<title>` | 網頁分頁標題 | |
| `apple-mobile-web-app-title` | iPhone 主畫面名稱 | content 裡的字 |
| `splash-name` | 開場動畫的名字 | |
| `魔法樹` | 主畫面那棵樹的名字 | 想改成「XX樹」 |

`manifest.json` 裡的 `name`、`short_name`、`description` 也一起改。

## 2. 改習慣清單（最常用！）

搜尋 `const HABITS`，會看到：

```js
const HABITS=[
  {k:'wakeup',l:'早起',c:'1f305',fc:'1fab7',phrase:'你是一個善待自己的人'},
  {k:'sleep',l:'早睡',c:'1f319',fc:'1fab7',phrase:'你是一個照顧自己的人'},
  ...
];
```

每一行是一個習慣，欄位意義：

| 欄位 | 意義 | 注意 |
|---|---|---|
| `k` | 英文代號（唯一值） | **建好之後不要再改**，資料是用它記的；新增習慣就取新代號 |
| `l` | 顯示名稱 | 隨意改 |
| `c` | 習慣圖示的 emoji 代碼 | 見下方「emoji 代碼怎麼查」 |
| `fc` | 完成時花園裡開出的花的 emoji 代碼 | 同上 |
| `phrase` | 打卡完成時顯示的肯定句 | 隨意改 |

- **刪習慣**：整行刪掉（歷史紀錄還在，只是不再顯示）
- **加習慣**：照格式加一行，`k` 用沒用過的英文代號

### emoji 代碼怎麼查
圖示用的是 [fluentui 3D emoji]（透過 CDN 載入）。代碼＝emoji 的 unicode 編號小寫：
1. 到 https://emojipedia.org 搜尋你要的 emoji
2. 頁面下方找「Codepoints」，例如 🌅 是 `U+1F305` → 代碼填 `1f305`（去掉 `U+`、轉小寫）

## 3. 改身份標籤

搜尋 `const IDENTITY_TAGS`：

```js
{id:'health',emoji:'1f305',label:'健康的人',habits:['wakeup','sleep']},
```

- `habits` 陣列填習慣的 `k` 代號——完成那些習慣就會累積這個身份的天數
- `label`／`emoji` 隨意改；`id` 建好後不要改

## 4. 改 TDL 主題的自動 emoji

搜尋 `const THEME_EMOJI`，是一個「主題名稱 → emoji」對照表。你平常在 TDL 填的主題（例如「工作」「日文」）會自動配上 emoji，想加自己常用的主題就照格式加。

## 5. 改成就清單

搜尋 `const ACHIEVEMENTS`。`id` 不要改，`icon`／`name`／`desc` 可以改文字。

## 6. 改配色

搜尋 `:root{`（第一個），主要變數：

| 變數 | 用途 |
|---|---|
| `--primary` | 主色（深藍） |
| `--secondary` | 次色（圖表藍） |
| `--tertiary` | 淺青 |
| `--pink`／`--gold` | 粉、金點綴色 |

改色時 `--primary-rgb` 等 `-rgb` 版本也要一起改成相同顏色的 RGB 數值。

## 7. 改「清除資料」的通關密碼

預設是 `1228`。搜尋 `verifyDangerCode`，把函式裡的 `'1228'` 改成你要的（有兩處：判斷式和提示文字）。

## 8. 換圖片

直接用**同檔名**覆蓋上傳即可：

| 檔案 | 用途 |
|---|---|
| `puppy.png` | 場景裡的小狗（建議透明背景 PNG） |
| `puppy_icon.png` | App 圖示（正方形） |
| `background.png` | 開場畫面背景 |
| `pic/cloud bkg.jpg` | 資源書頁面的背景 |

## 9. 改見證／鼓勵文案

- 搜尋 `const tails` → 週/月回顧見證卡片輪播的溫柔結尾語
- 搜尋 `你正在成為自己的見證者` → 機制說明文案
