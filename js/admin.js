let sentencesData = { lessons: [] };
let dictionaryData = {};
let mediaRecorder = null;
let mediaStream = null;
let audioChunks = [];
let recordedBlob = null;
let recordedUrl = null;
let recordedMimeType = '';
let timerInterval = null;
let recordStart = null;
let dataDirty = { sentences: false, dictionary: false };
let pendingAudio = {}; // sentenceId -> { blob, ext }
let activeRecordingContext = null; // { lessonId, sentenceId }
const recentlyPublishedAudio = new Set(); // sentenceId -> uploaded this session
const expandedLessons = new Set(); // lessonId -> currently expanded in "Your lessons"

const el = (id) => document.getElementById(id);

/* ---------- Audio format helpers ---------- */

function getSupportedMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/ogg;codecs=opus'
  ];
  for (const type of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return '';
}

function extFromMimeType(mime) {
  if (!mime) return 'webm';
  if (mime.includes('mp4')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  return 'webm';
}

/* ---------- GitHub settings ---------- */

function getGitHubSettings() {
  return {
    owner: localStorage.getItem('gh_owner') || '',
    repo: localStorage.getItem('gh_repo') || '',
    branch: localStorage.getItem('gh_branch') || 'main',
    token: localStorage.getItem('gh_token') || ''
  };
}

function isGitHubConfigured() {
  const s = getGitHubSettings();
  return !!(s.owner && s.repo && s.token);
}

function loadGitHubSettingsIntoForm() {
  const s = getGitHubSettings();
  el('ghOwner').value = s.owner;
  el('ghRepo').value = s.repo;
  el('ghBranch').value = s.branch;
  el('ghToken').value = s.token;
  updateGitHubStatus();
}

function saveGitHubSettings() {
  localStorage.setItem('gh_owner', el('ghOwner').value.trim());
  localStorage.setItem('gh_repo', el('ghRepo').value.trim());
  localStorage.setItem('gh_branch', el('ghBranch').value.trim() || 'main');
  localStorage.setItem('gh_token', el('ghToken').value.trim());
  updateGitHubStatus();
  loadData();
}

function forgetGitHubSettings() {
  ['gh_owner', 'gh_repo', 'gh_branch', 'gh_token'].forEach(k => localStorage.removeItem(k));
  loadGitHubSettingsIntoForm();
}

function updateGitHubStatus() {
  const configured = isGitHubConfigured();
  el('ghStatus').textContent = configured
    ? '✓ Connected — Publish will save straight to your repo.'
    : 'Not connected — you can still write content and download JSON backups manually.';
  el('ghStatus').className = configured ? 'hint status-ok' : 'hint';
  el('publishBtn').disabled = !configured;
}

/* ---------- GitHub API ---------- */

function utf8ToBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function githubGetFile(path) {
  const { owner, repo, branch, token } = getGitHubSettings();
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`, {
    headers: token
      ? { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' }
      : { Accept: 'application/vnd.github+json' }
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub error ${res.status} reading ${path}`);
  const data = await res.json();
  return { sha: data.sha };
}

