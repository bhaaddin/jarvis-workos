import {lstat, mkdir, readdir, readFile, realpath, rename, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type {ObjectValue, ToolContext} from './contracts.js';
import {assert} from './errors.js';
import {packageRoot} from './config.js';
import {runProcess} from './processes.js';
import {object} from './store-context.js';

// Writes are limited to explicitly registered personal working clones.
// Coordinator-owned checkouts (Medical) and everything else are unreachable:
// resolution fails closed when the project id is unknown.
const secretName = /(^|\.)env$|password|credential|secret|token|private\.key|\.pem$|^id_(?:rsa|ed25519)/i;
const generatedDir = /^(node_modules|\.git|dist|build|coverage|\.next|__pycache__|\.venv)$/;
const destructive = /\brm\s+-rf\s+\/|:\(\)\s*{\s*:\|:\s*&\s*}|mkfs\b|\bdd\s+.*\bof=|shutdown(\.exe)?\s+\/s|reboot|format\s+[a-z]:|del\s+(\/s\s+)?.*c:\\windows|git\s+push\s+.*--force|git\s+reset\s+--hard/i;
const MAX_READ = 1024 * 1024;
const MAX_EDIT = 20000;
const SCAFFOLD_NAME = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const SCAFFOLD_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9]|node_modules|\.git|dist|build|coverage)$/i;
const SCAFFOLD_TEMPLATES = ['node', 'python', 'docs'] as const;

function scaffoldRoot(): string {
  return process.env.JARVIS_SCAFFOLD_ROOT ?? path.join(os.homedir(), 'Jarvis-Projects');
}

function scaffoldFiles(template: string, name: string): Array<[string, string]> {
  const readme = '# ' + name + '\n\nScaffolded by JARVIS. Ask JARVIS to build the first feature.\n';
  if (template === 'python')
    return [['README.md', readme], ['.gitignore', '__pycache__/\n.venv/\n*.pyc\n.env\n'],
      ['main.py', 'def main():\n    print("hello from ' + name + '")\n\n\nif __name__ == "__main__":\n    main()\n']];
  if (template === 'docs')
    return [['README.md', readme], ['notes.md', '# Notes\n\n']];
  return [['README.md', readme], ['.gitignore', 'node_modules/\ndist/\n.env\n'],
    ['package.json', JSON.stringify({name, version: '0.1.0', private: true,
      scripts: {test: 'node --test'}}, null, 2) + '\n']];
}

async function scaffoldCode(input: ObjectValue, signal: AbortSignal): Promise<ObjectValue> {
  const name = input.project;
  assert(typeof name === 'string' && SCAFFOLD_NAME.test(name) && !SCAFFOLD_RESERVED.test(name),
    'CODE_SCAFFOLD_INVALID', 'Name the project with 3-40 lowercase letters, digits or dashes.');
  const template = input.template === undefined ? 'node' : input.template;
  assert(typeof template === 'string' && (SCAFFOLD_TEMPLATES as readonly string[]).includes(template),
    'CODE_SCAFFOLD_INVALID', 'Choose a node, python or docs template.');
  const parent = scaffoldRoot();
  assert(path.isAbsolute(parent), 'CODE_SCAFFOLD_INVALID', 'The scaffold root is not configured.', 503);
  const target = path.join(parent, name);
  try {
    await lstat(target);
    throw new Error('exists');
  } catch (error) {
    assert((error as {code?: string}).code === 'ENOENT', 'CODE_SCAFFOLD_EXISTS',
      'A folder with that project name already exists. Pick another name.', 409);
  }
  signal.throwIfAborted();
  await mkdir(target, {recursive: true});
  const files = scaffoldFiles(template, name);
  for (const [relative, content] of files) {
    assert(!secretName.test(relative), 'CODE_SECRET_REFUSED', 'Credential and key files are never touched.', 403);
    await writeFile(path.join(target, relative), content, {flag: 'wx', mode: 0o600});
  }
  const git = await runProcess('git', ['init'], {cwd: target, timeoutMs: 30000, signal});
  assert(git.code === 0, 'CODE_SCAFFOLD_GIT', 'The project folder was created but git init failed.', 503);
  const configured = process.env.JARVIS_CODE_CONFIG ?? path.join(packageRoot, 'config/code.json');
  const raw = object(JSON.parse(await readFile(configured, 'utf8')));
  const projects = Array.isArray(raw.projects) ? raw.projects : [];
  assert(!projects.some(entry => object(entry).id === name), 'CODE_SCAFFOLD_EXISTS',
    'That project id is already registered. Pick another name.', 409);
  assert(projects.length < 40, 'CODE_ROOTS_INVALID', 'The working project registry is full.', 503);
  projects.push({id: name, path: target, access: 'ask'});
  const temporary = configured + '.tmp';
  await writeFile(temporary, JSON.stringify({projects}, null, 2) + '\n', {mode: 0o600});
  await rename(temporary, configured);
  return {project: name, path: target, template, registered: 'ask',
    files: files.map(([relative]) => relative), git: (git.stdout + git.stderr).slice(0, 500)};
}

