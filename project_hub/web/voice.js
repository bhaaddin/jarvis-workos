'use strict';
// Capture and playback belong to the current project conversation.
const voice = {ready: false, mime: '', recording: null, playback: null};
const voiceBar = element('div', undefined, 'suggestions');
voiceBar.setAttribute('role', 'group'); voiceBar.setAttribute('aria-label', 'Voice controls');
const recordButton = element('button', 'Record dictation', 'button compact');
const stopButton = element('button', 'Stop playback', 'button compact');
const retryVoice = element('button', 'Check voice', 'button compact');
const voiceSelect = element('select'); voiceSelect.id = 'voice-select';
const voiceLabel = element('label', 'Reading voice'); voiceLabel.htmlFor = voiceSelect.id;
const voiceStatus = element('p', 'Checking local voice…', 'muted');
voiceStatus.setAttribute('role', 'status'); voiceStatus.setAttribute('aria-live', 'polite');
const audioPlayer = element('audio'); audioPlayer.controls = true; audioPlayer.hidden = true;
audioPlayer.setAttribute('aria-label', 'Spoken answer'); audioPlayer.className = 'wide';
for (const button of [recordButton, stopButton, retryVoice]) button.type = 'button';
voiceBar.append(recordButton, voiceLabel, voiceSelect, stopButton, retryVoice);
$('chat-message').after(voiceBar, voiceStatus, audioPlayer);

