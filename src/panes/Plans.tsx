import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, alive, todayStr, dateOf, type Plan } from '../lib/db';
import { useKjv, useReadMap, useReadthroughs, useActiveRt, type Device } from '../lib/hooks';
import { usePaneState } from '../lib/layout';
import { mutate } from '../lib/write';
import { ui, toast } from '../lib/store';
import { formatVerses, vBook, vChap, vVerse } from '../lib/ref';
import { usePlans, createPlan, buildPlanVerses, availableDates, spread, planProgress, catchUpPreview, dayVerses, dayLabel, addDays } from '../lib/plans';
import { useTagIndex, useTaggings, useNotes, useLinks, anchorLabel } from '../lib/annot';
import { playVerses } from '../lib/tts';
import { Icon } from '../components/Icon';
import { RefText, openRef } from '../components/RefText';
import { MicButton } from '../components/Voice';

type Req = { n: number; params?: Record<string, unknown> };
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmtDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

export default function Plans({ device, req }: { device: Device; req?: Req }) {
  const [st, setSt] = usePaneState(device, 'plans', { tab: 'plans', plan: '', month: '', day: '' });
  const last = useRef(0);
  useEffect(() => {
    if (!req || req.n === last.current) return;
    last.current = req.n;
    const p = req.params ?? {};
    if (typeof p.plan === 'string') setSt({ tab: 'plans', plan: p.plan });
    else if (typeof p.tab === 'string') setSt({ tab: p.tab, plan: '' });
    if (p.create) setSt({ tab: 'plans', plan: 'new' });
  }, [req, setSt]);
  return (
    <div className="stack">
      <div className="row wrap">
        <h2>Plans & Calendar</h2><span className="spacer" />
        <div className="tabs" role="tablist">
          {(['plans', 'calendar', 'timeline'] as const).map((t) => <button key={t} role="tab" aria-selected={st.tab === t} className={st.tab === t ? 'on' : ''} onClick={() => setSt({ tab: t, plan: '' })}>{t[0].toUpperCase() + t.slice(1)}</button>)}
        </div>
      </div>
      {st.tab === 'plans' && (st.plan === 'new' ? <NewPlan done={(id) => setSt({ plan: id ?? '' })} /> : st.plan ? <PlanView id={st.plan} back={() => setSt({ plan: '' })} /> : <PlanList open={(id) => setSt({ plan: id })} />)}
      {st.tab === 'calendar' && <Calendar month={st.month || todayStr().slice(0, 7)} setMonth={(m) => setSt({ month: m })} day={st.day} setDay={(d) => setSt({ day: d })} />}
      {st.tab === 'timeline' && <Timeline />}
    </div>
  );
}

// ---------------- plan list ----------------
function PlanList({ open }: { open: (id: string) => void }) {
  const plans = usePlans();
  return (
    <div className="stack">
      <div className="row"><span className="muted small">Add the passages you want to read, choose dates, and BibleBetter divides them up.</span><span className="spacer" />
        <button className="btn primary" onClick={() => open('new')}><Icon name="plus" size={16} /> New plan</button></div>
      {plans.map((p) => <PlanCard key={p.id} p={p} open={() => open(p.id)} />)}
      {!plans.length && <div className="muted">No plans yet.</div>}
    </div>
  );
}

function PlanCard({ p, open }: { p: Plan; open: () => void }) {
  const reads = useReadMap(p.rt);
  const pr = useMemo(() => planProgress(p, reads), [p, reads]);
  return (
    <div className="card stack" style={{ cursor: 'pointer' }} onClick={open}>
      <div className="row wrap"><h3>{p.name}</h3>
        <span className={'pill' + (p.status === 'active' ? ' accent' : p.status === 'done' ? ' mint' : '')}>{p.status}</span>
        {pr.missed > 0 && p.status === 'active' && <span className="pill" style={{ background: 'var(--rose)', color: 'var(--rose-text)' }}>{pr.missed} behind</span>}
        <span className="spacer" /><span className="muted small">{fmtDate(p.start)} → {fmtDate(p.end)}</span></div>
      <div className="progress"><i style={{ width: `${pr.pct}%` }} /></div>
      <div className="muted small">{pr.pct.toFixed(0)}% · {pr.done.toLocaleString()} of {pr.total.toLocaleString()} verses{pr.today ? ` · Today: ${dayLabel(pr.today) || 'rest day'}` : ''}</div>
    </div>
  );
}

