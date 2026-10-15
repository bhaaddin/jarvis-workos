"""Exercise source connections through the actual host, Gateway tool and CLI bridge."""
from datetime import datetime, timezone
import json
import subprocess
import urllib.request
from init import ROOT, read_env


def call(url, token, body):
    request = urllib.request.Request(url, data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def main():
    env = read_env()
    folder = ROOT / 'logs' / ('connection-bridges-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    folder.mkdir(parents=True)
    result = {'verified': False, 'checks': {}}
    try:
        result['stage'] = 'host'
        source = call('http://127.0.0.1:18791/api/tool', env['JARVIS_PROJECT_TOKEN'], {'action': 'compatibility', 'project': 'upstream-ollama'})
        assert source['sourceReady'] and any(item['compatible'] for item in source['runtimes'])
        result['checks']['authenticatedHostContract'] = True
        result['stage'] = 'gateway'
        tool = call('http://127.0.0.1:18789/tools/invoke', env['OPENCLAW_GATEWAY_TOKEN'],
                    {'tool': 'jarvis_projects', 'args': {'action': 'connections', 'query': 'ollama', 'limit': 10}})
        assert tool.get('ok') is True
        payload = tool['result']
        details = payload.get('details')
        if not isinstance(details, dict):
            details = json.loads(next(item['text'] for item in payload.get('content', []) if item.get('type') == 'text'))
        assert any(item['id'] == 'upstream-ollama' for item in details['projects'])
        result['checks']['actualGatewayTool'] = True
        result['stage'] = 'cli'
        command = ['docker', 'exec', 'jarvis-workos-openclaw-1', 'node',
                   '/home/node/.openclaw/workspace/skills/jarvis-projects/bridge.mjs', 'compatibility', 'upstream-ollama']
        cli = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=45, check=False)
        result['cliExit'] = cli.returncode
        assert cli.returncode == 0
        data = json.loads(cli.stdout)
        assert data['project'] == 'upstream-ollama' and data['sourceReady']
        result['checks']['installedCliBridge'] = True
        result['verified'] = True
        result['stage'] = 'complete'
    except (OSError, ValueError, KeyError, AssertionError, StopIteration, subprocess.SubprocessError) as error:
        result['failureType'] = type(error).__name__
    (folder / 'results.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({**result, 'evidence': str(folder)}, indent=2))
    return 0 if result['verified'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
