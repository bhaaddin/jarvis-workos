"""Prove the real caller-owned structured tool loop with synthetic data only."""
from datetime import datetime, timezone
import json
import subprocess
import time
import urllib.request
import uuid

from init import ROOT, read_env

token = read_env()['JARVIS_OPERATOR_GATEWAY_TOKEN']
folder = ROOT / 'logs' / ('operator-brain-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
folder.mkdir()
marker = 'SYNTHETIC_PRIVATE_' + uuid.uuid4().hex
tools = [{'type': 'function', 'function': {'name': 'jarvis_probe', 'description': 'Read the synthetic qualification count.',
    'parameters': {'type': 'object', 'properties': {'correlation': {'type':'string','enum':[marker]}},
                   'required':['correlation'], 'additionalProperties': False}}}]
messages = [{'role': 'system', 'content': 'Use the supplied tool. Report its count and correlation exactly in one short sentence. Do not use other tools.'},
            {'role': 'user', 'content': f'{marker}: What count does the qualification record contain? Use this correlation.'}]


def call(payload):
    request = urllib.request.Request('http://127.0.0.1:18809/v1/chat/completions',
        data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token,
        'x-openclaw-session-key': 'agent:main:dashboard:incognito-jarvis-' + str(uuid.uuid4())})
    with urllib.request.urlopen(request, timeout=180) as response:
        return json.load(response)


start = time.monotonic()
ready_request = urllib.request.Request('http://127.0.0.1:18809/jarvis/operator-boundary', headers={'Authorization':'Bearer ' + token})
with urllib.request.urlopen(ready_request, timeout=10) as response:
    readiness = json.load(response)
assert readiness.get('boundaryVersion') == 2 and readiness.get('nativeLogsDisabled') is True, 'Operational privacy boundary is not active'
logging = subprocess.run(['docker', 'inspect', '--format', '{{.HostConfig.LogConfig.Type}}', 'jarvis-operator-brain-1'], capture_output=True, text=True, timeout=10, check=True)
assert logging.stdout.strip() == 'none', 'Native console output must not be retained by Docker'
first = call({'model': 'openclaw/default', 'stream': False, 'messages': messages, 'tools': tools, 'tool_choice': 'required'})
message = first['choices'][0]['message']
calls = message.get('tool_calls') or []
assert len(calls) == 1 and calls[0]['function']['name'] == 'jarvis_probe', 'No verified client tool call'
assert json.loads(calls[0]['function']['arguments']) == {'correlation':marker}, 'Unexpected tool arguments'
messages.append(message)
messages.append({'role': 'tool', 'tool_call_id': calls[0]['id'], 'content': json.dumps({'count': 37, 'correlation':marker, 'source': 'synthetic_qualification'})})
second = call({'model': 'openclaw/default', 'stream': False, 'messages': messages, 'tools': tools, 'tool_choice': 'none'})
answer = second['choices'][0]['message']['content']
assert '37' in answer, 'Final answer did not use the observed tool result'
result = {'tool': calls[0]['function']['name'], 'observed_count': 37, 'answer': answer.replace(marker, '[SYNTHETIC MARKER]'),
          'elapsed_seconds': round(time.monotonic() - start, 3), 'synthetic_marker': marker, 'structured_loop_verified': True,
          'session_mode': 'incognito', 'privacy_verified': False, 'native_console_logging_driver': logging.stdout.strip()}
with urllib.request.urlopen(ready_request, timeout=10) as response:
    boundary = json.load(response)
result['gateway_process_suppressed_writes'] = boundary['suppressedWrites'] - readiness['suppressedWrites']
# Agent workers can hold different plugin instances from the HTTP listener.
# Inspect actual retained data rather than equating that process-local counter
# with transcript suppression across the native worker boundary.
plain = call({'model': 'openclaw/default', 'stream': False,
    'messages': [{'role':'user','content':f'{marker}: Reply with the word ready.'}]})
assert plain['choices'][0]['message'].get('content'), 'Plain conversation failed'
scanner = "const f=require('fs'),p=require('path'),needle=Buffer.from(process.argv[1]),found=[];function walk(d){for(const e of f.readdirSync(d,{withFileTypes:true})){const n=p.join(d,e.name);if(e.isDirectory())walk(n);else if(e.isFile()&&f.statSync(n).size<50000000&&f.readFileSync(n).includes(needle))found.push(n)}};for(const d of ['/home/node/.openclaw','/tmp/openclaw'])if(f.existsSync(d))walk(d);console.log(JSON.stringify(found));"
scan = subprocess.run(['docker','exec','jarvis-operator-brain-1','node','-e',scanner,marker], capture_output=True, text=True, timeout=30, check=True)
result['native_raw_marker_paths'] = json.loads(scan.stdout)
result['privacy_verified'] = not result['native_raw_marker_paths']
(folder / 'results.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
assert not result['native_raw_marker_paths'], 'Synthetic private content was persisted by the native Gateway'
(folder / 'results.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps({key: value for key, value in result.items() if key != 'synthetic_marker'}, indent=2))
print('Artifacts:', folder)
