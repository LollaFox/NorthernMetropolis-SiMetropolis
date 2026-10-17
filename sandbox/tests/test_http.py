import http.client
import json
import threading
import unittest

from sandbox.server import make_server
from sandbox.service import CityService


class HTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.city = CityService(start=False)
        cls.server = make_server(0, cls.city)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.city.close()

    def request(self, path, body=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        hs = {"Content-Type": "application/json"}
        hs.update(headers or {})
        conn.request("POST" if body is not None else "GET", path,
                     json.dumps(body) if body is not None else None, hs)
        response = conn.getresponse()
        raw = response.read()
        result = (response.status, raw, dict(response.getheaders()))
        conn.close()
        return result

    def test_http_world_control_and_error_contract(self):
        status, raw, _ = self.request("/api/state")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw)["world"]["version"], "2.0.0")
        self.assertEqual(self.request("/api/control", {"playing": False})[0], 200)
        self.assertEqual(self.request("/api/control", {"speed": 999})[0], 400)
        self.assertEqual(self.request("/api/missing")[0], 404)
        self.assertEqual(self.request("/api/model")[0], 200)

    def test_local_host_origin_and_static_path_boundaries(self):
        self.assertEqual(self.request("/api/state", headers={"Host": "evil.example"})[0], 403)
        self.assertEqual(self.request("/api/control", {"playing": True}, {"Origin": "https://evil.example"})[0], 403)
        for path in ("/../ai.py", "/%2e%2e/service.py", "/.env", "/api/../.env"):
            self.assertEqual(self.request(path)[0], 404)

    def test_export_has_history_and_no_provider_credentials(self):
        status, raw, _ = self.request("/api/export")
        self.assertEqual(status, 200)
        value = json.loads(raw)
        self.assertEqual(value["schemaVersion"], 2)
        self.assertIn("history", value["branches"][0])
        for token in (b"API_KEY", b"Authorization", b"Bearer "):
            self.assertNotIn(token, raw)

    def test_invalid_unicode_is_rejected_before_state_change(self):
        before = self.city.state()
        self.assertEqual(self.request("/api/branch", {"label": "\ud800"})[0], 400)
        self.assertEqual(self.request("/api/state")[0], 200)
        self.assertEqual(self.city.state(), before)
