import { useEffect, useMemo, useRef, useState } from 'react';
import { BOOKS } from '../data/books';
import type { Tag, Tagging, Note } from '../lib/db';
import { useKjv, type Device } from '../lib/hooks';
import { usePaneState } from '../lib/layout';
import { ui, toast } from '../lib/store';
import { mutate } from '../lib/write';
import { vBook } from '../lib/ref';
import { useTagIndex, useTaggings, useNotes, useLinks, anchorLabel, anchorText, anchorKey, saveTag, mergeTags, normCode, type TagIndex } from '../lib/annot';
import { Modal } from '../components/ui';
import { Icon } from '../components/Icon';
import { TagChip } from '../components/TagPicker';
import { RefText, openRef } from '../components/RefText';

export const TAG_COLORS = ['#fbe7a1', '#bfe8d4', '#c3dcf5', '#d9cff5', '#fad3bf', '#f6c6d0', '#cfe3c1', '#f9c9a7', '#c9e6ef', '#e6d3c3', '#e2c6f0', '#d6d6d6'];

export default function Notes({ device, req }: { device: Device; req?: { n: number; params?: Record<string, unknown> } }) {
  const [st, setSt] = usePaneState(device, 'notes', { tab: 'tags', tag: '' });
  const last = useRef(0);
  useEffect(() => {
    if (!req || req.n === last.current) return;
    last.current = req.n;
    if (typeof req.params?.tag === 'string') setSt({ tab: 'tags', tag: req.params.tag });
    else if (typeof req.params?.tab === 'string') setSt({ tab: req.params.tab, tag: '' });
  }, [req, setSt]);
  return (
    <div className="stack">
      <div className="row wrap">
        <h2>Notes & Tags</h2><span className="spacer" />
        <div className="tabs" role="tablist">
          {(['tags', 'notes', 'links'] as const).map((t) => <button key={t} role="tab" aria-selected={st.tab === t} className={st.tab === t ? 'on' : ''} onClick={() => setSt({ tab: t, tag: '' })}>{t[0].toUpperCase() + t.slice(1)}</button>)}
        </div>
      </div>
      {st.tab === 'tags' && (st.tag ? <TagPage id={st.tag} back={() => setSt({ tag: '' })} open={(id) => setSt({ tag: id })} /> : <TagTree open={(id) => setSt({ tag: id })} />)}
      {st.tab === 'notes' && <NotesList />}
      {st.tab === 'links' && <LinksList />}
    </div>
  );
}

function useCounts(idx: TagIndex) {
  const taggings = useTaggings();
  const notes = useNotes();
  return useMemo(() => {
    const own = new Map<string, number>();
    taggings.forEach((t) => own.set(t.tag, (own.get(t.tag) ?? 0) + 1));
    notes.forEach((n) => n.tags.forEach((t) => own.set(t, (own.get(t) ?? 0) + 1)));
    return (id: string) => idx.desc(id).reduce((s, x) => s + (own.get(x) ?? 0), 0);
  }, [taggings, notes, idx]);
}

