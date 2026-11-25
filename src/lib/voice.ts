/** Thin wrapper around the browser's speech recognition (Chrome / Edge). */
type Rec = {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string; confidence: number }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
const Ctor = (): (new () => Rec) | null => {
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};
export const voiceSupported = () => typeof window !== 'undefined' && !!Ctor();

export interface Listener { stop: () => void }

/**
 * Listen once (stops after a pause) or continuously (dictation).
 * onFinal gets each finished phrase; onInterim the words so far; onEnd when listening stops.
 */
export function listen(opts: { continuous?: boolean; onInterim?: (t: string) => void; onFinal: (t: string, confidence: number) => void; onEnd?: () => void; onError?: (msg: string) => void }): Listener | null {
  const C = Ctor();
  if (!C) { opts.onError?.('Speech recognition isn’t available in this browser. Use Chrome or Edge.'); return null; }
  const r = new C();
  r.lang = navigator.language?.startsWith('en') ? navigator.language : 'en-US';
  r.continuous = !!opts.continuous;
  r.interimResults = true;
  r.maxAlternatives = 1;
  r.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) opts.onFinal(res[0].transcript.trim(), res[0].confidence);
      else interim += res[0].transcript;
    }
    opts.onInterim?.(interim.trim());
  };
  r.onerror = (e) => {
    const m: Record<string, string> = {
      'not-allowed': 'Microphone permission is off. Allow it in the browser’s site settings.',
      'no-speech': 'I didn’t hear anything.',
      network: 'Speech recognition needs an internet connection.',
      'audio-capture': 'No microphone was found.',
    };
    if (e.error !== 'aborted') opts.onError?.(m[e.error] ?? `Speech error: ${e.error}`);
  };
  r.onend = () => opts.onEnd?.();
  try { r.start(); } catch { /* already started */ }
  return { stop: () => { try { r.stop(); } catch { /* */ } } };
}

/** Spoken punctuation for dictation. */
export function punctuate(t: string): string {
  return t
    .replace(/\s*\b(new line|newline|next line)\b\s*/gi, '\n')
    .replace(/\s*\b(new paragraph)\b\s*/gi, '\n\n')
    .replace(/\s*\b(comma)\b/gi, ',')
    .replace(/\s*\b(period|full stop)\b/gi, '.')
    .replace(/\s*\b(question mark)\b/gi, '?')
    .replace(/\s*\b(exclamation (mark|point))\b/gi, '!')
    .replace(/\s*\b(colon)\b/gi, ':')
    .replace(/\s*\b(semicolon)\b/gi, ';')
    .replace(/(^|[.?!]\s+|\n)([a-z])/g, (_, a, b) => a + b.toUpperCase());
}

const ONES: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, first: 1, second: 2, third: 3 };
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
/** "twenty eight" -> 28, "a hundred and nineteen" -> 119 (Chrome usually gives digits already). */
export function wordsToNumbers(t: string): string {
  return t.replace(/\b((?:a |one )?hundred(?: and)? )?((?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[ -](?:one|two|three|four|five|six|seven|eight|nine))?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)\b/gi, (m, h, rest) => {
    let n = h ? 100 : 0;
    const parts = String(rest).toLowerCase().split(/[ -]/);
    for (const p of parts) n += TENS[p] ?? ONES[p] ?? 0;
    return String(n);
  }).replace(/\b(?:a |one )?hundred\b/gi, '100');
}
