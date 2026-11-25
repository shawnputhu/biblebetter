import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { ui, useUI, dismissToast, navigate, toast } from '../lib/store';
import { FUNCTIONS, fnDef, useRecent } from '../lib/layout';
import { parseRef, refLabel } from '../lib/ref';
import { addInbox } from '../lib/actions';
import { saveSettings, useSettings, useActiveRt } from '../lib/hooks';
import { downloadBackup } from '../lib/backup';
import { undoLast } from '../lib/write';
import { MicButton } from './Voice';

export function Modal({ onClose, children, bottom }: { onClose: () => void; children: ReactNode; bottom?: boolean }) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [onClose]);
  return (
    <div className={'scrim' + (bottom ? ' bottom' : '')} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      {children}
    </div>
  );
}

export function Toasts() {
  const toasts = useUI((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div className="toast" key={t.id}>
          <span>{t.text}</span>
          {t.undo && <button onClick={() => { t.undo!(); dismissToast(t.id); }}>Undo</button>}
          <button aria-label="Dismiss" onClick={() => dismissToast(t.id)}>✕</button>
        </div>
      ))}
    </div>
  );
}

export function SyncBadge() {
  const s = useUI((x) => x.sync);
  const d = useUI((x) => x.syncDetail);
  const short = { local: 'This device', 'signed-out': 'Signed out', syncing: 'Syncing', synced: 'Synced', offline: 'Offline', error: 'Sync issue' }[s];
  return <button type="button" className={'sync ' + s} title={d} style={{ border: 'none', background: 'none', cursor: 'pointer' }} onClick={() => toast(d || short, undefined, 8000)}><i />{short}</button>;
}

