#!/usr/bin/env python3
"""格蘭朵本機伺服器：提供 App 的檔案，並用跟 GAS 一樣的 API 把資料存在這台電腦。

  python3 tools/local_server.py                       # 資料夾預設 ~/Documents/Personal-Growth-System/data
  python3 tools/local_server.py --data DIR --port 8768
  python3 tools/local_server.py --data DIR --restore DIR/backups/2026-11-13.zip

資料夾用人看得懂的格式存（說明見資料夾裡的 README.md）：
  days/YYYY-MM-DD.json  一天一個檔：日記、待辦、明天的計畫、習慣、身體、照片
  goals.json collections.json garden.json settings.json today.json
  media/ 照片　backups/ 每天第一次寫入前自動備份（留 60 份）　config.json 日曆用的 GAS 網址與通行碼
App 看到的還是 GAS 的形狀，轉換在這裡做，App 不用改。
資料絕不寫進 git repo。只綁 127.0.0.1。只用標準庫，macOS 內建的 python3（3.9）就能跑。
"""
import argparse, base64, datetime, json, os, pathlib, re, tempfile, threading
import urllib.parse, urllib.request, zipfile
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

APP_ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_DATA = pathlib.Path.home() / 'Documents' / 'Personal-Growth-System' / 'data'
DEFAULT_PORT = 8768
LOCAL_FLAG = b'<script>window.GRANDOL_LOCAL=1</script>'
VER = 'local-2'
KEEP_BACKUPS = 60
MAX_BODY = 20 * 1024 * 1024

# 日曆還是 Google 日曆：這些動作轉給 GAS，其餘都在本機處理
CAL_ACTIONS = {'getCalEvents', 'addCalEvent', 'editCalEvent', 'delCalEvent', 'syncReminders'}
STATIC_FILES = {'index.html', 'focus.js', 'focus-core.js', 'focus.css', 'ds.css', 'sw.js', 'manifest.json'}
IMAGE_TYPES = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
               '.gif': 'image/gif', '.svg': 'image/svg+xml'}
TEXT_TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
              '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8'}
DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
LOCK = threading.Lock()

# ── 新格式 ↔ App（GAS 形狀）的對照表 ─────────────────────
# 一天：App 欄位 → 新名稱。JSON 欄位在 App 那邊是字串，這裡存成真正的清單／物件
DAY_DIARY = {'hl': 'highlight', 'rf': 'reflection', 'gr': 'gratitude', 'quote': 'quote'}
DAY_JSON = {'tdlItems': 'todos', 'tdl': 'planForTomorrow', 'checked': 'habitsDone', 'health': 'health', 'photos': 'photos'}
# 算得出來、App 現在還會讀的數字：集中放在 app，之後 App 改版時拿掉
DAY_APP = ('exp', 'streak', 'tdlTotal', 'tdlDone', 'savedAt')

# 其他資料：App 欄位 → (檔案, 新名稱, 是不是 JSON)
STATE_MAP = {
    'focus': ('goals.json', 'focus', True),
    'quotes': ('collections.json', 'quotes', True),
    'myPeople': ('collections.json', 'people', True),
    'treasures': ('collections.json', 'treasures', True),
    'supportResources': ('collections.json', 'resources', True),
    'supportCategories': ('collections.json', 'supportCategories', True),
    'calNotes': ('collections.json', 'calendarNotes', True),
    'exp': ('garden.json', 'exp', False),
    'streak': ('garden.json', 'streak', False),
    'lastPlant': ('garden.json', 'lastPlant', False),
    'lastStreak': ('garden.json', 'lastStreak', False),
    'flowers': ('garden.json', 'flowers', True),
    'apples': ('garden.json', 'apples', True),
    'bigApples': ('garden.json', 'bigApples', False),
    'goldFruits': ('garden.json', 'goldFruits', False),
    'seedlings': ('garden.json', 'seedlings', False),
    'trees': ('garden.json', 'trees', False),
    'achievements': ('garden.json', 'achievements', True),
    'expLog': ('garden.json', 'expLog', True),
    'gardenPos': ('garden.json', 'positions', True),
    'notifications': ('settings.json', 'notifications', True),
    'healthOpts': ('settings.json', 'healthOptions', True),
    'archivedHabits': ('settings.json', 'archivedHabits', True),
    'calColorTags': ('settings.json', 'calendarColorTags', True),
    'calRecur': ('settings.json', 'calendarRepeats', True),
    'updatedAt': ('settings.json', 'savedAt', False),
    'todaySession': ('today.json', 'todaySession', True),
}
STATE_FILES = ('goals.json', 'collections.json', 'garden.json', 'settings.json', 'today.json')

