#!/usr/bin/env python3
"""從 index.html 產生 template/index.html（可公開分享的中性版本）。

每次改完 index.html 都要跑：  python3 tools/regen_template.py
會做的事：
  1. 個人化字眼 → 中性（格蘭朵→小森林、妳→你）
  2. 抽掉私人的 GAS 網址與本機圖片路徑
  3. 補上「還沒設定雲端」的防呆（範本預設沒有後端）
"""
import re, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
src = (ROOT / 'index.html').read_text(encoding='utf-8')

# 1) 品牌字眼：長的先換，不然會被短的吃掉
for a, b in [('格蘭朵魔法森林', '魔法小森林'), ('格蘭朵樹', '魔法樹'),
             ('格蘭朵女神', '森林女神'), ('格蘭朵圖片庫', '小森林圖片庫'),
             ('格蘭朵', '小森林'), ('妳', '你')]:
    src = src.replace(a, b)

# 2) 開場動畫背景改用漸層（範本沒有 background.png）
src = src.replace(
    "#pwa-splash{display:none;position:fixed;inset:0;z-index:99999;"
    "background:#D4EEFF url('background.png') center/cover no-repeat;",
    "#pwa-splash{display:none;position:fixed;inset:0;z-index:99999;"
    "background:linear-gradient(180deg,#D4EEFF,#EAF6E8);")

# 3) 抽掉私人後端網址與個人圖床
src = re.sub(r"const DEFAULT_GAS_URL='[^']*';", "const DEFAULT_GAS_URL='';", src)
src = src.replace(
    'https://cdn.jsdelivr.net/gh/yuna-28/Personal-Growth-System@main/puppy.png',
    'puppy.png')

# 4) 沒設定 GAS 時給清楚訊息，而不是靜靜失敗
guards = [
    ("  if(VIEWER_MODE)throw new Error('viewer-readonly');",
     "\n  if(!GAS_URL)throw new Error('尚未設定 GAS 網址');"),
    ("  if(VIEWER_MODE){setSync('ok','👀 監督模式（唯讀）');return;}",
     "\n  if(!GAS_URL){setSync('error','尚未設定雲端（設定→雲端同步）');return;}"),
    ("async function loadCloud(){",
     "\n  if(!GAS_URL){setSync('error','尚未設定雲端（設定→雲端同步）');return;}"),
]
for anchor, add in guards:
    if anchor not in src:
        raise SystemExit(f'找不到防呆插入點，index.html 可能改過：{anchor[:40]}')
    src = src.replace(anchor, anchor + add)

(ROOT / 'template' / 'index.html').write_text(src, encoding='utf-8')

# 5) 出貨前自我檢查：個人資料一個都不能漏
leaks = {name: src.count(name) for name in ('格蘭朵', '妳', 'AKfyc', 'yuna-28/Personal')}
bad = {k: v for k, v in leaks.items() if v}
if bad:
    raise SystemExit(f'❌ 範本仍殘留個人資料：{bad}')
print(f'✅ template 已更新（{len(src)} bytes），中和檢查通過')
