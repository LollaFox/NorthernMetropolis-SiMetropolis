"""Launch the combined frontend, fiscal scenarios and government API product."""
import argparse
import os
from pathlib import Path
import socket
import subprocess
import sys

ROOT = Path(__file__).resolve().parent


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port',type=int,default=8898)
    parser.add_argument('--scenario',type=Path,help='Government script JSON used by Original server scenario')
    parser.add_argument('--live',action='store_true',help='Legacy server credential. Government decision AI is disabled; enter the DeepSeek key in Configure for building narratives.')
    parser.add_argument('--api-key-file',type=Path)
    parser.add_argument('--model',default='deepseek-flash')
    args=parser.parse_args()
    if not 1<=args.port<=65535:parser.error('Invalid port')
    if args.api_key_file and not args.live:parser.error('Use --live with a credential file')
    if args.live:
        if args.api_key_file:
            try:
                if args.api_key_file.stat().st_size > 8192:
                    parser.error('API key file is too large; save only one key.')
                credential=args.api_key_file.read_text(encoding='utf-8').strip()
            except (OSError,UnicodeError):
                parser.error('Cannot read API key file. Check the path and save it as UTF-8.')
        else:
            credential=os.environ.get('DEEPSEEK_API_KEY','').strip()
        if not credential:
            parser.error('API key is empty. Paste your DeepSeek key into the key file and SAVE it, or set DEEPSEEK_API_KEY.')
        if credential.startswith(('\ufeff','"',"'")) or len(credential)>4096 or any(c in credential for c in '\r\n\x00'):
            parser.error('Invalid key file format. Use one raw key on one line, without quotes; save as UTF-8 without BOM.')
        del credential
    with socket.socket() as probe:
        probe.settimeout(1)
        if probe.connect_ex(('127.0.0.1',args.port))==0:
            parser.error(f'Port {args.port} is already in use. Stop the existing server before restarting; no second server was started.')
    cmd=[sys.executable,'-B','-m','backend.server','--port',str(args.port),
         '--no-demo','--data-dir',str(ROOT/'backend/.data/product'),
         '--provider','deepseek' if args.live else 'offline']
    if args.scenario:
        scenario=args.scenario if args.scenario.is_absolute() else ROOT/args.scenario
        cmd+=['--scenario',str(scenario.resolve())]
    if args.live:
        cmd+=['--model',args.model]
        if args.api_key_file:cmd+=['--api-key-file',str(args.api_key_file.resolve())]
    print(f'Northern Metropolis product: http://127.0.0.1:{args.port}/',flush=True)
    print('Starting government API mode; web confirmation starts calls after successful startup.' if args.live else 'Offline mode; no API calls.',flush=True)
    return subprocess.call(cmd,cwd=ROOT)


if __name__=='__main__':raise SystemExit(main())
