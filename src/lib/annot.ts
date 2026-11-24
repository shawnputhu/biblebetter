import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, alive, uid, getMeta, setMeta, type Anchor, type Tag, type Tagging, type Note, type LinkItem } from './db';
import { mutate } from './write';
import { formatVerses, vBook, vChap, vVerse, allVerseIds } from './ref';
import { loadKjv, type KJV } from './hooks';
import { toast } from './store';

// ---------------- anchors ----------------
export const anchorKey = (a: Anchor) => `${a.s}|${a.e}${a.w ? `|${a.w[0]}-${a.w[1]}` : ''}`;
export function anchorVerses(a: Anchor): number[] {
  if (a.s === a.e) return [a.s];
  const all = allVerseIds();
  const i = all.indexOf(a.s), j = all.indexOf(a.e);
  return i < 0 || j < 0 ? [a.s] : all.slice(i, j + 1);
}
export function anchorLabel(a: Anchor): string {
  const base = formatVerses(anchorVerses(a));
  return a.w && a.q ? `${base} “${a.q}”` : base;
}
export const overlaps = (a: Anchor, v: number) => v >= a.s && v <= a.e;
export const anchorOf = (verses: number[], w?: [number, number] | null, q?: string | null): Anchor => {
  const sorted = [...verses].sort((x, y) => x - y);
  return { s: sorted[0], e: sorted[sorted.length - 1], w: w ?? null, q: q ?? null };
};
export const words = (text: string) => text.split(/\s+/).filter(Boolean);

export function anchorText(kjv: KJV | null, a: Anchor, max = 6): string {
  if (!kjv) return '';
  const vs = anchorVerses(a).slice(0, max);
  const t = vs.map((v) => kjv[vBook(v) - 1]?.[vChap(v) - 1]?.[vVerse(v) - 1] ?? '');
  if (a.w && vs.length === 1) return words(t[0]).slice(a.w[0], a.w[1] + 1).join(' ');
  return t.join(' ') + (anchorVerses(a).length > max ? ' …' : '');
}

// ---------------- live data ----------------
export function useTags(): Tag[] {
  return useLiveQuery(async () => (await db.tags.toArray()).filter(alive).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)), []) ?? [];
}
export function useTaggings(): Tagging[] {
  return useLiveQuery(async () => (await db.taggings.toArray()).filter(alive), []) ?? [];
}
export function useNotes(): Note[] {
  return useLiveQuery(async () => (await db.notes.toArray()).filter(alive), []) ?? [];
}
export function useLinks(): LinkItem[] {
  return useLiveQuery(async () => (await db.links.toArray()).filter(alive), []) ?? [];
}

/** Tag helpers: map, children, descendants, path names. */
export function useTagIndex() {
  const tags = useTags();
  return useMemo(() => {
    const byId = new Map(tags.map((t) => [t.id, t]));
    const kids = new Map<string | null, Tag[]>();
    tags.forEach((t) => {
      const p = t.parent && byId.has(t.parent) ? t.parent : null;
      if (!kids.has(p)) kids.set(p, []);
      kids.get(p)!.push(t);
    });
    const desc = (id: string): string[] => [id, ...(kids.get(id) ?? []).flatMap((k) => desc(k.id))];
    const path = (id: string): string => {
      const t = byId.get(id);
      if (!t) return '';
      return t.parent && byId.has(t.parent) ? `${path(t.parent)} › ${t.name}` : t.name;
    };
    const byCode = new Map(tags.map((t) => [t.code.toUpperCase(), t]));
    return { tags, byId, kids, desc, path, byCode };
  }, [tags]);
}
export type TagIndex = ReturnType<typeof useTagIndex>;

// ---------------- tag actions ----------------
export const normCode = (c: string) => c.trim().toUpperCase().replace(/[^A-Z0-9.]/g, '').slice(0, 12);

export async function tagPassage(tag: Tag, a: Anchor) {
  const id = `${tag.id}|${anchorKey(a)}`;
  const cur = await db.taggings.get(id);
  if (alive(cur)) { toast(`Already tagged ${tag.name}`, undefined, 2000); return; }
  await mutate(`Tagged ${anchorLabel(a)} · ${tag.name}`, (w) =>
    w.put<Tagging>('taggings', { id, tag: tag.id, s: a.s, e: a.e, w: a.w ?? null, q: a.q ?? null, created_at: Date.now(), deleted_at: null, purged: false }));
  const recent = await getMeta<string[]>('recentTags', []);
  await setMeta('recentTags', [tag.id, ...recent.filter((x) => x !== tag.id)].slice(0, 8));
}
export const untag = (t: Tagging, label = 'Removed tag') => mutate(label, (w) => w.purge('taggings', t.id));

