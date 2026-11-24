import { BOOKS } from '../data/books';

/** Verse id = book(1-66) * 1_000_000 + chapter * 1_000 + verse */
export const vid = (b: number, c: number, v: number) => b * 1_000_000 + c * 1_000 + v;
export const vBook = (id: number) => Math.floor(id / 1_000_000);
export const vChap = (id: number) => Math.floor(id / 1_000) % 1_000;
export const vVerse = (id: number) => id % 1_000;
export const chapKey = (b: number, c: number) => `${b}:${c}`;

export const TOTAL_VERSES = BOOKS.reduce((s, b) => s + b.v.reduce((a, x) => a + x, 0), 0);
export const bookVerseCount = (b: number) => BOOKS[b - 1].v.reduce((a, x) => a + x, 0);
export const testamentVerseCount = (t: 'OT' | 'NT') =>
  BOOKS.filter((b) => b.t === t).reduce((s, b) => s + b.v.reduce((a, x) => a + x, 0), 0);

/** All verse ids in canonical order (lazily built). */
let ALL: number[] | null = null;
export function allVerseIds(): number[] {
  if (ALL) return ALL;
  ALL = [];
  BOOKS.forEach((bk, bi) => bk.v.forEach((n, ci) => { for (let v = 1; v <= n; v++) ALL!.push(vid(bi + 1, ci + 1, v)); }));
  return ALL;
}

export function chapterVerseIds(b: number, c: number): number[] {
  const n = BOOKS[b - 1]?.v[c - 1] ?? 0;
  return Array.from({ length: n }, (_, i) => vid(b, c, i + 1));
}

const ALIAS = new Map<string, number>();
BOOKS.forEach((bk, i) => bk.al.forEach((a) => { if (!ALIAS.has(a)) ALIAS.set(a, i + 1); }));

function findBook(raw: string): number | null {
  const s = raw.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (ALIAS.has(s)) return ALIAS.get(s)!;
  const ns = s.replace(/ /g, '');
  if (ALIAS.has(ns)) return ALIAS.get(ns)!;
  // prefix match on full names (e.g. "philip" -> Philippians, "eph" -> Ephesians)
  const hits = BOOKS.map((b, i) => ({ i, n: b.name.toLowerCase() })).filter((x) => x.n.startsWith(s) || x.n.replace(/ /g, '').startsWith(ns));
  return hits.length ? hits[0].i + 1 : null;
}

export interface ParsedRef { book: number; chapter?: number; verse?: number; verseEnd?: number }

/** Parse "jn 3:16", "Rom 8", "1 cor 13:4-7", "song of solomon 2" */
export function parseRef(input: string): ParsedRef | null {
  const m = input.trim().match(/^((?:[1-3]|i{1,3})?\s*[a-z][a-z .]*?)\s*(\d+)?(?:\s*[:.]\s*(\d+)(?:\s*[-–]\s*(\d+))?)?\s*$/i);
  if (!m) return null;
  const book = findBook(m[1]);
  if (!book) return null;
  const meta = BOOKS[book - 1];
  let chapter = m[2] ? parseInt(m[2]) : undefined;
  // single-chapter books: "jude 3" means verse 3
  if (meta.v.length === 1 && chapter && !m[3] && chapter > 1) return { book, chapter: 1, verse: Math.min(chapter, meta.v[0]) };
  if (chapter && (chapter < 1 || chapter > meta.v.length)) return null;
  const verse = m[3] ? parseInt(m[3]) : undefined;
  if (chapter && verse && (verse < 1 || verse > meta.v[chapter - 1])) return null;
  const verseEnd = m[4] ? Math.min(parseInt(m[4]), meta.v[(chapter ?? 1) - 1]) : undefined;
  return { book, chapter, verse, verseEnd };
}

export function refLabel(r: ParsedRef): string {
  const n = BOOKS[r.book - 1].name;
  if (!r.chapter) return n;
  if (!r.verse) return `${n} ${r.chapter}`;
  return `${n} ${r.chapter}:${r.verse}${r.verseEnd && r.verseEnd !== r.verse ? '–' + r.verseEnd : ''}`;
}

/** Turn a list of verse ids into a compact readable reference: "John 3:16–18, 20; 4; Romans 8" */
export function formatVerses(ids: number[]): string {
  const sorted = [...new Set(ids)].sort((a, b) => a - b);
  const byBook = new Map<number, Map<number, number[]>>();
  for (const id of sorted) {
    const b = vBook(id), c = vChap(id);
    if (!byBook.has(b)) byBook.set(b, new Map());
    const m = byBook.get(b)!;
    if (!m.has(c)) m.set(c, []);
    m.get(c)!.push(vVerse(id));
  }
  const out: string[] = [];
  for (const [b, chaps] of byBook) {
    const meta = BOOKS[b - 1];
    const cs: string[] = [];
    for (const [c, vs] of chaps) {
      const ranges: string[] = [];
      let i = 0;
      while (i < vs.length) {
        let j = i;
        while (j + 1 < vs.length && vs[j + 1] === vs[j] + 1) j++;
        ranges.push(vs[i] === vs[j] ? `${vs[i]}` : `${vs[i]}–${vs[j]}`);
        i = j + 1;
      }
      const whole = vs.length === meta.v[c - 1];
      if (meta.v.length === 1) cs.push(whole ? '' : ranges.join(', '));
      else cs.push(whole ? `${c}` : `${c}:${ranges.join(', ')}`);
    }
    out.push(`${meta.name}${cs[0] ? ' ' : ''}${cs.join('; ')}`);
  }
  return out.join('; ');
}

export function bgUrl(ref: string, version = 'ESV') {
  return `https://www.biblegateway.com/passage/?search=${encodeURIComponent(ref)}&version=${encodeURIComponent(version)}`;
}

export const verseRef = (id: number) => `${BOOKS[vBook(id) - 1].name} ${vChap(id)}:${vVerse(id)}`;
