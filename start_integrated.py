"""Start the integrated original frontend and offline narrative backend."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8893)
    parser.add_argument('--check', action='store_true', help='Check the running service without starting or changing it')
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error('port must be 1–65535')
    if sys.version_info < (3, 9):
        parser.error('Python 3.9 or newer is required')
    address = 'http://127.0.0.1:%d/' % args.port
    # Never use an environment proxy for a local status check.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    running = False
    try:
        with opener.open(address + 'api/v3/config', timeout=3) as response:
            config = json.load(response)
        running = True
        if config.get('transport') != 'local-narrative-scenario':
            print('Port %d is serving another application. Stop it or choose --port.' % args.port)
            return 1
    except urllib.error.HTTPError:
        print('Port %d is already serving another application.' % args.port)
        return 1
    except urllib.error.URLError:
        pass
    except (ValueError, OSError):
        print('A service answered on port %d but did not return the expected backend config.' % args.port)
        return 1
    if running:
        print('Integrated backend is already running: ' + address)
        print('Refresh the existing browser tab. No second server was started.')
        return 0
    if args.check:
        print('No integrated backend is responding at ' + address)
        return 1
    folder = 'integrated-offline' if args.port == 8893 else 'integrated-offline-%d' % args.port
    command = [sys.executable, '-B', '-m', 'backend.server', '--port', str(args.port),
               '--preset', 'northern-metropolis', '--provider', 'offline',
               '--data-dir', str(ROOT / 'backend' / '.data' / folder)]
    print('Opening the original frontend with backend v0.1.0. Offline synthetic scenario; no API key needed.', flush=True)
    print('Preview: ' + address + ' · stop with Ctrl+C', flush=True)
    try:
        return subprocess.call(command, cwd=str(ROOT))
    except KeyboardInterrupt:
        return 0


if __name__ == '__main__':
    raise SystemExit(main())
