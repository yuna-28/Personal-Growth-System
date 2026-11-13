#!/usr/bin/env python3
"""格蘭朵本機伺服器：提供 App 的檔案，並用跟 GAS 一樣的 API 把資料存在這台電腦。

  python3 tools/local_server.py                       # 資料夾預設 ~/Documents/Personal-Growth-System/data
  python3 tools/local_server.py --data DIR --port 8768
  python3 tools/local_server.py --data DIR --restore DIR/backups/2026-11-13.zip

資料夾內容：state.json、entries/YYYY-MM-DD.json（一天一個）、media/（照片）、
backups/（每天第一次寫入前自動備份，留 60 份）、config.json（日曆用的 GAS 網址與通行碼）。
資料絕不寫進 git repo。只綁 127.0.0.1。只用標準庫，macOS 內建的 python3（3.9）就能跑。
"""
import argparse, base64, datetime, json, os, pathlib, re, sys, tempfile, threading
import urllib.parse, urllib.request, zipfile
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

APP_ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_DATA = pathlib.Path.home() / 'Documents' / 'Personal-Growth-System' / 'data'
DEFAULT_PORT = 8768
LOCAL_FLAG = b'<script>window.GRANDOL_LOCAL=1</script>'
VER = 'local-1'
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


# ── 資料夾 ─────────────────────────────────────────────
def in_git_repo(p):
    p = p.resolve()
    return any((d / '.git').exists() for d in [p, *p.parents])


class Store:
    def __init__(self, root):
        self.root = pathlib.Path(root).expanduser().resolve()
        if in_git_repo(self.root):
            raise SystemExit(f'資料夾在 git repo 裡面，拒絕使用（個人資料不能進 repo）：{self.root}')
        for d in (self.root, self.root / 'entries', self.root / 'media', self.root / 'backups'):
            d.mkdir(parents=True, exist_ok=True)
            os.chmod(d, 0o700)
        self.state_path = self.root / 'state.json'
        self.entries = self.root / 'entries'
        self.media = self.root / 'media'
        self.backups = self.root / 'backups'

    def config(self):
        try:
            return json.loads((self.root / 'config.json').read_text(encoding='utf-8'))
        except (OSError, ValueError):
            return {}

    # 每次寫入：暫存檔 → fsync → 改名，斷電也不會留下寫一半的檔
    def write_json(self, path, obj):
        fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix='.tmp-')
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as f:
                json.dump(obj, f, ensure_ascii=False, indent=1)
                f.flush()
                os.fsync(f.fileno())
            os.chmod(tmp, 0o600)
            os.replace(tmp, path)
        except BaseException:
            if os.path.exists(tmp):
                os.unlink(tmp)
            raise

    def read_json(self, path, fallback=None):
        try:
            return json.loads(path.read_text(encoding='utf-8'))
        except FileNotFoundError:
            return fallback

    def snapshot(self, name):
        path = self.backups / name
        tmp = path.with_name('.tmp-' + path.name)
        with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as z:
            for f in [self.state_path, *sorted(self.entries.glob('*.json')), *sorted(self.media.iterdir())]:
                if f.is_file() and not f.name.startswith('.'):
                    z.write(f, f.relative_to(self.root).as_posix())
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
        return path

    # 每天第一次寫入前備份一次，只留最近 KEEP_BACKUPS 天（手動快照不會被清）
    def daily_backup(self):
        name = datetime.date.today().isoformat() + '.zip'
        if (self.backups / name).exists():
            return
        if not self.state_path.exists() and not any(self.entries.glob('*.json')):
            return
        self.snapshot(name)
        daily = sorted(p for p in self.backups.glob('*.zip') if re.match(r'^\d{4}-\d{2}-\d{2}\.zip$', p.name))
        for old in daily[:-KEEP_BACKUPS]:
            old.unlink()

    def restore(self, zip_path):
        zip_path = pathlib.Path(zip_path).resolve()
        with zipfile.ZipFile(zip_path) as z:
            names = z.namelist()
            bad = [n for n in names if not (n == 'state.json' or re.match(r'^(entries/\d{4}-\d{2}-\d{2}\.json|media/[^/]+)$', n))]
            if bad:
                raise SystemExit(f'備份檔裡有不認得的檔案，不還原：{bad[:3]}')
            with LOCK:
                before = self.snapshot('before-restore-' + stamp() + '.zip')
                self.state_path.unlink(missing_ok=True)
                for f in self.entries.glob('*.json'):
                    f.unlink()
                for n in names:
                    target = self.root / n
                    data = z.read(n)
                    if n.endswith('.json'):
                        self.write_json(target, json.loads(data.decode('utf-8')))
                    else:
                        target.write_bytes(data)
        return before


