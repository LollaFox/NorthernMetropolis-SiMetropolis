"""Launch the combined frontend and narrative product.

The DeepSeek key is entered in Configure. This launcher does not read api_key
or backend/.data/credentials.
"""
import argparse
from pathlib import Path
import socket
import subprocess
import sys
import time
import webbrowser

ROOT = Path(__file__).resolve().parent


def server_is_ready(port, proc, seconds=30):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            return False
        with socket.socket() as probe:
            probe.settimeout(0.2)
            if probe.connect_ex(('127.0.0.1', port)) == 0:
                return True
        time.sleep(0.1)
    return False


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port',type=int,default=8898)
    parser.add_argument('--scenario',type=Path,help='Optional server default script. Configure selects Default City, Function Zones, or Mixed Zones.')
    args=parser.parse_args()
    if not 1<=args.port<=65535:parser.error('Invalid port')
    with socket.socket() as probe:
        probe.settimeout(1)
        if probe.connect_ex(('127.0.0.1',args.port))==0:
            parser.error(f'Port {args.port} is already in use. Stop the existing server before restarting; no second server was started.')
    cmd=[sys.executable,'-B','-m','backend.server','--port',str(args.port),
         '--no-demo','--data-dir',str(ROOT/'backend/.data/product'),
         '--provider','offline']
    if args.scenario:
        scenario=args.scenario if args.scenario.is_absolute() else ROOT/args.scenario
        cmd+=['--scenario',str(scenario.resolve())]
    url=f'http://127.0.0.1:{args.port}/'
    print(f'Northern Metropolis product: {url}',flush=True)
    print('Enter a DeepSeek API key in Configure. No key file is read.',flush=True)
    proc=subprocess.Popen(cmd,cwd=ROOT)
    try:
        if server_is_ready(args.port,proc):
            webbrowser.open(url)
        return proc.wait()
    except KeyboardInterrupt:
        proc.terminate()
        return proc.wait()


if __name__=='__main__':raise SystemExit(main())
