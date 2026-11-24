import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { BOOKS } from '../data/books';
import { db, alive, todayStr } from '../lib/db';
import { useActiveRt, useReadMap, useSettings, useKjv, saveSettings, isTyping, type Device } from '../lib/hooks';
import { vid, vBook, vChap, vVerse, chapKey, chapterVerseIds, bgUrl, formatVerses, verseRef } from '../lib/ref';
import { setChecked, setHighlight, copyRef } from '../lib/actions';
import { useTagIndex, useTaggings, useNotes, useLinks, overlaps, anchorOf, words } from '../lib/annot';
import type { Anchor } from '../lib/db';
import { usePaneState, addRecent } from '../lib/layout';
import { ui, toast } from '../lib/store';
import { Icon } from '../components/Icon';
import { Ring, Modal } from '../components/ui';
import { RefText } from '../components/RefText';

export const HL_COLORS = [
  { key: 'butter', css: 'var(--butter)' },
  { key: 'mint', css: 'var(--mint)' },
  { key: 'sky', css: 'var(--sky)' },
  { key: 'lavender', css: 'var(--accent-soft)' },
  { key: 'peach', css: 'var(--peach)' },
  { key: 'rose', css: 'var(--rose)' },
];
const hlCss = (k?: string) => HL_COLORS.find((c) => c.key === k)?.css;

interface Props { device: Device; req?: { n: number; params?: Record<string, unknown> }; focused: boolean }

export function useHighlights() {
  const rows = useLiveQuery(() => db.highlights.toArray(), []);
  return useMemo(() => new Map((rows ?? []).filter(alive).filter((r) => r.color).map((r) => [r.verse, r.color])), [rows]);
}

export default function Bible({ device, req, focused }: Props) {
  const [st, setSt] = usePaneState(device, 'bible', { book: 0, chapter: 0 });
  const [jump, setJump] = useState<number | null>(null);
  const rt = useActiveRt();
  const reads = useReadMap(rt?.id);

  // navigation requests from palette / Today / recent items
  const lastReq = useRef(0);
  useEffect(() => {
    if (!req || req.n === lastReq.current) return;
    lastReq.current = req.n;
    const p = req.params ?? {};
    if (typeof p.book === 'number') {
      setSt({ book: p.book, chapter: (p.chapter as number) || (BOOKS[p.book - 1].v.length === 1 ? 1 : 0) });
      if (p.verse) setJump(vid(p.book, (p.chapter as number) || 1, p.verse as number));
    }
  }, [req, setSt]);

  const counts = useMemo(() => {
    const book = new Map<number, number>(), chap = new Map<string, number>();
    reads.forEach((_, v) => {
      book.set(vBook(v), (book.get(vBook(v)) ?? 0) + 1);
      const k = chapKey(vBook(v), vChap(v));
      chap.set(k, (chap.get(k) ?? 0) + 1);
    });
    return { book, chap };
  }, [reads]);

  const go = (book: number, chapter: number) => setSt({ book, chapter });
  const b = st.book, c = st.chapter;

  return (
    <>
      <div className="pane-head" style={{ borderBottom: 'none', background: 'transparent', minHeight: 0, padding: '10px 14px 0' }}>
        <nav className="crumbs" aria-label="Location">
          <button onClick={() => go(0, 0)}>Bible</button>
          {b > 0 && <>/<button onClick={() => go(b, 0)} className={c ? '' : 'cur'}>{BOOKS[b - 1].name}</button></>}
          {b > 0 && c > 0 && <>/<span className="cur">{c}</span></>}
        </nav>
        <span className="spacer" />
        {rt && <span className="pill" title="Active read-through">{rt.name}</span>}
      </div>
      <div className="pane-body">
        {!b && <Books counts={counts.book} onPick={(bk) => go(bk, BOOKS[bk - 1].v.length === 1 ? 1 : 0)} />}
        {b > 0 && !c && <Chapters book={b} counts={counts.chap} onPick={(ch) => go(b, ch)} />}
        {b > 0 && c > 0 && rt && (
          <Chapter key={`${b}:${c}`} book={b} chapter={c} rt={rt.id} reads={reads} focused={focused} jump={jump} clearJump={() => setJump(null)} go={go} device={device} />
        )}
      </div>
    </>
  );
}