interface CodeRoot {id: string; path: string; access: 'ask' | 'off'}

async function workingRoots(): Promise<CodeRoot[]> {
  const configured = process.env.JARVIS_CODE_CONFIG ?? path.join(packageRoot, 'config/code.json');
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(configured, 'utf8'));
  } catch {
    throw new Error('No working code roots are configured.');
  }
  const entries = object(raw).projects;
  assert(Array.isArray(entries) && entries.length > 0 && entries.length <= 40,
    'CODE_ROOTS_INVALID', 'No working code roots are configured.', 503);
  return entries.map(entry => {
    const row = object(entry);
    assert(typeof row.id === 'string' && /^[a-z0-9-]{1,80}$/.test(row.id)
      && typeof row.path === 'string' && path.isAbsolute(row.path),
      'CODE_ROOTS_INVALID', 'A configured code root is invalid.', 503);
    const access = row.access === undefined ? 'ask' : row.access;
    assert(access === 'ask' || access === 'off',
      'CODE_ROOTS_INVALID', 'Project access is ask or off.', 503);
    return {id: row.id, path: row.path, access};
  });
}

function cleanRelative(value: unknown): string {
  assert(typeof value === 'string' && value.length > 0 && value.length < 500,
    'CODE_PATH_INVALID', 'A bounded relative file path is required.');
  const parts = value.replaceAll('\\', '/').split('/');
  assert(parts.every(part => part && part !== '.' && part !== '..' && !/[<>:"|?*\x00-\x1f]/.test(part)
    && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part)),
    'CODE_PATH_INVALID', 'Use a normal relative path without traversal.');
  return parts.join('/');
}

async function resolveIn(root: string, relative: string, forWrite: boolean): Promise<string> {
  const base = await realpath(root);
  const parts = relative.split('/');
  const name = parts[parts.length - 1]!;
  assert(!secretName.test(name), 'CODE_SECRET_REFUSED', 'Credential and key files are never touched.', 403);
  let current = base;
  for (let index = 0; index < parts.length - 1; index++) {
    const part = parts[index]!;
    current = path.join(current, part);
    const entry = await lstat(current);
    assert(!entry.isSymbolicLink(), 'CODE_LINK_BLOCKED', 'Linked directories are not followed.', 403);
    assert(entry.isDirectory(), 'CODE_PATH_INVALID', 'The directory path is not valid.');
    if (forWrite) assert(!generatedDir.test(part), 'CODE_GENERATED_REFUSED', 'Generated and VCS directories are not edited.', 403);
  }
  if (forWrite) {
    const resolved = path.resolve(base, relative);
    assert(resolved.startsWith(base + path.sep), 'CODE_SCOPE_REJECTED', 'The file is outside the working root.', 403);
    return resolved;
  }
  const target = path.join(current, name);
  const entry = await lstat(target);
  assert(!entry.isSymbolicLink(), 'CODE_LINK_BLOCKED', 'Linked files are not followed.', 403);
  const resolved = await realpath(target);
  assert(resolved.startsWith(base + path.sep), 'CODE_SCOPE_REJECTED', 'The file is outside the working root.', 403);
  return resolved;
}

