let LESSONS = [];
let DICTIONARY = {};

const app = document.getElementById('app');

async function init() {
  try {
    const [sentencesRes, dictRes] = await Promise.all([
      fetch('data/sentences.json'),
      fetch('data/dictionary.json')
    ]);
    const data = await sentencesRes.json();
    LESSONS = data.lessons || [];
    DICTIONARY = await dictRes.json();
    renderLessonList();
  } catch (e) {
    app.innerHTML = `
      <header class="top">
        <div class="eyebrow">Daily British English</div>
        <h1>Content didn't load</h1>
        <p>This usually means the page was opened directly as a file. It needs to run from a real web address (like GitHub Pages) or a local server to load the lesson data.</p>
      </header>
    `;
  }
}

function renderLessonList() {
  app.innerHTML = `
    <header class="top">
      <div class="eyebrow">Daily British English</div>
      <h1>Pick a lesson</h1>
      <p>Tap a lesson, listen to each line, and click any underlined word to learn it.</p>
    </header>
    <div class="lesson-list">
      ${LESSONS.map((lesson, i) => `
        <button class="lesson-btn" data-lesson="${lesson.id}">
          <div class="titles">
            <span class="num">${String(i + 1).padStart(2, '0')}</span>${lesson.title}
            <div class="zh">${lesson.titleZh || ''}</div>
          </div>
          <div class="count">${lesson.sentences.length} lines</div>
        </button>
      `).join('')}
    </div>
  `;
  app.querySelectorAll('.lesson-btn').forEach(btn => {
    btn.addEventListener('click', () => renderLesson(btn.dataset.lesson));
  });
}

function renderLesson(lessonId) {
  const lesson = LESSONS.find(l => l.id === lessonId);
  if (!lesson) return renderLessonList();

  app.innerHTML = `
    <button class="back-link">&larr; All lessons</button>
    <header class="top">
      <div class="eyebrow">Lesson</div>
      <h1>${lesson.title}</h1>
      <p>${lesson.titleZh || ''}</p>
    </header>
    <div class="sentence-list">
      ${lesson.sentences.map(s => sentenceCardHtml(s)).join('')}
    </div>
  `;

  app.querySelector('.back-link').addEventListener('click', renderLessonList);

  lesson.sentences.forEach(s => {
    const card = app.querySelector(`[data-sentence="${s.id}"]`);
    const audioEl = card.querySelector('audio');
    const playBtn = card.querySelector('.play-btn');
    playBtn.addEventListener('click', () => {
      audioEl.currentTime = 0;
      audioEl.play().catch(() => {
        playBtn.textContent = '⚠ audio not found yet';
      });
    });
    card.querySelectorAll('.word').forEach(w => {
      w.addEventListener('click', () => showWordPopup(w.dataset.word));
    });
  });
}

function sentenceCardHtml(s) {
  return `
    <div class="sentence-card" data-sentence="${s.id}">
      <div class="en">${highlightWords(s.en, s.words || [])}</div>
      <div class="zh">${s.zh}</div>
      <div class="controls">
        <button class="play-btn">▶ Play</button>
        <audio preload="none" src="${s.audio}"></audio>
      </div>
    </div>
  `;
}

function highlightWords(text, words) {
  if (!words || !words.length) return escapeHtml(text);
  const sorted = [...words].sort((a, b) => b.length - a.length);
  const pattern = sorted.map(w => escapeRegex(w)).join('|');
  const re = new RegExp(`(${pattern})`, 'gi');
  const parts = text.split(re);
  return parts.map(part => {
    const match = sorted.find(w => w.toLowerCase() === part.toLowerCase());
    if (match) {
      return `<span class="word" data-word="${match.toLowerCase()}">${escapeHtml(part)}</span>`;
    }
    return escapeHtml(part);
  }).join('');
}

function showWordPopup(wordKey) {
  const entry = DICTIONARY[wordKey];
  const backdrop = document.createElement('div');
  backdrop.className = 'popup-backdrop';
  backdrop.innerHTML = `
    <div class="popup">
      <div class="word-title">${wordKey}</div>
      <div class="word-zh">${entry ? entry.zh : '（词典还没有收录，稍后补充）'}</div>
      ${entry && entry.note ? `<div class="word-note">${entry.note}</div>` : ''}
      <button class="close-btn">Close</button>
    </div>
  `;
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.remove();
  });
  backdrop.querySelector('.close-btn').addEventListener('click', () => backdrop.remove());
  document.body.appendChild(backdrop);
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

init();