README = """# 格蘭朵的資料

這個資料夾就是格蘭朵的全部紀錄，App（tools/local_server.py）直接讀寫這裡。
可以直接打開來看，但 App 開著時請不要手動改檔案。

## 每一天：days/YYYY-MM-DD.json
- diary：日記。highlight＝今天的亮點、reflection＝反思、gratitude＝感謝、quote＝金句
- todos：今天的待辦清單。done＝做完了沒、c＝順延過幾次、why＝順延的原因
- planForTomorrow：這天晚上排給「隔天」的計畫
- habitsDone：這天完成的習慣
- health：身體紀錄（sleep 睡眠、diet 飲食、exercise 運動、water 喝水、body 體態、dayTags 今天狀況）
- photos：照片（url 指向 media/ 裡的檔案）
- app：App 內部用的數字（經驗值、連續天數、待辦完成數、存檔時間），都算得出來，分析時可以忽略
- extra：App 送來、但還沒有對照名稱的欄位

## 其他
- goals.json：目標、階段、實驗、計畫（focus）
- collections.json：金句、我的人、收藏、支持資源、日曆備註
- garden.json：花園（經驗值、花、果實、成就、經驗值紀錄、物件位置）
- settings.json：提醒、健康選項、封存的習慣、日曆顏色與重複設定、最後存檔時間
- today.json：App 記住「今天」進行到哪的暫存（今天的勾選與待辦），正式紀錄在 days/
- media/：照片　backups/：每天自動備份（zip）　import/：從 Google Sheet 搬過來的原始資料
- config.json：日曆用的 GAS 網址與通行碼（不要分享）

## 還原
python3 tools/local_server.py --restore backups/某一天.zip（會先把目前的資料存成 before-restore 快照）
"""


def dumps(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(',', ':'))


def blank(v):
    return v is None or v == ''


def parse_json_field(v):
    """App 送來的 JSON 字串解開成清單／物件；解不開或不是清單／物件就原樣保留。"""
    if isinstance(v, str):
        try:
            obj = json.loads(v)
        except ValueError:
            return v
        return obj if isinstance(obj, (list, dict)) else v
    return v


def pack_json_field(v):
    return dumps(v) if isinstance(v, (list, dict)) else v


def day_from_entry(p):
    day = {'date': str(p.get('date', ''))[:10]}
    diary = {DAY_DIARY[k]: p[k] for k in DAY_DIARY if not blank(p.get(k))}
    if diary:
        day['diary'] = diary
    for k, name in DAY_JSON.items():
        if not blank(p.get(k)):
            day[name] = parse_json_field(p[k])
    app = {k: p[k] for k in DAY_APP if not blank(p.get(k))}
    if app:
        day['app'] = app
    extra = {k: v for k, v in p.items() if k not in DAY_DIARY and k not in DAY_JSON and k not in DAY_APP
             and k != 'date' and not blank(v)}
    if extra:
        day['extra'] = extra
    return day


def entry_from_day(day):
    out = {'date': day['date']}
    for k, name in DAY_DIARY.items():
        if name in day.get('diary', {}):
            out[k] = day['diary'][name]
    for k, name in DAY_JSON.items():
        if name in day:
            out[k] = pack_json_field(day[name])
    out.update(day.get('app', {}))
    out.update(day.get('extra', {}))
    return out


