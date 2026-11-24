import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { BOOKS } from '../data/books';
import { db, alive } from '../lib/db';
import { useKjv, useActiveRt, useReadMap, type Device, type KJV } from '../lib/hooks';
import { usePaneState } from '../lib/layout';
import { parseRef, refLabel, vid, vBook, vChap, vVerse, verseRef } from '../lib/ref';
import { useTagIndex, useTaggings, useNotes, useLinks, anchorLabel, anchorVerses } from '../lib/annot';
import { navigate, ui } from '../lib/store';
import { Icon } from '../components/Icon';
import { TagChip } from '../components/TagPicker';
import { toRange, openRef } from '../components/RefText';

interface Q { terms: string[]; phrases: string[] }
function parseQuery(q: string): Q {
  const phrases: string[] = [];
  const rest = q.replace(/"([^"]+)"/g, (_, p) => { phrases.push(p.trim().toLowerCase()); return ' '; });
  const terms = rest.toLowerCase().split(/\s+/).map((t) => t.replace(/[^a-z0-9'’]/g, '')).filter((t) => t.length > 0);
  return { terms, phrases };
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function matcher(q: Q) {
  const rx = [...q.phrases.map((p) => new RegExp(`\\b${esc(p)}\\b`, 'i')), ...q.terms.map((t) => new RegExp(`\\b${esc(t)}`, 'i'))];
  return (text: string) => rx.length > 0 && rx.every((r) => r.test(text));
}
function highlightRx(q: Q) {
  const parts = [...q.phrases.map((p) => `\\b${esc(p)}\\b`), ...q.terms.map((t) => `\\b${esc(t)}[a-z]*`)];
  return parts.length ? new RegExp(`(${parts.join('|')})`, 'gi') : null;
}
function Hl({ text, rx }: { text: string; rx: RegExp | null }) {
  if (!rx) return <>{text}</>;
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(rx)) { out.push(text.slice(last, m.index)); out.push(<mark key={m.index}>{m[0]}</mark>); last = m.index! + m[0].length; }
  out.push(text.slice(last));
  return <>{out}</>;
}

let flat: { id: number; t: string }[] | null = null;
function flatten(kjv: KJV) {
  if (flat) return flat;
  flat = [];
  kjv.forEach((b, bi) => b.forEach((c, ci) => c.forEach((t, vi) => flat!.push({ id: vid(bi + 1, ci + 1, vi + 1), t }))));
  return flat;
}

export default function Search({ device, req }: { device: Device; req?: { n: number; params?: Record<string, unknown> } }) {
  const [st, setSt] = usePaneState(device, 'search', { q: '', scope: 0, tag: '' });
  const [q, setQ] = useState(st.q);
  const [dq, setDq] = useState(st.q);
  const kjv = useKjv();
  const idx = useTagIndex();
  const taggings = useTaggings();
  const notes = useNotes();
  const links = useLinks();
  const rt = useActiveRt();
  const reads = useReadMap(rt?.id);
  const reflections = useLiveQuery(async () => (await db.reflections.toArray()).filter(alive), []) ?? [];
  const inbox = useLiveQuery(async () => (await db.inbox_items.toArray()).filter(alive), []) ?? [];
  const input = useRef<HTMLInputElement>(null);
  const last = useRef(0);
  useEffect(() => {
    if (req && req.n !== last.current) { last.current = req.n; if (typeof req.params?.q === 'string') { setQ(req.params.q); setDq(req.params.q); } }
    setTimeout(() => input.current?.focus(), 50);
  }, [req]);
  useEffect(() => { const t = setTimeout(() => { setDq(q); setSt({ q }); }, 220); return () => clearTimeout(t); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const query = useMemo(() => parseQuery(dq), [dq]);
  const ref = useMemo(() => (dq.trim() ? parseRef(dq) : null), [dq]);
  const has = useMemo(() => matcher(query), [query]);
  const hl = useMemo(() => highlightRx(query), [query]);
  const scope = st.scope as number;
  const inScope = (v: number) => !scope || (scope === -1 ? vBook(v) <= 39 : scope === -2 ? vBook(v) >= 40 : vBook(v) === scope);
  const tagSet = useMemo(() => {
    if (!st.tag) return null;
    const ids = new Set(idx.desc(st.tag as string));
    const s = new Set<number>();
    taggings.filter((t) => ids.has(t.tag)).forEach((t) => anchorVerses(t).forEach((v) => s.add(v)));
    notes.filter((n) => n.tags.some((x) => ids.has(x))).forEach((n) => anchorVerses(n).forEach((v) => s.add(v)));
    return s;
  }, [st.tag, idx, taggings, notes]);

  const verseHits = useMemo(() => {
    if (!kjv || (!query.terms.length && !query.phrases.length) || ref) return { list: [], total: 0 };
    const all = flatten(kjv);
    const list: { id: number; t: string }[] = [];
    let total = 0;
    for (const x of all) {
      if (!inScope(x.id) || (tagSet && !tagSet.has(x.id))) continue;
      if (has(x.t)) { total++; if (list.length < 200) list.push(x); }
    }
    return { list, total };
  }, [kjv, query, has, ref, scope, tagSet]); // eslint-disable-line react-hooks/exhaustive-deps

  const tagOnlyVerses = useMemo(() => (tagSet && !dq.trim() ? [...tagSet].filter(inScope).sort((a, b) => a - b) : []), [tagSet, dq, scope]); // eslint-disable-line react-hooks/exhaustive-deps
  const textOn = query.terms.length + query.phrases.length > 0;
  const tagHits = textOn ? idx.tags.filter((t) => has(`${t.name} ${t.code} ${t.desc}`)) : [];
  const noteHits = textOn ? notes.filter((n) => inScope(n.s) && (!tagSet || anchorVerses(n).some((v) => tagSet.has(v))) && has(n.text)) : [];
  const linkHits = textOn ? links.filter((l) => inScope(l.s) && has(`${l.title} ${l.url} ${l.comment}`)) : [];
  const reflHits = textOn ? reflections.filter((r) => has(r.text)) : [];
  const inboxHits = textOn ? inbox.filter((i) => has(i.text)) : [];
  const refRange = ref ? toRange(ref) : null;

  return (
    <div className="stack">
      <div className="row">
        <input ref={input} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder='Search verses, tags, notes… e.g. "love of God", grace faith, rom 8' style={{ fontSize: 16 }} />
      </div>
      <div className="row wrap">
        <select value={scope} onChange={(e) => setSt({ scope: Number(e.target.value) })} style={{ width: 170 }}>
          <option value={0}>Whole Bible</option><option value={-1}>Old Testament</option><option value={-2}>New Testament</option>
          {BOOKS.map((b, i) => <option key={i} value={i + 1}>{b.name}</option>)}
        </select>
        <select value={st.tag as string} onChange={(e) => setSt({ tag: e.target.value })} style={{ width: 200 }}>
          <option value="">Any tag</option>{idx.tags.map((t) => <option key={t.id} value={t.id}>{idx.path(t.id)}</option>)}
        </select>
        <span className="muted small">Quotes = exact phrase · several words = all of them</span>
      </div>

      {ref && refRange && (
        <div className="result" onClick={() => navigate('bible', { book: ref.book, chapter: ref.chapter ?? 0, verse: ref.verse ?? 0 })}>
          <div className="row"><Icon name="book" /> <b>Go to {refLabel(ref)}</b></div>
          {kjv && ref.verse && <div style={{ fontFamily: 'var(--serif)', marginTop: 6 }}>{kjv[ref.book - 1][(ref.chapter ?? 1) - 1][ref.verse - 1]}</div>}
        </div>
      )}
      {ref && !refRange && <div className="result" onClick={() => navigate('bible', { book: ref.book })}><Icon name="book" /> <b>Open {BOOKS[ref.book - 1].name}</b></div>}

      {!!tagHits.length && <Group title="Tags" n={tagHits.length}>
        <div className="row wrap" style={{ gap: 6 }}>{tagHits.map((t) => <TagChip key={t.id} tag={t} onClick={() => navigate('notes', { tag: t.id })} />)}</div>
      </Group>}

      {!!verseHits.total && <Group title="Verses" n={verseHits.total} note={verseHits.total > 200 ? 'showing first 200' : undefined}>
        {verseHits.list.map((x) => <VerseResult key={x.id} v={x.id} text={x.t} hl={hl} read={reads.has(x.id)} />)}
      </Group>}

      {!!tagOnlyVerses.length && <Group title="Tagged verses" n={tagOnlyVerses.length}>
        {tagOnlyVerses.slice(0, 200).map((v) => <VerseResult key={v} v={v} text={kjv?.[vBook(v) - 1][vChap(v) - 1][vVerse(v) - 1] ?? ''} hl={null} read={reads.has(v)} />)}
      </Group>}

      {!!noteHits.length && <Group title="Notes" n={noteHits.length}>
        {noteHits.map((n) => <div className="result" key={n.id} onClick={() => ui.set({ details: n })}><b className="small">{anchorLabel(n)}</b><div style={{ whiteSpace: 'pre-wrap' }}><Hl text={n.text} rx={hl} /></div></div>)}
      </Group>}
      {!!linkHits.length && <Group title="Links" n={linkHits.length}>
        {linkHits.map((l) => <div className="result" key={l.id} onClick={() => ui.set({ details: l })}><b className="small">{anchorLabel(l)}</b><div><Hl text={l.title || l.url} rx={hl} /></div>{l.comment && <div className="muted small"><Hl text={l.comment} rx={hl} /></div>}</div>)}
      </Group>}
      {!!reflHits.length && <Group title="Reflections" n={reflHits.length}>
        {reflHits.map((r) => <div className="result" key={r.id} onClick={() => navigate('readthroughs')}><b className="small">{r.date}</b><div style={{ whiteSpace: 'pre-wrap' }}><Hl text={r.text} rx={hl} /></div></div>)}
      </Group>}
      {!!inboxHits.length && <Group title="Inbox" n={inboxHits.length}>
        {inboxHits.map((i) => <div className="result" key={i.id} onClick={() => navigate('inbox')}><Hl text={i.text} rx={hl} /></div>)}
      </Group>}

      {dq.trim() && !ref && !verseHits.total && !tagHits.length && !noteHits.length && !linkHits.length && !reflHits.length && !inboxHits.length && <div className="muted">No results.</div>}
      {!dq.trim() && !st.tag && <div className="muted small">Type a passage to jump there, or words to search the KJV text and everything you’ve written.</div>}
    </div>
  );
}

function Group({ title, n, note, children }: { title: string; n: number; note?: string; children: ReactNode }) {
  return <section className="stack" style={{ gap: 8 }}><h4>{title} · {n.toLocaleString()}{note ? ` · ${note}` : ''}</h4>{children}</section>;
}

function VerseResult({ v, text, hl, read }: { v: number; text: string; hl: RegExp | null; read: boolean }) {
  return (
    <div className="result" onClick={() => openRef({ s: v })}>
      <div className="row small"><b>{verseRef(v)}</b>{read && <span className="pill mint">read</span>}<span className="spacer" />
        <button className="icon-btn" title="Details" onClick={(e) => { e.stopPropagation(); ui.set({ details: { s: v, e: v } }); }}><Icon name="more" size={15} /></button></div>
      <div style={{ fontFamily: 'var(--serif)', fontSize: 15.5, lineHeight: 1.55 }}><Hl text={text} rx={hl} /></div>
    </div>
  );
}
