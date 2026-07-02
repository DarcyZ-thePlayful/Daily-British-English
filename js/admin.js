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

const el = (id) => document.getElementById(id);

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

async function loadData() {
  try {
    const [sRes, dRes] = await Promise.all([
      fetch('data/sentences.json'),
      fetch('data/dictionary.json')
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
  sel.innerHTML = sentencesData.lessons.map(l =>
    `<option value="${l.id}">${l.title} (${l.id})</option>`
  ).join('') + `<option value="__new__">+ New lesson…</option>`;
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

function downloadRecording() {
  if (!recordedBlob) { alert('Record something first.'); return; }
  const id = el('sentenceId').value.trim();
  if (!id) { alert('Type a sentence ID first (e.g. l01-s04) so the audio file is named correctly.'); return; }
  const ext = extFromMimeType(recordedMimeType);
  const a = document.createElement('a');
  a.href = recordedUrl;
  a.download = `${id}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
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
    lesson = { id: newId, title: newTitle, titleZh: newTitleZh, sentences: [] };
    sentencesData.lessons.push(lesson);
    lessonId = newId;
  } else {
    lesson = sentencesData.lessons.find(l => l.id === lessonId);
  }

  const entry = { id, en, zh, audio: `audio/${id}.${extFromMimeType(recordedMimeType)}`, words };
  const existingIdx = lesson.sentences.findIndex(s => s.id === id);
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
  deleteRecording();
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

/* ---------- Preview + export ---------- */

function refreshPreview() {
  el('sentenceCount').textContent = sentencesData.lessons.reduce((sum, l) => sum + l.sentences.length, 0);
  el('lessonCount').textContent = sentencesData.lessons.length;
  el('dictCount').textContent = Object.keys(dictionaryData).length;
  el('sentencesOutput').textContent = JSON.stringify(sentencesData, null, 2);
  el('dictionaryOutput').textContent = JSON.stringify(dictionaryData, null, 2);
  el('downloadSentencesBtn').disabled = !dataDirty.sentences;
  el('downloadDictionaryBtn').disabled = !dataDirty.dictionary;
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
  loadData();
  el('lessonSelect').addEventListener('change', toggleNewLessonFields);
  el('startRecBtn').addEventListener('click', startRecording);
  el('stopRecBtn').addEventListener('click', stopRecording);
  el('reRecordBtn').addEventListener('click', reRecord);
  el('deleteRecBtn').addEventListener('click', deleteRecording);
  el('downloadRecBtn').addEventListener('click', downloadRecording);
  el('addSentenceBtn').addEventListener('click', addSentence);
  el('addDictWordBtn').addEventListener('click', addDictionaryWord);
  el('downloadSentencesBtn').addEventListener('click', () => downloadJSON(sentencesData, 'sentences.json'));
  el('downloadDictionaryBtn').addEventListener('click', () => downloadJSON(dictionaryData, 'dictionary.json'));
  el('tab-sentence').addEventListener('click', () => showTab('sentence'));
  el('tab-dictionary').addEventListener('click', () => showTab('dictionary'));
});