// ---------------- tree ----------------
function TagTree({ open }: { open: (id: string) => void }) {
  const idx = useTagIndex();
  const count = useCounts(idx);
  const [edit, setEdit] = useState<Partial<Tag> | null>(null);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; zone: 'before' | 'in' | 'after' } | null>(null);

  const move = async (id: string, target: string | null, zone: 'before' | 'in' | 'after') => {
    if (target && idx.desc(id).includes(target)) return toast('A tag can’t go inside itself', undefined, 2500);
    const t = idx.byId.get(id)!;
    const tgt = target ? idx.byId.get(target) : null;
    const parent = zone === 'in' ? target : tgt?.parent ?? null;
    const sibs = (idx.kids.get(parent) ?? []).filter((x) => x.id !== id);
    let pos = sibs.length;
    if (zone !== 'in' && tgt) pos = sibs.findIndex((x) => x.id === tgt.id) + (zone === 'after' ? 1 : 0);
    sibs.splice(pos, 0, t);
    await mutate(`Moved ${t.name}`, async (w) => { for (const [i, s] of sibs.entries()) await w.patch('tags', s.id, { order: i, parent: s.id === id ? parent : s.parent }); });
  };

  // plain render function (not a component) so rows aren't remounted while dragging
  const renderRow = (t: Tag, depth: number) => {
    const kids = idx.kids.get(t.id) ?? [];
    const z = over?.id === t.id ? over.zone : null;
    return (
      <div key={t.id}>
        <div className={'tree-row' + (z ? ` drop-${z}` : '')} style={{ paddingLeft: 8 + depth * 20 }} draggable
          onDragStart={(e) => { setDrag(t.id); e.dataTransfer.effectAllowed = 'move'; }}
          onDragEnd={() => { setDrag(null); setOver(null); }}
          onDragOver={(e) => { if (!drag || drag === t.id) return; e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); const y = (e.clientY - r.top) / r.height; setOver({ id: t.id, zone: y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'in' }); }}
          onDragLeave={() => setOver((o) => (o?.id === t.id ? null : o))}
          onDrop={(e) => { e.preventDefault(); if (drag && over) void move(drag, t.id, over.zone); setDrag(null); setOver(null); }}
          onClick={() => open(t.id)}>
          <button className="icon-btn" style={{ width: 22, height: 22, visibility: kids.length ? 'visible' : 'hidden' }} aria-label={closed.has(t.id) ? 'Expand' : 'Collapse'}
            onClick={(e) => { e.stopPropagation(); const n = new Set(closed); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); setClosed(n); }}>
            <Icon name={closed.has(t.id) ? 'right' : 'down'} size={14} />
          </button>
          <i className="dot" style={{ background: t.color }} />
          <span style={{ fontWeight: 600 }}>{t.name}</span>
          <code className="muted">{t.code}</code>
          <span className="muted small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{t.desc}</span>
          <span className="count">{count(t.id)}</span>
          <button className="icon-btn" title="Add a tag inside" onClick={(e) => { e.stopPropagation(); setEdit({ parent: t.id, color: t.color }); }}><Icon name="plus" size={15} /></button>
          <button className="icon-btn" title="Edit tag" onClick={(e) => { e.stopPropagation(); setEdit(t); }}><Icon name="pen" size={15} /></button>
        </div>
        {!closed.has(t.id) && kids.map((k) => renderRow(k, depth + 1))}
      </div>
    );
  };
  return (
    <div className="stack">
      <div className="row"><span className="muted small">Drag a tag onto another to put it inside; drag to the top or bottom edge of a tag to reorder.</span><span className="spacer" />
        <button className="btn primary" onClick={() => setEdit({ parent: null })}><Icon name="plus" size={16} /> New tag</button></div>
      <div className="card" style={{ padding: 6 }}
        onDragOver={(e) => { if (drag) e.preventDefault(); }}
        onDrop={(e) => { if (drag && !over) { e.preventDefault(); void move(drag, null, 'in'); setDrag(null); } }}>
        {(idx.kids.get(null) ?? []).map((t) => renderRow(t, 0))}
        {!idx.tags.length && <div className="muted" style={{ padding: 12 }}>No tags yet.</div>}
        {drag && <div className="muted small" style={{ padding: 10, textAlign: 'center' }}>Drop here to move to the top level</div>}
      </div>
      {edit && <TagEditor initial={edit} idx={idx} onClose={() => setEdit(null)} />}
    </div>
  );
}