async function githubPutFile(path, base64Content, sha) {
  const { owner, repo, branch, token } = getGitHubSettings();
  const body = { message: `Update ${path} via Content Studio`, content: base64Content, branch };
  if (sha) body.sha = sha;
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GitHub error ${res.status}: ${errText.slice(0, 200)}`);
  }
  return res.json();
}

async function publishJSONFile(path, obj) {
  const existing = await githubGetFile(path).catch(() => null);
  const content = utf8ToBase64(JSON.stringify(obj, null, 2));
  await githubPutFile(path, content, existing ? existing.sha : undefined);
}

async function publishBinaryFile(path, blob) {
  const existing = await githubGetFile(path).catch(() => null);
  const content = await blobToBase64(blob);
  await githubPutFile(path, content, existing ? existing.sha : undefined);
}

/* ---------- Publish log ---------- */

function log(msg) {
  const box = el('publishLog');
  box.textContent += (box.textContent ? '\n' : '') + msg;
  box.scrollTop = box.scrollHeight;
}

function logClear() {
  el('publishLog').textContent = '';
}

async function publishAll() {
  if (!isGitHubConfigured()) {
    alert('Set up your GitHub connection first (top of the page).');
    return;
  }
  el('publishBtn').disabled = true;
  logClear();
  log('Starting publish…');
  try {
    if (dataDirty.sentences) {
      log('Uploading data/sentences.json…');
      await publishJSONFile('data/sentences.json', sentencesData);
      log('✓ data/sentences.json updated');
      dataDirty.sentences = false;
    }
    if (dataDirty.dictionary) {
      log('Uploading data/dictionary.json…');
      await publishJSONFile('data/dictionary.json', dictionaryData);
      log('✓ data/dictionary.json updated');
      dataDirty.dictionary = false;
    }
    const ids = Object.keys(pendingAudio);
    for (const id of ids) {
      const { blob, ext } = pendingAudio[id];
      log(`Uploading audio/${id}.${ext}…`);
      await publishBinaryFile(`audio/${id}.${ext}`, blob);
      log(`✓ audio/${id}.${ext} uploaded`);
      delete pendingAudio[id];
    }
    log('All done! Your live site will reflect this within about a minute.');
  } catch (err) {
    log(`✗ ${err.message}`);
  } finally {
    refreshPreview();
    el('publishBtn').disabled = !isGitHubConfigured();
  }
}

/* ---------- Data loading ---------- */

async function loadData() {
  try {
    const [sRes, dRes] = await Promise.all([
      fetch('data/sentences.json', { cache: 'no-store' }),
      fetch('data/dictionary.json', { cache: 'no-store' })
    ]);
    sentencesData = await sRes.json();
    dictionaryData = await dRes.json();
  } catch (e) {
    sentencesData = { lessons: [] };
    dictionaryData = {};
  }
  refreshLessonSelect();
  refreshPreview();
}

function refreshLessonSelect() {
  const sel = el('lessonSelect');
  const current = sel.value;
  sel.innerHTML = sentencesData.lessons.map(l =>
    `<option value="${l.id}">${l.title} (${l.id})</option>`
  ).join('') + `<option value="__new__">+ New lesson…</option>`;
  if ([...sel.options].some(o => o.value === current)) sel.value = current;
  toggleNewLessonFields();
}

function toggleNewLessonFields() {
  const isNew = el('lessonSelect').value === '__new__';
  el('newLessonFields').style.display = isNew ? 'block' : 'none';
}

/* ---------- Recording ---------- */

async function startRecording() {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    alert('Could not access the microphone. Make sure this page is running on https:// or localhost, and that mic permission is allowed.');
    return;
  }
  audioChunks = [];
  const mimeType = getSupportedMimeType();
  mediaRecorder = mimeType ? new MediaRecorder(mediaStream, { mimeType }) : new MediaRecorder(mediaStream);
  mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
  mediaRecorder.onstop = () => {
    recordedMimeType = mediaRecorder.mimeType || mimeType || 'audio/webm';
    recordedBlob = new Blob(audioChunks, { type: recordedMimeType });
    recordedUrl = URL.createObjectURL(recordedBlob);
    el('recPlayback').src = recordedUrl;
    el('recPlaybackWrap').style.display = 'flex';
    el('useRecBtn').textContent = '✓ Use this recording';
    mediaStream.getTracks().forEach(t => t.stop());
  };
  mediaRecorder.start();
  recordStart = Date.now();
  el('recDot').classList.add('blink');
  el('startRecBtn').disabled = true;
  el('stopRecBtn').disabled = false;
  el('recPlaybackWrap').style.display = 'none';
  timerInterval = setInterval(() => {
    const secs = Math.floor((Date.now() - recordStart) / 1000);
    el('recTimer').textContent = `${String(Math.floor(secs / 60)).padStart(2,'0')}:${String(secs % 60).padStart(2,'0')}`;
  }, 200);
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  clearInterval(timerInterval);
  el('recDot').classList.remove('blink');
  el('startRecBtn').disabled = false;
  el('stopRecBtn').disabled = true;
}

function reRecord() {
  recordedBlob = null;
  recordedUrl = null;
  el('recPlaybackWrap').style.display = 'none';
  el('recTimer').textContent = '00:00';
  startRecording();
}

function deleteRecording() {
  recordedBlob = null;
  recordedUrl = null;
  el('recPlaybackWrap').style.display = 'none';
  el('recTimer').textContent = '00:00';
}

function useRecording() {
  if (!recordedBlob) { alert('Record something first.'); return; }
  const id = getTargetSentenceId();
  if (!id) { alert('Type a Sentence ID first (e.g. l01-s04) so the recording is linked to the right sentence.'); return; }
  pendingAudio[id] = { blob: recordedBlob, ext: extFromMimeType(recordedMimeType) };
  el('recStatus').textContent = `Audio ready for "${id}" — will be published when you tap "Add sentence" then "Publish".`;
}

function downloadRecording() {
  if (!recordedBlob) { alert('Record something first.'); return; }
  const id = getTargetSentenceId() || 'recording';
  const ext = extFromMimeType(recordedMimeType);
  const a = document.createElement('a');
  a.href = recordedUrl;
  a.download = `${id}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function getTargetSentenceId() {
  return (activeRecordingContext && activeRecordingContext.sentenceId) || el('sentenceId').value.trim();
}

function detachRecorderPanel() {
  const anchor = el('recordSectionAnchor');
  const panel = el('recordSection');
  anchor.insertAdjacentElement('beforebegin', panel);
}

function attachRecorderPanel() {
  if (!activeRecordingContext) return;
  const target = document.querySelector(`.list-item[data-sentence-id="${activeRecordingContext.sentenceId}"]`);
  if (target) {
    target.insertAdjacentElement('afterend', el('recordSection'));
  } else {
    // the sentence this recorder was open for no longer exists (e.g. deleted)
    activeRecordingContext = null;
    el('recordSection').classList.remove('recorder-inline');
    el('recTargetHint').style.display = 'none';
  }
}

function openRecorderForSentence(lessonId, sentenceId) {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    alert('请先停止当前录音，再切换到其他句子。');
    return;
  }
  const isSameTarget = activeRecordingContext && activeRecordingContext.sentenceId === sentenceId;
  if (recordedBlob && !confirm(isSameTarget ? '关闭录音区会丢弃当前未发布的录音，确定吗？' : '切换到其他句子会丢弃当前未发布的录音，确定吗？')) {
    return;
  }
  if (isSameTarget) {
    closeInlineRecorder();
    return;
  }
  activeRecordingContext = { lessonId, sentenceId };
  expandedLessons.add(lessonId);
  el('sentenceId').value = sentenceId;
  deleteRecording();
  el('recStatus').textContent = '';
  el('recTargetHint').textContent = `🎤 正在为 "${sentenceId}" 录音 — 录完后点击"保存并发布这段录音"直接上传到 GitHub。`;
  el('recTargetHint').style.display = 'block';
  el('recordSection').classList.add('recorder-inline');
  refreshPreview();
  el('recordSection').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function closeInlineRecorder() {
  activeRecordingContext = null;
  el('recordSection').classList.remove('recorder-inline');
  el('recTargetHint').style.display = 'none';
  deleteRecording();
  refreshPreview();
}

async function saveAndPublishRecording() {
  if (!recordedBlob) { alert('请先录音。'); return; }
  const id = getTargetSentenceId();
  if (!id) { alert('请先输入或选择 Sentence ID。'); return; }
  if (!isGitHubConfigured()) { alert('请先在页面顶部设置 GitHub 连接。'); return; }

  let audioPath = `audio/${id}.${extFromMimeType(recordedMimeType)}`;
  const lesson = sentencesData.lessons.find(l => l.sentences.some(s => s.id === id));
  const existingSentence = lesson && lesson.sentences.find(s => s.id === id);
  if (existingSentence && existingSentence.audio) {
    audioPath = existingSentence.audio;
  }

  el('publishRecBtn').disabled = true;
  el('recStatus').textContent = `正在上传 ${audioPath} …`;
  try {
    await publishBinaryFile(audioPath, recordedBlob);
    delete pendingAudio[id];
    recentlyPublishedAudio.add(id);
    el('recStatus').textContent = `✓ 已上传并发布 ${audioPath}`;
    refreshPreview();
  } catch (err) {
    el('recStatus').textContent = `✗ 上传失败：${err.message}`;
  } finally {
    el('publishRecBtn').disabled = false;
  }
}

/* ---------- Sentence form ---------- */

function addSentence() {
  const id = el('sentenceId').value.trim();
  const en = el('sentenceEn').value.trim();
  const zh = el('sentenceZh').value.trim();
  const wordsRaw = el('sentenceWords').value.trim();
  const words = wordsRaw ? wordsRaw.split(',').map(w => w.trim().toLowerCase()).filter(Boolean) : [];

  if (!id || !en || !zh) {
    alert('Please fill in the sentence ID, English sentence, and Chinese translation.');
    return;
  }

  let lessonId = el('lessonSelect').value;
  let lesson;

  if (lessonId === '__new__') {
    const newId = el('newLessonId').value.trim();
    const newTitle = el('newLessonTitle').value.trim();
    const newTitleZh = el('newLessonTitleZh').value.trim();
    if (!newId || !newTitle) {
      alert('Please fill in the new lesson ID and title.');
      return;
    }
    lesson = sentencesData.lessons.find(l => l.id === newId);
    if (!lesson) {
      lesson = { id: newId, title: newTitle, titleZh: newTitleZh, sentences: [] };
      sentencesData.lessons.push(lesson);
    }
    lessonId = newId;
  } else {
    lesson = sentencesData.lessons.find(l => l.id === lessonId);
  }

  const existingIdx = lesson.sentences.findIndex(s => s.id === id);
  const audioPath = pendingAudio[id]
    ? `audio/${id}.${pendingAudio[id].ext}`
    : (existingIdx >= 0 ? lesson.sentences[existingIdx].audio : `audio/${id}.webm`);

  const entry = { id, en, zh, audio: audioPath, words };
  if (existingIdx >= 0) {
    lesson.sentences[existingIdx] = entry;
  } else {
    lesson.sentences.push(entry);
  }

  dataDirty.sentences = true;
  refreshLessonSelect();
  el('lessonSelect').value = lessonId;
  toggleNewLessonFields();
  refreshPreview();
  clearSentenceForm();
}

function clearSentenceForm() {
  el('sentenceId').value = '';
  el('sentenceEn').value = '';
  el('sentenceZh').value = '';
  el('sentenceWords').value = '';
  el('newLessonId').value = '';
  el('newLessonTitle').value = '';
  el('newLessonTitleZh').value = '';
  el('recStatus').textContent = '';
  el('useRecBtn').textContent = '✓ Use this recording';
  el('recTargetHint').style.display = 'none';
  el('recordSection').classList.remove('recorder-inline');
  activeRecordingContext = null;
  deleteRecording();
  refreshPreview();
}

function editSentence(lessonId, sentenceId) {
  const lesson = sentencesData.lessons.find(l => l.id === lessonId);
  if (!lesson) return;
  const s = lesson.sentences.find(x => x.id === sentenceId);
  if (!s) return;
  el('lessonSelect').value = lessonId;
  toggleNewLessonFields();
  el('sentenceId').value = s.id;
  el('sentenceEn').value = s.en;
  el('sentenceZh').value = s.zh;
  el('sentenceWords').value = (s.words || []).join(', ');
  el('recStatus').textContent = 'Editing existing sentence. Leave audio as-is, or record a new take and tap "Use this recording" to replace it.';
  window.scrollTo({ top: el('panel-sentence').offsetTop - 20, behavior: 'smooth' });
}

function deleteSentence(lessonId, sentenceId) {
  const lesson = sentencesData.lessons.find(l => l.id === lessonId);
  if (!lesson) return;
  if (!confirm(`Delete sentence "${sentenceId}"? This won't delete its audio file from GitHub, only remove it from the lesson.`)) return;
  lesson.sentences = lesson.sentences.filter(s => s.id !== sentenceId);
  dataDirty.sentences = true;
  refreshPreview();
}

/* ---------- Dictionary form ---------- */

function addDictionaryWord() {
  const word = el('dictWord').value.trim().toLowerCase();
  const zh = el('dictZh').value.trim();
  const note = el('dictNote').value.trim();
  if (!word || !zh) {
    alert('Please fill in the word and its Chinese meaning.');
    return;
  }
  dictionaryData[word] = { zh, note };
  dataDirty.dictionary = true;
  el('dictWord').value = '';
  el('dictZh').value = '';
  el('dictNote').value = '';
  refreshPreview();
}

function editDictionaryWord(word) {
  const entry = dictionaryData[word];
  if (!entry) return;
  el('dictWord').value = word;
  el('dictZh').value = entry.zh || '';
  el('dictNote').value = entry.note || '';
  window.scrollTo({ top: el('panel-dictionary').offsetTop - 20, behavior: 'smooth' });
}

function deleteDictionaryWord(word) {
  if (!confirm(`Delete "${word}" from the dictionary?`)) return;
  delete dictionaryData[word];
  dataDirty.dictionary = true;
  refreshPreview();
}

/* ---------- Preview / lists ---------- */

function refreshPreview() {
  const totalSentences = sentencesData.lessons.reduce((sum, l) => sum + l.sentences.length, 0);
  el('sentenceCount').textContent = totalSentences;
  el('lessonCount').textContent = sentencesData.lessons.length;
  el('dictCount').textContent = Object.keys(dictionaryData).length;

  detachRecorderPanel();

  el('sentenceList').innerHTML = sentencesData.lessons.map(lesson => `
    <details class="lesson-group" data-lesson-id="${lesson.id}" ${expandedLessons.has(lesson.id) ? 'open' : ''}>
      <summary>${lesson.title} <span class="hint">(${lesson.id} · ${lesson.sentences.length} lines)</span></summary>
      ${lesson.sentences.map(s => {
        const isActive = activeRecordingContext && activeRecordingContext.sentenceId === s.id;
        return `
        <div class="list-item" data-sentence-id="${s.id}">
          <div>
            <div class="li-en">${escapeHtml(s.en)}</div>
            <div class="li-zh">${escapeHtml(s.zh)} <span class="hint">· ${s.id}</span></div>
          </div>
          <div class="list-actions">
            <button class="btn btn-secondary btn-small" onclick="editSentence('${lesson.id}','${s.id}')">Edit</button>
            <button class="btn ${isActive ? 'btn-primary' : 'btn-secondary'} btn-small" onclick="openRecorderForSentence('${lesson.id}','${s.id}')">${isActive ? '🎤 收起' : '🎤 录音'}</button>
            <button class="btn btn-danger btn-small" onclick="deleteSentence('${lesson.id}','${s.id}')">Delete</button>
            ${recentlyPublishedAudio.has(s.id) ? '<span class="hint status-ok">✓ 已录音</span>' : ''}
          </div>
        </div>
      `;
      }).join('') || '<p class="hint">No sentences yet.</p>'}
    </details>
  `).join('') || '<p class="hint">No lessons yet — add your first sentence above.</p>';

  attachRecorderPanel();

  const words = Object.keys(dictionaryData).sort();
  el('dictionaryList').innerHTML = words.map(w => `
    <div class="list-item">
      <div>
        <div class="li-en">${escapeHtml(w)}</div>
        <div class="li-zh">${escapeHtml(dictionaryData[w].zh || '')}</div>
      </div>
      <div class="list-actions">
        <button class="btn btn-secondary btn-small" onclick="editDictionaryWord('${w.replace(/'/g, "\\'")}')">Edit</button>
        <button class="btn btn-danger btn-small" onclick="deleteDictionaryWord('${w.replace(/'/g, "\\'")}')">Delete</button>
      </div>
    </div>
  `).join('') || '<p class="hint">No dictionary words yet.</p>';

  el('downloadSentencesBtn').disabled = !dataDirty.sentences;
  el('downloadDictionaryBtn').disabled = !dataDirty.dictionary;

  const pendingCount = Object.keys(pendingAudio).length;
  el('publishSummary').textContent =
    `Pending: ${dataDirty.sentences ? 'sentences.json changed, ' : ''}${dataDirty.dictionary ? 'dictionary.json changed, ' : ''}${pendingCount} audio file(s) waiting to upload.`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ---------- Tabs ---------- */

function showTab(name) {
  document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  el(`panel-${name}`).style.display = 'block';
  el(`tab-${name}`).classList.add('active');
}

/* ---------- Init ---------- */

window.addEventListener('DOMContentLoaded', () => {
  loadGitHubSettingsIntoForm();
  loadData();
  el('saveGhBtn').addEventListener('click', saveGitHubSettings);
  el('forgetGhBtn').addEventListener('click', forgetGitHubSettings);
  el('publishBtn').addEventListener('click', publishAll);
  el('lessonSelect').addEventListener('change', toggleNewLessonFields);
  el('startRecBtn').addEventListener('click', startRecording);
  el('stopRecBtn').addEventListener('click', stopRecording);
  el('reRecordBtn').addEventListener('click', reRecord);
  el('deleteRecBtn').addEventListener('click', deleteRecording);
  el('useRecBtn').addEventListener('click', useRecording);
  el('publishRecBtn').addEventListener('click', saveAndPublishRecording);
  el('downloadRecBtn').addEventListener('click', downloadRecording);
  el('addSentenceBtn').addEventListener('click', addSentence);
  el('addDictWordBtn').addEventListener('click', addDictionaryWord);
  el('downloadSentencesBtn').addEventListener('click', () => downloadJSON(sentencesData, 'sentences.json'));
  el('downloadDictionaryBtn').addEventListener('click', () => downloadJSON(dictionaryData, 'dictionary.json'));
  el('tab-sentence').addEventListener('click', () => showTab('sentence'));
  el('tab-dictionary').addEventListener('click', () => showTab('dictionary'));
  // 'toggle' doesn't bubble, so this must be registered with capture:true to observe it via delegation
  el('sentenceList').addEventListener('toggle', (e) => {
    const details = e.target;
    if (details.tagName !== 'DETAILS') return;
    const lessonId = details.dataset.lessonId;
    if (!lessonId) return;
    if (details.open) expandedLessons.add(lessonId);
    else expandedLessons.delete(lessonId);
  }, true);
});