async function readCode(root: string, input: ObjectValue): Promise<ObjectValue> {
  const rel = cleanRelative(input.path);
  const file = await resolveIn(root, rel, false);
  const entry = await lstat(file);
  assert(entry.isFile() && entry.size <= MAX_READ, 'CODE_FILE_LIMIT', 'Choose a regular file no larger than 1 MiB.', 413);
  const text = await readFile(file, 'utf8');
  assert(!text.includes('\0'), 'CODE_BINARY_REFUSED', 'Binary files are not read as text.');
  const lines = text.split('\n');
  const start = input.start === undefined ? 1 : Number(input.start);
  const limit = input.limit === undefined ? 120 : Number(input.limit);
  assert(Number.isSafeInteger(start) && start >= 1 && Number.isSafeInteger(limit) && limit >= 1 && limit <= 500,
    'CODE_RANGE_INVALID', 'Use start >= 1 and limit 1-500.');
  return {path: rel, totalLines: lines.length, start, lines: lines.slice(start - 1, start - 1 + limit)};
}

async function editCode(root: string, input: ObjectValue, signal: AbortSignal): Promise<ObjectValue> {
  const oldText = input.oldText, newText = input.newText;
  assert(typeof oldText === 'string' && oldText.length >= 10 && oldText.length <= MAX_EDIT,
    'CODE_EDIT_INVALID', 'Supply the exact existing block (10-20000 chars) to replace.');
  assert(typeof newText === 'string' && newText.length <= MAX_EDIT,
    'CODE_EDIT_INVALID', 'Supply the replacement block (up to 20000 chars).');
  const rel = cleanRelative(input.path);
  const file = await resolveIn(root, rel, false);
  const entry = await lstat(file);
  assert(entry.isFile() && entry.size <= MAX_READ, 'CODE_FILE_LIMIT', 'Choose a regular file no larger than 1 MiB.', 413);
  const text = await readFile(file, 'utf8');
  assert(!text.includes('\0'), 'CODE_BINARY_REFUSED', 'Binary files are not edited.');
  signal.throwIfAborted();
  const matches = text.split(oldText).length - 1;
  assert(matches === 1, 'CODE_EDIT_AMBIGUOUS',
    matches === 0 ? 'The exact block was not found; read the file first.' : 'The block matches multiple places; include more context.');
  const updated = text.replace(oldText, () => newText);
  await writeFile(file, updated);
  signal.throwIfAborted();
  const bytes = await readFile(file);
  return {path: rel, replacements: 1,
    sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length};
}

async function runCode(root: string, input: ObjectValue, signal: AbortSignal): Promise<ObjectValue> {
  const command = input.command;
  assert(typeof command === 'string' && command.length >= 1 && command.length <= 2000,
    'CODE_COMMAND_INVALID', 'Supply the build/test command (up to 2000 chars).');
  assert(!destructive.test(command), 'CODE_COMMAND_REFUSED', 'Destructive commands are never run.');
  const cwd = input.workdir === undefined ? root : await resolveIn(root, cleanRelative(input.workdir), false);
  const cwdEntry = await lstat(cwd);
  assert(cwdEntry.isDirectory(), 'CODE_PATH_INVALID', 'The working directory is not valid.');
  const timeoutMs = input.timeoutMs === undefined ? 90000 : Number(input.timeoutMs);
  assert(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 110000,
    'CODE_TIMEOUT_INVALID', 'Use a timeout of 1-110 seconds.');
  const response = await runProcess('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', command], {signal, cwd, timeoutMs, maximum: 256000});
  return {command: command.slice(0, 300), workdir: path.relative(root, cwd) || '.', exitCode: response.code,
    stdout: response.stdout.slice(-60000), stderr: response.stderr.slice(-20000)};
}