function Books({ counts, onPick }: { counts: Map<number, number>; onPick: (b: number) => void }) {
  return (
    <>
      {(['OT', 'NT'] as const).map((t) => {
        const list = BOOKS.map((bk, i) => ({ bk, i })).filter((x) => x.bk.t === t);
        const total = list.reduce((s, x) => s + x.bk.v.reduce((a, n) => a + n, 0), 0);
        const done = list.reduce((s, x) => s + (counts.get(x.i + 1) ?? 0), 0);
        return (
          <section className="testament" key={t}>
            <h3>{t === 'OT' ? 'Old Testament' : 'New Testament'} <span className="pill mint">{((done / total) * 100).toFixed(1)}%</span></h3>
            <div className="book-grid">
              {list.map(({ bk, i }) => {
                const n = bk.v.reduce((a, x) => a + x, 0);
                return (
                  <button key={i} className="book-card" onClick={() => onPick(i + 1)}>
                    <Ring pct={((counts.get(i + 1) ?? 0) / n) * 100} />
                    <span><span className="name">{bk.name}</span><br /><span className="muted small">{bk.v.length} ch</span></span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </>
  );
}

function Chapters({ book, counts, onPick }: { book: number; counts: Map<string, number>; onPick: (c: number) => void }) {
  const bk = BOOKS[book - 1];
  return (
    <div className="chap-grid">
      {bk.v.map((n, i) => {
        const done = counts.get(chapKey(book, i + 1)) ?? 0;
        return (
          <button key={i} className={'chap' + (done === n ? ' done' : '')} onClick={() => onPick(i + 1)} aria-label={`Chapter ${i + 1}, ${done} of ${n} verses read`}>
            {done > 0 && done < n && <i className="fill" style={{ height: `${(done / n) * 100}%` }} />}
            <span>{i + 1}</span>
          </button>
        );
      })}
    </div>
  );
}

interface ChapterProps {
  book: number; chapter: number; rt: string; reads: Map<number, unknown>; focused: boolean; jump: number | null; clearJump: () => void;
  go: (b: number, c: number) => void; device: Device;
}

function Chapter({ book, chapter, rt, reads, focused, jump, clearJump, go }: ChapterProps) {
  const settings = useSettings();
  const compact = settings.compact;
  const kjv = useKjv();
  const hl = useHighlights();
  const verses = useMemo(() => chapterVerseIds(book, chapter), [book, chapter]);
  const tagIdx = useTagIndex();
  const taggings = useTaggings();
  const notes = useNotes();
  const links = useLinks();
  const marks = useMemo(() => {
    const m = new Map<number, { colors: string[]; note: boolean; link: boolean; partial: [number, number][] }>();
    const lo = verses[0], hi = verses[verses.length - 1];
    const get = (v: number) => { if (!m.has(v)) m.set(v, { colors: [], note: false, link: false, partial: [] }); return m.get(v)!; };
    const each = (a: Anchor, f: (x: ReturnType<typeof get>) => void) => {
      if (a.e < lo || a.s > hi) return;
      for (const v of verses) if (overlaps(a, v)) { const x = get(v); f(x); if (a.w && a.s === a.e) x.partial.push(a.w); }
    };
    taggings.forEach((t) => { const c = tagIdx.byId.get(t.tag)?.color; if (c) each(t, (x) => { if (!x.colors.includes(c)) x.colors.push(c); }); });
    notes.forEach((n) => each(n, (x) => { x.note = true; }));
    links.forEach((l) => each(l, (x) => { x.link = true; }));
    return m;
  }, [verses, taggings, notes, links, tagIdx]);
  const [wordBar, setWordBar] = useState<{ x: number; y: number; a: Anchor } | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [focusIdx, setFocusIdx] = useState(0);
  const [pending, setPending] = useState<{ set: Set<number>; on: boolean } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; verses: number[] } | null>(null);
  const [sheet, setSheet] = useState<number[] | null>(null);
  const [swipe, setSwipe] = useState<{ v: number; dx: number } | null>(null);
  const [dateFor, setDateFor] = useState(todayStr());
  const boxRef = useRef<HTMLDivElement>(null);
  const refl = useLiveQuery(async () => (await db.reflections.toArray()).filter((r) => alive(r) && r.chapters.includes(chapKey(book, chapter)) && r.text.trim()), [book, chapter]);
  const rts = useLiveQuery(() => db.readthroughs.toArray(), []);
  const bk = BOOKS[book - 1];
  const label = `${bk.name} ${chapter}`;

  useEffect(() => { void addRecent(label, 'bible', { book, chapter }); }, [label, book, chapter]);

  const isOn = (v: number) => (pending?.set.has(v) ? pending.on : reads.has(v));
  const allOn = verses.every((v) => reads.has(v));
  const range = (a: number, b: number) => verses.filter((v) => v >= Math.min(a, b) && v <= Math.max(a, b));

  // jump to a verse requested by navigation
  useEffect(() => {
    if (!jump || vBook(jump) !== book || vChap(jump) !== chapter) return;
    const idx = verses.indexOf(jump);
    setFocusIdx(Math.max(0, idx));
    setSel(new Set([jump]));
    setAnchor(jump);
    setTimeout(() => boxRef.current?.querySelector(`[data-v="${jump}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60);
    clearJump();
  }, [jump, book, chapter, verses, clearJump]);

  // ---------- drag-to-check (mouse / pen) ----------
  const drag = useRef<{ anchor: number; on: boolean; cur: number } | null>(null);
  useEffect(() => {
    const up = () => {
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      const set = range(d.anchor, d.cur);
      setPending(null);
      void setChecked(rt, set, d.on);
    };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  });
  const startDrag = (v: number) => {
    const on = !reads.has(v);
    drag.current = { anchor: v, on, cur: v };
    setPending({ set: new Set([v]), on });
  };
  const enterDrag = (v: number) => {
    const d = drag.current;
    if (!d || d.cur === v) return;
    d.cur = v;
    setPending({ set: new Set(range(d.anchor, v)), on: d.on });
  };

  // ---------- touch: tap, swipe, long-press-drag select ----------
  const touch = useRef<{ v: number; x: number; y: number; t: number; timer: ReturnType<typeof setTimeout>; selecting: boolean; moved: boolean; target: 'box' | 'text' } | null>(null);
  useEffect(() => {
    const move = (e: TouchEvent) => {
      const tt = touch.current;
      if (!tt?.selecting) return;
      e.preventDefault();
      const p = e.touches[0];
      const el = document.elementFromPoint(p.clientX, p.clientY)?.closest('[data-v]') as HTMLElement | null;
      if (el) { const v = Number(el.dataset.v); setSel(new Set(range(tt.v, v))); }
    };
    window.addEventListener('touchmove', move, { passive: false });
    return () => window.removeEventListener('touchmove', move);
  });
  const onPointerDown = (e: React.PointerEvent, v: number, target: 'box' | 'text') => {
    if (e.button === 2) return;
    if (e.pointerType === 'mouse' || e.pointerType === 'pen') {
      if (e.shiftKey || e.ctrlKey || e.metaKey) { e.preventDefault(); toggleSel(v, e.shiftKey); return; }
      if (target === 'box') { e.preventDefault(); startDrag(v); }
      return;
    }
    const timer = setTimeout(() => {
      if (!touch.current || touch.current.moved) return;
      touch.current.selecting = true;
      navigator.vibrate?.(15);
      setSel(new Set([v]));
      setAnchor(v);
    }, 430);
    touch.current = { v, x: e.clientX, y: e.clientY, t: Date.now(), timer, selecting: false, moved: false, target };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const tt = touch.current;
    if (!tt || tt.selecting) return;
    const dx = e.clientX - tt.x, dy = e.clientY - tt.y;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) { tt.moved = true; clearTimeout(tt.timer); }
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) setSwipe({ v: tt.v, dx: Math.max(-90, Math.min(90, dx)) });
  };
  const onPointerUp = (e: React.PointerEvent, v: number) => {
    const tt = touch.current;
    if (!tt) return;
    clearTimeout(tt.timer);
    touch.current = null;
    setSwipe(null);
    if (tt.selecting) return;
    const dx = e.clientX - tt.x, dy = e.clientY - tt.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) {
      navigator.vibrate?.(10);
      if (dx > 0) void setChecked(rt, [v], !reads.has(v));
      else setSheet(sel.has(v) && sel.size > 1 ? [...sel] : [v]);
      return;
    }
    if (!tt.moved && Date.now() - tt.t < 430) {
      if (sel.size) toggleSel(v, false);
      else if (tt.target === 'box') void setChecked(rt, [v], !reads.has(v));
      else toggleSel(v, false);
    }
  };
  const onPointerCancel = () => { if (touch.current) clearTimeout(touch.current.timer); touch.current = null; setSwipe(null); };

  const toggleSel = (v: number, shift: boolean) => {
    if (shift && anchor !== null) { setSel(new Set(range(anchor, v))); return; }
    const n = new Set(sel);
    if (n.has(v)) n.delete(v); else n.add(v);
    setSel(n);
    setAnchor(v);
  };

  // ---------- keyboard ----------
  useEffect(() => {
    if (!focused) return;
    const f = (e: KeyboardEvent) => {
      if (isTyping(e) || ui.get().palette || ui.get().reading) return;
      const cols = compact ? Math.max(1, Math.floor((boxRef.current?.clientWidth ?? 300) / 52)) : 1;
      let i = focusIdx;
      if (e.key === 'ArrowRight') i = Math.min(verses.length - 1, i + 1);
      else if (e.key === 'ArrowLeft') i = Math.max(0, i - 1);
      else if (e.key === 'ArrowDown') i = Math.min(verses.length - 1, i + cols);
      else if (e.key === 'ArrowUp') i = Math.max(0, i - cols);
      else if (e.key === ' ') { e.preventDefault(); const t = sel.size ? [...sel] : [verses[i]]; void setChecked(rt, t, !t.every((v) => reads.has(v))); return; }
      else if (e.key === 'Escape') { setSel(new Set()); setMenu(null); return; }
      else if (e.key === 'r' || e.key === 'R') { if (!e.ctrlKey && !e.metaKey) ui.set({ reading: { book, chapter } }); return; }
      else if ((e.key === 't' || e.key === 'T') && !e.ctrlKey && !e.metaKey) { e.preventDefault(); ui.set({ tagFor: anchorOf(sel.size ? [...sel] : [verses[i]]) }); return; }
      else if ((e.key === 'n' || e.key === 'N') && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); ui.set({ noteFor: { anchor: anchorOf(sel.size ? [...sel] : [verses[i]]) } }); return; }
      else if ((e.key === 'd' || e.key === 'D') && !e.ctrlKey && !e.metaKey) { e.preventDefault(); ui.set({ details: anchorOf(sel.size ? [...sel] : [verses[i]]) }); return; }
      else return;
      e.preventDefault();
      if (e.shiftKey) { const a = anchor ?? verses[focusIdx]; setAnchor(a); setSel(new Set(range(a, verses[i]))); }
      setFocusIdx(i);
      boxRef.current?.querySelector(`[data-v="${verses[i]}"]`)?.scrollIntoView({ block: 'nearest' });
    };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  });

  const selList = [...sel].sort((a, b) => a - b);
  const actVerses = (v: number) => (sel.has(v) && sel.size > 1 ? selList : [v]);
  const onContext = (e: React.MouseEvent, v: number) => { e.preventDefault(); setMenu({ x: Math.min(e.clientX, window.innerWidth - 250), y: Math.min(e.clientY, window.innerHeight - 330), verses: actVerses(v) }); };
  const link = (vs: number[]) => bgUrl(formatVerses(vs), settings.linkVersion);
  const nextChap = chapter < bk.v.length ? [book, chapter + 1] : book < 66 ? [book + 1, 1] : null;
  const prevChap = chapter > 1 ? [book, chapter - 1] : book > 1 ? [book - 1, BOOKS[book - 2].v.length] : null;

  const Marks = ({ v }: { v: number }) => {
    const m = marks.get(v);
    if (!m || (!m.colors.length && !m.note && !m.link)) return null;
    return (
      <button className="marks" title="Tags, notes and links" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); ui.set({ details: anchorOf([v]) }); }}>
        {m.colors.slice(0, 3).map((c) => <i key={c} style={{ background: c }} />)}
        {m.note && <Icon name="pen" size={11} />}{m.link && <Icon name="link" size={11} />}
      </button>
    );
  };
  const renderText = (v: number) => {
    const t = kjv ? kjv[book - 1][chapter - 1][vVerse(v) - 1] : '…';
    const parts = marks.get(v)?.partial ?? [];
    if (!parts.length || !kjv) return t;
    return words(t).map((w, i) => <span key={i}><span className={parts.some(([a, b]) => i >= a && i <= b) ? 'part' : ''}>{w}</span> </span>);
  };
  const onTextMouseUp = (v: number) => {
    const s = window.getSelection();
    if (!s || s.isCollapsed || !kjv) return;
    const el = boxRef.current?.querySelector(`[data-v="${v}"] .txt`);
    if (!el || !el.contains(s.anchorNode) || !el.contains(s.focusNode)) return;
    const full = kjv[book - 1][chapter - 1][vVerse(v) - 1];
    const range = s.getRangeAt(0);
    const pre = document.createRange(); pre.selectNodeContents(el); pre.setEnd(range.startContainer, range.startOffset);
    const startChar = pre.toString().length, endChar = startChar + range.toString().length;
    let pos = 0; const idx: number[] = [];
    words(full).forEach((w, i) => { const at = full.indexOf(w, pos); pos = at + w.length; if (at < endChar && at + w.length > startChar) idx.push(i); });
    if (!idx.length) return;
    const w: [number, number] = [idx[0], idx[idx.length - 1]];
    const rect = range.getBoundingClientRect();
    setWordBar({ x: Math.min(rect.left, window.innerWidth - 300), y: rect.bottom + 6, a: { s: v, e: v, w, q: words(full).slice(w[0], w[1] + 1).join(' ') } });
  };

  const swipeStyle = (v: number) => (swipe?.v === v ? { transform: `translateX(${swipe.dx}px)` } : undefined);
  const common = (v: number, target: 'box' | 'text') => ({
    onPointerDown: (e: React.PointerEvent) => onPointerDown(e, v, target),
    onPointerMove,
    onPointerUp: (e: React.PointerEvent) => onPointerUp(e, v),
    onPointerCancel,
  });

  return (
    <div ref={boxRef} onContextMenu={(e) => e.preventDefault()}>
      <div className="chapter-tools">
        <h2 className="chap-title">{label}</h2>
        <button className="btn small" onClick={() => void setChecked(rt, verses, !allOn)} title="Check or uncheck the whole chapter">
          <Icon name="check" size={15} /> <span className="lbl">{allOn ? 'Uncheck chapter' : 'Check chapter'}</span><span className="lbl-short">{allOn ? 'Uncheck all' : 'All'}</span>
        </button>
        <button className="icon-btn" title={compact ? 'Show verse text' : 'Compact view'} onClick={() => saveSettings({ compact: !compact })}><Icon name={compact ? 'list' : 'grid'} /></button>
        <button className="icon-btn" title="Reading mode (R)" onClick={() => ui.set({ reading: { book, chapter } })}><Icon name="read" /></button>
        <button className="icon-btn" title="Reflect on this chapter" onClick={() => ui.set({ reflectFor: { chapter: chapKey(book, chapter) } })}><Icon name="reflect" /></button>
        <a className="icon-btn" title={`Open chapter in ${settings.linkVersion} on BibleGateway`} href={bgUrl(label, settings.linkVersion)} target="_blank" rel="noreferrer"><Icon name="link" /></a>
      </div>

      {compact ? (
        <div className="verse-grid" role="grid" aria-label={`${label} verses`}>
          {verses.map((v, i) => (
            <div key={v} data-v={v} role="checkbox" aria-checked={isOn(v)} aria-label={verseRef(v)}
              className={'vchip' + (isOn(v) ? ' on' : '') + (sel.has(v) ? ' sel' : '') + (focused && i === focusIdx ? ' focus' : '')}
              style={swipeStyle(v)} {...common(v, 'box')}
              onPointerEnter={() => enterDrag(v)}
              onContextMenu={(e) => onContext(e, v)}>
              {vVerse(v)}
              {hl.get(v) && <i className="hl" style={{ background: hlCss(hl.get(v)) }} />}
              {marks.get(v) && <span className="cmarks">{marks.get(v)!.colors.slice(0, 3).map((c) => <i key={c} style={{ background: c }} />)}{(marks.get(v)!.note || marks.get(v)!.link) && <i className="nl" />}</span>}
            </div>
          ))}
        </div>
      ) : (
        <div className="verse-list">
          {verses.map((v, i) => (
            <div key={v} data-v={v} className={'vrow' + (sel.has(v) ? ' sel' : '') + (focused && i === focusIdx ? ' focus' : '')} style={swipeStyle(v)}
              onContextMenu={(e) => onContext(e, v)}>
              <div className={'box' + (isOn(v) ? ' on' : '')} role="checkbox" aria-checked={isOn(v)} aria-label={`Read ${verseRef(v)}`}
                {...common(v, 'box')} onPointerEnter={() => enterDrag(v)}><Icon name="check" size={16} /></div>
              <div className="num" onClick={(e) => toggleSel(v, e.shiftKey)}>{vVerse(v)}</div>
              <div className="txt" style={{ background: hlCss(hl.get(v)) }} {...common(v, 'text')}
                onMouseUp={() => onTextMouseUp(v)}
                onClick={(e) => { if (window.getSelection()?.isCollapsed === false) return; if ((e.nativeEvent as PointerEvent).pointerType === 'mouse' && !e.shiftKey && !e.ctrlKey && !e.metaKey) toggleSel(v, false); }}>
                {renderText(v)}
              </div>
              <Marks v={v} />
              <a className="icon-btn esv" href={link([v])} target="_blank" rel="noreferrer" title={`${verseRef(v)} in ${settings.linkVersion}`}><Icon name="link" size={16} /></a>
            </div>
          ))}
        </div>
      )}

      {sel.size > 0 && (
        <div className="selbar">
          <strong className="small" style={{ marginRight: 4 }}>{formatVerses(selList)}</strong>
          <button className="btn small primary" onClick={() => void setChecked(rt, selList, true)}><Icon name="check" size={14} /> Check</button>
          <button className="btn small" onClick={() => void setChecked(rt, selList, false)}>Uncheck</button>
          <button className="btn small" onClick={() => ui.set({ tagFor: anchorOf(selList) })} title="Tag (T)"><Icon name="tag" size={14} /> Tag</button>
          <button className="btn small" onClick={() => ui.set({ noteFor: { anchor: anchorOf(selList) } })} title="Note (N)"><Icon name="pen" size={14} /> Note</button>
          <button className="btn small" onClick={() => ui.set({ details: anchorOf(selList) })} title="Details (D)"><Icon name="more" size={14} /> Details</button>
          <div className="swatches">
            {HL_COLORS.map((c) => <button key={c.key} className="swatch" style={{ background: c.css }} title={`Highlight ${c.key}`} onClick={() => void setHighlight(selList, c.key)} />)}
            <button className="swatch none" title="Remove highlight" onClick={() => void setHighlight(selList, null)} />
          </div>
          <button className="btn small" onClick={() => void copyRef(selList)}><Icon name="copy" size={14} /> Copy</button>
          <a className="btn small" href={link(selList)} target="_blank" rel="noreferrer"><Icon name="link" size={14} /> {settings.linkVersion}</a>
          <span className="row small">
            <input type="date" value={dateFor} max={todayStr()} onChange={(e) => setDateFor(e.target.value)} style={{ width: 150, minHeight: 30, padding: '2px 8px' }} aria-label="Date read" />
            <button className="btn small" onClick={() => { void setChecked(rt, selList, true, new Date(dateFor + 'T12:00:00').getTime()); toast(`Marked read on ${dateFor}`, undefined, 2500); }}>Set date read</button>
          </span>
          <button className="icon-btn" onClick={() => setSel(new Set())} aria-label="Clear selection"><Icon name="x" /></button>
        </div>
      )}

      {!!refl?.length && (
        <section className="thoughts">
          <h3>Your thoughts on {label}</h3>
          {refl.sort((a, b) => b.date.localeCompare(a.date)).map((r) => (
            <div className="thought" key={r.id}>
              <div className="small muted">{r.date} · {rts?.find((x) => x.id === r.rt)?.name ?? 'Read-through'}{r.rt !== rt ? ' (earlier read-through)' : ''}</div>
              <RefText text={r.text} />
            </div>
          ))}
        </section>
      )}

      <div className="chapnav">
        {prevChap ? <button className="btn" onClick={() => go(prevChap[0], prevChap[1])}><Icon name="left" size={16} /> {BOOKS[prevChap[0] - 1].abbr} {prevChap[1]}</button> : <span />}
        {nextChap && <button className="btn" onClick={() => go(nextChap[0], nextChap[1])}>{BOOKS[nextChap[0] - 1].abbr} {nextChap[1]} <Icon name="right" size={16} /></button>}
      </div>

      {wordBar && (
        <div className="scrim" style={{ background: 'transparent' }} onMouseDown={() => setWordBar(null)}>
          <div className="menu fixed row" style={{ left: wordBar.x, top: wordBar.y, minWidth: 0, gap: 4 }} onMouseDown={(e) => e.stopPropagation()}>
            <button className="btn small primary" onClick={() => { ui.set({ tagFor: wordBar.a }); setWordBar(null); }}><Icon name="tag" size={14} /> Tag words</button>
            <button className="btn small" onClick={() => { ui.set({ noteFor: { anchor: wordBar.a } }); setWordBar(null); }}><Icon name="pen" size={14} /> Note</button>
            <button className="btn small" onClick={() => { ui.set({ details: wordBar.a }); setWordBar(null); }}>More</button>
          </div>
        </div>
      )}
      {menu && (
        <div className="scrim" style={{ background: 'transparent' }} onMouseDown={() => setMenu(null)}>
          <div className="menu fixed" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
            <VerseActions verses={menu.verses} rt={rt} reads={reads} link={link(menu.verses)} close={() => setMenu(null)} book={book} chapter={chapter} />
          </div>
        </div>
      )}
      {sheet && (
        <Modal bottom onClose={() => setSheet(null)}>
          <div className="sheet"><VerseActions verses={sheet} rt={rt} reads={reads} link={link(sheet)} close={() => setSheet(null)} book={book} chapter={chapter} /></div>
        </Modal>
      )}
    </div>
  );
}

function VerseActions({ verses, rt, reads, link, close, book, chapter }: { verses: number[]; rt: string; reads: Map<number, unknown>; link: string; close: () => void; book: number; chapter: number }) {
  const all = verses.every((v) => reads.has(v));
  const settings = useSettings();
  const run = (f: () => unknown) => () => { f(); close(); };
  return (
    <div>
      <div className="menu-label">{formatVerses(verses)}</div>
      <button className="menu-item" onClick={run(() => setChecked(rt, verses, !all))}><Icon name="check" /> {all ? 'Uncheck' : 'Check'}</button>
      <div className="menu-item" style={{ cursor: 'default' }}><Icon name="highlight" /> <div className="swatches">
        {HL_COLORS.map((c) => <button key={c.key} className="swatch" style={{ background: c.css }} aria-label={`Highlight ${c.key}`} onClick={run(() => setHighlight(verses, c.key))} />)}
        <button className="swatch none" aria-label="Remove highlight" onClick={run(() => setHighlight(verses, null))} />
      </div></div>
      <button className="menu-item" onClick={run(() => copyRef(verses))}><Icon name="copy" /> Copy reference</button>
      <a className="menu-item" href={link} target="_blank" rel="noreferrer" onClick={close}><Icon name="link" /> Open in {settings.linkVersion}</a>
      <button className="menu-item" onClick={run(() => ui.set({ reading: { book, chapter } }))}><Icon name="read" /> Reading mode</button>
      <button className="menu-item" onClick={run(() => ui.set({ reflectFor: { chapter: chapKey(book, chapter) } }))}><Icon name="reflect" /> Reflect</button>
      <div className="menu-sep" />
      <button className="menu-item" onClick={run(() => ui.set({ tagFor: anchorOf(verses) }))}><Icon name="tag" /> Tag <span className="hint">T</span></button>
      <button className="menu-item" onClick={run(() => ui.set({ noteFor: { anchor: anchorOf(verses) } }))}><Icon name="pen" /> Add note <span className="hint">N</span></button>
      <button className="menu-item" onClick={run(() => ui.set({ details: anchorOf(verses) }))}><Icon name="more" /> Details, links & cross-references <span className="hint">D</span></button>
      <button className="menu-item" disabled><Icon name="star" /> Add to Ideal Me <span className="hint">Phase 5</span></button>
    </div>
  );
}