def files_from_state(p):
    files = {f: {} for f in STATE_FILES}
    extra = {}
    for k, v in p.items():
        if blank(v):
            continue
        if k in STATE_MAP:
            f, name, is_json = STATE_MAP[k]
            files[f][name] = parse_json_field(v) if is_json else v
        else:
            extra[k] = v
    if extra:
        files['settings.json']['extra'] = extra
    return files


def state_from_files(files):
    out = {}
    for k, (f, name, is_json) in STATE_MAP.items():
        if name in files.get(f, {}):
            v = files[f][name]
            out[k] = pack_json_field(v) if is_json else v
    out.update(files.get('settings.json', {}).get('extra', {}))
    return out


# ── App 收到資料後實際用的樣子（照 index.html 的 loadCloud），核對時用 ─────
def num(v):
    if isinstance(v, bool):
        return int(v)
    if isinstance(v, (int, float)):
        return 0 if v != v else v
    try:
        n = float(str(v).strip() or 0)
        return 0 if n != n else n
    except ValueError:
        return 0


def parse_j(v, fb):
    if blank(v):
        return fb
    if not isinstance(v, str):
        return v
    try:
        return json.loads(v)
    except ValueError:
        return fb


def app_entry(row):
    return {'date': str(row.get('date', ''))[:10], 'checked': parse_j(row.get('checked'), []),
            'diary': {k: row.get(k) or '' for k in DAY_DIARY},
            'tdl': parse_j(row.get('tdl'), []), 'tdlItems': parse_j(row.get('tdlItems'), None),
            'photos': parse_j(row.get('photos'), []), 'health': parse_j(row.get('health'), None),
            **{k: num(row.get(k)) for k in DAY_APP}}


def app_state(d):
    return {k: (parse_j(d.get(k), None) if STATE_MAP[k][2] else (None if blank(d.get(k)) else d.get(k)))
            for k in STATE_MAP}


# ── 資料夾 ─────────────────────────────────────────────
def in_git_repo(p):
    p = p.resolve()
    return any((d / '.git').exists() for d in [p, *p.parents])


def stamp():
    return datetime.datetime.now().strftime('%Y-%m-%d_%H%M%S')


