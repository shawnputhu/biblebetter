import { useEffect, useMemo, useState } from 'react';
import { BOOKS } from '../data/books';
import { useKjv, useSettings } from '../lib/hooks';
import { ui, useUI } from '../lib/store';
import { vBook, vChap, vVerse, bgUrl, formatVerses } from '../lib/ref';
import { anchorLabel, anchorVerses, anchorKey, anchorText, overlaps, useTagIndex, useTaggings, useNotes, useLinks, untag, saveNote, saveLink, crossRefs, words } from '../lib/annot';
import { mutate } from '../lib/write';
import type { Anchor, Note } from '../lib/db';
import { Modal } from '../components/ui';
import { Icon } from '../components/Icon';
import { TagChip } from '../components/TagPicker';
import { RefText, RefLink, openRef } from '../components/RefText';

/** Drawer (PC) / sheet (phone) with everything attached to a passage. */
export function Details({ phone }: { phone: boolean }) {
  const a = useUI((s) => s.details);
  if (!a) return null;
  const close = () => ui.set({ details: null });
  const body = <DetailsBody a={a} />;
  return phone
    ? <Modal bottom onClose={close}><div className="sheet" style={{ maxHeight: '88vh' }}>{body}</div></Modal>
    : <Modal onClose={close}><div className="drawer" role="dialog" aria-label="Passage details">
        <div className="row" style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}><h3>{anchorLabel(a)}</h3><span className="spacer" /><button className="icon-btn" onClick={close} aria-label="Close"><Icon name="x" /></button></div>
        <div style={{ overflow: 'auto', padding: 16 }}>{body}</div>
      </div></Modal>;
}

function DetailsBody({ a }: { a: Anchor }) {
  const kjv = useKjv();
  const s = useSettings();
  const idx = useTagIndex();
  const taggings = useTaggings();
  const notes = useNotes();
  const links = useLinks();
  const verses = anchorVerses(a);
  const hits = (x: Anchor) => verses.some((v) => overlaps(x, v));
  const myTags = taggings.filter(hits);
  const myNotes = notes.filter(hits).sort((x, y) => x.s - y.s);
  const myLinks = links.filter(hits);
  const [pickWords, setPickWords] = useState<number | null>(null);
  const [wordSel, setWordSel] = useState<[number, number] | null>(a.w ?? null);
  const [linkForm, setLinkForm] = useState(false);
  const single = verses.length === 1;
  const vText = kjv && single ? kjv[vBook(a.s) - 1][vChap(a.s) - 1][vVerse(a.s) - 1] : '';
  const wds = useMemo(() => words(vText), [vText]);
  const wordAnchor: Anchor = wordSel ? { s: a.s, e: a.s, w: wordSel, q: wds.slice(wordSel[0], wordSel[1] + 1).join(' ') } : a;

  return (
    <div className="stack">
      {single ? (
        <div className="verse-words" aria-label="Tap two words to select part of the verse">
          {wds.map((w, i) => (
            <span key={i} className={'w' + (wordSel && i >= wordSel[0] && i <= wordSel[1] ? ' on' : '')}
              onClick={() => {
                if (pickWords === null) { setPickWords(i); setWordSel([i, i]); }
                else { setWordSel([Math.min(pickWords, i), Math.max(pickWords, i)]); setPickWords(null); }
              }}>{w} </span>
          ))}
        </div>
      ) : (
        <div style={{ fontFamily: 'var(--serif)', fontSize: 16, lineHeight: 1.6 }}>{anchorText(kjv, a, 8)}</div>
      )}
      {single && <div className="muted small">{wordSel ? <>Selected: “{wordAnchor.q}” · <button className="linkish" onClick={() => { setWordSel(null); setPickWords(null); }}>whole verse</button></> : 'Tap a word, then another, to work with part of the verse.'}</div>}

      <div className="row wrap">
        <button className="btn small primary" onClick={() => ui.set({ tagFor: wordAnchor })}><Icon name="tag" size={14} /> Tag{wordSel ? ' words' : ''}</button>
        <button className="btn small" onClick={() => ui.set({ noteFor: { anchor: wordAnchor } })}><Icon name="pen" size={14} /> Note</button>
        <button className="btn small" onClick={() => setLinkForm(true)}><Icon name="link" size={14} /> Link</button>
        <a className="btn small" href={bgUrl(formatVerses(verses), s.linkVersion)} target="_blank" rel="noreferrer">{s.linkVersion}</a>
        <button className="btn small ghost" onClick={() => { ui.set({ details: null }); openRef(a); }}>Go to passage</button>
      </div>
      {linkForm && <LinkForm anchor={wordAnchor} onDone={() => setLinkForm(false)} />}

      <section>
        <h4>Tags</h4>
        <div className="row wrap" style={{ gap: 6 }}>
          {myTags.map((t) => idx.byId.get(t.tag) && (
            <span key={t.id} title={anchorLabel(t)}><TagChip tag={idx.byId.get(t.tag)!} onRemove={() => untag(t)} />{(t.w || anchorKey(t) !== anchorKey(a)) && <span className="muted small"> {anchorLabel(t)}</span>}</span>
          ))}
          {!myTags.length && <span className="muted small">No tags yet.</span>}
        </div>
      </section>

      <section>
        <h4>Notes</h4>
        {myNotes.map((n) => <NoteView key={n.id} n={n} />)}
        {!myNotes.length && <span className="muted small">No notes yet.</span>}
      </section>

      <section>
        <h4>Links</h4>
        {myLinks.map((l) => (
          <div key={l.id} className="row" style={{ alignItems: 'flex-start', margin: '6px 0' }}>
            <Icon name="link" size={16} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <a href={l.url} target="_blank" rel="noreferrer" style={{ wordBreak: 'break-word' }}>{l.title || l.url}</a>
              <div className="muted small">{anchorLabel(l)}</div>
              {l.comment && <RefText text={l.comment} className="small" />}
            </div>
            <button className="icon-btn" title="Delete link" onClick={() => mutate('Link moved to Trash', (w) => w.trash('links', l.id))}><Icon name="trash" size={16} /></button>
          </div>
        ))}
        {!myLinks.length && <span className="muted small">No links yet.</span>}
      </section>

      {single && <CrossRefs v={a.s} />}
    </div>
  );
}

