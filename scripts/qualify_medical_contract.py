"""Run an existing Medical binary against a new disposable synthetic database.

No existing clinic database, account, source file or build output is changed.
Credentials stay in environment/stdin and are redacted from retained output.
"""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
import argparse

ROOT = Path(__file__).resolve().parents[1]
MEDICAL = ROOT.parent / 'SportMedical.Diagnostics'
DLL = MEDICAL / 'src/SportMedical.Diagnostics.Api/bin/Debug/net10.0/SportMedical.Diagnostics.Api.dll'
API = 'http://127.0.0.1:18952'


def request(route, body=None, token=None):
    call = urllib.request.Request(API + route, data=None if body is None else json.dumps(body).encode(),
        headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + token} if token else {})})
    try:
        with urllib.request.urlopen(call, timeout=20) as response:
            raw = response.read(8 * 1024 * 1024)
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


def main():
    global DLL
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', type=Path)
    args = parser.parse_args()
    if args.binary:
        DLL = args.binary.resolve()
    if not DLL.is_file():
        raise RuntimeError('No existing Medical API binary is available for isolated qualification.')
    for port in (18952, 18954):
        with socket.socket() as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            probe.bind(('127.0.0.1', port))
    marker = uuid.uuid4().hex[:12]
    folder = ROOT / 'logs' / ('medical-contract-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    folder.mkdir()
    content = ROOT / 'runtime/medical-qualification' / marker
    content.mkdir(parents=True)
    (content / 'appsettings.json').write_text('{}', encoding='utf-8')
    password, initial, final = (secrets.token_urlsafe(32) for _ in range(3))
    email = 'qualification-' + marker + '@example.test'
    container_name = 'jarvis-medical-qualification-' + marker
    result = {'verified': False, 'synthetic': True, 'binary': str(DLL),
              'binarySha256': hashlib.sha256(DLL.read_bytes()).hexdigest(),
              'binaryModifiedAt': datetime.fromtimestamp(DLL.stat().st_mtime, timezone.utc).isoformat(),
              'sourceHead': subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=MEDICAL, capture_output=True, text=True, check=True).stdout.strip(),
              'existingClinicDataAccessed': False}
    process = None
    container = None
    readers = []
    try:
        launch = subprocess.run(['docker', 'run', '--rm', '-d', '--name', container_name,
            '--label', 'jarvis.owner=medical-qualification', '--log-driver', 'none',
            '-e', 'POSTGRES_PASSWORD', '-e', 'POSTGRES_DB=jarvis_qualification',
            '-p', '127.0.0.1:18954:5432', '--tmpfs', '/var/lib/postgresql:rw,size=1536m',
            'postgres:18-alpine'], env={**os.environ, 'POSTGRES_PASSWORD': password}, capture_output=True, text=True, timeout=180)
        if launch.returncode:
            raise RuntimeError('The isolated PostgreSQL could not start: ' + launch.stderr[:500].replace(password, '[redacted]'))
        container = launch.stdout.strip()
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            ready = subprocess.run(['docker', 'exec', container, 'pg_isready', '-U', 'postgres', '-d', 'jarvis_qualification'], capture_output=True, timeout=10)
            if ready.returncode == 0:
                break
            time.sleep(.5)
        else:
            raise RuntimeError('The isolated PostgreSQL did not become ready.')
        connection = f'Host=127.0.0.1;Port=18954;Database=jarvis_qualification;Username=postgres;Password={password}'
        environment = {**os.environ, 'ASPNETCORE_ENVIRONMENT': 'Development', 'DOTNET_ENVIRONMENT': 'Development',
            'ASPNETCORE_URLS': API, 'ASPNETCORE_CONTENTROOT': str(content), 'DOTNET_CONTENTROOT': str(content),
            'ConnectionStrings__SportMedical': connection, 'ConnectionStrings__DefaultConnection': connection,
            'Database__MigrateOnStartup': 'true', 'BootstrapOwner__Email': email,
            'BootstrapOwner__DisplayName': 'Synthetic JARVIS Qualification', 'BootstrapOwner__OrganizationScopeKey': 'jarvis-qualification',
            'BootstrapOwner__ClinicScopeKey': 'synthetic-clinic', 'BootstrapOwner__TemporaryPassword': initial,
            'Logging__LogLevel__Default': 'Warning', 'Logging__LogLevel__Microsoft': 'Warning',
            'Agent__ApiKey': '', 'APPDATA': str(content / 'profile'), 'HOME': str(content / 'profile')}
        process = subprocess.Popen(['dotnet', str(DLL), '--contentRoot', str(content), '--urls', API], cwd=content,
            env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding='utf-8', errors='replace')
        def retain_output():
            with (folder / 'api.log').open('w', encoding='utf-8') as output:
                for line in process.stdout:
                    for secret in (password, initial, final):
                        line = line.replace(secret, '[redacted]')
                    output.write(line)
                    output.flush()
        reader = threading.Thread(target=retain_output, daemon=True);reader.start();readers.append(reader)
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError('The isolated Medical binary exited; inspect the redacted API log.')
            try:
                status, _ = request('/health/live')
                if status == 200:
                    break
            except (OSError, ValueError):
                pass
            time.sleep(.5)
        else:
            raise RuntimeError('The isolated Medical API did not become ready.')
        code, schema = request('/openapi/v1.json')
        if code != 200:
            raise RuntimeError('The actual API did not expose its development contract.')
        (folder / 'openapi.json').write_text(json.dumps(schema, indent=2), encoding='utf-8')
        result['paths'] = sorted(schema.get('paths', {}))
        result['unauthenticatedServicesStatus'] = request('/api/services')[0]
        if result['unauthenticatedServicesStatus'] != 401:
            raise RuntimeError('The actual protected route did not reject an unauthenticated caller.')
        code, _ = request('/api/v1/accounts/activate', {'email': email, 'temporaryPassword': initial,
            'newPassword': final, 'newPasswordConfirmation': final})
        result['activationStatus'] = code
        code, session = request('/api/v1/session', {'email': email, 'password': final})
        if code != 200 or not session.get('accessToken'):
            raise RuntimeError('The synthetic owner could not authenticate through the real session API.')
        token = session['accessToken']
        result['authenticated'] = True
        result['permissions'] = session.get('permissions', [])
        code, created = request('/api/services', {'code': 'JARVIS-' + marker, 'name': 'Synthetic qualification service',
            'description': 'Disposable API contract verification', 'category': 'Qualification', 'durationMinutes': 30, 'priceCzk': 355}, token)
        result['createServiceStatus'] = code
        if code != 201:
            raise RuntimeError('The real API rejected the synthetic service fixture.')
        code, prices = request('/api/services', token=token)
        matches = [item for item in prices.get('data', []) if item.get('code') == 'JARVIS-' + marker]
        if code != 200 or len(matches) != 1 or matches[0].get('priceCzk') != 355:
            raise RuntimeError('The actual API did not return the created 355 CZK fixture.')
        result['observedSyntheticPriceCzk'] = 355
        result['verified'] = True
    except Exception as error:
        result['failure'] = str(error)
        return_code = 1
    else:
        return_code = 0
    finally:
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.kill();process.wait(timeout=5)
        for reader in readers:
            reader.join(timeout=5)
        if container:
            cleanup = subprocess.run(['docker', 'rm', '-f', container], capture_output=True, timeout=30)
            result['qualificationContainerRemoved'] = cleanup.returncode == 0
        (folder / 'results.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
        print(json.dumps({key: value for key, value in result.items() if key not in ('paths', 'permissions')}, indent=2))
        print('Artifacts:', folder)
    return return_code


if __name__ == '__main__':
    raise SystemExit(main())