class Store:
    def __init__(self, root):
        self.root = pathlib.Path(root).expanduser().resolve()
        if in_git_repo(self.root):
            raise SystemExit(f'資料夾在 git repo 裡面，拒絕使用（個人資料不能進 repo）：{self.root}')
        self.days = self.root / 'days'
        self.media = self.root / 'media'
        self.backups = self.root / 'backups'
        for d in (self.root, self.days, self.media, self.backups):
            d.mkdir(parents=True, exist_ok=True)
            os.chmod(d, 0o700)
        if not (self.root / 'README.md').exists():
            (self.root / 'README.md').write_text(README, encoding='utf-8')

    def config(self):
        try:
            return json.loads((self.root / 'config.json').read_text(encoding='utf-8'))
        except (OSError, ValueError):
            return {}

    def read_json(self, path, fallback=None):
        try:
            return json.loads(path.read_text(encoding='utf-8'))
        except FileNotFoundError:
            return fallback

    # 暫存檔 → fsync → 改名，斷電也不會留下寫一半的檔。多個檔一起寫時，全部寫好才一起改名
    def write_files(self, items):
        done = []
        try:
            for path, obj in items:
                fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix='.tmp-')
                done.append((tmp, path))
                with os.fdopen(fd, 'w', encoding='utf-8') as f:
                    json.dump(obj, f, ensure_ascii=False, indent=1)
                    f.flush()
                    os.fsync(f.fileno())
                os.chmod(tmp, 0o600)
        except BaseException:
            for tmp, _ in done:
                if os.path.exists(tmp):
                    os.unlink(tmp)
            raise
        for tmp, path in done:
            os.replace(tmp, path)

    def write_json(self, path, obj):
        self.write_files([(path, obj)])

    def day_path(self, ds):
        return self.days / (ds + '.json')

    def has_data(self):
        return any((self.root / f).exists() for f in STATE_FILES) or any(self.days.glob('*.json'))

    def data_files(self):
        return [*(self.root / f for f in STATE_FILES), *sorted(self.days.glob('*.json')), *sorted(self.media.iterdir())]

    def snapshot(self, name):
        path = self.backups / name
        tmp = path.with_name('.tmp-' + path.name)
        with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as z:
            for f in self.data_files():
                if f.is_file() and not f.name.startswith('.'):
                    z.write(f, f.relative_to(self.root).as_posix())
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
        return path

    # 每天第一次寫入前備份一次，只留最近 KEEP_BACKUPS 天（其他快照不會被清）
    def daily_backup(self):
        name = datetime.date.today().isoformat() + '.zip'
        if (self.backups / name).exists() or not self.has_data():
            return
        self.snapshot(name)
        daily = sorted(p for p in self.backups.glob('*.zip') if re.match(r'^\d{4}-\d{2}-\d{2}\.zip$', p.name))
        for old in daily[:-KEEP_BACKUPS]:
            old.unlink()

    def clear(self):
        for f in STATE_FILES:
            (self.root / f).unlink(missing_ok=True)
        for f in self.days.glob('*.json'):
            f.unlink()

    def restore(self, zip_path):
        ok = re.compile(r'^(%s|days/\d{4}-\d{2}-\d{2}\.json|media/[^/]+)$' % '|'.join(map(re.escape, STATE_FILES)))
        with zipfile.ZipFile(pathlib.Path(zip_path).resolve()) as z:
            names = z.namelist()
            bad = [n for n in names if not ok.match(n)]
            if bad:
                raise SystemExit(f'備份檔裡有不認得的檔案，不還原：{bad[:3]}')
            with LOCK:
                before = self.snapshot('before-restore-' + stamp() + '.zip')
                self.clear()
                for n in names:
                    data = z.read(n)
                    if n.endswith('.json'):
                        self.write_json(self.root / n, json.loads(data.decode('utf-8')))
                    else:
                        (self.root / n).write_bytes(data)
        return before

    # ── 讀寫（App 的形狀進出）──
    def get_state(self):
        files = {f: self.read_json(self.root / f, {}) for f in STATE_FILES}
        return state_from_files(files) if any(files.values()) else {}

    def get_entries(self):
        return [entry_from_day(self.read_json(f)) for f in sorted(self.days.glob('*.json'))]

    def put_state(self, p):
        files = files_from_state(p)
        self.write_files([(self.root / f, files[f]) for f in STATE_FILES])

    def put_entry(self, p):
        day = day_from_entry(p)
        self.write_json(self.day_path(day['date']), day)


# ── 跟 GAS 一樣的資料動作 ──────────────────────────────
def js_falsy(v):
    return v is None or v is False or v == '' or (isinstance(v, (int, float)) and not isinstance(v, bool) and v == 0)


# 跟 GAS 的 mergeWind_ 一樣：睡前兩個時間點各自比時間戳，舊裝置送來的資料不會把新的吃掉
def merge_wind(a, b):
    if js_falsy(a):
        return b
    if js_falsy(b):
        return a
    newer = b if num(b.get('updatedAt')) >= num(a.get('updatedAt')) else a
    out = dict(newer)
    out['fieldUpdatedAt'] = {}
    for key in ('phoneAwayAt', 'inBedAt', 'obstacle'):
        def st(x):
            f = x.get('fieldUpdatedAt')
            if isinstance(f, dict) and f.get(key) is not None:
                return f[key]
            return num(x.get('updatedAt')) if key in x else -1
        sa, sb = st(a), st(b)
        winner = b if sb >= sa else a
        if key in winner:
            out[key] = winner[key]
        else:
            out.pop(key, None)
        if max(sa, sb) >= 0:
            out['fieldUpdatedAt'][key] = max(sa, sb)
    return out


