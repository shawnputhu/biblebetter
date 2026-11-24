import { useEffect, useRef, useState, type ReactNode } from 'react';
import { parseRef, refLabel, vid, chapterVerseIds, vVerse } from '../lib/ref';
import { BOOKS } from '../data/books';
import { useKjv } from '../lib/hooks';
import { anchorText } from '../lib/annot';
import { navigate, ui, useUI, toast } from '../lib/store';
import { Modal } from './ui';
import { Icon } from './Icon';

// "Rom 5:8", "1 Cor 13:4-7", "John 3", "Song of Solomon 2:4", "jn 3:16"
const RX = /\b((?:[1-3]|I{1,3})\s?[A-Za-z]{2,}\.?|Song of (?:Solomon|Songs)|[A-Za-z]{2,}\.?)\s(\d{1,3})(?::(\d{1,3})(?:\s?[-–]\s?(\d{1,3}))?)?\b/g;

export interface FoundRef { s: number; e: number; label: string }
export function toRange(r: { book: number; chapter?: number; verse?: number; verseEnd?: number }): FoundRef | null {
  if (!r.chapter) return null;
  const ids = chapterVerseIds(r.book, r.chapter);
  const s = r.verse ? vid(r.book, r.chapter, r.verse) : ids[0];
  const e = r.verse ? vid(r.book, r.chapter, r.verseEnd ?? r.verse) : ids[ids.length - 1];
  return { s, e, label: refLabel(r) };
}

/** Plain text with Bible references turned into preview links. */
export function RefText({ text, className }: { text: string; className?: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(RX)) {
    const word = m[1].replace(/\.$/, '').toLowerCase();
    if (['in', 'on', 'at', 'to', 'of', 'is', 'it', 'and', 'the', 'for', 'or', 'be', 'by', 'as', 'we', 'he', 'me', 'my', 'us', 'an', 'so', 'no', 'do', 'go', 'up', 'am', 'are', 'was', 'day', 'days', 'page', 'chapter', 'verse', 'verses', 'step', 'phase', 'week', 'weeks', 'year', 'years', 'top', 'item', 'line'].includes(word)) continue;
    const isCap = /^[1-3IA-Z]/.test(m[1]);
    const r = parseRef(`${m[1]} ${m[2]}${m[3] ? ':' + m[3] : ''}${m[4] ? '-' + m[4] : ''}`);
    if (!r || (!isCap && !m[3])) continue; // lowercase only counts with chapter:verse ("jn 3:16")
    const range = toRange(r);
    if (!range) continue;
    out.push(text.slice(last, m.index));
    out.push(<RefLink key={m.index} r={range}>{m[0]}</RefLink>);
    last = m.index! + m[0].length;
  }
  out.push(text.slice(last));
  return <span className={className} style={{ whiteSpace: 'pre-wrap' }}>{out}</span>;
}

export function RefLink({ r, children }: { r: FoundRef; children: ReactNode }) {
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const kjv = useKjv();
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return (
    <span className="reflink" tabIndex={0}
      onMouseEnter={(e) => { const rect = (e.target as HTMLElement).getBoundingClientRect(); timer.current = setTimeout(() => setHover({ x: rect.left, y: rect.bottom }), 250); }}
      onMouseLeave={() => { if (timer.current) clearTimeout(timer.current); setHover(null); }}
      onClick={(e) => {
        e.stopPropagation();
        if (window.matchMedia('(hover: hover)').matches) openRef(r);
        else ui.set({ preview: r });
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') openRef(r); }}>
      {children}
      {hover && (
        <span className="ref-pop" style={{ left: Math.min(hover.x, window.innerWidth - 380), top: Math.min(hover.y + 6, window.innerHeight - 200) }}>
          <b>{r.label}</b> {anchorText(kjv, { s: r.s, e: r.e })}
        </span>
      )}
    </span>
  );
}

export function openRef(r: { s: number; e?: number }) {
  const b = Math.floor(r.s / 1e6), c = Math.floor(r.s / 1e3) % 1e3;
  navigate('bible', { book: b, chapter: c, verse: vVerse(r.s) });
}

/** Phone: preview sheet for a tapped reference. */
export function RefPreview() {
  const r = useUI((s) => s.preview);
  const kjv = useKjv();
  if (!r) return null;
  const close = () => ui.set({ preview: null });
  return (
    <Modal bottom onClose={close}>
      <div className="sheet stack">
        <h3>{r.label}</h3>
        <div style={{ fontFamily: 'var(--serif)', fontSize: 17, lineHeight: 1.6 }}>{anchorText(kjv, r, 12)}</div>
        <div className="row">
          <button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(r.label); toast('Copied'); } catch { /* */ } close(); }}><Icon name="copy" size={16} /> Copy</button>
          <span className="spacer" />
          <button className="btn primary" onClick={() => { close(); openRef(r); }}><Icon name="book" size={16} /> Open</button>
        </div>
      </div>
    </Modal>
  );
}

export { BOOKS };
