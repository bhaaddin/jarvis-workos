// Seed Linux-native storage once. Existing config, memory, and skill edits win.
import { chmodSync, chownSync, constants, copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function directory(path) {
  mkdirSync(path, { recursive: true });
  chownSync(path, 1000, 1000);
}

function copyIfMissing(source, destination) {
  try {
    copyFileSync(source, destination, constants.COPYFILE_EXCL);
    chownSync(destination, 1000, 1000);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
}

function seedTree(source, destination, managedPlugin = false) {
  directory(destination);
  if (managedPlugin) chmodSync(destination, 0o755);
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) seedTree(from, to, managedPlugin);
    else if (entry.isFile()) {
      copyIfMissing(from, to);
      // Windows mounts report 0777; plugin source in the Linux volume must be 0644.
      if (managedPlugin) chmodSync(to, 0o644);
    }
  }
}

const state = '/home/node/.openclaw';
directory(state);
copyIfMissing('/seed-config/openclaw.json', join(state, 'openclaw.json'));
seedTree('/seed-workspace', join(state, 'workspace'));
seedTree('/seed-plugins', join(state, 'extensions'), true);
console.log('OpenClaw storage seeded. Existing files were preserved.');