def save_state(store, p):
    cur = store.get_state()
    # 多裝置防護（樂觀鎖）：本機版本比送來的基準新 → 拒絕覆蓋，App 會重拉再推
    if 'baseUpdatedAt' in p and cur and num(cur.get('updatedAt')) > num(p.get('baseUpdatedAt')):
        return 'conflict'
    new = {k: v for k, v in p.items() if k != 'baseUpdatedAt'}
    # 舊版 App 不送 focus 時保留原本的
    if 'focus' not in p and 'focus' in cur:
        new['focus'] = cur['focus']
    store.daily_backup()
    store.put_state(new)
    return True


def save_entry(store, p):
    ds = str(p.get('date', ''))[:10]
    if not DATE_RE.match(ds):
        raise ValueError('bad date')
    p = dict(p, date=ds)
    old = store.read_json(store.day_path(ds))
    if old is not None and 'health' in p:
        old_h = old.get('health') or {}
        try:
            if isinstance(old_h, str):
                old_h = json.loads(old_h or '{}')
            inc = p['health']
            inc = json.loads(inc or '{}') if isinstance(inc, str) else (inc or {})
        except ValueError:
            raise ValueError('invalid health JSON')
        a = old_h.get('sleep', {}).get('windDown') if isinstance(old_h.get('sleep'), dict) else None
        b = inc.get('sleep', {}).get('windDown') if isinstance(inc.get('sleep'), dict) else None
        wind = merge_wind(a, b)
        if not js_falsy(wind):
            if not isinstance(inc.get('sleep'), dict):
                inc['sleep'] = {}
            inc['sleep']['windDown'] = wind
            p['health'] = dumps(inc)
    store.daily_backup()
    store.put_entry(p)
    return True


def upload_image(store, p):
    if not p or not p.get('data'):
        raise ValueError('no image data')
    raw = base64.b64decode(p['data'])
    ext = '.png' if p.get('mimeType') == 'image/png' else '.jpg'
    base = re.sub(r'[\\/:*?"<>|\x00-\x1f]', '_', pathlib.Path(str(p.get('filename') or 'image')).stem)[:60] or 'image'
    name = f'{stamp()}_{base}{ext}'
    (store.media / name).write_bytes(raw)
    return 'media/' + urllib.parse.quote(name)


def clear_all(store):
    store.snapshot('before-clearAll-' + stamp() + '.zip')
    store.clear()
    return True


def call_gas(store, action, params, body):
    cfg = store.config()
    url = cfg.get('gas_url')
    if not url:
        return {'ok': False, 'error': 'calendar-not-configured'}
    q = [('action', action)] + [(k, v) for k, v in params if k not in ('action', 'code')]
    if cfg.get('gas_code'):
        q.append(('code', cfg['gas_code']))
    req = urllib.request.Request(url + '?' + urllib.parse.urlencode(q), data=body,
                                 headers={'Content-Type': 'text/plain'} if body is not None else {})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode('utf-8'))
    except Exception:
        return {'ok': False, 'error': 'calendar-unreachable'}


