import { useEffect, useRef } from 'react';
import { BOOKS } from '../data/books';
import { ui, useUI } from '../lib/store';
import { useActiveRt, useKjv, useReadMap, useSettings, saveSettings } from '../lib/hooks';
import { chapterVerseIds, vVerse, bgUrl, chapKey } from '../lib/ref';
import { setChecked } from '../lib/actions';
import { Icon } from '../components/Icon';
import { useHighlights, HL_COLORS } from './Bible';

export default function Reading() {
  const r = useUI((s) => s.reading);
  const kjv = useKjv();
  const s = useSettings();
  const rt = useActiveRt();
  const reads = useReadMap(rt?.id);
  const hl = useHighlights();
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!r) return;
    scroller.current?.scrollTo(0, 0);
    const f = (e: KeyboardEvent) => {
      if (e.key === 'Escape') ui.set({ reading: null });
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  });
  if (!r) return null;
  const { book, chapter } = r;
  const bk = BOOKS[book - 1];
  const verses = chapterVerseIds(book, chapter);
  function step(d: number) {
    if (!r) return;
    let b = r.book, c = r.chapter + d;
    if (c < 1) { b--; if (b < 1) return; c = BOOKS[b - 1].v.length; }
    if (c > BOOKS[b - 1].v.length) { b++; if (b > 66) return; c = 1; }
    ui.set({ reading: { book: b, chapter: c } });
  }
  const all = verses.every((v) => reads.has(v));
  const font = s.readFont === 'serif' ? 'var(--serif)' : 'var(--font)';
  return (
    <div className="reading" role="dialog" aria-label="Reading mode">
      <div className="bar">
        <button className="icon-btn" onClick={() => ui.set({ reading: null })} aria-label="Close reading mode"><Icon name="x" /></button>
        <strong>{bk.name} {chapter}</strong>
        <span className="spacer" />
        <button className="icon-btn" title="Smaller text" onClick={() => saveSettings({ readSize: Math.max(14, s.readSize - 1) })}>A−</button>
        <button className="icon-btn" title="Larger text" onClick={() => saveSettings({ readSize: Math.min(30, s.readSize + 1) })}>A+</button>
        <button className="icon-btn" title="Line spacing" onClick={() => saveSettings({ readLine: s.readLine >= 2.1 ? 1.5 : Math.round((s.readLine + 0.15) * 100) / 100 })}><Icon name="list" /></button>
        <button className="icon-btn" title="Serif / sans-serif" onClick={() => saveSettings({ readFont: s.readFont === 'serif' ? 'sans' : 'serif' })} style={{ fontFamily: font }}>Aa</button>
        <a className="icon-btn" title={`Open in ${s.linkVersion}`} href={bgUrl(`${bk.name} ${chapter}`, s.linkVersion)} target="_blank" rel="noreferrer"><Icon name="link" /></a>
        <button className="icon-btn" title="Reflect" onClick={() => ui.set({ reflectFor: { chapter: chapKey(book, chapter) } })}><Icon name="reflect" /></button>
      </div>
      <div className="scroll" ref={scroller}>
        <article style={{ fontFamily: font, fontSize: s.readSize, lineHeight: s.readLine }}>
          <h1>{bk.name} {chapter}</h1>
          <p>
            {kjv ? verses.map((v) => {
              const c = HL_COLORS.find((x) => x.key === hl.get(v))?.css;
              return (
                <span key={v} style={c ? { background: c, borderRadius: 4 } : undefined}>
                  <sup className={reads.has(v) ? 'on' : ''} role="checkbox" aria-checked={reads.has(v)} title="Tap to mark read"
                    onClick={() => rt && void setChecked(rt.id, [v], !reads.has(v))}>{vVerse(v)}</sup>
                  {kjv[book - 1][chapter - 1][vVerse(v) - 1]}{' '}
                </span>
              );
            }) : 'Loading…'}
          </p>
          <div className="chapnav" style={{ fontFamily: 'var(--font)', fontSize: 15 }}>
            <button className="btn" onClick={() => step(-1)}><Icon name="left" size={16} /> Previous</button>
            {rt && <button className="btn primary" onClick={() => { if (!all) void setChecked(rt.id, verses, true); step(1); }}>{all ? 'Next chapter' : 'Mark read & next'} <Icon name="right" size={16} /></button>}
          </div>
        </article>
      </div>
    </div>
  );
}