export function TagEditor({ initial, idx, onClose }: { initial: Partial<Tag>; idx: TagIndex; onClose: () => void }) {
  const [name, setName] = useState(initial.name ?? '');
  const [code, setCode] = useState(initial.code ?? '');
  const [desc, setDesc] = useState(initial.desc ?? '');
  const [color, setColor] = useState(initial.color ?? TAG_COLORS[3]);
  const [parent, setParent] = useState<string>(initial.parent ?? '');
  const [mergeTo, setMergeTo] = useState('');
  const [err, setErr] = useState('');
  const exclude = initial.id ? new Set(idx.desc(initial.id)) : new Set<string>();
  const save = async () => {
    try { await saveTag({ id: initial.id, name, code: code || name, desc, color, parent: parent || null }); onClose(); }
    catch (e) { setErr((e as Error).message); }
  };
  const t = initial.id ? idx.byId.get(initial.id) : undefined;
  return (
    <Modal onClose={onClose}>
      <div className="modal stack" style={{ padding: 18, overflow: 'auto' }}>
        <h3>{initial.id ? 'Edit tag' : 'New tag'}</h3>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <label className="field" style={{ flex: 1 }}>Name<input type="text" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="field" style={{ width: 130 }}>Short code<input type="text" value={code} onChange={(e) => setCode(normCode(e.target.value))} placeholder="e.g. MAR" /></label>
        </div>
        <label className="field">Description<input type="text" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What this tag is about" /></label>
        <div className="field">Colour
          <div className="colors">
            {TAG_COLORS.map((c) => <button key={c} className="swatch" style={{ background: c, outline: c === color ? '2px solid var(--accent)' : undefined }} onClick={() => setColor(c)} aria-label={`Colour ${c}`} />)}
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Custom colour" style={{ width: 36, height: 30, padding: 0, border: 'none', background: 'none' }} />
          </div>
        </div>
        <label className="field">Inside
          <select value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">— Top level —</option>
            {idx.tags.filter((x) => !exclude.has(x.id)).map((x) => <option key={x.id} value={x.id}>{idx.path(x.id)}</option>)}
          </select>
        </label>
        {err && <div className="small" style={{ color: 'var(--rose-text)' }}>{err}</div>}
        <div className="row"><span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!name.trim()} onClick={save}>Save</button></div>
        {t && (
          <>
            <div className="menu-sep" />
            <div className="row wrap">
              <select value={mergeTo} onChange={(e) => setMergeTo(e.target.value)} style={{ flex: 1, minWidth: 180 }}>
                <option value="">Merge into another tag…</option>
                {idx.tags.filter((x) => x.id !== t.id).map((x) => <option key={x.id} value={x.id}>{idx.path(x.id)}</option>)}
              </select>
              <button className="btn small" disabled={!mergeTo} onClick={async () => { await mergeTags(t, idx.byId.get(mergeTo)!); onClose(); }}>Merge</button>
              <button className="btn small danger" onClick={async () => { await mutate(`Moved tag ${t.name} to Trash`, (w) => w.trash('tags', t.id)); onClose(); }}><Icon name="trash" size={14} /> Delete tag</button>
            </div>
            <div className="muted small">Merging moves all of “{t.name}”’s passages (and inner tags) into the other tag. Deleted tags stay in Trash for 30 days.</div>
          </>
        )}
      </div>
    </Modal>
  );
}