# ── HTTP ─────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    store = None
    port = DEFAULT_PORT

    def log_message(self, fmt, *args):
        pass

    def allowed_hosts(self):
        return {f'127.0.0.1:{self.port}', f'localhost:{self.port}'}

    # 擋 DNS rebinding（Host 不對）與別的網站代發的寫入（Origin 不對）
    def guard(self, write):
        if self.headers.get('Host', '') not in self.allowed_hosts():
            return False
        origin = self.headers.get('Origin')
        if origin is not None and origin not in {'http://' + h for h in self.allowed_hosts()}:
            return False
        if write and self.headers.get('Sec-Fetch-Site') not in (None, 'same-origin', 'none'):
            return False
        return True

    def send(self, code, body, ctype):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, obj):
        self.send(200, json.dumps(obj, ensure_ascii=False).encode('utf-8'), 'application/json; charset=utf-8')

    def do_GET(self):
        if not self.guard(False):
            return self.send(403, b'forbidden', 'text/plain')
        u = urllib.parse.urlsplit(self.path)
        if u.path == '/api':
            params = urllib.parse.parse_qsl(u.query, keep_blank_values=True)
            action = dict(params).get('action', '').strip()
            if action == 'ping':
                return self.send_json({'ok': True, 'ver': VER})
            if action == 'getState':
                return self.send_json({'ok': True, 'role': 'owner', 'focusVersion': 1, 'data': self.store.get_state()})
            if action == 'getEntries':
                return self.send_json({'ok': True, 'role': 'owner', 'data': self.store.get_entries()})
            if action in CAL_ACTIONS:
                return self.send_json(call_gas(self.store, action, params, None))
            return self.send_json({'ok': False, 'error': 'unknown action: ' + action})
        return self.serve_file(urllib.parse.unquote(u.path))

    def do_POST(self):
        if not self.guard(True):
            return self.send(403, b'forbidden', 'text/plain')
        u = urllib.parse.urlsplit(self.path)
        if u.path != '/api':
            return self.send(404, b'not found', 'text/plain')
        params = urllib.parse.parse_qsl(u.query, keep_blank_values=True)
        action = dict(params).get('action', '').strip()
        n = int(self.headers.get('Content-Length') or 0)
        if n > MAX_BODY:
            return self.send(413, b'too large', 'text/plain')
        body = self.rfile.read(n)
        if action in CAL_ACTIONS:
            return self.send_json(call_gas(self.store, action, params, body))
        try:
            p = json.loads(body.decode('utf-8') or '{}')
            with LOCK:
                if action == 'saveEntry':
                    return self.send_json({'ok': save_entry(self.store, p)})
                if action == 'saveState':
                    r = save_state(self.store, p)
                    return self.send_json({'ok': False, 'conflict': True} if r == 'conflict' else {'ok': r, 'focusVersion': 1})
                if action == 'uploadImage':
                    return self.send_json({'ok': True, 'url': upload_image(self.store, p)})
                if action == 'clearAll':
                    return self.send_json({'ok': clear_all(self.store)})
            return self.send_json({'ok': False, 'error': 'unknown action: ' + action})
        except Exception as e:
            return self.send_json({'ok': False, 'error': str(e)})

    # 只提供 App 需要的檔案；repo 裡其他東西（部署檔、說明、.git）一律不給
    def serve_file(self, path):
        rel = path.lstrip('/') or 'index.html'
        parts = rel.split('/')
        if any(not x or x.startswith('.') or x == '..' for x in parts):
            return self.send(404, b'not found', 'text/plain')
        ext = os.path.splitext(rel)[1].lower()
        if parts[0] == 'media' and len(parts) == 2 and ext in IMAGE_TYPES:
            f = self.store.media / parts[1]
        elif rel in STATIC_FILES or (ext in IMAGE_TYPES and (len(parts) == 1 or (len(parts) == 2 and parts[0] == 'pic'))):
            f = APP_ROOT / rel
        else:
            return self.send(404, b'not found', 'text/plain')
        if not f.is_file():
            return self.send(404, b'not found', 'text/plain')
        body = f.read_bytes()
        if rel == 'index.html':
            body = body.replace(b'<head>', b'<head>' + LOCAL_FLAG, 1)
        self.send(200, body, IMAGE_TYPES.get(ext) or TEXT_TYPES.get(ext, 'application/octet-stream'))


def make_server(data, port):
    store = Store(data)
    handler = type('H', (Handler,), {'store': store, 'port': port})
    return ThreadingHTTPServer(('127.0.0.1', port), handler), store


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--data', default=os.environ.get('GRANDOL_DATA', str(DEFAULT_DATA)))
    ap.add_argument('--port', type=int, default=DEFAULT_PORT)
    ap.add_argument('--restore', help='從備份 zip 還原（會先把目前的資料存成 before-restore 快照）')
    a = ap.parse_args()
    if a.restore:
        before = Store(a.data).restore(a.restore)
        print(f'已還原。還原前的資料存在：{before}')
        return
    srv, store = make_server(a.data, a.port)
    print(f'格蘭朵本機版：http://127.0.0.1:{a.port}/   資料：{store.root}', flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
