import { useEffect, useRef, useState } from 'react';
import type { Capture, CaptureSource } from '@anti-void/contracts';

const SpeechRecognitionApi = window.SpeechRecognition || window.webkitSpeechRecognition;

function formatDate(value: string): string {
  const date = new Date(value);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + '\n' +
    date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

async function responseError(response: Response): Promise<Error> {
  try {
    const body = await response.json() as { message?: string; error?: string };
    return new Error(body.message || body.error || 'Something went wrong. Please try again.');
  } catch {
    return new Error('Something went wrong. Please try again.');
  }
}

export default function App() {
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [search, setSearch] = useState('');
  const [recording, setRecording] = useState(false);
  const [liveText, setLiveText] = useState('');
  const [status, setStatus] = useState('Ready when a thought arrives.');
  const [toast, setToast] = useState('');
  const [textEntryOpen, setTextEntryOpen] = useState(false);
  const [textEntry, setTextEntry] = useState('');
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const recordingRef = useRef(false);
  const transcriptRef = useRef('');
  const finishRecognitionRef = useRef<(() => void) | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioReadyRef = useRef<Promise<Blob> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function announce(message: string) {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(''), 2400);
  }

  async function loadCaptures() {
    const response = await fetch('/v1/captures');
    if (!response.ok) throw await responseError(response);
    setCaptures(await response.json() as Capture[]);
  }

  useEffect(() => {
    loadCaptures().catch(() => setStatus('Could not load your saved thoughts. Is the API running?'));
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      recordingRef.current = false;
      try { recognitionRef.current?.stop(); } catch { /* The recognizer may already be stopped. */ }
      try { if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop(); } catch { /* The recorder may already be stopped. */ }
      mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    };
  }, []);

  async function saveCapture(text: string, source: CaptureSource = 'web', audio?: Blob) {
    const trimmed = text.trim();
    if (!trimmed) {
      announce('No words came through that time.');
      return;
    }
    let response: Response;
    if (audio) {
      const form = new FormData();
      form.append('text', trimmed);
      form.append('source', source);
      form.append('audio', audio, audio.type.includes('mp4') ? 'thought.mp4' : 'thought.webm');
      response = await fetch('/v1/captures/audio', { method: 'POST', body: form });
    } else {
      response = await fetch('/v1/captures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmed, source })
      });
    }
    if (!response.ok) throw await responseError(response);
    const capture = await response.json() as Capture;
    setCaptures(current => [capture, ...current]);
    announce('Caught. You can leave it here.');
  }

  async function deleteCapture(id: string) {
    const response = await fetch('/v1/captures/' + encodeURIComponent(id), { method: 'DELETE' });
    if (!response.ok) {
      announce('Could not delete that thought.');
      return;
    }
    setCaptures(current => current.filter(capture => capture.id !== id));
  }

  function stopState() {
    recordingRef.current = false;
    setRecording(false);
    setLiveText('');
    try { if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop(); } catch { /* The recorder may already be stopped. */ }
    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setStatus('Audio recording is not supported in this browser. You can write a thought below.');
      announce('This browser does not support audio recording.');
      return;
    }

    transcriptRef.current = '';
    setLiveText('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];
      audioReadyRef.current = new Promise(resolve => {
        recorder.ondataavailable = event => {
          if (event.data.size > 0) audioChunksRef.current.push(event.data);
        };
        recorder.onstop = () => {
          const audioType = recorder.mimeType || 'audio/webm';
          resolve(new Blob(audioChunksRef.current, { type: audioType }));
          stream.getTracks().forEach(track => track.stop());
          mediaStreamRef.current = null;
        };
      });
      recorder.start();
      recordingRef.current = true;
      setRecording(true);
      setStatus('Recording. Stop when the thought is out.');

      if (!SpeechRecognitionApi) {
        setStatus('Recording audio. A transcript is not available in this browser.');
        return;
      }

      const recognition = new SpeechRecognitionApi();
      let canRestartRecognition = true;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      recognitionRef.current = recognition;

      recognition.onresult = event => {
        let interim = '';
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const words = event.results[index][0].transcript;
          if (event.results[index].isFinal) transcriptRef.current += words.trim() + ' ';
          else interim += words;
        }
        setLiveText((transcriptRef.current + interim).trim());
      };

      recognition.onerror = event => {
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          canRestartRecognition = false;
          setStatus('Audio is recording. Browser transcription is unavailable.');
        } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
          setStatus('Audio is recording. The transcript connection paused.');
        }
      };

      recognition.onend = () => {
        if (recordingRef.current && canRestartRecognition) {
          try { recognition.start(); } catch { /* The browser can still be closing the previous session. */ }
        } else if (finishRecognitionRef.current) {
          finishRecognitionRef.current();
          finishRecognitionRef.current = null;
        }
      };

      try { recognition.start(); } catch { setStatus('Audio is recording. Live transcription could not start.'); }
    } catch {
      stopState();
      setStatus('Could not start audio capture. Check microphone access and try again.');
    }
  }

  async function stopRecording() {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setRecording(false);
    setStatus('Saving your thought…');
    const recorder = mediaRecorderRef.current;
    const audioReady = audioReadyRef.current;
    if (recorder?.state === 'recording') recorder.stop();

    const ended = new Promise<void>(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve();
      };
      const timeout = setTimeout(finish, 1200);
      finishRecognitionRef.current = finish;
    });

    try { recognitionRef.current?.stop(); } catch { finishRecognitionRef.current?.(); }
    await ended;
    finishRecognitionRef.current = null;

    const transcript = transcriptRef.current.trim() || 'Voice recording';
    const audio = audioReady ? await audioReady : undefined;
    setLiveText('');
    try {
      await saveCapture(transcript, 'web', audio);
      setStatus('Ready when another thought arrives.');
      audioReadyRef.current = null;
      mediaRecorderRef.current = null;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not save that thought.');
    }
  }

  async function submitTextEntry() {
    try {
      await saveCapture(textEntry);
      setTextEntry('');
      setTextEntryOpen(false);
    } catch (error) {
      announce(error instanceof Error ? error.message : 'Could not save that thought.');
    }
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.code !== 'Space' || event.repeat) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
      event.preventDefault();
      if (recordingRef.current) void stopRecording();
      else startRecording();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const query = search.trim().toLocaleLowerCase();
  const visibleCaptures = captures.filter(capture => capture.text.toLocaleLowerCase().includes(query));

  return (
    <main className="shell">
      <header className="topbar">
        <a className="wordmark" href="/" aria-label="Anti-Void home">
          <span className="mark" aria-hidden="true">av</span><span>anti-void</span>
        </a>
        <div className="topbar-note"><span className="status-dot" /><span>Private thought archive</span><span className="note-divider">/</span><span>Saved on this Mac</span></div>
      </header>

      <section className="page-intro" aria-labelledby="page-title">
        <p className="eyebrow">A PLACE FOR THOUGHTS IN PASSING <span>— 01</span></p>
        <h1 id="page-title">Keep the thought.<br /><em>Let everything else wait.</em></h1>
        <p className="intro">Say it while it’s here. You can make sense of it later.</p>
      </section>

      <div className="workspace-layout">
        <section className="capture-panel" aria-labelledby="capture-heading">
          <div className="section-heading">
            <span className="section-index">01</span>
            <h2 id="capture-heading">Quick capture</h2>
          </div>
          <div className="recorder-wrap">
            <button
              id="record-button"
              className={'record-button' + (recording ? ' recording' : '')}
              type="button"
              aria-pressed={recording}
              aria-label={recording ? 'Stop and save your thought' : 'Start voice capture'}
              onClick={() => recordingRef.current ? void stopRecording() : startRecording()}
            >
              <span className="record-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <rect x="9" y="3" width="6" height="12" rx="3" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3m-4 0h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </span>
              <span className="record-label">{recording ? 'Stop and save' : 'Speak a thought'}</span>
            </button>
          </div>
          <div className={'record-state' + (recording ? ' recording' : '')} aria-live="polite">
            <span className="state-dot" /><span>{status}</span>
          </div>
          <p className="keyboard-hint">or press <kbd>space</kbd></p>
          {recording && <div className="live-caption" aria-live="polite">{liveText || 'Listening…'}</div>}

          <details className="text-fallback" open={textEntryOpen} onToggle={event => setTextEntryOpen(event.currentTarget.open)}>
            <summary>Write this one instead</summary>
            <div className="text-entry">
              <textarea
                rows={3}
                placeholder="A few words are enough."
                aria-label="Write a thought"
                value={textEntry}
                onChange={event => setTextEntry(event.target.value)}
                onKeyDown={event => {
                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void submitTextEntry();
                }}
              />
              <button className="save-button" type="button" onClick={() => void submitTextEntry()}>Save thought <span aria-hidden="true">↗</span></button>
            </div>
          </details>
          <p className="browser-note">Transcripts and voice recordings are saved on this Mac. Browser transcription may be processed online.</p>
        </section>

        <section className="inbox" aria-labelledby="inbox-heading">
          <div className="inbox-heading">
            <div>
              <div className="eyebrow small">THE INBOX</div>
              <h2 id="inbox-heading">Recent thoughts <span>{captures.length.toString().padStart(2, '0')}</span></h2>
            </div>
            <label className="search-box">
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none"><circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.3" /><path d="m13 13 4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
              <input type="search" placeholder="Search the archive" aria-label="Find a thought" value={search} onChange={event => setSearch(event.target.value)} />
            </label>
          </div>
          {captures.length === 0 ? (
            <div className="empty-state"><p>Nothing here yet.<br />The next thought can start the archive.</p></div>
          ) : visibleCaptures.length === 0 ? (
            <div className="empty-state"><p>No thought matches that search.</p></div>
          ) : (
            <div className="thought-list" aria-live="polite">
              {visibleCaptures.map(capture => (
                <article className="thought-card" key={capture.id}>
                  <time className="thought-date" dateTime={capture.createdAt}>{formatDate(capture.createdAt)}</time>
                  <div className="thought-content">
                    <div className="thought-text">{capture.text}</div>
                    {capture.audioUrl && <audio className="thought-audio" controls preload="metadata" src={capture.audioUrl}>Audio playback is not supported by this browser.</audio>}
                  </div>
                  <button className="delete-button" type="button" aria-label="Delete thought" onClick={() => void deleteCapture(capture.id)}>×</button>
                </article>
              ))}
            </div>
          )}
          <p className="archive-note">{captures.length === 1 ? 'One thought, safely kept.' : `${captures.length} thoughts, safely kept.`}</p>
        </section>
      </div>
      <footer><span>ANTI-VOID <i>/</i> PERSONAL ARCHIVE</span><span>One thought at a time is enough.</span></footer>
      <div className={'toast' + (toast ? ' show' : '')} role="status" aria-live="polite">{toast}</div>
    </main>
  );
}
