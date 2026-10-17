import http.client
import json
import os
import threading
import unittest
from unittest.mock import patch
from sandbox.server import make_server
from sandbox.service import CityService
class CompactHTTPTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.env=patch.dict(os.environ,{'V3_BACKEND_URL':''});cls.env.start();cls.city=CityService(start=False);cls.server=make_server(0,cls.city)
  threading.Thread(target=cls.server.serve_forever,daemon=True).start()
 @classmethod
 def tearDownClass(cls):cls.server.shutdown();cls.server.server_close();cls.city.close();cls.env.stop()
 def request(self,path,body=None,headers=None):
  conn=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=5);conn.request('GET' if body is None else 'POST',path,body,headers or {});r=conn.getresponse();out=(r.status,r.read(),dict(r.getheaders()));conn.close();return out
 def test_original_city_and_v3_api_coexist(self):
  before=self.city.state();status,raw,_=self.request('/api/state');self.assertEqual(status,200);self.assertIn('world',json.loads(raw))
  status,raw,_=self.request('/api/v3/config');self.assertEqual(status,200);self.assertFalse(json.loads(raw)['backendConfigured'])
  status,raw,_=self.request('/api/v3/simulations',b'{}',{'Content-Type':'application/json','Idempotency-Key':'test-key'});self.assertEqual(status,503);self.assertEqual(self.city.state(),before)
 def test_original_shell_uses_compact_entry_and_has_valid_scripts(self):
  status,raw,headers=self.request('/');self.assertEqual(status,200);self.assertIn(b'analysis-start',raw);self.assertIn(b'analysis-tag-summary',raw);self.assertIn(b'./app.js',raw);self.assertNotIn(b'v3-app.js',raw);self.assertIn('tile.openstreetmap.org',headers['Content-Security-Policy'])
  for p in ['/analysis-compact.js','/analysis-compact.css','/v3-contract.js']:
   self.assertEqual(self.request(p)[0],200)
 def test_policy_scope_metadata_passes_to_proposed_api_without_changing_original_world(self):
  body=b'--test\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n{"policyScope":{"schema":"nm-policy-scope-v1","tags":["border-access"]}}\r\n--test--\r\n'
  with patch.dict(os.environ,{'V3_BACKEND_URL':'http://127.0.0.1:9999'}):
   with patch('sandbox.v3_gateway.fetch_json',return_value=(200,{'initializationId':'i','reviewVersion':'r','items':[]})) as fetch:
    self.assertEqual(self.request('/api/v3/initializations',body,{'Content-Type':'multipart/form-data; boundary=test','Idempotency-Key':'test-key'})[0],200)
    self.assertEqual(fetch.call_args.args[1],body)
if __name__=='__main__':unittest.main()
