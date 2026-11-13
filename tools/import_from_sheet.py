#!/usr/bin/env python3
"""把 Google Sheet 的紀錄複製一份到本機資料夾（只讀 Sheet，不會改它）。

  python3 tools/import_from_sheet.py [--data DIR] [--xlsx ~/Downloads/grandol_sheet.xlsx] [--no-photos]

用 App 平常讀資料的同一個管道（getState、getEntries）。網址取自 index.html，
通行碼取自部署檔，兩者都不會印出來或存進資料夾。
Drive 上的照片會下載到 media/，紀錄裡的照片網址改成本機的。
存成新格式（見資料夾 README.md）；同一天有兩列時合併，兩列的內容都留下。
原始回應存在 import/<時間>/，舊資料（如果有）先存成 before-import 快照。
畫面上只列數字，不列任何日記內容。
"""
import argparse, collections, datetime, json, pathlib, re, sys, urllib.parse, urllib.request, zipfile
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
import local_server as LS  # noqa: E402

PHOTO_RE = re.compile(r'https://drive\.google\.com/thumbnail\?id=([\w-]+)(?:&sz=w\d+)?')


def secrets():
    url = re.search(r"const DEFAULT_GAS_URL='([^']+)'", (ROOT / 'index.html').read_text(encoding='utf-8')).group(1)
    code = re.search(r"const APP_CODE\s*=\s*['\"]([^'\"]*)['\"]",
                     (ROOT / '部署用_貼我到AppsScript.txt').read_text(encoding='utf-8')).group(1)
    return url, code


def gas_get(url, code, action):
    q = urllib.parse.urlencode({'action': action, 'code': code})
    try:
        with urllib.request.urlopen(url + '?' + q, timeout=120) as r:
            j = json.loads(r.read().decode('utf-8'))
    except Exception as e:
        raise SystemExit(f'讀取 {action} 失敗（{type(e).__name__}），什麼都沒有寫入')
    if not j.get('ok') or j.get('role') != 'owner':
        raise SystemExit(f'{action} 回應不對（ok={j.get("ok")} role={j.get("role")}），什麼都沒有寫入')
    return j['data']


def walk_strings(obj, fn):
    if isinstance(obj, str):
        return fn(obj)
    if isinstance(obj, list):
        return [walk_strings(x, fn) for x in obj]
    if isinstance(obj, dict):
        return {k: walk_strings(v, fn) for k, v in obj.items()}
    return obj


def fetch_photos(urls, media):
    done, failed = {}, []
    for pid, url in sorted(urls.items()):
        have = sorted(media.glob(f'drive_{pid}.*'))
        if have:  # 之前抓過了
            done[pid] = 'media/' + have[0].name
            continue
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                raw = r.read()
        except Exception:
            failed.append(pid)
            continue
        ext = '.jpg' if raw[:2] == b'\xff\xd8' else '.png' if raw[:4] == b'\x89PNG' else \
            '.webp' if raw[8:12] == b'WEBP' else '.gif' if raw[:4] == b'GIF8' else None
        if not ext:  # 拿到的不是圖片（例如登入頁），保留原網址
            failed.append(pid)
            continue
        name = f'drive_{pid}{ext}'
        (media / name).write_bytes(raw)
        done[pid] = 'media/' + name
    return done, failed


