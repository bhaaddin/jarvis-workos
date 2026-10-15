'use strict';
const $ = (id) => document.getElementById(id);
const state = { projects: [], current: null, root: '', folder: '', file: '', start: 1, tab: 'overview', conversations: new Map(), busy: new Set(), reviews: new Map(), reviewBusy: new Set(), chatDrafts: new Map(), reviewDrafts: new Map(), epoch: 0, treeSequence: 0, searchSequence: 0, readSequence: 0 };
const element = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };

async function api(path, body, method = body ? 'POST' : 'GET') {
  const response = await fetch(path, { method, credentials: 'same-origin', headers: body ? {'Content-Type': 'application/json'} : {}, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result;
}
function notice(message, error = false) { $('notice').textContent = message; $('notice').className = `notice${error ? ' error' : ''}`; $('notice').hidden = !message; }
function tool(action, extra = {}) { return api('/api/tool', {action, project: state.current, root: state.root, ...extra}); }
async function loadProjects(preferred) {
  state.projects = (await api('/api/projects')).projects;
  const navigation = $('projects'); navigation.replaceChildren();
  for (const project of state.projects) {
    const button = element('button', project.name, 'project-button'); button.dataset.project = project.id;
    button.append(element('small', `${project.roots.length} connected folder${project.roots.length === 1 ? '' : 's'}`));
    button.addEventListener('click', () => selectProject(project.id).catch(showError)); navigation.append(button);
  }
  if (state.projects.length) await selectProject(preferred || state.current || state.projects[0].id);
  else { $('welcome').hidden = false; $('workspace').hidden = true; }
}
async function selectProject(id) {
  window.JarvisVoice?.cancel();
  saveDrafts(); const epoch = ++state.epoch;
  const project = state.projects.find(p => p.id === id) || state.projects[0];
  state.current = project.id; state.folder = ''; state.file = ''; state.root = project.roots[0].id;
  restoreDrafts(); $('file-entries').replaceChildren();
  $('source-content').textContent = 'Select a file from this project folder.'; $('source-title').textContent = 'Choose a source file';
  $('search-results').hidden = true; $('previous-page').hidden = true; $('next-page').hidden = true;
  $('project-title').textContent = project.name; $('welcome').hidden = true; $('workspace').hidden = false;
  document.querySelectorAll('.project-button').forEach(button => { button.classList.toggle('active', button.dataset.project === state.current); });
  $('root-select').replaceChildren(...project.roots.map(root => { const option = element('option', root.label); option.value = root.id; return option; }));
  $('root-cards').replaceChildren(element('p', 'Reading live project context…', 'muted'));
  notice(''); renderMessages(); renderReview(); await showTab('overview');
  const overview = await tool('overview');
  if (state.epoch === epoch) renderOverview(overview);
}
function renderOverview(project) {
  const cards = $('root-cards'); cards.replaceChildren();
  for (const root of project.roots) {
    const card = element('article', undefined, 'panel root-card'); card.append(element('h3', root.label), element('div', root.path, 'path'));
    if (!root.available) { card.append(element('p', root.error, 'muted')); cards.append(card); continue; }
    const stack = element('div'); for (const name of root.stack) stack.append(element('span', name, 'pill')); card.append(stack);
    const metrics = element('div', undefined, 'metrics');
    for (const [value, label] of [[root.source_files, 'source files'], [root.git.change_count || 0, 'changed source paths']]) {
      const metric = element('div', undefined, 'metric'); metric.append(element('strong', value.toLocaleString()), element('small', label)); metrics.append(metric);
    }
    card.append(metrics, element('div', root.git.repository ? `⑂ ${root.git.branch} · ${root.git.head || 'no commit yet'}` : 'Local source folder', 'branch'));
    if (root.index_truncated) card.append(element('p', 'Source inventory reached its scan limit.', 'muted'));
    if (root.git.changes.length) {
      const list = element('ul', undefined, 'change-list'); for (const change of root.git.changes.slice(0, 6)) list.append(element('li', `${change.status} ${change.path}`));
      if (root.git.change_count > 6) list.append(element('li', `+ ${root.git.change_count - 6} more changed source paths`)); card.append(list);
    }
    for (const instruction of root.instructions) {
      const detail = element('details', undefined, 'instruction'); detail.append(element('summary', `Instructions · ${instruction.path}`), element('pre', instruction.content));
      if (instruction.truncated) detail.append(element('p', 'Preview truncated. Read the file in Source explorer for more.', 'muted')); card.append(detail);
    }
    cards.append(card);
  }
}
async function showTab(name) {
  if (name !== 'chat') window.JarvisVoice?.cancel();
  state.tab = name;
  document.querySelectorAll('.view').forEach(view => { view.hidden = view.id !== name; });
  document.querySelectorAll('.tab').forEach(tab => { const active = tab.dataset.tab === name; tab.classList.toggle('active', active); if (active) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current'); });
  if (name === 'files') await loadTree();
  if (name === 'chat') renderMessages();
  if (name === 'review' && !state.reviews.has(state.current)) {
    const project = state.current;
    const result = await api(`/api/reviews?project=${encodeURIComponent(project)}`);
    if (result.jobs.length) {
      const job = result.jobs[0];
      state.reviews.set(project, `${job.status.toUpperCase()} · Saved job ${job.id}\n\n${job.answer || job.error || 'Use Resume last job status to follow this job.'}${job.artifacts ? '\n\nFull execution record: ' + job.artifacts : ''}`);
      if (['queued','running'].includes(job.status)) sessionStorage.setItem(`jarvis-review-${project}`, JSON.stringify({id: job.id, root: ''}));
    }
    if (state.current === project) renderReview();
  }
}
async function loadTree() {
  const epoch = state.epoch; const sequence = ++state.treeSequence; $('file-entries').replaceChildren(element('p', 'Loading source…', 'muted'));
  const selection = `${state.current}/${state.root}/${state.folder}`;
  const tree = await tool('tree', {path: state.folder});
  if (selection !== `${state.current}/${state.root}/${state.folder}` || epoch !== state.epoch || sequence !== state.treeSequence) return;
  $('folder-path').textContent = '/' + tree.path; $('file-entries').replaceChildren();
  for (const entry of tree.entries) {
    const button = element('button', `${entry.kind === 'folder' ? '▸' : '·'}  ${entry.name}`, `file-entry ${entry.kind}`);
    button.addEventListener('click', () => { if (epoch !== state.epoch) return; if (entry.kind === 'folder') { state.folder = entry.path; loadTree().catch(showError); } else readFile(entry.path).catch(showError); });
    $('file-entries').append(button);
  }
  if (!tree.entries.length) $('file-entries').append(element('p', 'No source files in this folder.', 'muted'));
  if (tree.truncated) $('file-entries').append(element('p', 'Showing a bounded source view.', 'muted'));
}
async function readFile(path, start = 1) {
  const epoch = state.epoch;
  const sequence = ++state.readSequence;
  const selection = `${state.current}/${state.root}`;
  const result = await tool('read', {path, start, limit: 160});
  if (selection !== `${state.current}/${state.root}` || sequence !== state.readSequence || epoch !== state.epoch) return;
  state.file = path; state.start = start;
  $('source-title').textContent = `${state.root}/${path} · ${result.total_lines} lines`;
  $('source-content').textContent = result.content || '(empty file)';
  $('previous-page').hidden = start <= 1; $('next-page').hidden = start + 160 > result.total_lines;
}
function conversation() {
  if (!state.conversations.has(state.current)) {
    const key = `jarvis-thread-${state.current}`;
    let thread = sessionStorage.getItem(key); if (!thread) { thread = crypto.randomUUID(); sessionStorage.setItem(key, thread); }
    state.conversations.set(state.current, {thread, messages: []});
  }
  return state.conversations.get(state.current);
}
function renderMessages() {
  if (!state.current) return;
  const messages = conversation().messages; $('messages').replaceChildren();
  for (const message of messages) {
    const node = element('div', undefined, `message ${message.role}`); node.append(element('strong', message.role === 'user' ? 'YOU' : message.role === 'error' ? 'REQUEST STATUS' : 'JARVIS'), document.createTextNode(message.text)); $('messages').append(node);
    window.JarvisVoice?.decorate(node, message);
  }
  if (!messages.length) $('messages').append(element('p', 'Your project instructions and live Git context are included. Ask for source evidence when you need an exact answer.', 'muted'));
  const busy = state.busy.has(state.current); $('send-message').disabled = busy || !!window.JarvisVoice?.isRecording(); $('new-chat').disabled = busy;
  $('chat-state').textContent = busy ? 'JARVIS is working with your project tools…' : 'Uses your configured assistant model';
  $('messages').scrollTop = $('messages').scrollHeight;
}
function showError(error) { notice(error.message, true); }
function saveDrafts() { if (!state.current) return; state.chatDrafts.set(state.current, $('chat-message').value); state.reviewDrafts.set(`${state.current}/${state.root}`, {files: $('review-files').value, task: $('review-task').value, mode: $('review-mode').value}); }
function restoreDrafts() { $('chat-message').value = state.chatDrafts.get(state.current) || ''; const draft = state.reviewDrafts.get(`${state.current}/${state.root}`) || {}; $('review-files').value = draft.files || ''; $('review-task').value = draft.task || ''; $('review-mode').value = draft.mode || 'review'; }
function renderReview() { const text = state.reviews.get(state.current); $('review-result').hidden = !text; $('review-result').textContent = text || ''; $('run-review').disabled = state.reviewBusy.has(state.current); $('resume-review').hidden = state.reviewBusy.has(state.current) || !sessionStorage.getItem(`jarvis-review-${state.current}`); }
function openConnect() { $('connect-error').textContent = ''; $('connect-dialog').showModal(); $('project-name').focus(); }
$('connect-project').onclick = openConnect; $('welcome-connect').onclick = openConnect;
$('close-connect').onclick = () => $('connect-dialog').close();
$('connect-form').addEventListener('submit', async event => {
  event.preventDefault(); $('save-project').disabled = true;
  try {
    const roots = $('project-folders').value.split('\n').map(s => s.trim()).filter(Boolean).map(line => { const at = line.indexOf('='); return at > 0 ? {label: line.slice(0, at).trim(), path: line.slice(at + 1).trim()} : {path: line}; });
    const project = await api('/api/projects', {name: $('project-name').value.trim(), roots});
    $('connect-dialog').close(); await loadProjects(project.id); $('connect-form').reset(); notice('Project connected. Its source is ready for JARVIS.');
  } catch (error) { $('connect-error').textContent = error.message; }
  finally { $('save-project').disabled = false; }
});
document.querySelectorAll('.tab').forEach(tab => tab.onclick = () => showTab(tab.dataset.tab).catch(showError));
$('refresh').onclick = () => loadProjects().catch(showError);
$('ask-project').onclick = () => showTab('chat').catch(showError);
$('root-select').onchange = () => { window.JarvisVoice?.cancel(); saveDrafts(); state.epoch++; state.root = $('root-select').value; restoreDrafts(); state.folder = ''; state.file = ''; $('file-entries').replaceChildren(); $('source-content').textContent = 'Select a file from this project folder.'; $('source-title').textContent = 'Choose a source file'; $('search-results').hidden = true; $('previous-page').hidden = true; $('next-page').hidden = true; if (state.tab === 'files') loadTree().catch(showError); };
$('parent-folder').onclick = () => { state.folder = state.folder.split('/').slice(0, -1).join('/'); loadTree().catch(showError); };
$('previous-page').onclick = () => readFile(state.file, Math.max(1, state.start - 160)).catch(showError);
$('next-page').onclick = () => readFile(state.file, state.start + 160).catch(showError);
$('search-form').onsubmit = async event => {
  event.preventDefault(); const selection = `${state.current}/${state.root}`; const epoch = state.epoch; const sequence = ++state.searchSequence;
  try {
    const result = await tool('search', {query: $('search-query').value});
    if (selection !== `${state.current}/${state.root}` || epoch !== state.epoch || sequence !== state.searchSequence) return;
    const list = $('search-results'); list.hidden = false; list.replaceChildren(element('h3', `${result.hits.length} matches${result.truncated ? ' · bounded search' : ''}`));
    for (const hit of result.hits) { const button = element('button', `${hit.path}:${hit.line}`, 'search-hit'); button.append(element('small', hit.preview)); button.onclick = () => readFile(hit.path, Math.max(1, hit.line - 10)).catch(showError); list.append(button); }
    if (!result.hits.length) list.append(element('p', 'No matches in the scanned source files.', 'muted'));
  } catch (error) { showError(error); }
};
document.querySelectorAll('[data-prompt]').forEach(button => button.onclick = () => { $('chat-message').value = button.dataset.prompt; $('chat-message').focus(); });
$('new-chat').onclick = () => { window.JarvisVoice?.cancel(); state.conversations.delete(state.current); sessionStorage.removeItem(`jarvis-thread-${state.current}`); renderMessages(); };
$('chat-form').onsubmit = async event => {
  event.preventDefault(); const project = state.current; if (state.busy.has(project) || window.JarvisVoice?.isRecording()) return;
  const message = $('chat-message').value.trim(); if (!message) return;
  const chat = conversation(); chat.messages.push({role: 'user', text: message}); state.busy.add(project); $('chat-message').value = ''; state.chatDrafts.set(project, ''); renderMessages();
  try { const result = await api('/api/chat', {project, message, thread: chat.thread}); chat.messages.push({role: 'assistant', text: result.answer}); }
  catch (error) { chat.messages.push({role: 'error', text: error.message}); }
  finally { state.busy.delete(project); if (state.current === project) renderMessages(); }
};
$('open-coding').onclick = async () => { try { const result = await api('/api/coding/open', {project: state.current, root: state.root}); notice(`Opened ${result.engine} in ${result.folder}.`); } catch (error) { showError(error); } };
async function watchReview(project, root, job) {
  state.reviewBusy.add(project);
  const display = text => { state.reviews.set(project, text); if (state.current === project) renderReview(); };
  sessionStorage.setItem(`jarvis-review-${project}`, JSON.stringify({id: job.id, root}));
  try {
    while (['queued','running'].includes(job.status)) {
      display(`${job.status === 'queued' ? 'Queued' : 'Working'} · Job ${job.id} · ${root}\nThe coding worker is reviewing your selected source snapshots.`);
      await new Promise(resolve => setTimeout(resolve, 1500)); job = await api(`/api/reviews/${job.id}`);
    }
    display(`${job.status.toUpperCase()} · ${job.id} · ${root}\n\n${job.answer || job.error || (job.errors || []).join('\n') || 'Check the job record for its current status.'}\n\n${job.applied === false ? 'Source changes have not been applied.' : ''}${job.artifacts ? '\nFull execution record: ' + job.artifacts : ''}`);
    sessionStorage.removeItem(`jarvis-review-${project}`);
  } catch (error) { display(`${error.message}\nJob ${job.id} may still be running. Use Resume last job status.`); }
  finally { state.reviewBusy.delete(project); if (state.current === project) renderReview(); }
}
$('review-form').onsubmit = async event => {
  event.preventDefault(); const project = state.current; const root = state.root; if (state.reviewBusy.has(project)) return;
  state.reviewBusy.add(project); renderReview();
  try {
    const job = await api('/api/reviews', {project, root, mode: $('review-mode').value, task: $('review-task').value, files: $('review-files').value.split('\n').map(s => s.trim()).filter(Boolean)});
    await watchReview(project, root, job);
  } catch (error) { state.reviews.set(project, error.message); }
  finally { state.reviewBusy.delete(project); if (state.current === project) renderReview(); }
};
const resumeReview = element('button', 'Resume last job status', 'button'); resumeReview.id = 'resume-review'; resumeReview.hidden = true; $('review-result').before(resumeReview);
resumeReview.onclick = async () => { const project = state.current; const saved = JSON.parse(sessionStorage.getItem(`jarvis-review-${project}`) || 'null'); if (!saved) return; try { await watchReview(project, saved.root, await api(`/api/reviews/${saved.id}`)); } catch (error) { showError(error); } };
loadProjects().catch(showError);