function NoteView({ n }: { n: Note }) {
  const idx = useTagIndex();
  return (
    <div className="note">
      <div className="row small muted">{anchorLabel(n)}<span className="spacer" />
        <button className="icon-btn" title="Edit" onClick={() => ui.set({ noteFor: { anchor: n, id: n.id, text: n.text } })}><Icon name="pen" size={15} /></button>
        <button className="icon-btn" title="Move to Trash" onClick={() => mutate('Note moved to Trash', (w) => w.trash('notes', n.id))}><Icon name="trash" size={15} /></button>
      </div>
      <RefText text={n.text} />
      {!!n.tags.length && <div className="row wrap" style={{ gap: 4, marginTop: 6 }}>{n.tags.map((t) => idx.byId.get(t) && <TagChip small key={t} tag={idx.byId.get(t)!} />)}</div>}
    </div>
  );
}

function LinkForm({ anchor, onDone, initial }: { anchor: Anchor; onDone: () => void; initial?: { url?: string; title?: string } }) {
  const [url, setUrl] = useState(initial?.url ?? '');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [comment, setComment] = useState('');
  return (
    <div className="card stack" style={{ boxShadow: 'none', border: '1px solid var(--line)' }}>
      <label className="field">Web address<input type="text" inputMode="url" autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></label>
      <label className="field">Title (optional)<input type="text" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label className="field">Comment (optional)<input type="text" value={comment} onChange={(e) => setComment(e.target.value)} /></label>
      <div className="row"><span className="spacer" /><button className="btn small" onClick={onDone}>Cancel</button>
        <button className="btn small primary" disabled={!url.trim()} onClick={async () => { const u = /^https?:\/\//i.test(url.trim()) ? url.trim() : 'https://' + url.trim(); await saveLink({ ...anchor, url: u, title: title.trim(), comment }); onDone(); }}>Save link</button></div>
    </div>
  );
}
export { LinkForm };

function CrossRefs({ v }: { v: number }) {
  const [refs, setRefs] = useState<{ word: string; refs: { s: number; e: number }[] }[] | null>(null);
  useEffect(() => { setRefs(null); void crossRefs(v).then(setRefs); }, [v]);
  return (
    <section>
      <h4>Cross-references <span className="muted small" style={{ fontWeight: 400 }}>· Treasury of Scripture Knowledge</span></h4>
      {refs === null && <span className="muted small">Loading…</span>}
      {refs?.length === 0 && <span className="muted small">None for this verse.</span>}
      {refs?.map((g, i) => (
        <div key={i} className="xref">
          <b>{g.word}</b>
          <div>
            {g.refs.map((r, j) => {
              const label = anchorLabel({ s: r.s, e: r.e });
              return <span key={j}><RefLink r={{ s: r.s, e: r.e, label }}>{label}</RefLink>{j < g.refs.length - 1 ? '; ' : ''}</span>;
            })}
          </div>
        </div>
      ))}
    </section>
  );
}

/** Note editor modal (global). */
export function NoteEditor() {
  const n = useUI((s) => s.noteFor);
  const [text, setText] = useState('');
  useEffect(() => { setText(n?.text ?? ''); }, [n]);
  if (!n) return null;
  const close = () => ui.set({ noteFor: null });
  const save = async () => { if (text.trim()) await saveNote({ ...n.anchor, id: n.id, text }); close(); };
  return (
    <Modal onClose={close}>
      <div className="modal stack" style={{ padding: 18 }}>
        <h3>{n.id ? 'Edit note' : 'New note'} · {anchorLabel(n.anchor)}</h3>
        <textarea autoFocus rows={7} value={text} onChange={(e) => setText(e.target.value)} placeholder="Your note… references like Rom 5:8 become links."
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void save(); }} />
        <div className="row"><span className="muted small">Ctrl+Enter saves</span><span className="spacer" /><button className="btn" onClick={close}>Cancel</button><button className="btn primary" onClick={save}>Save</button></div>
      </div>
    </Modal>
  );
}

export { BOOKS };
