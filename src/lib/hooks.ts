import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, alive, DEFAULT_SETTINGS, type Settings, type VerseRead, type Readthrough, uid, todayStr } from './db';
import { mutate } from './write';

// ---------- KJV text ----------
export type KJV = string[][][];
let kjv: KJV | null = null;
let kjvPromise: Promise<KJV> | null = null;
export function loadKjv(): Promise<KJV> {
  if (kjv) return Promise.resolve(kjv);
  kjvPromise ??= fetch(import.meta.env.BASE_URL + 'kjv.json').then((r) => r.json()).then((d) => (kjv = d));
  return kjvPromise;
}
export function useKjv(): KJV | null {
  const [d, setD] = useState<KJV | null>(kjv);
  useEffect(() => { if (!d) void loadKjv().then(setD); }, [d]);
  return d;
}

// ---------- settings ----------
export function useSettings(): Settings {
  const s = useLiveQuery(() => db.settings.get('main'), []);
  return { ...DEFAULT_SETTINGS, updated_at: 0, ...(s ?? {}) } as Settings;
}
export const saveSettings = (patch: Partial<Settings>) =>
  mutate(null, async (w) => {
    const cur = (await db.settings.get('main')) ?? { ...DEFAULT_SETTINGS, updated_at: 0 };
    await w.put<Settings>('settings', { ...cur, ...patch });
  });

// ---------- read-throughs ----------
export function useReadthroughs(): Readthrough[] {
  return useLiveQuery(async () => (await db.readthroughs.toArray()).filter(alive).sort((a, b) => a.created_at - b.created_at), []) ?? [];
}
export function useActiveRt(): Readthrough | undefined {
  const s = useSettings();
  const rts = useReadthroughs();
  return rts.find((r) => r.id === s.activeRt) ?? rts[rts.length - 1];
}

/** Map verse id -> read row, for checked verses of a read-through. */
export function useReadMap(rt?: string): Map<number, VerseRead> {
  const rows = useLiveQuery(async () => (rt ? db.verse_reads.where('rt').equals(rt).toArray() : []), [rt]);
  const [map, setMap] = useState<Map<number, VerseRead>>(new Map());
  useEffect(() => {
    const m = new Map<number, VerseRead>();
    (rows ?? []).forEach((r) => { if (r.checked && alive(r)) m.set(r.verse, r); });
    setMap(m);
  }, [rows]);
  return map;
}

/** First-run setup: settings row and a first read-through. Run after the first sync so devices don't duplicate. */
export async function ensureSetup() {
  const rts = (await db.readthroughs.toArray()).filter(alive);
  const s = await db.settings.get('main');
  if (rts.length && s) return;
  await mutate(null, async (w) => {
    let active = s?.activeRt;
    if (!rts.length) {
      const id = uid();
      await w.put<Readthrough>('readthroughs', { id, name: `Read-through #1 – ${new Date().getFullYear()}`, start: todayStr(), finish: null, created_at: Date.now() });
      active = id;
    }
    if (!s) await w.put<Settings>('settings', { ...DEFAULT_SETTINGS, activeRt: active ?? rts[0]?.id });
  });
}

// ---------- device / layout mode ----------
export type Device = 'pc' | 'phone';
function measure() {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const small = Math.min(window.innerWidth, window.innerHeight) < 600;
  const device: Device = coarse && small ? 'phone' : 'pc';
  const dual = window.innerWidth >= 760;
  return { device, dual, landscape: window.innerWidth > window.innerHeight };
}
export function useDevice() {
  const [m, setM] = useState(measure);
  useEffect(() => {
    const f = () => setM(measure());
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  return m;
}

export function useTheme(theme: Settings['theme']) {
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#24212e' : '#c8bef0');
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}

export const isTyping = (e: Event) => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
};