def stamp():
    return datetime.datetime.now().strftime('%Y-%m-%d_%H%M%S')


# ── 跟 GAS 同形狀的資料動作 ─────────────────────────────
# App 送來的物件欄位是 JSON 字串。存檔時解開（人和 Claude 才讀得懂），
# 並在 _json 記下是哪些欄位；讀取時再包回字串，App 收到的跟 GAS 一模一樣。
def dumps(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(',', ':'))


def unpack(p):
    out, packed = {}, []
    for k, v in p.items():
        if isinstance(v, str) and v[:1] in '[{':
            try:
                obj = json.loads(v)
            except ValueError:
                obj = None
            # 包回去要一字不差才解開（日記剛好打了像 JSON 的字也不會被改）
            if obj is not None and dumps(obj) == v:
                out[k] = obj
                packed.append(k)
                continue
        out[k] = v
    if packed:
        out['_json'] = packed
    return out


def pack(rec):
    rec = dict(rec)
    packed = rec.pop('_json', [])
    for k in packed:
        if k in rec:
            rec[k] = dumps(rec[k])
    return rec


def num(v):
    try:
        n = float(v)
        return 0 if n != n else n
    except (TypeError, ValueError):
        return 0


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


def get_state(store):
    st = store.read_json(store.state_path, {})
    return pack(st) if st else {}


def get_entries(store):
    return [pack(store.read_json(f)) for f in sorted(store.entries.glob('*.json'))]


def save_state(store, p):
    cur = store.read_json(store.state_path, {})
    # 多裝置防護（樂觀鎖）：本機版本比送來的基準新 → 拒絕覆蓋，App 會重拉再推
    if 'baseUpdatedAt' in p and cur and num(cur.get('updatedAt')) > num(p.get('baseUpdatedAt')):
        return 'conflict'
    new = unpack({k: v for k, v in p.items() if k != 'baseUpdatedAt'})
    # 舊版 App 不送 focus 時保留原本的
    if 'focus' not in p and 'focus' in cur:
        new['focus'] = cur['focus']
        if 'focus' in cur.get('_json', []):
            new.setdefault('_json', []).append('focus')
    store.daily_backup()
    store.write_json(store.state_path, new)
    return True


def save_entry(store, p):
    ds = str(p.get('date', ''))[:10]
    if not DATE_RE.match(ds):
        raise ValueError('bad date')
    p = dict(p, date=ds)
    path = store.entries / (ds + '.json')
    old = store.read_json(path)
    if old is not None and 'health' in p:
        try:
            old_h = old.get('health') or {}
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
    store.write_json(path, unpack(p))
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
    store.state_path.unlink(missing_ok=True)
    for f in store.entries.glob('*.json'):
        f.unlink()
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

    def send(self, code, body, ctype, extra=None):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        for k, v in (extra or {}).items():
            self.send_header(k, v)
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
                return self.send_json({'ok': True, 'role': 'owner', 'focusVersion': 1, 'data': get_state(self.store)})
            if action == 'getEntries':
                return self.send_json({'ok': True, 'role': 'owner', 'data': get_entries(self.store)})
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
