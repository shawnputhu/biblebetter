import { useLiveQuery } from 'dexie-react-hooks';
import { BOOKS } from '../data/books';
import { db, alive, uid, todayStr, type Plan, type PlanDay } from './db';
import { mutate } from './write';
import { parseRef, vid, chapterVerseIds, allVerseIds, vBook, vChap, vVerse, formatVerses } from './ref';
import type { KJV } from './hooks';

/** Parse "Romans", "Ps 1-50", "John 3-5", "Rom 8:28-39", "Gen 1:1-2:3" into [start, end] verse ids. */
export function parsePassage(raw: string): [number, number] | null {
  const t = raw.trim().replace(/\s+/g, ' ');
  if (!t) return null;
  const m = t.match(/^(.*?[a-z.])\s*(\d+)\s*[-–]\s*(\d+)$/i); // book chapter-chapter
  if (m && !m[1].includes(':')) {
    const r = parseRef(`${m[1]} ${m[2]}`), r2 = parseRef(`${m[1]} ${m[3]}`);
    if (r?.chapter && r2?.chapter && r2.chapter >= r.chapter && !/:/.test(t)) {
      const a = chapterVerseIds(r.book, r.chapter), b = chapterVerseIds(r.book, r2.chapter);
      return [a[0], b[b.length - 1]];
    }
  }
  const x = t.match(/^(.*?[a-z.])\s*(\d+):(\d+)\s*[-–]\s*(\d+):(\d+)$/i); // cross-chapter
  if (x) {
    const r = parseRef(`${x[1]} ${x[2]}:${x[3]}`), r2 = parseRef(`${x[1]} ${x[4]}:${x[5]}`);
    if (r?.verse && r2?.verse) return [vid(r.book, r.chapter!, r.verse), vid(r2.book, r2.chapter!, r2.verse)];
  }
  const r = parseRef(t);
  if (!r) return null;
  if (!r.chapter) { const bk = BOOKS[r.book - 1]; return [vid(r.book, 1, 1), vid(r.book, bk.v.length, bk.v[bk.v.length - 1])]; }
  const ids = chapterVerseIds(r.book, r.chapter);
  if (!r.verse) return [ids[0], ids[ids.length - 1]];
  return [vid(r.book, r.chapter, r.verse), vid(r.book, r.chapter, r.verseEnd ?? r.verse)];
}

let IDX: Map<number, number> | null = null;
const idxOf = (v: number) => { if (!IDX) { IDX = new Map(); allVerseIds().forEach((x, i) => IDX!.set(x, i)); } return IDX.get(v) ?? -1; };

export function rangeVerses([s, e]: [number, number]): number[] {
  const all = allVerseIds();
  const i = idxOf(s), j = idxOf(e);
  return i < 0 || j < 0 || j < i ? [] : all.slice(i, j + 1);
}

const addDays = (d: string, n: number) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return todayStr(x); };
export { addDays };

export function availableDates(p: Pick<Plan, 'start' | 'end' | 'skipWeekdays' | 'skipDates' | 'skipRanges'>, from?: string): string[] {
  const out: string[] = [];
  for (let d = from && from > p.start ? from : p.start; d <= p.end; d = addDays(d, 1)) {
    const wd = new Date(d + 'T12:00:00').getDay();
    if (p.skipWeekdays.includes(wd) || p.skipDates.includes(d) || p.skipRanges.some((r) => d >= r.from && d <= r.to)) continue;
    out.push(d);
    if (out.length > 3700) break;
  }
  return out;
}

const wordCount = (kjv: KJV | null, v: number) => (kjv ? kjv[vBook(v) - 1][vChap(v) - 1][vVerse(v) - 1].split(/\s+/).length : 25);

