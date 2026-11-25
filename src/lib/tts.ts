import { BOOKS } from '../data/books';
import { db, DEFAULT_SETTINGS, type Settings } from './db';
import { loadKjv } from './hooks';
import { setChecked } from './actions';
import { ui, navigate } from './store';
import { vBook, vChap, vVerse, chapterVerseIds, verseRef } from './ref';

export interface PlayerState {
  label: string;
  verses: number[]; // empty when reading plain text items
  texts: string[];
  idx: number;
  playing: boolean;
  follow: boolean;
  rt?: string;
  wholeChapter: boolean;
}

let session = 0;
let lock: WakeLockSentinel | null = null;
let ducked = false;

async function settings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, updated_at: 0, ...((await db.settings.get('main')) ?? {}) } as Settings;
}
export const ttsSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

export function voices(): SpeechSynthesisVoice[] {
  return ttsSupported() ? speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en')) : [];
}
function pickVoice(uri?: string) {
  const vs = voices();
  return vs.find((v) => v.voiceURI === uri) ?? vs.find((v) => v.default) ?? vs[0];
}

async function wake(on: boolean) {
  try {
    if (on && !lock && (await settings()).keepScreenOn !== false && 'wakeLock' in navigator) lock = await navigator.wakeLock.request('screen');
    if (!on && lock) { await lock.release(); lock = null; }
  } catch { /* not allowed */ }
}

const P = () => ui.get().player;
const setP = (patch: Partial<PlayerState> | null) => ui.set({ player: patch === null ? null : { ...(P() as PlayerState), ...patch } });

/** Read verses aloud, one at a time. */
export async function playVerses(verses: number[], label: string, opts: { rt?: string; startIdx?: number; wholeChapter?: boolean } = {}) {
  if (!ttsSupported() || !verses.length) return;
  const s = await settings();
  ui.set({ player: { label, verses, texts: [], idx: opts.startIdx ?? 0, playing: true, follow: true, rt: opts.rt ?? s.activeRt, wholeChapter: !!opts.wholeChapter } });
  void speakCurrent();
}
export const playChapter = (book: number, chapter: number, startVerse = 1, rt?: string) =>
  playVerses(chapterVerseIds(book, chapter), `${BOOKS[book - 1].name} ${chapter}`, { rt, startIdx: startVerse - 1, wholeChapter: true });

/** Read plain text items (briefing, notes, reflections). */
export function playText(texts: string[], label: string) {
  if (!ttsSupported() || !texts.length) return;
  ui.set({ player: { label, verses: [], texts, idx: 0, playing: true, follow: false, wholeChapter: false } });
  void speakCurrent();
}

async function speakCurrent() {
  const p = P();
  if (!p) return;
  const my = ++session;
  speechSynthesis.cancel();
  const s = await settings();
  let text: string;
  const v = p.verses[p.idx];
  if (p.verses.length) {
    const kjv = await loadKjv();
    const prev = p.verses[p.idx - 1];
    const heading = p.idx === 0 || (prev && vChap(prev) !== vChap(v)) ? `${BOOKS[vBook(v) - 1].name}, chapter ${vChap(v)}. ` : '';
    text = heading + kjv[vBook(v) - 1][vChap(v) - 1][vVerse(v) - 1];
    followVerse(v);
  } else text = p.texts[p.idx];
  const u = new SpeechSynthesisUtterance(text);
  u.rate = s.ttsRate ?? 1;
  const voice = pickVoice(s.ttsVoice);
  if (voice) u.voice = voice;
  u.lang = voice?.lang ?? 'en-US';
  const started = Date.now();
  u.onend = () => {
    if (my !== session) return;
    // an utterance that "ends" instantly means the device couldn't speak it — stop instead of racing ahead
    if (Date.now() - started < 120 && text.length > 20) { fail('Read aloud isn’t working on this device right now (no speech voice available).'); return; }
    void advance(s);
  };
  u.onerror = (e) => { if (my === session && e.error !== 'interrupted' && e.error !== 'canceled') fail(`Read aloud stopped: ${e.error}.`); };
  void wake(true);
  speechSynthesis.speak(u);
}

async function advance(s: Settings) {
  const p = P();
  if (!p || !p.playing) return;
  const v = p.verses[p.idx];
  if (v && s.autoCheckListening && p.rt) void setChecked(p.rt, [v], true);
  const total = p.verses.length || p.texts.length;
  if (p.idx + 1 < total) { setP({ idx: p.idx + 1 }); return speakCurrent(); }
  if (p.wholeChapter && s.continueChapters !== false && v) {
    let b = vBook(v), c = vChap(v) + 1;
    if (c > BOOKS[b - 1].v.length) { b++; c = 1; }
    if (b <= 66) { setP({ verses: chapterVerseIds(b, c), idx: 0, label: `${BOOKS[b - 1].name} ${c}` }); return speakCurrent(); }
  }
  stop();
}

function fail(msg: string) {
  pause();
  void import('./store').then(({ toast }) => toast(msg, undefined, 6000));
}

function followVerse(v: number) {
  const p = P();
  if (!p?.follow) return;
  const at = ui.get().bibleAt;
  if (at && (at.book !== vBook(v) || at.chapter !== vChap(v))) navigate('bible', { book: vBook(v), chapter: vChap(v), follow: true });
}

export function pause() { session++; speechSynthesis.cancel(); if (P()) setP({ playing: false }); void wake(false); }
export function resume() { if (P()) { setP({ playing: true }); void speakCurrent(); } }
export function toggle() { if (P()?.playing) pause(); else resume(); }
export function stop() { session++; if (ttsSupported()) speechSynthesis.cancel(); ui.set({ player: null }); void wake(false); }
export function step(d: number) {
  const p = P();
  if (!p) return;
  const total = p.verses.length || p.texts.length;
  setP({ idx: Math.max(0, Math.min(total - 1, p.idx + d)), playing: true, follow: true });
  void speakCurrent();
}
export const repeat = () => step(0);
export async function setRate(r: number) {
  const { saveSettings } = await import('./hooks');
  await saveSettings({ ttsRate: Math.round(Math.max(0.5, Math.min(2, r)) * 100) / 100 });
  if (P()?.playing) void speakCurrent();
}
export const currentVerse = () => { const p = P(); return p?.verses[p.idx]; };
export const currentLabel = () => { const v = currentVerse(); return v ? verseRef(v) : P()?.label ?? ''; };

/** The microphone pauses reading so the app doesn't hear itself; resumeAfterMic picks up again. */
export function duck() { if (P()?.playing) { ducked = true; pause(); } }
export function unduck() { if (ducked) { ducked = false; resume(); } }

/** Speak a short reply (confirmations). Resolves when finished. */
export async function say(text: string): Promise<void> {
  if (!ttsSupported() || !text) return;
  const s = await settings();
  return new Promise((res) => {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = Math.min(1.3, (s.ttsRate ?? 1) * 1.1);
    const voice = pickVoice(s.ttsVoice);
    if (voice) u.voice = voice;
    u.onend = () => res();
    u.onerror = () => res();
    speechSynthesis.speak(u);
    setTimeout(res, 8000);
  });
}
