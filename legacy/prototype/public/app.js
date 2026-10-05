const recordButton = document.querySelector('#record-button');
const recordLabel = document.querySelector('#record-label');
const recordState = document.querySelector('#record-state');
const stateText = document.querySelector('#state-text');
const liveCaption = document.querySelector('#live-caption');
const browserNote = document.querySelector('#browser-note');
const thoughtList = document.querySelector('#thought-list');
const emptyState = document.querySelector('#empty-state');
const thoughtCount = document.querySelector('#thought-count');
const textInput = document.querySelector('#thought-input');
const searchInput = document.querySelector('#search');
const toast = document.querySelector('#toast');
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

let recognition;
let recording = false;
let transcript = '';
let thoughts = [];
let toastTimer;
let finishRecognition;

function announce(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
}

function setRecording(active) {
  recording = active;
  recordButton.classList.toggle('recording', active);
  recordButton.setAttribute('aria-pressed', String(active));
  recordLabel.textContent = active ? 'Tap to keep this' : 'Tap to speak';
  recordState.classList.toggle('recording', active);
  stateText.textContent = active ? 'Listening. Follow the thought wherever it goes.' : 'Nothing is saved here until you stop.';
  liveCaption.hidden = !active;
}

function renderThoughts() {
  const query = searchInput.value.trim().toLocaleLowerCase();
  const visible = thoughts.filter(thought => thought.text.toLocaleLowerCase().includes(query));
  thoughtCount.textContent = String(thoughts.length);
  thoughtList.replaceChildren();
  emptyState.hidden = visible.length > 0;
  if (!thoughts.length) return;
  if (!visible.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No thought matches that search.';
    thoughtList.append(empty);
    return;
  }
  for (const thought of visible) {
    const card = document.createElement('article');
    card.className = 'thought-card';
    const date = new Date(thought.createdAt);
    const dateEl = document.createElement('time');
    dateEl.className = 'thought-date';
    dateEl.dateTime = thought.createdAt;
    dateEl.textContent = `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}\n${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
    const text = document.createElement('div');
    text.className = 'thought-text';
    text.textContent = thought.text;
    const remove = document.createElement('button');
    remove.className = 'delete-button';
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', 'Delete thought');
    remove.addEventListener('click', () => deleteThought(thought.id));
    card.append(dateEl, text, remove);
    thoughtList.append(card);
  }
}

async function loadThoughts() {
  const response = await fetch('/api/thoughts');
  if (!response.ok) throw new Error('Could not load your saved thoughts.');
  thoughts = await response.json();
  renderThoughts();
}

async function saveThought(value) {
  const text = value.trim();
  if (!text) { announce('No words came through that time.'); return; }
  const response = await fetch('/api/thoughts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not save that thought.');
  thoughts.unshift(result);
  renderThoughts();
  announce('Caught. You can leave it here.');
}

async function deleteThought(id) {
  const response = await fetch(`/api/thoughts/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!response.ok) { announce('Could not delete that thought.'); return; }
  thoughts = thoughts.filter(thought => thought.id !== id);
  renderThoughts();
}

function startRecording() {
  if (!SpeechRecognition) {
    stateText.textContent = 'Voice capture is not supported in this browser. Try Chrome, or use the text option below.';
    announce('This browser does not support voice capture.');
    return;
  }
  transcript = '';
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.onresult = event => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const text = event.results[i][0].transcript;
      if (event.results[i].isFinal) transcript += `${text.trim()} `;
      else interim += text;
    }
    liveCaption.textContent = `${transcript}${interim}`.trim();
  };
  recognition.onerror = event => {
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      setRecording(false);
      stateText.textContent = 'Microphone access is off. Allow it in your browser settings, then try again.';
    } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
      stateText.textContent = 'The connection paused. Try again when you’re ready.';
    }
  };
  recognition.onend = () => {
    if (recording) { try { recognition.start(); } catch {} }
    else if (finishRecognition) { finishRecognition(); finishRecognition = null; }
  };
  try {
    recognition.start();
    setRecording(true);
  } catch {
    stateText.textContent = 'Could not start voice capture. Please try again.';
  }
}

async function stopRecording() {
  if (!recording) return;
  setRecording(false);
  const ended = new Promise(resolve => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; clearTimeout(timeout); resolve(); } };
    const timeout = setTimeout(finish, 1200);
    finishRecognition = finish;
  });
  try { recognition.stop(); } catch { if (finishRecognition) finishRecognition(); }
  await ended;
  finishRecognition = null;
  const words = transcript.trim();
  liveCaption.hidden = true;
  if (!words) { announce('No words came through that time.'); return; }
  try { await saveThought(words); }
  catch (error) { announce(error.message); }
}

recordButton.addEventListener('click', () => recording ? stopRecording() : startRecording());
document.querySelector('#save-text').addEventListener('click', async () => {
  try { await saveThought(textInput.value); textInput.value = ''; }
  catch (error) { announce(error.message); }
});
textInput.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') document.querySelector('#save-text').click(); });
searchInput.addEventListener('input', renderThoughts);
window.addEventListener('keydown', event => {
  if (event.code !== 'Space' || event.repeat || ['INPUT', 'TEXTAREA', 'BUTTON'].includes(document.activeElement.tagName)) return;
  event.preventDefault();
  recordButton.click();
});

if (!SpeechRecognition) {
  browserNote.textContent = 'Voice capture is not available in this browser. Open this page in Chrome, or use the text option for now.';
}

loadThoughts().catch(error => { stateText.textContent = error.message; });