def xlsx_dates(path):
    """讀使用者下載的 Excel：entries 分頁有哪些日期（date 欄是 Excel 序號或文字）。"""
    ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    rid = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'
    z = zipfile.ZipFile(path)
    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', ns):
            shared.append(''.join(t.text or '' for t in si.iter('{%s}t' % ns['m'])))
    rels = {r.get('Id'): r.get('Target') for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
    sheet = next(s for s in ET.fromstring(z.read('xl/workbook.xml')).find('m:sheets', ns) if s.get('name') == 'entries')
    target = rels[sheet.get(rid)].lstrip('/')
    target = target if target.startswith('xl/') else 'xl/' + target

    def col(ref):
        n = 0
        for ch in re.match(r'[A-Z]+', ref).group(0):
            n = n * 26 + ord(ch) - 64
        return n

    def val(c):
        v = c.find('m:v', ns)
        if c.get('t') == 's':
            return shared[int(v.text)]
        if c.get('t') == 'inlineStr':
            return ''.join(t.text or '' for t in c.iter('{%s}t' % ns['m']))
        return v.text if v is not None else ''

    rows = ET.fromstring(z.read(target)).find('m:sheetData', ns)
    date_col, dates, n = None, [], 0
    for row in rows:
        cells = {col(c.get('r')): val(c) for c in row}
        if date_col is None:
            date_col = next(k for k, v in cells.items() if v == 'date')
            continue
        d = cells.get(date_col, '')
        if not d:
            continue
        n += 1
        if re.match(r'^\d+(\.\d+)?$', d):
            d = (datetime.date(1899, 12, 30) + datetime.timedelta(days=int(float(d)))).isoformat()
        dates.append(str(d)[:10])
    return n, dates


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--data', default=str(LS.DEFAULT_DATA))
    ap.add_argument('--xlsx')
    ap.add_argument('--no-photos', action='store_true')
    a = ap.parse_args()
    store = LS.Store(a.data)
    url, code = secrets()

    state = gas_get(url, code, 'getState')
    rows = gas_get(url, code, 'getEntries')
    stamp = LS.stamp()
    imp = store.root / 'import' / stamp
    imp.mkdir(parents=True)
    for d in (imp.parent, imp):
        d.chmod(0o700)
    store.write_json(imp / 'getState.json', state)
    store.write_json(imp / 'getEntries.json', rows)

    # 照片：找出所有 Drive 縮圖網址 → 下載 → 換成本機網址
    found = {}
    walk_strings([state, rows], lambda s: [found.setdefault(m.group(1), m.group(0)) for m in PHOTO_RE.finditer(s)] and s)
    local, failed = ({}, sorted(found)) if a.no_photos else fetch_photos(found, store.media)

    def swap(s):
        return PHOTO_RE.sub(lambda m: local.get(m.group(1), m.group(0)), s)
    state2, rows2 = walk_strings(state, swap), walk_strings(rows, swap)

    # 同一天有多列：以 App 會顯示的那列為主（savedAt 大的贏，一樣大就後面那列），
    # 它空著、另一列有填的欄位補進來，這樣兩列的內容都不會不見
    by_date, dup, recovered = {}, collections.Counter(), []
    empty = lambda v: LS.blank(v) or v in ('[]', '{}', [], {})
    for r in rows2:
        ds = str(r.get('date', ''))[:10]
        if not LS.DATE_RE.match(ds):
            continue
        r = dict(r, date=ds)
        if ds in by_date:
            dup[ds] += 1
            win, lose = (by_date[ds], r) if LS.num(by_date[ds].get('savedAt')) > LS.num(r.get('savedAt')) else (r, by_date[ds])
            win = dict(win)
            for k, v in lose.items():
                if empty(win.get(k)) and not empty(v):
                    win[k] = v
                    recovered.append(f'{ds} {k}')
            r = win
        by_date[ds] = r

    # 寫入：舊資料（舊格式或新格式）先打包成快照
    with LS.LOCK:
        old = [store.root / 'state.json', *sorted((store.root / 'entries').glob('*.json'))]
        if store.has_data() or any(f.exists() for f in old):
            snap = store.backups / f'before-import-{stamp}.zip'
            with zipfile.ZipFile(snap, 'w', zipfile.ZIP_DEFLATED) as z:
                for f in [*old, *store.data_files()]:
                    if f.is_file() and not f.name.startswith('.') and f.parent != store.media:
                        z.write(f, f.relative_to(store.root).as_posix())
            snap.chmod(0o600)
        for f in old:
            if f.exists():
                f.unlink()
        if (store.root / 'entries').is_dir():
            (store.root / 'entries').rmdir()
        store.clear()
        for r in by_date.values():
            store.put_entry(r)
        if state2:
            store.put_state(state2)
        store.snapshot('import-' + stamp + '.zip')

    # 核對：App 從本機讀到的內容，要跟它從 Sheet 讀到的一樣（照片網址換成本機的除外）
    back = {e['date']: e for e in store.get_entries()}
    same = sum(1 for ds, r in by_date.items() if ds in back and LS.app_entry(back[ds]) == LS.app_entry(r))
    state_same = LS.app_state(store.get_state()) == LS.app_state(state2)
    lost = sorted(k for k in state2 if k not in LS.STATE_MAP and not LS.blank(state2[k]))
    filled = collections.Counter(k for r in by_date.values() for k, v in r.items() if v not in ('', None, '[]', '{}', 0))
    dates = sorted(by_date)

    print(f'Sheet entries 列數：{len(rows)}　不同日期：{len(by_date)}　同一天重複：{sum(dup.values())} 列（{len(dup)} 天）　合併補回：{recovered or "無"}')
    print(f'日期範圍：{dates[0] if dates else "-"} ～ {dates[-1] if dates else "-"}')
    print(f'寫入本機：{len(list(store.days.glob("*.json")))} 天　App 讀到的內容與 Sheet 一致：{same}/{len(by_date)}　其他資料一致：{state_same}　沒有對照的欄位：{lost or "無"}')
    print(f'照片：Sheet 裡 {len(found)} 張　下載成功 {len(local)}　失敗 {len(failed)}')
    print('各欄位有填的天數：' + '、'.join(f'{k} {n}' for k, n in sorted(filled.items())))
    print('最近 7 天有填的欄位數：' + '、'.join(f'{ds[5:]} {sum(1 for v in by_date[ds].values() if v not in ("", None, "[]", "{}", 0))}' for ds in dates[-7:]))
    if a.xlsx:
        n, xd = xlsx_dates(pathlib.Path(a.xlsx).expanduser())
        xs = set(xd)
        print(f'Excel 對照：{n} 列、{len(xs)} 個不同日期　只在 Excel：{len(xs - set(by_date))}　只在 Sheet：{len(set(by_date) - xs)}')
    print(f'原始回應：{imp}')


if __name__ == '__main__':
    main()
