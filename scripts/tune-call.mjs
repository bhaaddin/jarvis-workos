// Preserve the selected local model; raise its reasoning through the native writer.
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const config = JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG_PATH, 'utf8'));
if (config.agents?.defaults?.model?.primary !== 'ollama/qwen3.5:9b') {
  throw new Error('The selected model changed; review its reasoning support before tuning.');
}
const models = config.models.providers.ollama.models.map(model => {
  if (model.id !== 'qwen3.5:9b') return model;
  const params = {...model.params};
  delete params.thinking;
  return {...model, reasoning: true, params};
});
const changes = [
  {path: 'agents.defaults.thinkingDefault', value: 'high'},
  {path: 'models.providers.ollama.models', value: models},
];
const result = spawnSync(process.execPath, ['dist/index.js', 'config', 'set', '--batch-json', JSON.stringify(changes)], {stdio: 'inherit'});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