export function Ring({ pct, size = 34, stroke = 4 }: { pct: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg className="ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label={`${Math.round(pct)}% read`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--mint-strong)" strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={`${(c * pct) / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      {size >= 34 && pct > 0 && <text x="50%" y="54%" textAnchor="middle" dominantBaseline="middle" fontSize="9" fontWeight="700" fill="var(--muted)">{pct >= 100 ? '✓' : Math.floor(pct)}</text>}
    </svg>
  );
}

// ---------- command palette ----------
interface Cmd { id: string; label: string; hint?: string; icon: string; run: () => void }

export function Palette({ extra }: { extra: Cmd[] }) {
  const open = useUI((s) => s.palette);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const recent = useRecent(6);
  const settings = useSettings();
  const rt = useActiveRt();
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setQ(''); setSel(0); setTimeout(() => inputRef.current?.focus(), 10); } }, [open]);
  const close = () => ui.set({ palette: false });

  const cmds = useMemo<Cmd[]>(() => {
    const out: Cmd[] = [];
    const ref = q.trim() ? parseRef(q) : null;
    if (ref) out.push({ id: 'ref', icon: 'book', label: `Go to ${refLabel(ref)}`, hint: 'Enter', run: () => navigate('bible', { book: ref.book, chapter: ref.chapter ?? 0, verse: ref.verse ?? 0 }) });
    if (ref?.chapter) out.push({ id: 'refread', icon: 'read', label: `Read ${refLabel({ book: ref.book, chapter: ref.chapter })} in Reading mode`, run: () => ui.set({ reading: { book: ref.book, chapter: ref.chapter! } }) });
    const base: Cmd[] = [
      ...FUNCTIONS.map((f) => ({ id: 'fn-' + f.key, icon: f.icon, label: `Open ${f.name}`, hint: f.phase > 1 ? `Phase ${f.phase}` : undefined, run: () => navigate(f.key) })),
      ...extra,
      { id: 'theme', icon: settings.theme === 'dark' ? 'sun' : 'moon', label: 'Switch light / dark theme', run: () => saveSettings({ theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' }) },
      { id: 'newrt', icon: 'layers', label: 'New read-through', run: () => navigate('readthroughs', { create: true }) },
      { id: 'reflect', icon: 'reflect', label: "Write today's reflection", run: () => ui.set({ reflectFor: {} }) },
      { id: 'export', icon: 'download', label: 'Export backup file', run: () => void downloadBackup() },
      { id: 'undo', icon: 'undo', label: 'Undo last change', hint: 'Ctrl+Z', run: () => void undoLast() },
      { id: 'cheat', icon: 'keyboard', label: 'Keyboard shortcuts', hint: '?', run: () => ui.set({ cheat: true }) },
      ...recent.map((r) => ({ id: 'recent-' + r.id, icon: 'clock', label: r.label, hint: 'Recent', run: () => navigate(r.fn, r.params) })),
    ];
    const t = q.trim().toLowerCase();
    const filtered = t ? base.filter((c) => c.label.toLowerCase().includes(t)) : base.filter((c) => !c.id.startsWith('fn-') || ['fn-today', 'fn-bible', 'fn-readthroughs', 'fn-notes', 'fn-search'].includes(c.id));
    out.push(...filtered);
    if (t && !ref) out.push({ id: 'search', icon: 'search', label: `Search everything for “${q.trim()}”`, hint: 'Ctrl+Shift+F', run: () => navigate('search', { q: q.trim() }) });
    if (t && !ref) out.push({ id: 'capture', icon: 'inbox', label: `Capture “${q.trim()}” to Inbox`, run: () => void addInbox(q.trim()) });
    return out.slice(0, 40);
  }, [q, extra, recent, settings.theme]);
  void rt;

  if (!open) return null;
  const run = (c?: Cmd) => { if (!c) return; close(); c.run(); };
  return (
    <Modal onClose={close}>
      <div className="modal" role="dialog" aria-label="Command palette">
        <input ref={inputRef} autoFocus className="palette-input" placeholder="Type a passage (rom 8, jn 3:16) or a command…" value={q}
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, cmds.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            if (e.key === 'Enter') { e.preventDefault(); run(cmds[sel]); }
          }} />
        <div className="palette-list">
          {cmds.map((c, i) => (
            <button key={c.id} className={'menu-item' + (i === sel ? ' sel' : '')} onMouseEnter={() => setSel(i)} onClick={() => run(c)}>
              <Icon name={c.icon} /> <span>{c.label}</span> {c.hint && <span className="hint">{c.hint}</span>}
            </button>
          ))}
          {!cmds.length && <div className="muted small" style={{ padding: 12 }}>No matches</div>}
        </div>
      </div>
    </Modal>
  );
}

export function CheatSheet() {
  const open = useUI((s) => s.cheat);
  if (!open) return null;
  const rows: [string, string][] = [
    ['Ctrl + K', 'Command palette: jump to a passage or run a command'],
    ['?', 'This list'],
    ['Ctrl + Z', 'Undo last change'],
    ['Ctrl + \\', 'Swap the two panes'],
    ['Ctrl + Shift + Z', 'Undo layout change'],
    ['Ctrl + 1 / Ctrl + 2', 'Focus left / right pane'],
    ['Alt + N', 'Quick capture to Inbox'],
    ['↑ ↓ ← →', 'Move between verses (Bible pane)'],
    ['Space', 'Check / uncheck the focused verse'],
    ['Shift + arrows / Shift + click', 'Select a range of verses'],
    ['Drag across checkboxes', 'Check (or uncheck) many verses at once'],
    ['Right-click a verse', 'Verse actions'],
    ['R', 'Reading mode for the open chapter'],
    ['T', 'Tag the selected verses (type a code, Enter)'],
    ['N', 'Note on the selected verses'],
    ['D', 'Details: tags, notes, links, cross-references'],
    ['Select words (mouse)', 'Tag or note part of a verse'],
    ['Ctrl + Shift + F', 'Search everything'],
    ['Esc', 'Close dialogs and Reading mode; clear selection'],
  ];
  return (
    <Modal onClose={() => ui.set({ cheat: false })}>
      <div className="modal">
        <div className="row" style={{ padding: '14px 18px 0' }}><h3>Keyboard shortcuts</h3><span className="spacer" />
          <button className="icon-btn" onClick={() => ui.set({ cheat: false })} aria-label="Close"><Icon name="x" /></button></div>
        <div className="cheat">{rows.map(([k, d]) => [<kbd key={k}>{k}</kbd>, <span key={k + 'd'}>{d}</span>])}</div>
      </div>
    </Modal>
  );
}

export function Capture({ phone }: { phone: boolean }) {
  const open = useUI((s) => s.capture);
  const [t, setT] = useState('');
  if (!open) return null;
  const close = () => { ui.set({ capture: false }); setT(''); };
  const save = async () => { if (t.trim()) await addInbox(t.trim()); close(); };
  const body = (
    <div className="stack" style={{ padding: phone ? 4 : 18 }}>
      <h3>Quick capture</h3>
      <textarea autoFocus value={t} onChange={(e) => setT(e.target.value)} placeholder="A thought, a verse to look at later, a link…"
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void save(); }} />
      <div className="row"><MicButton onText={(x) => setT((y) => (y ? y.replace(/\s*$/, ' ') : '') + x)} onCommand={(c) => (c === 'save' ? void save() : close())} /><span className="muted small">Saved to your Inbox.</span><span className="spacer" />
        <button className="btn" onClick={close}>Cancel</button><button className="btn primary" onClick={save}>Save</button></div>
    </div>
  );
  return <Modal onClose={close} bottom={phone}>{phone ? <div className="sheet">{body}</div> : <div className="modal">{body}</div>}</Modal>;
}

export function PanePicker({ current, onPick, other }: { current: string; onPick: (k: string) => void; other?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const f = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', f);
    return () => window.removeEventListener('mousedown', f);
  }, [open]);
  const d = fnDef(current);
  return (
    <div className="picker" ref={ref}>
      <button className="picker-btn" onClick={() => setOpen(!open)} aria-haspopup="menu" title="Choose what this pane shows">
        <Icon name={d.icon} /> {d.name} <Icon name="right" size={14} className="muted" />
      </button>
      {open && (
        <div className="menu" role="menu">
          {FUNCTIONS.filter((f) => !f.system || f.key === 'today').map((f) => (
            <button key={f.key} className={'menu-item' + (f.key === current ? ' sel' : '')} onClick={() => { onPick(f.key); setOpen(false); }}>
              <Icon name={f.icon} /> {f.name}
              <span className="hint">{f.key === other ? 'swap' : f.phase > 1 ? `Phase ${f.phase}` : ''}</span>
            </button>
          ))}
          <div className="menu-sep" />
          {FUNCTIONS.filter((f) => f.system && f.key !== 'today').map((f) => (
            <button key={f.key} className="menu-item" onClick={() => { onPick(f.key); setOpen(false); }}><Icon name={f.icon} /> {f.name}</button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Placeholder({ fn }: { fn: string }) {
  const d = fnDef(fn);
  const what: Record<string, string> = {
    plans: 'Reading plans from your own passage list, a calendar and a timeline of everything you do, with reminders.',
    prayer: 'Your prayer journal with answers, the shared People list and daily prayer habits.',
    idealme: '“How do I want to be remembered?” — Smarts, Strength, Social, Spiritual, with daily Do / Don’t tracking and Memorable today.',
    stats: 'Statistics for reading, prayer, Ideal Me and goals.',
    study: 'Study tabs with a rich editor, images and PDF / Word export.',
    research: 'Research questions, sub-questions, sources and stance-labelled evidence.',
  };
  return (
    <div className="placeholder">
      <div className="big"><Icon name={d.icon} size={30} /></div>
      <h2>{d.name}</h2>
      <p>{what[fn] ?? ''}</p>
      <span className="pill accent">Coming in Phase {d.phase}</span>
    </div>
  );
}

export function Walkthrough({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const steps = [
    { icon: 'book', title: 'Welcome to BibleBetter', text: 'Track your reading verse by verse, reflect on what you read, and grow — on your phone and your PC.' },
    { icon: 'check', title: 'Check off what you read', text: 'Open a chapter and tap the verse numbers. On a PC, drag across them to check many at once; on your phone, swipe a verse right, or long-press and drag to select.' },
    { icon: 'swap', title: 'Two things at once', text: 'Keep any two functions side by side on your PC (or turn your phone sideways). Changed a pane by mistake? Undo the layout from the top bar.' },
    { icon: 'search', title: 'Jump anywhere', text: 'Press Ctrl + K (or Search on your phone) and type “rom 8” or “jn 3:16”. Press ? to see every shortcut.' },
  ];
  const s = steps[i];
  return (
    <Modal onClose={onDone}>
      <div className="modal walk">
        <div className="big"><Icon name={s.icon} size={34} /></div>
        <h2>{s.title}</h2>
        <p className="muted">{s.text}</p>
        <div className="dots">{steps.map((_, k) => <i key={k} className={k === i ? 'on' : ''} />)}</div>
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn ghost" onClick={onDone}>Skip</button>
          {i < steps.length - 1 ? <button className="btn primary" onClick={() => setI(i + 1)}>Next</button> : <button className="btn primary" onClick={onDone}>Start reading</button>}
        </div>
      </div>
    </Modal>
  );
}

export { toast };
