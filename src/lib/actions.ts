import { db, TRASH_TABLES, type VerseRead, type Highlight, type Reflection, uid, todayStr, type InboxItem } from './db';
import { mutate } from './write';
import { formatVerses, chapKey, vBook, vChap } from './ref';
import { toast } from './store';

/** Check or uncheck verses for a read-through (one undo step). */
export function setChecked(rt: string, verses: number[], checked: boolean, at?: number) {
  if (!verses.length) return Promise.resolve();
  const label = `${checked ? 'Checked' : 'Unchecked'} ${formatVerses(verses)}`;
  return mutate(label, async (w) => {
    const when = at ?? Date.now();
    const ids = verses.map((v) => `${rt}|${v}`);
    const cur = await db.verse_reads.bulkGet(ids);
    const rows: VerseRead[] = [];
    verses.forEach((v, i) => {
      const c = cur[i];
      const isOn = !!c && c.checked && !c.deleted_at && !c.purged;
      if (checked && isOn && at === undefined) return; // keep original read time
      if (!checked && !isOn) return;
      rows.push({ id: ids[i], rt, verse: v, checked, at: checked ? when : c?.at ?? when, updated_at: 0, deleted_at: null, purged: false });
    });
    await w.putMany<VerseRead>('verse_reads', rows);
  });
}

export function setHighlight(verses: number[], color: string | null) {
  return mutate(color ? `Highlighted ${formatVerses(verses)}` : `Removed highlight from ${formatVerses(verses)}`, async (w) => {
    await w.putMany<Highlight>(
      'highlights',
      verses.map((v) => ({ id: String(v), verse: v, color: color ?? '', deleted_at: color ? null : Date.now(), purged: !color })),
    );
  });
}

export async function copyRef(verses: number[]) {
  const t = formatVerses(verses);
  try { await navigator.clipboard.writeText(t); toast(`Copied “${t}”`, undefined, 2500); }
  catch { toast(t, undefined, 4000); }
}

export async function saveReflection(rt: string, date: string, text: string, addChapter?: string) {
  const id = `${rt}|${date}`;
  const cur = await db.reflections.get(id);
  // passages = chapters read that day in this read-through (+ any chapter you reflected from)
  const start = new Date(date + 'T00:00:00').getTime();
  const reads = await db.verse_reads.where('at').between(start, start + 86_400_000).toArray();
  const chs = new Set<string>(cur && !cur.deleted_at ? cur.chapters : []);
  reads.filter((r) => r.rt === rt && r.checked && !r.purged && !r.deleted_at).forEach((r) => chs.add(chapKey(vBook(r.verse), vChap(r.verse))));
  if (addChapter) chs.add(addChapter);
  await mutate(null, (w) => w.put<Reflection>('reflections', { id, rt, date, text, chapters: [...chs], deleted_at: null, purged: false }));
}

export const addInbox = (text: string) =>
  mutate('Captured to Inbox', (w) => w.put<InboxItem>('inbox_items', { id: uid(), text, created_at: Date.now() }));

export async function purgeOldTrash() {
  const cutoff = Date.now() - 30 * 86_400_000;
  for (const t of TRASH_TABLES) {
    const old = (await db.table(t).toArray()).filter((r) => r.deleted_at && r.deleted_at < cutoff && !r.purged);
    if (old.length) await mutate(null, async (w) => { for (const r of old) await w.purge(t, r.id); });
  }
}

export { todayStr };