// ---------------- new plan ----------------
function NewPlan({ done }: { done: (id?: string) => void }) {
  const kjv = useKjv();
  const rts = useReadthroughs();
  const active = useActiveRt();
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [rt, setRt] = useState('');
  const [start, setStart] = useState(todayStr());
  const [end, setEnd] = useState(addDays(todayStr(), 29));
  const [skipWeekdays, setSkipWeekdays] = useState<number[]>([]);
  const [skipDates, setSkipDates] = useState<string[]>([]);
  const [skipRanges, setSkipRanges] = useState<{ from: string; to: string }[]>([]);
  const [oneDate, setOneDate] = useState('');
  const [rFrom, setRFrom] = useState(''); const [rTo, setRTo] = useState('');
  const [balance, setBalance] = useState<Plan['balance']>('words');
  const passages = text.split(/[\n;,]+/).map((x) => x.trim()).filter(Boolean);
  const built = useMemo(() => buildPlanVerses(passages), [text]); // eslint-disable-line react-hooks/exhaustive-deps
  const cfg = { start, end, skipWeekdays, skipDates, skipRanges };
  const dates = useMemo(() => (start && end && end >= start ? availableDates(cfg) : []), [start, end, skipWeekdays, skipDates, skipRanges]); // eslint-disable-line react-hooks/exhaustive-deps
  const preview = useMemo(() => (dates.length && built.verses.length ? spread(built.verses, dates, balance, kjv) : []), [dates, built, balance, kjv]);
  const create = async () => {
    const id = await createPlan({ name: name.trim() || passages.slice(0, 3).join(', '), rt: rt || active?.id || rts[0]?.id, passages, ...cfg, balance }, kjv);
    done(id);
  };
  return (
    <div className="card stack">
      <div className="row"><button className="icon-btn" onClick={() => done()} aria-label="Back"><Icon name="left" /></button><h3>New reading plan</h3></div>
      <label className="field">Name<input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Romans in 30 days" /></label>
      <label className="field">Passages — one per line or separated by commas
        <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Romans\nPs 1-50\nJohn 3-5\nRom 8:28-39'} />
      </label>
      <div className="row"><MicButton onText={(t) => setText((x) => (x ? x + '\n' : '') + t)} label="Say passages" /><span className="small" style={{ color: built.bad.length ? 'var(--rose-text)' : 'var(--muted)' }}>
        {built.bad.length ? `Not recognised: ${built.bad.join(', ')}` : built.verses.length ? `${built.verses.length.toLocaleString()} verses` : ''}</span></div>
      <div className="row wrap">
        <label className="field" style={{ width: 160 }}>Start<input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label className="field" style={{ width: 160 }}>End<input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></label>
        <label className="field" style={{ width: 200 }}>Counts toward
          <select value={rt || active?.id} onChange={(e) => setRt(e.target.value)}>{rts.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      </div>
      <div className="field">Skip these weekdays
        <div className="row wrap">{WD.map((d, i) => (
          <button key={d} className={'btn small' + (skipWeekdays.includes(i) ? ' primary' : '')} onClick={() => setSkipWeekdays(skipWeekdays.includes(i) ? skipWeekdays.filter((x) => x !== i) : [...skipWeekdays, i])}>{d}</button>
        ))}</div>
      </div>
      <div className="row wrap" style={{ alignItems: 'flex-end' }}>
        <label className="field" style={{ width: 160 }}>Skip a date<input type="date" value={oneDate} onChange={(e) => setOneDate(e.target.value)} /></label>
        <button className="btn small" disabled={!oneDate} onClick={() => { setSkipDates([...new Set([...skipDates, oneDate])]); setOneDate(''); }}>Add</button>
        <label className="field" style={{ width: 150 }}>Skip from<input type="date" value={rFrom} onChange={(e) => setRFrom(e.target.value)} /></label>
        <label className="field" style={{ width: 150 }}>to<input type="date" value={rTo} min={rFrom} onChange={(e) => setRTo(e.target.value)} /></label>
        <button className="btn small" disabled={!rFrom || !rTo || rTo < rFrom} onClick={() => { setSkipRanges([...skipRanges, { from: rFrom, to: rTo }]); setRFrom(''); setRTo(''); }}>Add range</button>
      </div>
      {(skipDates.length > 0 || skipRanges.length > 0) && <div className="row wrap" style={{ gap: 6 }}>
        {skipDates.map((d) => <span key={d} className="pill">{fmtDate(d)} <button className="linkish" onClick={() => setSkipDates(skipDates.filter((x) => x !== d))}>✕</button></span>)}
        {skipRanges.map((r, i) => <span key={i} className="pill">{fmtDate(r.from)} – {fmtDate(r.to)} <button className="linkish" onClick={() => setSkipRanges(skipRanges.filter((_, k) => k !== i))}>✕</button></span>)}
      </div>}
      <div className="field">Balance each day by
        <div className="row"><button className={'btn small' + (balance === 'words' ? ' primary' : '')} onClick={() => setBalance('words')}>Word count (even reading time)</button>
          <button className={'btn small' + (balance === 'verses' ? ' primary' : '')} onClick={() => setBalance('verses')}>Verse count</button></div>
      </div>
      {preview.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          <div className="small"><b>{dates.length} reading days</b> · about {Math.ceil(built.verses.length / dates.length)} verses a day</div>
          <div className="plan-preview">{preview.slice(0, 7).map((d) => <div key={d.date} className="small"><span className="muted">{fmtDate(d.date)}</span> {dayLabel(d)}</div>)}{preview.length > 7 && <div className="muted small">…and {preview.length - 7} more days</div>}</div>
        </div>
      )}
      <div className="row"><span className="spacer" /><button className="btn" onClick={() => done()}>Cancel</button>
        <button className="btn primary" disabled={!preview.length} onClick={create}>Create plan</button></div>
    </div>
  );
}