// ---------------- tag page ----------------
type Item = { kind: 'tagging'; t: Tagging } | { kind: 'note'; n: Note };
function TagPage({ id, back, open }: { id: string; back: () => void; open: (id: string) => void }) {
  const idx = useTagIndex();
  const taggings = useTaggings();
  const notes = useNotes();
  const kjv = useKjv();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState('');
  const [edit, setEdit] = useState(false);
  const tag = idx.byId.get(id);
  const ids = useMemo(() => new Set(tag ? idx.desc(id) : []), [idx, id, tag]);
  const items: Item[] = useMemo(() => [
    ...taggings.filter((t) => ids.has(t.tag)).map((t) => ({ kind: 'tagging' as const, t })),
    ...notes.filter((n) => n.tags.some((x) => ids.has(x))).map((n) => ({ kind: 'note' as const, n })),
  ].sort((a, b) => (a.kind === 'tagging' ? a.t.s : a.n.s) - (b.kind === 'tagging' ? b.t.s : b.n.s)), [taggings, notes, ids]);
  if (!tag) return <div className="muted">Tag not found. <button className="linkish" onClick={back}>Back</button></div>;
  const key = (it: Item) => (it.kind === 'tagging' ? it.t.id : it.n.id);
  const chosen = items.filter((it) => sel.has(key(it)));

  const bulk = async (to: string | null, copy: boolean) => {
    await mutate(to ? `${copy ? 'Copied' : 'Moved'} ${chosen.length} passage(s)` : `Removed tag from ${chosen.length} passage(s)`, async (w) => {
      for (const it of chosen) {
        if (it.kind === 'tagging') {
          if (to) await w.put<Tagging>('taggings', { ...it.t, id: `${to}|${anchorKey(it.t)}`, tag: to, deleted_at: null, purged: false });
          if (!copy) await w.purge('taggings', it.t.id);
        } else {
          const keep = copy ? it.n.tags : it.n.tags.filter((x) => !ids.has(x));
          await w.patch('notes', it.n.id, { tags: [...new Set(to ? [...keep, to] : keep)] });
        }
      }
    });
    setSel(new Set());
  };

  return (
    <div className="stack">
      <div className="row wrap">
        <button className="icon-btn" onClick={back} aria-label="All tags"><Icon name="left" /></button>
        <TagChip tag={tag} />
        <span className="muted small">{idx.path(id)}</span>
        <span className="spacer" />
        <button className="btn small" onClick={() => setEdit(true)}><Icon name="pen" size={14} /> Edit</button>
      </div>
      {tag.desc && <div className="muted">{tag.desc}</div>}
      {!!(idx.kids.get(id) ?? []).length && <div className="row wrap" style={{ gap: 6 }}>Inside: {(idx.kids.get(id) ?? []).map((k) => <TagChip small key={k.id} tag={k} onClick={() => open(k.id)} />)}</div>}
      <div className="row wrap">
        <label className="row small"><input type="checkbox" checked={!!items.length && sel.size === items.length} onChange={(e) => setSel(e.target.checked ? new Set(items.map(key)) : new Set())} /> Select all ({items.length})</label>
        {sel.size > 0 && (
          <>
            <select value={target} onChange={(e) => setTarget(e.target.value)} style={{ width: 200, minHeight: 32 }}>
              <option value="">Choose a tag…</option>
              {idx.tags.filter((x) => x.id !== id).map((x) => <option key={x.id} value={x.id}>{idx.path(x.id)}</option>)}
            </select>
            <button className="btn small" disabled={!target} onClick={() => bulk(target, false)}>Move to tag</button>
            <button className="btn small" disabled={!target} onClick={() => bulk(target, true)}>Copy to tag</button>
            <button className="btn small danger" onClick={() => bulk(null, false)}>Remove tag</button>
          </>
        )}
      </div>
      <div className="list">
        {items.map((it) => {
          const a = it.kind === 'tagging' ? it.t : it.n;
          const tg = it.kind === 'tagging' ? idx.byId.get(it.t.tag) : null;
          return (
            <div className="item" key={key(it)} style={{ alignItems: 'flex-start' }}>
              <input type="checkbox" checked={sel.has(key(it))} onChange={() => { const n = new Set(sel); if (n.has(key(it))) n.delete(key(it)); else n.add(key(it)); setSel(n); }} style={{ marginTop: 4 }} />
              <div className="grow">
                <div className="row wrap"><button className="linkish" onClick={() => openRef(a)}><b>{anchorLabel(a)}</b></button>
                  {it.kind === 'note' && <span className="pill">Note</span>}
                  {tg && tg.id !== id && <TagChip small tag={tg} />}
                  <span className="spacer" /><button className="icon-btn" title="Details" onClick={() => ui.set({ details: a })}><Icon name="more" size={16} /></button></div>
                <div style={{ fontFamily: 'var(--serif)', fontSize: 15, marginTop: 4 }}>{anchorText(kjv, a, 3)}</div>
                {it.kind === 'note' && <div className="note"><RefText text={it.n.text} /></div>}
              </div>
            </div>
          );
        })}
        {!items.length && <div className="muted">No passages with this tag yet. Select verses in the Bible and press T (or tap Tag).</div>}
      </div>
      {edit && <TagEditor initial={tag} idx={idx} onClose={() => setEdit(false)} />}
    </div>
  );
}

