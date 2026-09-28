#!/usr/bin/env python3
"""格蘭朵魔法森林的零依賴完整性檢查。

用法：python3 tools/verify_project.py
"""
from __future__ import annotations

import json
import pathlib
import re
import struct
import subprocess
import sys
import zipfile


ROOT = pathlib.Path(__file__).resolve().parent.parent
errors: list[str] = []


def fail(message: str) -> None:
    errors.append(message)


def png_size(path: pathlib.Path) -> tuple[int, int] | None:
    try:
        data = path.read_bytes()[:24]
    except OSError as exc:
        fail(f'無法讀取 {path.relative_to(ROOT)}: {exc}')
        return None
    if len(data) != 24 or data[:8] != b'\x89PNG\r\n\x1a\n' or data[12:16] != b'IHDR':
        fail(f'{path.relative_to(ROOT)} 不是有效的 PNG')
        return None
    return struct.unpack('>II', data[16:24])


def check_manifest(relative: str) -> None:
    path = ROOT / relative
    try:
        manifest = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError) as exc:
        fail(f'{relative} 無法解析: {exc}')
        return
    for icon in manifest.get('icons', []):
        icon_path = path.parent / icon.get('src', '')
        declared = icon.get('sizes', '')
        actual = png_size(icon_path)
        if actual and declared != f'{actual[0]}x{actual[1]}':
            fail(f'{relative}: {icon_path.name} 實際為 {actual[0]}x{actual[1]}，但宣告為 {declared}')


def check_javascript(relative: str) -> None:
    path = ROOT / relative
    result = subprocess.run(
        ['node', '--check', str(path)], capture_output=True, text=True, check=False
    )
    if result.returncode:
        fail(f'{relative} JavaScript 語法錯誤:\n{result.stderr.strip()}')


def check_html_scripts(relative: str) -> None:
    path = ROOT / relative
    text = path.read_text(encoding='utf-8')
    # 專案的 inline script 標籤都獨佔一行；避開說明文字中的 <script> 字樣。
    blocks = re.findall(r'^<script>\n(.*?)^</script>$', text, flags=re.MULTILINE | re.DOTALL)
    if not blocks:
        fail(f'{relative}: 找不到 inline script')
        return
    for index, script in enumerate(blocks, 1):
        result = subprocess.run(
            ['node', '--check', '-'], input=script, capture_output=True, text=True, check=False
        )
        if result.returncode:
            fail(f'{relative} 第 {index} 個 script 語法錯誤:\n{result.stderr.strip()}')


def check_template_zip() -> None:
    template = ROOT / 'template'
    archive = ROOT / 'forest-template-2.0.zip'
    expected = {
        (pathlib.Path('template') / p.relative_to(template)).as_posix(): p.read_bytes()
        for p in template.rglob('*')
        if p.is_file() and not any(part.startswith('.') for part in p.relative_to(template).parts)
    }
    try:
        with zipfile.ZipFile(archive) as zf:
            actual_names = {n for n in zf.namelist() if not n.endswith('/')}
            if actual_names != set(expected):
                missing = sorted(set(expected) - actual_names)
                extra = sorted(actual_names - set(expected))
                fail(f'{archive.name} 檔案清單不同步（缺少={missing}, 多出={extra}）')
            for name in sorted(actual_names & set(expected)):
                if zf.read(name) != expected[name]:
                    fail(f'{archive.name} 內的 {name} 已過期')
    except (OSError, zipfile.BadZipFile) as exc:
        fail(f'{archive.name} 無法讀取: {exc}')


for manifest_path in ('manifest.json', 'template/manifest.json'):
    check_manifest(manifest_path)
for js_path in ('sw.js', 'template/sw.js', 'focus-core.js', 'focus.js', 'template/focus-core.js', 'template/focus.js'):
    check_javascript(js_path)
for html_path in ('index.html', 'template/index.html'):
    check_html_scripts(html_path)

template_html = (ROOT / 'template/index.html').read_text(encoding='utf-8')
for private_marker in ('格蘭朵', '妳', 'AKfyc', 'yuna-28/Personal'):
    if private_marker in template_html:
        fail(f'template/index.html 殘留私人標記: {private_marker}')

check_template_zip()

if errors:
    print('❌ 專案檢查失敗：')
    for error in errors:
        print(f'  - {error}')
    sys.exit(1)

print('✅ 專案檢查通過：JSON、PWA 圖示、JavaScript、公開範本與 ZIP 皆一致')
