import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { BOOKS } from '../data/books';
import { db, todayStr, alive } from '../lib/db';
import { useActiveRt, useReadMap, useSettings, saveSettings, type Device } from '../lib/hooks';
import { allVerseIds, formatVerses, TOTAL_VERSES, vBook, vChap, vVerse } from '../lib/ref';
import { saveReflection } from '../lib/actions';
import { navigate, ui, useUI } from '../lib/store';
import { downloadBackup, downloadDue } from '../lib/backup';
import { Icon } from '../components/Icon';
import { Modal } from '../components/ui';

export function useMode() {
  const s = useSettings();
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(t); }, []);
  const hm = now.toTimeString().slice(0, 5);
  const auto: 'morning' | 'evening' = hm >= s.morningStart && hm < s.eveningStart ? 'morning' : 'evening';
  const o = s.modeOverride;
  const mode = o && o.date === todayStr(now) ? o.mode : auto;
  return { mode, toggle: () => saveSettings({ modeOverride: { date: todayStr(), mode: mode === 'morning' ? 'evening' : 'morning' } }) };
}

export default function Today({ device }: { device: Device }) {
  const rt = useActiveRt();
  const reads = useReadMap(rt?.id);
  const { mode, toggle } = useMode();
  const [due, setDue] = useState(false);
  useEffect(() => { if (device === 'phone') void downloadDue().then(setDue); }, [device]);

  const today = todayStr();
  const start = new Date(today + 'T00:00:00').getTime();
  const todays = useMemo(() => [...reads.values()].filter((r) => r.at >= start && r.at < start + 86_400_000).map((r) => r.verse), [reads, start]);
  const next = useMemo(() => {
    // continue after the most recently checked verse; otherwise first unchecked
    let last: number | null = null, lastAt = 0;
    reads.forEach((r) => { if (r.at > lastAt) { lastAt = r.at; last = r.verse; } });
    const all = allVerseIds();
    const from = last ? all.indexOf(last) + 1 : 0;
    for (let i = 0; i < all.length; i++) { const v = all[(from + i) % all.length]; if (!reads.has(v)) return v; }
    return null;
  }, [reads]);
  const pct = (reads.size / TOTAL_VERSES) * 100;
  const date = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div>
      <div className="today-hero">
        <div>
          <div className="muted small">{date}</div>
          <h2>{mode === 'morning' ? 'Good morning' : 'Evening review'}</h2>
        </div>
        <span className="spacer" />
        <button className="btn small" onClick={toggle} title="Switch between morning summary and evening review"><Icon name={mode === 'morning' ? 'moon' : 'sun'} size={15} /> {mode === 'morning' ? 'Evening' : 'Morning'}</button>
      </div>

      {due && (
        <div className="banner">
          <Icon name="download" />
          <span className="grow" style={{ flex: 1 }}>Weekly backup: save a copy to this phone.</span>
          <button className="btn small primary" onClick={async () => { await downloadBackup(); setDue(false); }}>Download</button>
        </div>
      )}

      <div className="grid-cards">
        <div className="card stack">
          <div className="row"><h3>{rt?.name ?? 'Read-through'}</h3><span className="spacer" /><span className="pill mint">{pct.toFixed(1)}%</span></div>
          <div className="progress"><i style={{ width: `${pct}%` }} /></div>
          <div className="muted small">{reads.size.toLocaleString()} of {TOTAL_VERSES.toLocaleString()} verses</div>
          {next && (
            <button className="btn primary" onClick={() => navigate('bible', { book: vBook(next), chapter: vChap(next), verse: vVerse(next) })}>
              <Icon name="book" size={16} /> Continue: {BOOKS[vBook(next) - 1].name} {vChap(next)}:{vVerse(next)}
            </button>
          )}
          {next && <button className="btn" onClick={() => ui.set({ reading: { book: vBook(next), chapter: vChap(next) } })}><Icon name="read" size={16} /> Open in Reading mode</button>}
        </div>

        <div className="card stack">
          <h3>Read today</h3>
          {todays.length ? <div>{formatVerses(todays)}</div> : <div className="muted">Nothing checked yet today.</div>}
          <div className="muted small">{todays.length} verse{todays.length === 1 ? '' : 's'}</div>
        </div>

        <ReflectionCard rtId={rt?.id} />
      </div>

      <h3 style={{ margin: '22px 0 10px' }}>{mode === 'morning' ? 'Coming to your morning summary' : 'Coming to your evening review'}</h3>
      <div className="grid-cards">
        <div className="soon">Today’s plan reading · Phase 3</div>
        <div className="soon">Prayer slots and requests · Phase 4</div>
        <div className="soon">Ideal Me, 3 goals, Memorable today · Phase 5</div>
      </div>
    </div>
  );
}

function ReflectionCard({ rtId }: { rtId?: string }) {
  const today = todayStr();
  const row = useLiveQuery(() => (rtId ? db.reflections.get(`${rtId}|${today}`) : undefined), [rtId, today]);
  const [text, setText] = useState<string | null>(null);
  const value = text ?? (alive(row) ? row.text : '');
  useEffect(() => {
    if (text === null || !rtId) return;
    const t = setTimeout(() => void saveReflection(rtId, today, text), 700);
    return () => clearTimeout(t);
  }, [text, rtId, today]);
  return (
    <div className="card stack">
      <h3>Today’s reflection</h3>
      <textarea value={value} onChange={(e) => setText(e.target.value)} placeholder="What stood out? What is God showing you?" rows={4} />
      <div className="muted small">{alive(row) && row.chapters.length ? `On ${formatChapters(row.chapters)} · saved` : 'Saves automatically'}</div>
    </div>
  );
}

export function formatChapters(keys: string[]) {
  return keys
    .map((k) => k.split(':').map(Number))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .map(([b, c]) => `${BOOKS[b - 1].abbr} ${c}`)
    .join(', ');
}

/** Modal to write today's reflection, opened from a chapter / Reading mode / palette. */
export function ReflectModal() {
  const r = useUI((s) => s.reflectFor);
  const rt = useActiveRt();
  const today = todayStr();
  const row = useLiveQuery(() => (rt ? db.reflections.get(`${rt.id}|${today}`) : undefined), [rt?.id, today]);
  const [text, setText] = useState<string | null>(null);
  if (!r || !rt) return null;
  const value = text ?? (alive(row) ? row.text : '');
  const close = async () => {
    if (text !== null) await saveReflection(rt.id, today, text, r.chapter);
    else if (r.chapter && alive(row) && !row.chapters.includes(r.chapter)) await saveReflection(rt.id, today, row.text, r.chapter);
    setText(null);
    ui.set({ reflectFor: null });
  };
  const ch = r.chapter ? r.chapter.split(':').map(Number) : null;
  return (
    <Modal onClose={close}>
      <div className="modal stack" style={{ padding: 18 }}>
        <div className="row"><h3>Reflection · {today}</h3><span className="spacer" /><span className="pill">{rt.name}</span></div>
        {ch && <div className="muted small">Adding {BOOKS[ch[0] - 1].name} {ch[1]} to today’s reflection</div>}
        <textarea autoFocus rows={8} value={value} onChange={(e) => setText(e.target.value)} placeholder="What stood out? What is God showing you?" />
        <div className="row"><span className="spacer" /><button className="btn primary" onClick={close}>Done</button></div>
      </div>
    </Modal>
  );
}


