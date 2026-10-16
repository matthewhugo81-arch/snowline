"""Run the native Worker transport/cache fixture without live provider calls."""
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

root = Path(__file__).resolve().parents[2]
config = sys.argv[1] if len(sys.argv) > 1 else 'tests/worker-runtime/wrangler.toml'
expected = ({'ok': True, 'rpc': True, 'posts': 1, 'leaseReused': True}
            if 'scheduler-runtime' in config else {'ok': True, 'nativeFetch': True, 'upstream': 1, 'reused': True})
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
with tempfile.TemporaryFile(mode='w+') as log:
    process = subprocess.Popen([
        'npx', '--yes', 'wrangler@4.151.0', 'dev', '--local',
        '--config', config, '--ip', '127.0.0.1',
        '--port', str(port),
    ], cwd=root, stdout=log, stderr=log, start_new_session=True)
    try:
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            try:
                with opener.open(f'http://127.0.0.1:{port}/', timeout=3) as response:
                    result = json.load(response)
                assert result == expected, result
                print('Native Cloudflare runtime: PASS', config)
                break
            except urllib.error.HTTPError as error:
                raise AssertionError(error.read().decode()) from error
            except (urllib.error.URLError, TimeoutError):
                if process.poll() is not None:
                    raise RuntimeError('Worker runtime exited before the test.')
                time.sleep(0.25)
        else:
            raise TimeoutError('Worker runtime did not become ready.')
    except Exception:
        log.seek(0)
        print(log.read())
        raise
    finally:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
