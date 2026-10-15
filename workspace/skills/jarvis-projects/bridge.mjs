const [action, project, root, ...rest] = process.argv.slice(2);
const actions = new Set(['list', 'connections', 'compatibility', 'overview', 'tree', 'read', 'search', 'git', 'instructions']);
const token = process.env.JARVIS_PROJECT_TOKEN;
if (!actions.has(action) || !token || (!['list','connections'].includes(action) && !project)) {
  console.error('Use list/connections, compatibility/overview PROJECT, or tree/read/search/git/instructions PROJECT ROOT. JARVIS_PROJECT_TOKEN is required.');
  process.exit(2);
}
const request = {action, project, root};
if (action === 'tree' || action === 'instructions') request.path = rest[0] || '';
if (action === 'read') Object.assign(request, {path: rest[0], start: Number(rest[1] || 1), limit: Number(rest[2] || 160)});
if (action === 'search') request.query = rest.join(' ');
try {
  const response = await fetch(new URL('/api/tool', process.env.JARVIS_PROJECT_URL || 'http://host.docker.internal:18791'), {
    method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`},
    body: JSON.stringify(request), signal: AbortSignal.timeout(45000), redirect: 'error',
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Project Hub returned HTTP ${response.status}`);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(`Project tool failed: ${error.message}`);
  process.exit(1);
}
