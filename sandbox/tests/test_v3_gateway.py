import io
import json
import os
import unittest
from unittest.mock import patch
from sandbox import v3_gateway as gateway

class FakeHandler:
 def __init__(self,path,method='GET',body=b'',headers=None):
  self.path=path;self.command=method;self.rfile=io.BytesIO(body);self.headers={'Content-Length':str(len(body)),**(headers or {})};self.result=None
 def _json(self,status,value): self.result=(status,value)

class GatewayTests(unittest.TestCase):
 def setUp(self):
  self.env=patch.dict(os.environ,{'V3_BACKEND_URL':'','V3_BACKEND_TOKEN':''});self.env.start()
 def tearDown(self): self.env.stop()
 def test_config_never_exposes_token(self):
  os.environ['V3_BACKEND_TOKEN']='test-private-token';h=FakeHandler('/api/v3/config');gateway.handle(h)
  self.assertFalse(h.result[1]['backendConfigured']);self.assertNotIn('test-private-token',json.dumps(h.result))
 def test_unconfigured_does_not_silently_mock(self):
  h=FakeHandler('/api/v3/simulations','POST');gateway.handle(h);self.assertEqual(h.result[0],503)
 def test_allowlisted_routes_only(self):
  for path in ['/api/v3/../../secret','/api/v3/http://example.com','/api/v3/simulations/x/snapshots/a%2fb']:
   h=FakeHandler(path);gateway.handle(h);self.assertEqual(h.result[0],404)
 def test_multipart_pdf_forwarded_unchanged_with_key(self):
  os.environ['V3_BACKEND_URL']='http://127.0.0.1:9999/v3';body=b'--test\r\n%PDF-1.4\r\n--test--'
  h=FakeHandler('/api/v3/initializations','POST',body,{'Content-Type':'multipart/form-data; boundary=test','Idempotency-Key':'k1'})
  with patch.object(gateway,'fetch_json',return_value=(200,{'initializationId':'i'})) as fetch:
   gateway.handle(h);args=fetch.call_args.args;self.assertEqual(args[0],'http://127.0.0.1:9999/v3/initializations');self.assertEqual(args[1],body);self.assertEqual(args[2]['Idempotency-Key'],'k1')
  self.assertEqual(h.result[0],200)
 def test_wrong_content_type_missing_key_and_oversized_requests(self):
  os.environ['V3_BACKEND_URL']='http://127.0.0.1:9999'
  for headers in [{'Content-Type':'text/plain','Idempotency-Key':'k'},{'Content-Type':'application/json'},{'Content-Type':'application/json','Idempotency-Key':'k','Content-Length':str(gateway.MAX_UPLOAD+1)}]:
   h=FakeHandler('/api/v3/simulations','POST',b'{}',headers);gateway.handle(h);self.assertEqual(h.result[0],400)
 def test_no_redirect_or_user_selected_proxy(self):
  self.assertIsNone(gateway.NoRedirect().redirect_request(None,None,302,'',{},'https://other.example'))
  os.environ['V3_BACKEND_URL']='https://user:pass@example.org';self.assertRaises(ValueError,gateway.backend_base)
 def test_upstream_error_does_not_expose_private_message(self):
  os.environ['V3_BACKEND_URL']='http://localhost:9999'
  h=FakeHandler('/api/v3/jobs/j1')
  with patch.object(gateway,'fetch_json',return_value=(500,{'error':'secret traceback'})):gateway.handle(h)
  self.assertEqual(h.result[0],500);self.assertNotIn('secret',json.dumps(h.result))
 def test_elevation_bounds_and_fixed_provider(self):
  for params in ['lat=nan&lon=114','lat=90&lon=114','lat=22.5']:
   h=FakeHandler('/api/v3/sources/elevation?'+params);gateway.handle(h);self.assertEqual(h.result[0],400)
  h=FakeHandler('/api/v3/sources/elevation?lat=22.525&lon=114.075')
  with patch.object(gateway,'fetch_json',return_value=(200,{'status':'OK'})) as fetch:
   gateway.handle(h);self.assertTrue(fetch.call_args.args[0].startswith('https://api.opentopodata.org/v1/srtm90m?'));self.assertNotIn('Authorization',fetch.call_args.kwargs['headers'])
  self.assertEqual(h.result[0],200)
 def test_timeout_never_substitutes_fixture(self):
  os.environ['V3_BACKEND_URL']='http://localhost:9999'
  with patch.object(gateway,'fetch_json',side_effect=TimeoutError):
   h=FakeHandler('/api/v3/jobs/j1');gateway.handle(h)
  self.assertEqual(h.result[0],502);self.assertIn('No synthetic',h.result[1]['error'])
if __name__=='__main__':unittest.main()
