import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, alive, uid, todayStr, type Readthrough, type Settings } from '../lib/db';
import { useReadthroughs, useSettings, saveSettings } from '../lib/hooks';
import { mutate } from '../lib/write';
import { TOTAL_VERSES } from '../lib/ref';
import { Icon } from '../components/Icon';
import { formatChapters } from './Today';
import { RefText } from '../components/RefText';

const daysBetween = (a: string, b: string) => Math.round((new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / 86_400_000) + 1;

export default function Readthroughs({ req }: { req?: { n: number; params?: Record<string, unknown> } }) {
  const rts = useReadthroughs();
  const s = useSettings();
  const active = rts.find((r) => r.id === s.activeRt) ?? rts[rts.length - 1];
  const counts = useLiveQuery(async () => {
    const m = new Map<string, number>();
    await db.verse_reads.each((r) => { if (r.checked && alive(r)) m.set(r.rt, (m.get(r.rt) ?? 0) + 1); });
    return m;
  }, []) ?? new Map();
  const [creating, setCreating] = useState(false);
  const last = useRef(0);
  useEffect(() => { if (req && req.n !== last.current) { last.current = req.n; if (req.params?.create) setCreating(true); } }, [req]);

  return (
    <div className="stack">
      <div className="row">
        <h2>Read-throughs</h2>
        <span className="spacer" />
        <button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> New read-through</button>
      </div>
      {creating && <NewRt n={rts.length + 1} onDone={() => setCreating(false)} />}
      {[...rts].reverse().map((r) => (
        <RtCard key={r.id} r={r} active={r.id === active?.id} count={counts.get(r.id) ?? 0} canDelete={rts.length > 1} />
      ))}
    </div>
  );
}

function NewRt({ n, onDone }: { n: number; onDone: () => void }) {
  const [name, setName] = useState(`Read-through #${n} – ${new Date().getFullYear()}`);
  const [start, setStart] = useState(todayStr());
  const [makeActive, setMakeActive] = useState(true);
  const create = async () => {
    const id = uid();
    await mutate(`Created ${name}`, async (w) => {
      await w.put<Readthrough>('readthroughs', { id, name: name.trim() || `Read-through #${n}`, start, finish: null, created_at: Date.now() });
      if (makeActive) {
        const cur = await db.settings.get('main');
        if (cur) await w.put<Settings>('settings', { ...cur, activeRt: id });
      }
    });
    onDone();
  };
  return (
    <div className="card stack">
      <h3>New read-through</h3>
      <label className="field">Name<input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
      <label className="field">Start date<input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
      <label className="row small"><input type="checkbox" checked={makeActive} onChange={(e) => setMakeActive(e.target.checked)} /> Make it the active read-through</label>
      <div className="row"><span className="spacer" /><button className="btn" onClick={onDone}>Cancel</button><button className="btn primary" onClick={create}>Create</button></div>
    </div>
  );
}

function RtCard({ r, active, count, canDelete }: { r: Readthrough; active: boolean; count: number; canDelete: boolean }) {
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState(r.name);
  const [open, setOpen] = useState(false);
  const pct = (count / TOTAL_VERSES) * 100;
  const refl = useLiveQuery(async () => (open ? (await db.reflections.where('rt').equals(r.id).toArray()).filter((x) => alive(x) && x.text.trim()).sort((a, b) => b.date.localeCompare(a.date)) : []), [open, r.id]);
  const patch = (p: Partial<Readthrough>, label: string) => mutate(label, (w) => w.patch('readthroughs', r.id, p));
  return (
    <div className="card stack">
      <div className="row wrap">
        {edit ? (
          <input type="text" value={name} autoFocus onChange={(e) => setName(e.target.value)} style={{ maxWidth: 360 }}
            onKeyDown={(e) => { if (e.key === 'Enter') { void patch({ name }, 'Renamed read-through'); setEdit(false); } if (e.key === 'Escape') setEdit(false); }}
            onBlur={() => { if (name !== r.name) void patch({ name }, 'Renamed read-through'); setEdit(false); }} />
        ) : (
          <h3 onDoubleClick={() => setEdit(true)}>{r.name}</h3>
        )}
        {active ? <span className="pill accent">Active</span> : <button className="btn small" onClick={() => saveSettings({ activeRt: r.id })}>Make active</button>}
        {r.finish && <span className="pill mint">Finished in {daysBetween(r.start, r.finish)} days</span>}
        <span className="spacer" />
        <button className="icon-btn" title="Rename" onClick={() => setEdit(true)}><Icon name="pen" /></button>
        {canDelete && <button className="icon-btn" title="Move to Trash" onClick={() => mutate(`Moved “${r.name}” to Trash`, (w) => w.trash('readthroughs', r.id))}><Icon name="trash" /></button>}
      </div>
      <div className="progress"><i style={{ width: `${pct}%` }} /></div>
      <div className="row wrap small muted">
        <span>{count.toLocaleString()} / {TOTAL_VERSES.toLocaleString()} verses · {pct.toFixed(1)}%</span>
        <span className="spacer" />
        <label className="row">Started <input type="date" value={r.start} onChange={(e) => void patch({ start: e.target.value }, 'Changed start date')} style={{ width: 150 }} /></label>
        <label className="row">Finished <input type="date" value={r.finish ?? ''} onChange={(e) => void patch({ finish: e.target.value || null }, e.target.value ? 'Marked finished' : 'Cleared finish date')} style={{ width: 150 }} /></label>
        {!r.finish && <button className="btn small" onClick={() => void patch({ finish: todayStr() }, `Finished ${r.name}`)}>Finish today</button>}
      </div>
      <button className="btn ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(!open)}>
        <Icon name="reflect" size={14} /> {open ? 'Hide reflections' : 'Show reflections'}
      </button>
      {open && (refl?.length ? refl.map((x) => (
        <div className="thought" key={x.id}>
          <div className="small muted">{x.date}{x.chapters.length ? ` · ${formatChapters(x.chapters)}` : ''}</div>
          <RefText text={x.text} />
        </div>
      )) : <div className="muted small">No reflections yet.</div>)}
    </div>
  );
}