// ---------------- notes & links lists ----------------
function Filters({ tag, setTag, book, setBook }: { tag: string; setTag: (s: string) => void; book: number; setBook: (n: number) => void }) {
  const idx = useTagIndex();
  return (
    <div className="row wrap">
      <select value={tag} onChange={(e) => setTag(e.target.value)} style={{ width: 200 }}><option value="">All tags</option>{idx.tags.map((t) => <option key={t.id} value={t.id}>{idx.path(t.id)}</option>)}</select>
      <select value={book} onChange={(e) => setBook(Number(e.target.value))} style={{ width: 180 }}><option value={0}>All books</option><option value={-1}>Old Testament</option><option value={-2}>New Testament</option>{BOOKS.map((b, i) => <option key={i} value={i + 1}>{b.name}</option>)}</select>
    </div>
  );
}
const inBook = (s: number, book: number) => !book || (book === -1 ? vBook(s) <= 39 : book === -2 ? vBook(s) >= 40 : vBook(s) === book);

function NotesList() {
  const notes = useNotes();
  const idx = useTagIndex();
  const [tag, setTag] = useState('');
  const [book, setBook] = useState(0);
  const ids = tag ? new Set(idx.desc(tag)) : null;
  const list = notes.filter((n) => inBook(n.s, book) && (!ids || n.tags.some((t) => ids.has(t)))).sort((a, b) => a.s - b.s);
  return (
    <div className="stack">
      <Filters tag={tag} setTag={setTag} book={book} setBook={setBook} />
      <div className="list">
        {list.map((n) => (
          <div className="item" key={n.id} style={{ alignItems: 'flex-start' }}>
            <div className="grow">
              <div className="row"><button className="linkish" onClick={() => ui.set({ details: n })}><b>{anchorLabel(n)}</b></button><span className="spacer" />
                <button className="icon-btn" title="Edit" onClick={() => ui.set({ noteFor: { anchor: n, id: n.id, text: n.text } })}><Icon name="pen" size={15} /></button>
                <button className="icon-btn" title="Move to Trash" onClick={() => mutate('Note moved to Trash', (w) => w.trash('notes', n.id))}><Icon name="trash" size={15} /></button></div>
              <RefText text={n.text} />
              {!!n.tags.length && <div className="row wrap" style={{ gap: 4, marginTop: 6 }}>{n.tags.map((t) => idx.byId.get(t) && <TagChip small key={t} tag={idx.byId.get(t)!} />)}</div>}
            </div>
          </div>
        ))}
        {!list.length && <div className="muted">No notes{tag || book ? ' match these filters' : ' yet. Select verses and press N (or tap Note)'}.</div>}
      </div>
    </div>
  );
}

function LinksList() {
  const links = useLinks();
  const taggings = useTaggings();
  const idx = useTagIndex();
  const [tag, setTag] = useState('');
  const [book, setBook] = useState(0);
  const ids = tag ? new Set(idx.desc(tag)) : null;
  const tagged = (s: number, e: number) => !ids || taggings.some((t) => ids.has(t.tag) && t.s <= e && t.e >= s);
  const list = links.filter((l) => inBook(l.s, book) && tagged(l.s, l.e)).sort((a, b) => a.s - b.s);
  return (
    <div className="stack">
      <Filters tag={tag} setTag={setTag} book={book} setBook={setBook} />
      <div className="list">
        {list.map((l) => (
          <div className="item" key={l.id}>
            <Icon name="link" />
            <div className="grow">
              <a href={l.url} target="_blank" rel="noreferrer" style={{ wordBreak: 'break-word' }}>{l.title || l.url}</a>
              <div className="small"><button className="linkish" onClick={() => ui.set({ details: l })}>{anchorLabel(l)}</button>{l.comment && <> · <RefText text={l.comment} /></>}</div>
            </div>
            <button className="icon-btn" title="Move to Trash" onClick={() => mutate('Link moved to Trash', (w) => w.trash('links', l.id))}><Icon name="trash" size={15} /></button>
          </div>
        ))}
        {!list.length && <div className="muted">No links{tag || book ? ' match these filters' : ' yet'}.</div>}
      </div>
    </div>
  );
}

