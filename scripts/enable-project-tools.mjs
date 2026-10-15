// Merge this feature through OpenClaw's public configuration writer.
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const config = JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG_PATH, 'utf8'));
const changes = [];
// The local model needs the project tool's complete schema, not a deferred tool ID.
if (config.tools?.toolSearch !== false) changes.push({path: 'tools.toolSearch', value: false});
if (config.gateway?.http?.endpoints?.chatCompletions?.enabled !== true) {
  changes.push({path: 'gateway.http.endpoints.chatCompletions.enabled', value: true});
}
const skills = config.agents?.defaults?.skills;
if (Array.isArray(skills) && !skills.includes('jarvis-projects')) {
  changes.push({path: 'agents.defaults.skills', value: [...skills, 'jarvis-projects']});
}
const paths = config.plugins?.load?.paths || [];
const pluginIds = ['jarvis-project-tools', 'jarvis-capability-tools'];
const requiredPaths = pluginIds.map(id => `/home/node/.openclaw/extensions/${id}`);
if (requiredPaths.some(path => !paths.includes(path))) changes.push({path: 'plugins.load.paths', value: [...new Set([...paths, ...requiredPaths])]});
for (const id of pluginIds) {
  if (config.plugins?.entries?.[id]?.enabled !== true) changes.push({path: `plugins.entries.${id}.enabled`, value: true});
}
const allow = config.plugins?.allow;
if (Array.isArray(allow) && pluginIds.some(id => !allow.includes(id))) {
  changes.push({path: 'plugins.allow', value: [...new Set([...allow, ...pluginIds])]});
}
if (changes.length) {
  const result = spawnSync(process.execPath, ['dist/index.js', 'config', 'set', '--batch-json', JSON.stringify(changes)], {stdio: 'inherit'});
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
console.log('Project chat and skill configuration are already enabled.');
