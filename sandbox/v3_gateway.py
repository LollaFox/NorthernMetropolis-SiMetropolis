"""Fixed-route local gateway. Team routes are a proposal until backend agreement.

V3_BACKEND_URL is set by the operator, never accepted from a browser request.
Only the fixed Open Topo Data endpoint is exposed as a public source check.
"""
from __future__ import annotations
import json
import math
import os
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, parse_qs, urlencode
from urllib.request import Request, build_opener, HTTPRedirectHandler

MAX_UPLOAD = 21 * 1024 * 1024
MAX_RESPONSE = 48 * 1024 * 1024
ROUTES = {
    'POST': re.compile(r'^/(initializations|initializations/[A-Za-z0-9_-]{1,100}/confirm|simulations)$'),
    'GET': re.compile(r'^/(jobs/[A-Za-z0-9_-]{1,100}|simulations/[A-Za-z0-9_-]{1,100}/snapshots/[A-Za-z0-9_-]{1,100})$'),
}

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def backend_base():
    value = os.environ.get('V3_BACKEND_URL', '').rstrip('/')
    if value:
        u = urlsplit(value)
        if u.scheme not in ('http', 'https') or not u.hostname or u.username or u.password or u.query or u.fragment:
            raise ValueError('V3_BACKEND_URL must be an HTTP(S) base URL without credentials, query or fragment')
    return value

def fetch_json(url, body=None, headers=None, timeout=25):
    request = Request(url, data=body, headers=headers or {}, method='GET' if body is None else 'POST')
    try:
        response = build_opener(NoRedirect).open(request, timeout=timeout)
    except HTTPError as exc:
        response = exc
    with response:
        payload = response.read(MAX_RESPONSE + 1)
        if len(payload) > MAX_RESPONSE:
            raise ValueError('Upstream response exceeds the 48 MB preview limit; split snapshots or use binary assets.')
        if 'application/json' not in response.headers.get('Content-Type', ''):
            raise ValueError('Upstream must return JSON; redirects are not followed.')
        result = json.loads(payload)
        return response.status, result

def handle(handler):
    path = urlsplit(handler.path).path.removeprefix('/api/v3')
    method = handler.command
    try:
        base = backend_base()
        if method == 'GET' and path == '/config':
            handler._json(200, {'schema': 'nm-v3-draft-1', 'backendConfigured': bool(base),
                               'transport': 'proposed-team-contract',
                               'tileURL': 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'})
            return
        if method == 'GET' and path == '/sources/elevation':
            params = parse_qs(urlsplit(handler.path).query)
            lat, lon = float(params['lat'][0]), float(params['lon'][0])
            if not math.isfinite(lat) or not math.isfinite(lon) or not 22.1 <= lat <= 22.9 or not 113.7 <= lon <= 114.7:
                raise ValueError('Point is outside the Hong Kong–Shenzhen preview extent.')
            status, data = fetch_json('https://api.opentopodata.org/v1/srtm90m?' + urlencode({'locations': f'{lat:.6f},{lon:.6f}'}),
                                      headers={'User-Agent': 'NorthernMetropolisResearchPreview/0.1 (local source verification)', 'Accept': 'application/json'})
            handler._json(status, {'source': 'Open Topo Data / SRTM90m', 'sourceURL': 'https://www.opentopodata.org/datasets/srtm/',
                                   'note': 'Single historical terrain sample, not a 1000×1000 grid or a policy outcome.', 'data': data})
            return
        if method not in ROUTES or not ROUTES[method].fullmatch(path):
            handler._json(404, {'error': 'Unsupported V3 route.'})
            return
        if not base:
            handler._json(503, {'error': 'Team simulation backend is not configured. Select Contract fixture for a clearly labelled test.'})
            return
        body = None
        headers = {'Accept': 'application/json'}
        if method == 'POST':
            length = int(handler.headers.get('Content-Length', '-1'))
            if not 0 < length <= MAX_UPLOAD:
                raise ValueError('Upload exceeds the preview request limit or has no Content-Length.')
            content_type = handler.headers.get('Content-Type', '')
            expected = 'multipart/form-data' if path == '/initializations' else 'application/json'
            if content_type.split(';', 1)[0] != expected:
                raise ValueError('Unexpected request content type.')
            if expected == 'multipart/form-data' and 'boundary=' not in content_type:
                raise ValueError('Multipart upload is missing its boundary.')
            key = handler.headers.get('Idempotency-Key', '')
            if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', key):
                raise ValueError('A valid Idempotency-Key is required.')
            body = handler.rfile.read(length)
            if len(body) != length:
                raise ValueError('Incomplete request body.')
            headers.update({'Content-Type': content_type, 'Idempotency-Key': key})
        token = os.environ.get('V3_BACKEND_TOKEN')
        if token:
            headers['Authorization'] = 'Bearer ' + token
        status, data = fetch_json(base + path, body, headers)
        if not 200 <= status < 300:
            # Do not expose internal stack traces or upstream credentials to the UI.
            data = {'error': f'Team backend returned HTTP {status}. Check its request/schema and server logs.'}
        handler._json(status, data)
    except (ValueError, KeyError, IndexError) as exc:
        handler._json(400, {'error': str(exc) if isinstance(exc, ValueError) else 'Missing source coordinates.'})
    except (TimeoutError, URLError, OSError):
        handler._json(502, {'error': 'Upstream unavailable or timed out. No synthetic result was substituted.'})