export async function saveTag(t: Partial<Tag> & { name: string; code: string }) {
  const code = normCode(t.code);
  const clash = (await db.tags.toArray()).find((x) => alive(x) && x.code.toUpperCase() === code && x.id !== t.id);
  if (clash) throw new Error(`The code ${code} is already used by “${clash.name}”.`);
  if (!code) throw new Error('Give the tag a short code (letters, numbers, dots).');
  const id = t.id ?? uid();
  const cur = t.id ? await db.tags.get(t.id) : undefined;
  const siblings = (await db.tags.toArray()).filter((x) => alive(x) && (x.parent ?? null) === (t.parent ?? cur?.parent ?? null));
  await mutate(cur ? `Updated tag ${t.name}` : `Created tag ${t.name}`, (w) =>
    w.put<Tag>('tags', {
      id, name: t.name.trim(), code, desc: t.desc ?? cur?.desc ?? '', color: t.color ?? cur?.color ?? '#c8bef0',
      parent: t.parent !== undefined ? t.parent : cur?.parent ?? null,
      order: t.order ?? cur?.order ?? (siblings.length ? Math.max(...siblings.map((x) => x.order)) + 1 : 0),
      deleted_at: null, purged: false,
    }));
  return id;
}

/** Move every passage of `from` (taggings + notes) onto `to`. copy=false removes them from `from`. */
export async function retagAll(from: string, to: string, copy: boolean, onlyIds?: Set<string>) {
  const tgs = (await db.taggings.where('tag').equals(from).toArray()).filter(alive).filter((t) => !onlyIds || onlyIds.has(t.id));
  const notes = (await db.notes.toArray()).filter((n) => alive(n) && n.tags.includes(from) && (!onlyIds || onlyIds.has(n.id)));
  await mutate(`${copy ? 'Copied' : 'Moved'} ${tgs.length + notes.length} passage(s)`, async (w) => {
    for (const t of tgs) {
      const id = `${to}|${anchorKey(t)}`;
      await w.put<Tagging>('taggings', { ...t, id, tag: to, deleted_at: null, purged: false });
      if (!copy) await w.purge('taggings', t.id);
    }
    for (const n of notes) {
      const tags = [...new Set([...n.tags.filter((x) => copy || x !== from), to])];
      await w.patch('notes', n.id, { tags });
    }
  });
}

export async function mergeTags(from: Tag, into: Tag) {
  await retagAll(from.id, into.id, false);
  await mutate(`Merged ${from.name} into ${into.name}`, async (w) => {
    for (const k of (await db.tags.where('parent').equals(from.id).toArray()).filter(alive)) await w.patch('tags', k.id, { parent: into.id });
    await w.trash('tags', from.id);
  });
}

// ---------------- notes & links ----------------
export const saveNote = (n: Partial<Note> & Anchor & { text: string }) =>
  mutate(n.id ? 'Note saved' : `Note added to ${anchorLabel(n)}`, (w) =>
    w.put<Note>('notes', { id: n.id ?? uid(), s: n.s, e: n.e, w: n.w ?? null, q: n.q ?? null, text: n.text, tags: n.tags ?? [], created_at: n.created_at ?? Date.now(), deleted_at: null, purged: false }));
export const saveLink = (l: Partial<LinkItem> & Anchor & { url: string }) =>
  mutate(l.id ? 'Link saved' : `Link added to ${anchorLabel(l)}`, (w) =>
    w.put<LinkItem>('links', { id: l.id ?? uid(), s: l.s, e: l.e, w: l.w ?? null, q: l.q ?? null, url: l.url, title: l.title || l.url, comment: l.comment ?? '', created_at: l.created_at ?? Date.now(), deleted_at: null, purged: false }));

// ---------------- starter tags (fixed ids so two devices never duplicate them) ----------------
const STARTER: [string, string, string, string][] = [
  ['FAM', 'Family', 'Parents, children, the home', '#f9c9a7'],
  ['PUR', 'Purity', 'Holiness of heart, mind and body', '#c3dcf5'],
  ['MAR', 'Marriage', 'Husbands, wives, covenant', '#f6c6d0'],
  ['FIN', 'Finance', 'Money, work, giving, debt', '#bfe8d4'],
  ['SAL', 'Salvation', 'Grace, faith, redemption', '#fbe7a1'],
  ['GOD', "God's Attributes", 'Who God is', '#d9cff5'],
  ['INS', 'Instructions', 'What to do in specific situations', '#cfe3c1'],
];
export async function ensureStarterTags() {
  if (await getMeta('starterTags', false)) return;
  const any = await db.tags.count();
  if (!any) {
    await mutate(null, (w) => w.putMany<Tag>('tags', STARTER.map(([code, name, desc, color], i) => ({ id: `starter-${code}`, code, name, desc, color, parent: null, order: i }))));
  }
  await setMeta('starterTags', true);
}

// ---------------- cross-references (Treasury of Scripture Knowledge) ----------------
type TskBook = Record<string, [string, number[][]][]>;
const tskCache = new Map<number, Promise<TskBook>>();
export function loadTsk(book: number): Promise<TskBook> {
  if (!tskCache.has(book)) tskCache.set(book, fetch(`${import.meta.env.BASE_URL}tsk/${book}.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({})));
  return tskCache.get(book)!;
}
export async function crossRefs(v: number) {
  const b = await loadTsk(vBook(v));
  return (b[`${vChap(v)}:${vVerse(v)}`] ?? []).map(([word, refs]) => ({ word, refs: refs.map((r) => ({ s: r[0], e: r[1] ?? r[0] })) }));
}

export { loadKjv };