function voiceMessage(text, error = false) { voiceStatus.textContent = text; voiceStatus.className = error ? 'notice error' : 'muted'; }
function updateVoiceControls() {
  const job = voice.recording;
  recordButton.disabled = !job && (!voice.ready || !voice.mime || !state.current);
  recordButton.textContent = !job ? 'Record dictation' : job.phase === 'recording' ? 'Stop recording' : 'Cancel dictation';
  recordButton.setAttribute('aria-pressed', String(job?.phase === 'recording'));
  stopButton.disabled = !voice.playback; voiceSelect.disabled = !voice.ready;
  if (state.current) renderMessages();
}
function stopTracks(job) { job.stream?.getTracks().forEach(track => track.stop()); }
function releaseRecording(job) {
  clearTimeout(job.timer); job.controller.abort();
  if (voice.recording === job) voice.recording = null;
  try { if (job.recorder && job.recorder.state !== 'inactive') job.recorder.stop(); }
  finally { stopTracks(job); job.chunks = []; }
}
function recordingMatches(job) { return voice.recording === job && state.current === job.project && state.conversations.get(job.project)?.thread === job.thread; }
function failRecording(job, error) {
  if (voice.recording !== job) return;
  releaseRecording(job); voiceMessage(error.message || 'Recording failed.', true); updateVoiceControls();
}
function stopPlayback() {
  const job = voice.playback; voice.playback = null;
  if (job) {
    job.controller.abort(); audioPlayer.onended = audioPlayer.onerror = null;
    audioPlayer.pause(); audioPlayer.removeAttribute('src'); audioPlayer.load(); audioPlayer.hidden = true;
    if (job.url) URL.revokeObjectURL(job.url);
  }
  stopButton.disabled = true;
}
function cancelVoice() {
  const active = voice.recording || voice.playback;
  if (voice.recording) releaseRecording(voice.recording);
  stopPlayback(); if (active) voiceMessage('Voice activity stopped.'); updateVoiceControls();
}
async function voiceFetch(path, options) {
  const response = await fetch(path, {credentials: 'same-origin', ...options});
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Voice request failed (${response.status}).`);
  }
  return response;
}
function finishRecording(job) {
  if (!recordingMatches(job) || job.phase !== 'recording') return;
  job.phase = 'transcribing'; clearTimeout(job.timer);
  try { job.recorder.stop(); }
  catch (error) { failRecording(job, error); return; }
  finally { stopTracks(job); }
  voiceMessage('Transcribing locally…'); updateVoiceControls();
}
async function transcribeRecording(job) {
  stopTracks(job); clearTimeout(job.timer);
  if (!recordingMatches(job)) return;
  try {
    if (performance.now() - job.started > 60000 && !job.stoppedInTime) throw new Error('Recording exceeded 60 seconds; discarded.');
    const blob = new Blob(job.chunks, {type: job.recorder.mimeType}); job.chunks = [];
    if (!blob.size || blob.size > 10 * 1024 * 1024) throw new Error('Recording must contain audio and be at most 10 MiB.');
    const type = blob.type.split(';')[0].toLowerCase();
    if (!['audio/webm', 'audio/ogg', 'audio/wav'].includes(type)) throw new Error('Unsupported recording format.');
    const response = await voiceFetch('/api/voice/transcribe', {method:'POST', headers:{'Content-Type':type}, body:blob, signal:job.controller.signal});
    const result = await response.json();
    if (!recordingMatches(job)) return;
    if (typeof result.text !== 'string' || !result.text.trim()) throw new Error('No speech was recognized. Try speaking closer to the microphone.');
    const composer = $('chat-message');
    const text = composer.value + (composer.value ? '\n' : '') + result.text.trim();
    if (text.length > composer.maxLength) throw new Error('The transcript is too long for this draft. Record a shorter segment.');
    composer.value = text; state.chatDrafts.set(job.project, text);
    voiceMessage('Transcript ready. Edit it or select Send.'); composer.focus();
  } catch (error) { if (recordingMatches(job)) voiceMessage(error.message, true); }
  finally { if (voice.recording === job) { releaseRecording(job); updateVoiceControls(); } }
}
recordButton.onclick = async () => {
  const active = voice.recording;
  if (active) {
    if (active.phase === 'recording') { active.stoppedInTime = performance.now() - active.started <= 60000; finishRecording(active); }
    else cancelVoice();
    return;
  }
  if (!voice.ready || !voice.mime || !state.current) return;
  stopPlayback();
  const job = {project:state.current, thread:conversation().thread, phase:'permission', controller:new AbortController(), chunks:[], bytes:0};
  voice.recording = job; voiceMessage('Opening microphone…'); updateVoiceControls();
  try {
    job.stream = await navigator.mediaDevices.getUserMedia({audio:true});
    if (!recordingMatches(job)) { stopTracks(job); return; }
    job.recorder = new MediaRecorder(job.stream, {mimeType:voice.mime});
    job.recorder.ondataavailable = event => {
      if (!recordingMatches(job)) return;
      job.bytes += event.data.size;
      if (job.bytes > 10 * 1024 * 1024) { failRecording(job, new Error('Recording exceeded 10 MiB; discarded.')); return; }
      job.chunks.push(event.data);
    };
    job.recorder.onerror = () => failRecording(job, new Error('Microphone recording failed.'));
    job.recorder.onstop = () => { void transcribeRecording(job); };
    job.stream.getAudioTracks().forEach(track => { track.onended = () => { if (job.phase === 'recording') failRecording(job, new Error('Microphone disconnected; recording discarded.')); }; });
    job.recorder.start(250); job.started = performance.now(); job.phase = 'recording';
    job.timer = setTimeout(() => { job.stoppedInTime = performance.now() - job.started <= 60000; finishRecording(job); }, 59500);
    voiceMessage('Recording — select Stop recording. Up to 60 seconds.'); updateVoiceControls();
  } catch (error) { stopTracks(job); failRecording(job, error); }
};
async function speakAnswer(text) {
  if (!voice.ready || voice.recording || !text) return;
  if (text.length > 6000) { voiceMessage('This answer is longer than the 6,000-character reading limit. Ask for a spoken summary.', true); return; }
  stopPlayback(); const job = {controller:new AbortController()}; voice.playback = job;
  stopButton.disabled = false; voiceMessage('Preparing local speech…');
  try {
    const response = await voiceFetch('/api/voice/speak', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({text, voice:voiceSelect.value}), signal:job.controller.signal});
    if (response.headers.get('Content-Type')?.split(';')[0].trim() !== 'audio/wav') throw new Error('Speech service did not return WAV audio.');
    const blob = await response.blob(); if (voice.playback !== job) return;
    job.url = URL.createObjectURL(blob); audioPlayer.src = job.url; audioPlayer.hidden = false;
    audioPlayer.onended = () => { if (voice.playback === job) { stopPlayback(); voiceMessage('Playback finished.'); } };
    audioPlayer.onerror = () => { if (voice.playback === job) { stopPlayback(); voiceMessage('Audio playback failed.', true); } };
    try { await audioPlayer.play(); if (voice.playback === job) voiceMessage('Reading aloud…'); }
    catch { if (voice.playback === job) voiceMessage('Audio ready. Select Play in the audio controls.'); }
  } catch (error) { if (voice.playback === job) { stopPlayback(); voiceMessage(error.message, true); } }
}
async function checkVoice() {
  retryVoice.disabled = true;
  try {
    const status = await api('/api/voice/status');
    if (!status.available) throw new Error(status.message || 'Local voice is unavailable.');
    if (!Array.isArray(status.voices) || !status.voices.length || !status.voices.every(id => typeof id === 'string')) throw new Error('Invalid voice catalog.');
    const labels = {bm_george:'George · British male', af_heart:'Heart · American female', bf_emma:'Emma · British female', am_michael:'Michael · American male'};
    voiceSelect.replaceChildren(...status.voices.map(id => { const option = element('option', labels[id] || id); option.value = id; return option; }));
    voice.ready = true;
    if (window.isSecureContext && navigator.mediaDevices?.getUserMedia && window.MediaRecorder) voice.mime = ['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/webm','audio/ogg','audio/wav'].find(type => MediaRecorder.isTypeSupported(type)) || '';
    voiceMessage(voice.mime ? 'Local voice ready. Record a message or read an answer aloud.' : 'Read-aloud ready. This browser does not support the recording formats.');
  } catch (error) { voice.ready = false; voiceMessage(error.message, true); }
  finally { retryVoice.disabled = false; updateVoiceControls(); }
}
stopButton.onclick = () => { stopPlayback(); voiceMessage('Playback stopped.'); };
retryVoice.onclick = checkVoice;
window.addEventListener('pagehide', cancelVoice);
document.addEventListener('visibilitychange', () => { if (document.hidden && voice.recording) cancelVoice(); });
window.JarvisVoice = {
  cancel:cancelVoice, isRecording:() => !!voice.recording,
  decorate(node, message) {
    if (message.role !== 'assistant') return;
    const read = element('button', 'Read aloud', 'button compact'); read.type = 'button';
    read.disabled = !voice.ready || !!voice.recording; read.onclick = () => speakAnswer(message.text);
    node.append(element('br'), read);
  },
};
updateVoiceControls(); checkVoice();