async function scanCode(root: string, input: ObjectValue, signal: AbortSignal): Promise<ObjectValue> {
  const scope = input.workdir === undefined ? root : await resolveIn(root, cleanRelative(input.workdir), false);
  const scopeEntry = await lstat(scope);
  assert(scopeEntry.isDirectory(), 'CODE_PATH_INVALID', 'The scan scope is not a directory.');
  const timeoutMs = input.timeoutMs === undefined ? 100000 : Number(input.timeoutMs);
  assert(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 110000,
    'CODE_TIMEOUT_INVALID', 'Use a timeout of 1-110 seconds.');
  // Fixed registry rulesets: '--config auto' refuses to run with metrics off,
  // while these two work privately. No findings are sent anywhere.
  const override = process.env.JARVIS_SEMGREP_CONFIG;
  const configs = override ? [override] : ['p/security-audit', 'p/secrets'];
  // Explicit file targets: directory discovery ('.') is unreliable on some
  // platforms, and this also keeps generated/secret/oversize files out.
  const targets: string[] = [];
  const walk = async (folder: string, depth: number): Promise<void> => {
    if (targets.length >= 1000 || depth > 6) return;
    for (const entry of await readdir(folder, {withFileTypes: true})) {
      if (targets.length >= 1000) return;
      if (entry.name.startsWith('.') || entry.isSymbolicLink() || secretName.test(entry.name)) continue;
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        if (!generatedDir.test(entry.name)) await walk(full, depth + 1);
      } else if (entry.isFile()) {
        const meta = await lstat(full);
        if (meta.size > 0 && meta.size <= MAX_READ) targets.push(path.relative(scope, full) || entry.name);
      }
    }
  };
  await walk(scope, 0);
  assert(targets.length > 0, 'CODE_SCAN_EMPTY', 'No scannable files found in the selected scope.', 404);
  const response = await runProcess('semgrep',
    ['scan', ...configs.flatMap(entry => ['--config', entry]), '--json', '--quiet', '--metrics', 'off',
      '--timeout', '30', ...targets],
    {signal, cwd: scope, timeoutMs, maximum: 512000});
  let parsed: {results?: unknown[]; errors?: unknown[]; paths?: {scanned?: unknown[]}};
  try {
    parsed = JSON.parse(response.stdout) as typeof parsed;
  } catch {
    throw new Error('The security scan returned an unreadable response.');
  }
  assert(Array.isArray(parsed.results), 'CODE_SCAN_INVALID', 'The security scan produced no usable result.', 502);
  const findings = parsed.results.slice(0, 50).map(entry => {
    const row = (entry ?? {}) as Record<string, unknown>;
    const start = (row.start ?? {}) as Record<string, unknown>;
    const extra = (row.extra ?? {}) as Record<string, unknown>;
    return {rule: String(row.check_id ?? 'unknown').slice(0, 200),
      severity: String(extra.severity ?? row.severity ?? 'INFO').slice(0, 20),
      path: String(row.path ?? '').slice(-300), line: typeof start.line === 'number' ? start.line : null,
      message: String(extra.message ?? row.message ?? '').slice(0, 300)};
  });
  const bySeverity: Record<string, number> = {};
  for (const finding of findings) bySeverity[finding.severity] = (bySeverity[finding.severity] ?? 0) + 1;
  return {scope: path.relative(root, scope) || '.', exitCode: response.code,
    filesScanned: Array.isArray(parsed.paths?.scanned) ? parsed.paths.scanned.length : null,
    findingCount: parsed.results.length, truncated: parsed.results.length > findings.length,
    bySeverity, findings};
}

export async function codeWorkspace(input: ObjectValue, context: ToolContext): Promise<ObjectValue> {
  const operation = input.operation;
  assert(operation === 'read' || operation === 'edit' || operation === 'run' || operation === 'scan' || operation === 'scaffold',
    'CODE_OPERATION_INVALID', 'Choose read, edit, run, scan or scaffold.');
  if (operation === 'scaffold') return scaffoldCode(input, context.signal);
  const projectId = input.project;
  assert(typeof projectId === 'string' && /^[a-z0-9-]{1,80}$/.test(projectId),
    'CODE_PROJECT_INVALID', 'Choose a connected working project id.');
  const roots = await workingRoots();
  const root = roots.find(entry => entry.id === projectId);
  assert(root, 'CODE_PROJECT_UNKNOWN', 'That project is not a connected working clone. Connect it first.', 404);
  assert(root.access !== 'off', 'CODE_PROJECT_DISABLED', 'Code access for this project is switched off. Enable it first.', 403);
  try {
    await mkdir(root.path, {recursive: true});
  } catch {
    throw new Error('The working project folder is unavailable.');
  }
  context.signal.throwIfAborted();
  if (operation === 'read') return readCode(root.path, input);
  if (operation === 'edit') return editCode(root.path, input, context.signal);
  if (operation === 'scan') return scanCode(root.path, input, context.signal);
  return runCode(root.path, input, context.signal);
}