/** Spread verses over dates as evenly as possible (by verse count or word count), as contiguous ranges. */
export function spread(verses: number[], dates: string[], balance: Plan['balance'], kjv: KJV | null): PlanDay[] {
  if (!dates.length || !verses.length) return dates.map((date) => ({ date, ranges: [] }));
  const w = verses.map((v) => (balance === 'words' ? wordCount(kjv, v) : 1));
  const total = w.reduce((a, b) => a + b, 0);
  const days: PlanDay[] = [];
  let i = 0, acc = 0;
  dates.forEach((date, k) => {
    const target = (total * (k + 1)) / dates.length;
    const mine: number[] = [];
    while (i < verses.length && (acc + w[i] / 2 <= target || k === dates.length - 1)) { acc += w[i]; mine.push(verses[i]); i++; }
    days.push({ date, ranges: toRanges(mine) });
  });
  return days;
}

export function toRanges(vs: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const v of vs) {
    const last = out[out.length - 1];
    if (last && idxOf(v) === idxOf(last[1]) + 1) last[1] = v;
    else out.push([v, v]);
  }
  return out;
}

export const dayVerses = (d: PlanDay) => d.ranges.flatMap((r) => rangeVerses(r));
export const dayLabel = (d: PlanDay) => formatVerses(dayVerses(d));

export function buildPlanVerses(passages: string[]): { verses: number[]; bad: string[] } {
  const verses: number[] = [], bad: string[] = [];
  const seen = new Set<number>();
  passages.forEach((p) => {
    const r = parsePassage(p);
    if (!r) { bad.push(p); return; }
    rangeVerses(r).forEach((v) => { if (!seen.has(v)) { seen.add(v); verses.push(v); } });
  });
  return { verses, bad };
}

export function usePlans(): Plan[] {
  return useLiveQuery(async () => (await db.plans.toArray()).filter(alive).sort((a, b) => b.created_at - a.created_at), []) ?? [];
}

export async function createPlan(p: Omit<Plan, 'id' | 'updated_at' | 'days' | 'status' | 'created_at'>, kjv: KJV | null) {
  const { verses } = buildPlanVerses(p.passages);
  const days = spread(verses, availableDates(p), p.balance, kjv);
  const id = uid();
  await mutate(`Created plan “${p.name}”`, (w) => w.put<Plan>('plans', { ...p, id, days, status: 'active', created_at: Date.now(), deleted_at: null, purged: false }));
  return id;
}

/** Catch-up: everything not yet read from past days + today onward is re-spread from today. */
export function catchUpPreview(p: Plan, reads: Map<number, unknown>, kjv: KJV | null) {
  const today = todayStr();
  const keep = p.days.filter((d) => d.date < today).map((d) => ({ ...d, ranges: toRanges(dayVerses(d).filter((v) => reads.has(v))) }));
  const pending = p.days.filter((d) => d.date < today).flatMap(dayVerses).filter((v) => !reads.has(v))
    .concat(p.days.filter((d) => d.date >= today).flatMap(dayVerses).filter((v) => !reads.has(v)));
  const future = spread(pending, availableDates(p, today), p.balance, kjv);
  return { days: [...keep, ...future], pendingCount: pending.length, perDay: future.length ? Math.ceil(pending.length / future.length) : pending.length };
}

export function planProgress(p: Plan, reads: Map<number, unknown>) {
  const today = todayStr();
  let total = 0, done = 0, missed = 0;
  const status = new Map<string, 'done' | 'missed' | 'today' | 'upcoming' | 'partial'>();
  p.days.forEach((d) => {
    const vs = dayVerses(d);
    const r = vs.filter((v) => reads.has(v)).length;
    total += vs.length; done += r;
    const complete = vs.length > 0 && r === vs.length;
    const st = complete ? 'done' : d.date < today ? (r > 0 ? 'partial' : 'missed') : d.date === today ? 'today' : 'upcoming';
    if (st === 'missed' || st === 'partial') missed++;
    status.set(d.date, st);
  });
  return { total, done, pct: total ? (done / total) * 100 : 0, missed, status, today: p.days.find((d) => d.date === today) };
}
