#!/usr/bin/env python3
"""Launch the local simulator build and retain a screenshot plus startup evidence."""
import json
from pathlib import Path
import re
import subprocess
import sys
import time


def run(args, timeout=120, check=True):
    result = subprocess.run(args, text=True, capture_output=True, timeout=timeout)
    if check and result.returncode:
        raise RuntimeError(f"Command failed: {args!r}\n{result.stdout}\n{result.stderr}")
    return result


def main():
    app = Path(sys.argv[1]).resolve()
    output = Path(sys.argv[2]).resolve()
    output.mkdir(parents=True, exist_ok=True)
    device_json = run(['xcrun', 'simctl', 'list', 'devices', 'available', '--json']).stdout
    (output / 'available-simulators.json').write_text(device_json)
    devices = json.loads(device_json)['devices']
    candidates = []
    for runtime, entries in devices.items():
        match = re.search(r'\.iOS-(\d+)-(\d+)(?:-(\d+))?$', runtime)
        if not match:
            continue
        version = tuple(int(part or 0) for part in match.groups())
        for device in entries:
            if device.get('isAvailable') and device['name'].startswith('iPhone'):
                candidates.append((version, device['name'], runtime, device['udid']))
    if not candidates:
        raise RuntimeError('No available iPhone simulator on this runner.')
    version, name, runtime, udid = sorted(candidates, reverse=True)[0]
    metadata = {'device': name, 'runtime': runtime, 'udid': udid,
                'bundleIdentifier': 'com.icjunge.pocketballs', 'sceneReady': False}
    (output / 'smoke.json').write_text(json.dumps(metadata, indent=2) + '\n')
    boot = run(['xcrun', 'simctl', 'boot', udid], check=False)
    if boot.returncode and 'Booted' not in boot.stderr:
        raise RuntimeError(boot.stderr)
    run(['xcrun', 'simctl', 'bootstatus', udid, '-b'], timeout=240)
    try:
        run(['xcrun', 'simctl', 'install', udid, str(app)])
        stdout_path = output / 'app-stdout.log'
        stderr_path = output / 'app-stderr.log'
        launched = run(['xcrun', 'simctl', 'launch', '--terminate-running-process',
                        f'--stdout={stdout_path}', f'--stderr={stderr_path}',
                        udid, metadata['bundleIdentifier'], '--pocket-smoke'])
        (output / 'launch.log').write_text(launched.stdout + launched.stderr)
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline:
            logs = ''.join(path.read_text(errors='replace') if path.exists() else ''
                           for path in (stdout_path, stderr_path))
            if 'PocketBalls scene ready' in logs:
                metadata['sceneReady'] = True
                time.sleep(3)
                break
            time.sleep(1)
        run(['xcrun', 'simctl', 'io', udid, 'screenshot', str(output / 'iphone-launch.png')])
        (output / 'smoke.json').write_text(json.dumps(metadata, indent=2) + '\n')
        if not metadata['sceneReady']:
            raise RuntimeError('The WKWebView scene did not signal ready within 45 seconds; inspect screenshot and app logs.')
        print(json.dumps(metadata, indent=2))
    finally:
        run(['xcrun', 'simctl', 'shutdown', udid], check=False)


if __name__ == '__main__':
    main()