// ---------------- plan view ----------------
function PlanView({ id, back }: { id: string; back: () => void }) {
  const p = useLiveQuery(() => db.plans.get(id), [id]);
  const kjv = useKjv();
  const reads = useReadMap(p?.rt);
  const [catchUp, setCatchUp] = useState<ReturnType<typeof catchUpPreview> | null>(null);
  const pr = useMemo(() => (p ? planProgress(p, reads) : null), [p, reads]);
  const todayRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setTimeout(() => todayRef.current?.scrollIntoView({ block: 'center' }), 100); }, [id]);
  if (!p || !alive(p) || !pr) return <div className="muted">Plan not found. <button className="linkish" onClick={back}>Back</button></div>;
  const setStatus = (status: Plan['status']) => mutate(`Plan ${status === 'active' ? 'resumed' : status}`, (w) => w.patch('plans', p.id, { status }));
  return (
    <div className="stack">
      <div className="row wrap">
        <button className="icon-btn" onClick={back} aria-label="All plans"><Icon name="left" /></button>
        <h3>{p.name}</h3><span className="pill">{p.status}</span><span className="spacer" />
        {p.status === 'active' && <button className="btn small" onClick={() => setStatus('paused')}>Pause</button>}
        {p.status === 'paused' && <button className="btn small primary" onClick={() => setStatus('active')}>Resume</button>}
        {p.status !== 'done' && <button className="btn small" onClick={() => setStatus('done')}>Finish</button>}
        <button className="icon-btn" title="Move to Trash" onClick={async () => { await mutate(`Moved “${p.name}” to Trash`, (w) => w.trash('plans', p.id)); back(); }}><Icon name="trash" /></button>
      </div>
      <div className="progress"><i style={{ width: `${pr.pct}%` }} /></div>
      <div className="row wrap small"><span>{pr.pct.toFixed(0)}% · {pr.done} / {pr.total} verses</span><span className="muted">{fmtDate(p.start)} → {fmtDate(p.end)}</span><span className="spacer" />
        {pr.missed > 0 && p.status === 'active' && <button className="btn small primary" onClick={() => setCatchUp(catchUpPreview(p, reads, kjv))}>Catch up ({pr.missed} day{pr.missed > 1 ? 's' : ''} behind)</button>}</div>
      {catchUp && (
        <div className="banner" style={{ flexWrap: 'wrap' }}>
          <span style={{ flex: 1 }}>Catch-up spreads {catchUp.pendingCount} unread verses over the remaining days — about {catchUp.perDay} a day.</span>
          <button className="btn small primary" onClick={async () => { await mutate('Plan caught up', (w) => w.patch('plans', p.id, { days: catchUp.days })); setCatchUp(null); }}>Apply</button>
          <button className="btn small ghost" onClick={() => setCatchUp(null)}>Cancel</button>
        </div>
      )}
      <div className="list">
        {p.days.map((d) => {
          const s = pr.status.get(d.date)!;
          const vs = dayVerses(d);
          return (
            <div key={d.date} ref={d.date === todayStr() ? todayRef : undefined} className={'item plan-day ' + s}>
              <span className={'daydot ' + s} aria-label={s} />
              <div className="grow">
                <div className="small muted">{fmtDate(d.date)}{s === 'today' ? ' · Today' : s === 'missed' ? ' · missed' : s === 'partial' ? ' · partly read' : ''}</div>
                <div>{vs.length ? <button className="linkish" onClick={() => openRef({ s: vs[0] })}>{dayLabel(d)}</button> : <span className="muted">Nothing left for this day</span>}</div>
              </div>
              {vs.length > 0 && s !== 'done' && <>
                <button className="icon-btn" title="Read aloud" onClick={() => playVerses(vs, dayLabel(d), { rt: p.rt })}><Icon name="volume" /></button>
                <button className="btn small" onClick={() => openRef({ s: vs.find((v) => !reads.has(v)) ?? vs[0] })}>Read</button>
              </>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------- calendar ----------------
function useActivity() {
  const reads = useLiveQuery(async () => (await db.verse_reads.toArray()).filter((r) => r.checked && alive(r)), []) ?? [];
  const reflections = useLiveQuery(async () => (await db.reflections.toArray()).filter((r) => alive(r) && r.text.trim()), []) ?? [];
  const notes = useNotes();
  const taggings = useTaggings();
  const links = useLinks();
  const plans = usePlans();
  return useMemo(() => {
    const m = new Map<string, { verses: number[]; refl: typeof reflections; notes: typeof notes; tags: typeof taggings; links: typeof links; plan: { p: Plan; label: string }[] }>();
    const g = (d: string) => { if (!m.has(d)) m.set(d, { verses: [], refl: [], notes: [], tags: [], links: [], plan: [] }); return m.get(d)!; };
    reads.forEach((r) => g(dateOf(r.at)).verses.push(r.verse));
    reflections.forEach((r) => g(r.date).refl.push(r));
    notes.forEach((n) => g(dateOf(n.created_at)).notes.push(n));
    taggings.forEach((t) => g(dateOf(t.created_at)).tags.push(t));
    links.forEach((l) => g(dateOf(l.created_at)).links.push(l));
    plans.filter((p) => p.status !== 'done').forEach((p) => p.days.forEach((d) => { if (d.ranges.length) g(d.date).plan.push({ p, label: dayLabel(d) }); }));
    return m;
  }, [reads, reflections, notes, taggings, links, plans]);
}

function Calendar({ month, setMonth, day, setDay }: { month: string; setMonth: (m: string) => void; day: string; setDay: (d: string) => void }) {
  const act = useActivity();
  const idx = useTagIndex();
  const [y, mo] = month.split('-').map(Number);
  const first = new Date(y, mo - 1, 1);
  const daysIn = new Date(y, mo, 0).getDate();
  const cells: (string | null)[] = [...Array(first.getDay()).fill(null), ...Array.from({ length: daysIn }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
  const shift = (n: number) => { const d = new Date(y, mo - 1 + n, 1); setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); };
  const today = todayStr();
  const sel = day && day.startsWith(month) ? day : '';
  const a = sel ? act.get(sel) : undefined;
  return (
    <div className="stack">
      <div className="row">
        <button className="icon-btn" onClick={() => shift(-1)} aria-label="Previous month"><Icon name="left" /></button>
        <h3 style={{ minWidth: 160, textAlign: 'center' }}>{first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h3>
        <button className="icon-btn" onClick={() => shift(1)} aria-label="Next month"><Icon name="right" /></button>
        <button className="btn small" onClick={() => { setMonth(today.slice(0, 7)); setDay(today); }}>Today</button>
        <span className="spacer" />
        <span className="legend small muted"><i className="c-read" />read <i className="c-refl" />reflection <i className="c-note" />note/tag <i className="c-plan" />plan</span>
      </div>
      <div className="cal">
        {WD.map((d) => <div key={d} className="cal-h">{d}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={'e' + i} />;
          const x = act.get(d);
          return (
            <button key={d} className={'cal-d' + (d === today ? ' today' : '') + (d === sel ? ' sel' : '')} onClick={() => setDay(d)}>
              <span className="n">{Number(d.slice(8))}</span>
              {x && <span className="dots">
                {x.verses.length > 0 && <i className="c-read" title={`${x.verses.length} verses`} />}
                {x.refl.length > 0 && <i className="c-refl" />}
                {(x.notes.length > 0 || x.tags.length > 0 || x.links.length > 0) && <i className="c-note" />}
                {x.plan.length > 0 && <i className="c-plan" />}
              </span>}
              {x && x.verses.length > 0 && <span className="cnt">{x.verses.length}</span>}
            </button>
          );
        })}
      </div>
      {sel && (
        <div className="card stack">
          <h3>{fmtDate(sel)}</h3>
          {!a && <div className="muted small">Nothing recorded.</div>}
          {a?.plan.map((x, i) => <div key={i} className="small"><span className="pill">{x.p.name}</span> {x.label}</div>)}
          {!!a?.verses.length && <div><b className="small">Read · {a.verses.length} verses</b><div>{formatVerses(a.verses)}</div></div>}
          {a?.refl.map((r) => <div key={r.id} className="thought"><RefText text={r.text} /></div>)}
          {a?.notes.map((n) => <div key={n.id} className="note"><button className="linkish small" onClick={() => ui.set({ details: n })}>{anchorLabel(n)}</button><br /><RefText text={n.text} /></div>)}
          {!!a?.tags.length && <div className="small">Tagged: {a.tags.map((t) => `${anchorLabel(t)} (${idx.byId.get(t.tag)?.name ?? '?'})`).join('; ')}</div>}
          {a?.links.map((l) => <div key={l.id} className="small"><Icon name="link" size={13} /> <a href={l.url} target="_blank" rel="noreferrer">{l.title}</a> · {anchorLabel(l)}</div>)}
        </div>
      )}
    </div>
  );
}

// ---------------- timeline ----------------
type Ev = { date: string; at: number; kind: 'read' | 'reflection' | 'note' | 'tag' | 'link' | 'plan' | 'readthrough'; title: string; body?: string; tags?: string[]; onClick?: () => void };
const KINDS: Ev['kind'][] = ['read', 'reflection', 'note', 'tag', 'link', 'plan', 'readthrough'];

function Timeline() {
  const act = useActivity();
  const idx = useTagIndex();
  const plans = usePlans();
  const rts = useReadthroughs();
  const [kinds, setKinds] = useState<Set<Ev['kind']>>(new Set(KINDS));
  const [tag, setTag] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [limit, setLimit] = useState(150);
  const events = useMemo(() => {
    const out: Ev[] = [];
    act.forEach((a, date) => {
      if (a.verses.length) out.push({ date, at: new Date(date + 'T23:59:00').getTime(), kind: 'read', title: `Read ${a.verses.length} verse${a.verses.length > 1 ? 's' : ''}`, body: formatVerses(a.verses), onClick: () => openRef({ s: Math.min(...a.verses) }) });
      a.refl.forEach((r) => out.push({ date, at: r.updated_at, kind: 'reflection', title: 'Reflection', body: r.text }));
      a.notes.forEach((n) => out.push({ date, at: n.created_at, kind: 'note', title: `Note · ${anchorLabel(n)}`, body: n.text, tags: n.tags, onClick: () => ui.set({ details: n }) }));
      a.tags.forEach((t) => out.push({ date, at: t.created_at, kind: 'tag', title: `Tagged ${anchorLabel(t)} · ${idx.byId.get(t.tag)?.name ?? ''}`, tags: [t.tag], onClick: () => ui.set({ details: t }) }));
      a.links.forEach((l) => out.push({ date, at: l.created_at, kind: 'link', title: `Link · ${l.title}`, body: anchorLabel(l), onClick: () => window.open(l.url, '_blank') }));
    });
    plans.forEach((p) => out.push({ date: dateOf(p.created_at), at: p.created_at, kind: 'plan', title: `Started plan “${p.name}”` }));
    rts.forEach((r) => { out.push({ date: r.start, at: new Date(r.start + 'T00:01:00').getTime(), kind: 'readthrough', title: `Started ${r.name}` }); if (r.finish) out.push({ date: r.finish, at: new Date(r.finish + 'T23:00:00').getTime(), kind: 'readthrough', title: `Finished ${r.name}` }); });
    const tagIds = tag ? new Set(idx.desc(tag)) : null;
    return out.filter((e) => kinds.has(e.kind) && (!from || e.date >= from) && (!to || e.date <= to) && (!tagIds || e.tags?.some((t) => tagIds.has(t))))
      .sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at);
  }, [act, idx, plans, rts, kinds, tag, from, to]);
  let lastDate = '';
  return (
    <div className="stack">
      <div className="row wrap" style={{ gap: 6 }}>
        {KINDS.map((k) => <button key={k} className={'btn small' + (kinds.has(k) ? ' primary' : '')} onClick={() => { const n = new Set(kinds); if (n.has(k)) n.delete(k); else n.add(k); setKinds(n); }}>{k === 'readthrough' ? 'read-through' : k}</button>)}
      </div>
      <div className="row wrap">
        <select value={tag} onChange={(e) => setTag(e.target.value)} style={{ width: 190 }}><option value="">Any tag</option>{idx.tags.map((t) => <option key={t.id} value={t.id}>{idx.path(t.id)}</option>)}</select>
        <label className="row small">From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} /></label>
        <label className="row small">To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} /></label>
        <label className="row small">Jump to <input type="date" onChange={(e) => { if (e.target.value) { setTo(e.target.value); setFrom(''); } }} style={{ width: 150 }} /></label>
      </div>
      <div className="timeline">
        {events.slice(0, limit).map((e, i) => {
          const head = e.date !== lastDate; lastDate = e.date;
          return (
            <div key={i}>
              {head && <div className="tl-date">{fmtDate(e.date)}</div>}
              <div className={'tl-ev ' + e.kind} onClick={e.onClick} style={{ cursor: e.onClick ? 'pointer' : 'default' }}>
                <span className={'tl-dot ' + e.kind} />
                <div><div className="small" style={{ fontWeight: 600 }}>{e.title}</div>{e.body && <div className="small"><RefText text={e.body.length > 300 ? e.body.slice(0, 300) + '…' : e.body} /></div>}</div>
              </div>
            </div>
          );
        })}
        {events.length > limit && <button className="btn small" onClick={() => setLimit(limit + 150)}>Show more</button>}
        {!events.length && <div className="muted">Nothing here yet.</div>}
      </div>
    </div>
  );
}

export { vBook, vChap, vVerse, toast };
