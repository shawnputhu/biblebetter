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
import { MicButton } from '../components/Voice';
import * as tts from '../lib/tts';
import { briefingText } from '../lib/commands';
import { usePlans, planProgress, dayVerses, dayLabel } from '../lib/plans';
import type { Plan } from '../lib/db';

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
        <button className="btn small" onClick={async () => tts.playText(await briefingText(), 'Briefing')} title="Read a short briefing aloud"><Icon name="volume" size={15} /> Briefing</button>
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

        <TodayPlans />
        <ReflectionCard rtId={rt?.id} />
      </div>

      <h3 style={{ margin: '22px 0 10px' }}>{mode === 'morning' ? 'Coming to your morning summary' : 'Coming to your evening review'}</h3>
      <div className="grid-cards">
        <div className="soon">Prayer slots and requests · Phase 4</div>
        <div className="soon">Ideal Me, 3 goals, Memorable today · Phase 5</div>
      </div>
    </div>
  );
}

function TodayPlans() {
  const plans = usePlans().filter((p) => p.status === 'active');
  if (!plans.length) return (
    <div className="card stack"><h3>Reading plan</h3><div className="muted small">No active plan.</div>
      <button className="btn" onClick={() => navigate('plans', { create: true })}><Icon name="calendar" size={16} /> Make a reading plan</button></div>
  );
  return <>{plans.map((p) => <TodayPlan key={p.id} p={p} />)}</>;
}
function TodayPlan({ p }: { p: Plan }) {
  const reads = useReadMap(p.rt);
  const pr = useMemo(() => planProgress(p, reads), [p, reads]);
  const d = pr.today;
  const vs = d ? dayVerses(d) : [];
  const left = vs.filter((v) => !reads.has(v));
  return (
    <div className="card stack">
      <div className="row"><h3 style={{ cursor: 'pointer' }} onClick={() => navigate('plans', { plan: p.id })}>{p.name}</h3><span className="spacer" /><span className="pill mint">{pr.pct.toFixed(0)}%</span></div>
      {d && vs.length ? <div>Today: <b>{dayLabel(d)}</b></div> : <div className="muted">No reading scheduled today.</div>}
      {vs.length > 0 && <div className="muted small">{left.length ? `${left.length} of ${vs.length} verses to go` : 'Done for today ✓'}</div>}
      {pr.missed > 0 && <button className="btn small" onClick={() => navigate('plans', { plan: p.id })}>{pr.missed} day{pr.missed > 1 ? 's' : ''} behind — catch up</button>}
      {left.length > 0 && <div className="row">
        <button className="btn primary" onClick={() => navigate('bible', { book: vBook(left[0]), chapter: vChap(left[0]), verse: vVerse(left[0]) })}><Icon name="book" size={16} /> Read now</button>
        <button className="btn" onClick={() => tts.playVerses(left, dayLabel(d!), { rt: p.rt })}><Icon name="volume" size={16} /> Read aloud</button>
      </div>}
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
      <div className="row"><MicButton onText={(t) => setText((x) => ((x ?? value) ? (x ?? value).replace(/\s*$/, ' ') : '') + t)} label="Dictate your reflection" />
        <span className="spacer" />{value.trim() && <button className="icon-btn" title="Read aloud" onClick={() => tts.playText([value], 'Reflection')}><Icon name="volume" size={16} /></button>}</div>
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
        <MicButton onText={(t) => setText((x) => ((x ?? value) ? (x ?? value).replace(/\s*$/, ' ') : '') + t)} label="Dictate your reflection" />
        <div className="row"><span className="spacer" /><button className="btn primary" onClick={close}>Done</button></div>
      </div>
    </Modal>
  );
}


