import { randomUUID } from 'node:crypto';

const action = process.argv[2];
if (action !== 'demo-briefing') {
  console.error('Usage: node bridge.mjs demo-briefing');
  process.exit(2);
}

const token = process.env.JARVIS_WORKFLOW_TOKEN;
if (!token) {
  console.error('JARVIS_WORKFLOW_TOKEN is missing. Start through Docker Compose.');
  process.exit(2);
}

try {
  const base = process.env.JARVIS_N8N_URL || 'http://n8n:5678';
  const requestId = randomUUID();
  const response = await fetch(new URL('/webhook/jarvis/demo-briefing', base), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Jarvis-Key': token },
    body: JSON.stringify({ schema_version: 1, request_id: requestId }),
    signal: AbortSignal.timeout(15000),
    redirect: 'error',
  });
  if (!response.ok) {
    throw new Error(`n8n returned HTTP ${response.status}. Check workflow publication and credentials.`);
  }
  const result = await response.json();
  if (result.request_id !== requestId || result.status !== 'completed' || result.mode !== 'demo') {
    throw new Error('n8n returned an unexpected response contract.');
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
