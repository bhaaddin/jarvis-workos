// Retire the redundant shell skill from active routing; retain the installed source.
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const config = JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG_PATH, 'utf8'));
const changes = [];
const skills = config.agents?.defaults?.skills;
if (Array.isArray(skills) && skills.includes('weather'))
  changes.push({path: 'agents.defaults.skills', value: skills.filter(name => name !== 'weather')});
if (config.skills?.entries?.weather?.enabled !== false)
  changes.push({path: 'skills.entries.weather.enabled', value: false});
if (changes.length) {
  const result = spawnSync(process.execPath, ['dist/index.js', 'config', 'set', '--batch-json', JSON.stringify(changes)], {stdio: 'inherit'});
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
console.log('The shell weather skill is already retired from active routing.');
