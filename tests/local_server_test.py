#!/usr/bin/env python3
"""tools/local_server.py 的測試：只用暫存資料夾和假的 GAS，不碰真實資料。

  python3 tests/local_server_test.py
"""
import json, pathlib, re, sys, tempfile, threading, unittest, urllib.error, urllib.parse, urllib.request, zipfile
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
import local_server as LS  # noqa: E402


class FakeGAS(BaseHTTPRequestHandler):
    """像 GAS：POST 先 302 轉址，再用 GET 拿結果；回傳收到的 action、code 和內容。"""
    seen = []

    def log_message(self, *a):
        pass

    def reply(self, body=b''):
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(self.path).query))
        FakeGAS.seen.append((self.command, q, body))
        out = json.dumps({'ok': True, 'action': q.get('action'), 'code': q.get('code'), 'start': q.get('start')}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def do_GET(self):
        self.reply()

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length') or 0))
        FakeGAS.seen.append(('POST', {}, body))
        self.send_response(302)
        self.send_header('Location', self.path)
        self.send_header('Content-Length', '0')
        self.end_headers()


class LocalServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.data = pathlib.Path(cls.tmp.name) / 'data'
        cls.gas = ThreadingHTTPServer(('127.0.0.1', 0), FakeGAS)
        threading.Thread(target=cls.gas.serve_forever, daemon=True).start()
        cls.srv, cls.store = LS.make_server(cls.data, 0)
        cls.port = cls.srv.server_address[1]
        cls.srv.RequestHandlerClass.port = cls.port
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = f'http://127.0.0.1:{cls.port}'

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.gas.shutdown()
        cls.tmp.cleanup()

    def req(self, path, body=None, headers=None):
        h = {'Origin': self.base} if body is not None else {}
        h.update(headers or {})
        data = json.dumps(body).encode() if isinstance(body, dict) else body
        r = urllib.request.Request(self.base + path, data=data, headers=h)
        try:
            with urllib.request.urlopen(r, timeout=10) as res:
                return res.status, res.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()

    def api(self, action, body=None, **headers):
        code, raw = self.req('/api?action=' + action, body, headers)
        self.assertEqual(code, 200, raw)
        return json.loads(raw)

    def clear_state(self):
        for f in LS.STATE_FILES:
            (self.data / f).unlink(missing_ok=True)

    # ── 資料 ──
    def test_state_round_trip_matches_gas_shape(self):
        self.clear_state()
        payload = {'updatedAt': 100, 'baseUpdatedAt': 0, 'flowers': '[{"d":"2026-11-01"}]', 'streak': 3,
                   'lastPlant': '2026-11-01', 'focus': '{"version":1,"projects":[]}', 'quotes': '[]'}
        self.assertEqual(self.api('saveState', payload), {'ok': True, 'focusVersion': 1})
        st = self.api('getState')
        self.assertEqual((st['role'], st['focusVersion']), ('owner', 1))
        want = dict(payload)
        del want['baseUpdatedAt']
        self.assertEqual(st['data'], want)
        # 檔案裡是解開的，人讀得懂
        garden = json.loads((self.data / 'garden.json').read_text(encoding='utf-8'))
        self.assertEqual(garden['flowers'], [{'d': '2026-11-01'}])
        goals = json.loads((self.data / 'goals.json').read_text(encoding='utf-8'))
        self.assertEqual(goals['focus'], {'version': 1, 'projects': []})

    def test_state_conflict_and_focus_kept(self):
        self.clear_state()
        self.api('saveState', {'updatedAt': 200, 'baseUpdatedAt': 0, 'focus': '{"version":1}'})
        self.assertEqual(self.api('saveState', {'updatedAt': 300, 'baseUpdatedAt': 150, 'focus': '{}'}),
                         {'ok': False, 'conflict': True})
        self.api('saveState', {'updatedAt': 400, 'baseUpdatedAt': 200})
        self.assertEqual(self.api('getState')['data']['focus'], '{"version":1}')

    def test_entry_round_trip_and_diary_text_untouched(self):
        e = {'date': '2026-10-02T00:00:00', 'checked': ['a'], 'hl': '[1, 2] 像 JSON 的日記', 'rf': '{x}',
             'tdl': [], 'exp': 5, 'photos': [], 'health': '{"sleep":{}}', 'savedAt': 1}
        self.assertEqual(self.api('saveEntry', e), {'ok': True})
        got = [x for x in self.api('getEntries')['data'] if x['date'] == '2026-10-02'][0]
        self.assertEqual(got['hl'], '[1, 2] 像 JSON 的日記')
        self.assertEqual(got['rf'], '{x}')
        self.assertEqual(got['health'], '{"sleep":{}}')
        self.assertEqual(json.loads(got['checked']), ['a'])
        day = json.loads((self.data / 'days' / '2026-10-02.json').read_text(encoding='utf-8'))
        self.assertEqual(day['diary']['highlight'], '[1, 2] 像 JSON 的日記')
        self.assertEqual((day['habitsDone'], day['health'], day['app']['exp']), (['a'], {'sleep': {}}, 5))
        self.assertEqual(LS.app_entry(got), LS.app_entry(dict(e, date='2026-10-02')))

    def test_unknown_fields_are_kept(self):
        self.api('saveEntry', {'date': '2026-10-03', 'newThing': {'x': 1}})
        got = [x for x in self.api('getEntries')['data'] if x['date'] == '2026-10-03'][0]
        self.assertEqual(got['newThing'], {'x': 1})
        self.clear_state()
        self.api('saveState', {'updatedAt': 1, 'baseUpdatedAt': 0, 'newSetting': 'y', 'gardenPos': ''})
        self.assertEqual(self.api('getState')['data'], {'updatedAt': 1, 'newSetting': 'y'})

    def test_every_field_the_app_sends_has_a_name(self):
        html = (ROOT / 'index.html').read_text(encoding='utf-8')
        a = html.index("gasPost('saveState',{")
        seg = html[a:html.index('},opts);', a)]
        seg = seg[:seg.index('todaySession:')] + seg[seg.index('expLog:'):]
        sent = set(re.findall(r'(\w+):', seg)) - {'saveState', 'baseUpdatedAt'}
        self.assertEqual(sent - set(LS.STATE_MAP), set())
        a = html.index('function entryPayload')
        sent = set(re.findall(r'(\w+):', html[a:html.index('savedAt', a)])) | {'savedAt'}
        self.assertEqual(sent - set(LS.DAY_DIARY) - set(LS.DAY_JSON) - set(LS.DAY_APP) - {'date'}, set())

    def test_entry_keeps_sleep_events_from_both_devices(self):
        h1 = {'sleep': {'windDown': {'phoneAwayAt': '2026-09-28T17:30:00Z', 'updatedAt': 1}}}
        h2 = {'sleep': {'windDown': {'inBedAt': '2026-09-28T18:00:00Z', 'updatedAt': 2}}}
        self.api('saveEntry', {'date': '2026-09-28', 'health': json.dumps(h1)})
        self.api('saveEntry', {'date': '2026-09-28', 'health': json.dumps(h2)})
        got = [x for x in self.api('getEntries')['data'] if x['date'] == '2026-09-28'][0]
        w = json.loads(got['health'])['sleep']['windDown']
        self.assertEqual((w['phoneAwayAt'], w['inBedAt']), ('2026-09-28T17:30:00Z', '2026-09-28T18:00:00Z'))
        # 舊版裝置沒送睡前事件也不會清掉
        self.api('saveEntry', {'date': '2026-09-28', 'health': '{"sleep":{}}'})
        got = [x for x in self.api('getEntries')['data'] if x['date'] == '2026-09-28'][0]
        self.assertIn('inBedAt', json.loads(got['health'])['sleep']['windDown'])

    def test_bad_date_rejected(self):
        self.assertFalse(self.api('saveEntry', {'date': '../../x'})['ok'])
        self.assertFalse(any(self.data.parent.glob('x*')))

    def test_upload_and_serve_image(self):
        r = self.api('uploadImage', {'data': 'aGVsbG8=', 'filename': '../早餐.jpg', 'mimeType': 'image/jpeg'})
        self.assertTrue(r['ok'] and r['url'].startswith('media/'))
        code, body = self.req('/' + r['url'])
        self.assertEqual((code, body), (200, b'hello'))

    def test_daily_backup_and_restore(self):
        self.api('saveEntry', {'date': '2026-08-01', 'hl': 'before'})
        self.api('saveEntry', {'date': '2026-08-01', 'hl': 'after'})
        backups = list((self.data / 'backups').glob('20*.zip'))
        self.assertEqual(len(backups), 1)
        snap = self.store.snapshot('manual.zip')
        self.api('saveEntry', {'date': '2026-08-01', 'hl': 'later'})
        before = self.store.restore(snap)
        got = [x for x in self.api('getEntries')['data'] if x['date'] == '2026-08-01'][0]
        self.assertEqual(got['hl'], 'after')
        with zipfile.ZipFile(before) as z:
            self.assertIn('days/2026-08-01.json', z.namelist())

    # ── 日曆轉給 GAS ──
    def test_calendar_proxy_adds_code_and_follows_redirect(self):
        (self.data / 'config.json').write_text(json.dumps(
            {'gas_url': f'http://127.0.0.1:{self.gas.server_address[1]}/exec', 'gas_code': 'fake-code'}))
        try:
            r = self.api('getCalEvents&start=2026-11-01&end=2026-11-30&code=ignored')
            self.assertEqual((r['action'], r['code'], r['start']), ('getCalEvents', 'fake-code', '2026-11-01'))
            r = self.api('addCalEvent', {'title': 't'})
            self.assertEqual((r['ok'], r['action'], r['code']), (True, 'addCalEvent', 'fake-code'))
            self.assertIn(('POST', {}, b'{"title": "t"}'), FakeGAS.seen)
        finally:
            (self.data / 'config.json').unlink()
        self.assertEqual(self.api('getCalEvents')['error'], 'calendar-not-configured')

    # ── 安全 ──
    def test_only_app_files_are_served(self):
        self.assertEqual(self.req('/sw.js')[0], 200)
        code, body = self.req('/')
        self.assertEqual(code, 200)
        self.assertIn(b'<head><script>window.GRANDOL_LOCAL=1</script>', body)
        for p in ('/部署用_貼我到AppsScript.txt', '/.git/config', '/tools/local_server.py', '/grandol_spec.md',
                  '/template/index.html', '/../x.png', '/media/../state.json', '/forest-template-2.0.zip'):
            self.assertEqual(self.req(urllib.parse.quote(p))[0], 404, p)

    def test_cross_site_requests_blocked(self):
        self.assertEqual(self.req('/api?action=clearAll', {}, {'Origin': 'https://evil.example'})[0], 403)
        self.assertEqual(self.req('/api?action=clearAll', {}, {'Sec-Fetch-Site': 'cross-site'})[0], 403)
        self.assertEqual(self.req('/api?action=getState', None, {'Host': 'evil.example:80'})[0], 403)

    def test_refuses_data_inside_git_repo(self):
        with self.assertRaises(SystemExit):
            LS.Store(ROOT / 'scratchpad' / 'never-created')


if __name__ == '__main__':
    unittest.main(verbosity=1)
