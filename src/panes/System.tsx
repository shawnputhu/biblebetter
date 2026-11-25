import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, TRASH_TABLES, uid, type SyncTable, type Base, type InboxItem } from '../lib/db';
import { useSettings, saveSettings } from '../lib/hooks';
import { mutate } from '../lib/write';
import { supabase, getSession, syncNow } from '../lib/sync';
import { useUI, toast } from '../lib/store';
import { downloadBackup, importAll, listSnapshots, snapshotNow, fetchSnapshot, folderSupported, chooseFolder, folderStatus, saveToFolder, type BackupFile } from '../lib/backup';
import { formatVerses } from '../lib/ref';
import { Icon } from '../components/Icon';
import * as tts from '../lib/tts';
import { pushSupported, enablePush, savePrefs, currentSub, disablePush, testPush } from '../lib/push';
import { RefText } from '../components/RefText';
import { MicButton } from '../components/Voice';
import { FileInbox } from '../components/Share';
import type { InboxItem as InboxRow } from '../lib/db';

// ---------------- Inbox ----------------
export function Inbox() {
  const items = useLiveQuery(async () => (await db.inbox_items.orderBy('created_at').reverse().toArray()).filter((i) => !i.deleted_at && !i.purged), []) ?? [];
  const [t, setT] = useState('');
  const [filing, setFiling] = useState<InboxRow | null>(null);
  const add = async () => {
    if (!t.trim()) return;
    await mutate('Captured to Inbox', (w) => w.put<InboxItem>('inbox_items', { id: uid(), text: t.trim(), created_at: Date.now() }));
    setT('');
  };
  return (
    <div className="stack">
      <h2>Inbox</h2>
      <p className="muted small" style={{ margin: 0 }}>Quick thoughts to sort later. File them as notes on a passage when you’re ready.</p>
      <div className="row">
        <input type="text" value={t} onChange={(e) => setT(e.target.value)} placeholder="Capture a thought…" onKeyDown={(e) => { if (e.key === 'Enter') void add(); }} />
        <MicButton onText={(x) => setT((y) => (y ? y.replace(/\s*$/, ' ') : '') + x)} />
        <button className="btn primary" onClick={add}>Add</button>
      </div>
      <div className="list">
        {items.map((i) => (
          <div className="item" key={i.id}>
            <div className="grow"><RefText text={i.text} /><div className="muted small">{new Date(i.created_at).toLocaleString()}</div></div>
            <button className="btn small" onClick={() => setFiling(i)}><Icon name="pen" size={14} /> File as note</button>
            <button className="icon-btn" title="Move to Trash" onClick={() => mutate('Moved to Trash', (w) => w.trash('inbox_items', i.id))}><Icon name="trash" /></button>
          </div>
        ))}
        {!items.length && <div className="muted">Inbox is empty.</div>}
      </div>
      {filing && <FileInbox item={filing} onClose={() => setFiling(null)} />}
    </div>
  );
}

// ---------------- Trash ----------------
const KIND_LABEL: Record<string, string> = { readthroughs: 'Read-through', reflections: 'Reflection', highlights: 'Highlight', inbox_items: 'Inbox item', tags: 'Tag', notes: 'Note', links: 'Link' };
function describe(t: string, r: Base & Record<string, unknown>) {
  if (t === 'readthroughs') return String(r.name);
  if (t === 'reflections') return `${r.date}: ${String(r.text).slice(0, 120)}`;
  if (t === 'highlights') return formatVerses([Number(r.verse)]);
  if (t === 'tags') return `${r.name} (${r.code})`;
  if (t === 'notes') return `${formatVerses([Number(r.s), Number(r.e)].filter((x, i, a) => a.indexOf(x) === i))}: ${String(r.text).slice(0, 120)}`;
  if (t === 'links') return String(r.title || r.url);
  return String(r.text ?? '').slice(0, 140);
}
export function Trash() {
  const rows = useLiveQuery(async () => {
    const out: { t: SyncTable; r: Base & Record<string, unknown> }[] = [];
    for (const t of TRASH_TABLES) (await db.table(t).toArray()).forEach((r) => { if (r.deleted_at && !r.purged) out.push({ t, r }); });
    return out.sort((a, b) => (b.r.deleted_at ?? 0) - (a.r.deleted_at ?? 0));
  }, []) ?? [];
  const left = (d: number) => Math.max(0, 30 - Math.floor((Date.now() - d) / 86_400_000));
  return (
    <div className="stack">
      <div className="row"><h2>Trash</h2><span className="spacer" />
        {rows.length > 0 && <button className="btn danger" onClick={() => { if (confirm(`Permanently delete ${rows.length} item(s)? This can’t be undone.`)) void mutate(null, async (w) => { for (const x of rows) await w.purge(x.t, x.r.id); }); }}>Empty Trash</button>}
      </div>
      <p className="muted small" style={{ margin: 0 }}>Deleted items stay here for 30 days, then are removed for good.</p>
      <div className="list">
        {rows.map(({ t, r }) => (
          <div className="item" key={t + r.id}>
            <span className="pill">{KIND_LABEL[t]}</span>
            <div className="grow"><div>{describe(t, r)}</div><div className="muted small">{left(r.deleted_at!)} days left</div></div>
            <button className="btn small" onClick={() => mutate('Restored', (w) => w.restore(t, r.id))}><Icon name="undo" size={14} /> Restore</button>
            <button className="icon-btn" title="Delete forever" onClick={() => { if (confirm('Delete this permanently? This can’t be undone.')) void mutate(null, (w) => w.purge(t, r.id)); }}><Icon name="x" /></button>
          </div>
        ))}
        {!rows.length && <div className="muted">Trash is empty.</div>}
      </div>
    </div>
  );
}

// ---------------- Settings ----------------
export function SettingsPane({ onSignOut }: { onSignOut: () => void }) {
  const s = useSettings();
  const sync = useUI((x) => x.syncDetail);
  const file = useRef<HTMLInputElement>(null);
  const [snaps, setSnaps] = useState<{ name: string }[]>([]);
  const [folder, setFolder] = useState<{ name: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState('');
  const session = getSession();
  useEffect(() => { if (session) listSnapshots().then(setSnaps).catch(() => {}); void folderStatus().then(setFolder); }, [session]);

  const [pendingImport, setPendingImport] = useState<BackupFile | null>(null);
  const doImport = async (data: BackupFile) => setPendingImport(data);
  const finishImport = async (mode: 'merge' | 'replace') => {
    if (!pendingImport) return;
    try { await importAll(pendingImport, mode); toast(mode === 'replace' ? 'Backup restored' : 'Backup merged'); }
    catch (e) { toast(`Import failed: ${(e as Error).message}`); }
    setPendingImport(null);
  };

  const versions = ['ESV', 'KJV', 'NKJV', 'NIV', 'NASB', 'CSB', 'NLT', 'AMP', 'NET'];
  return (
    <div className="stack" style={{ maxWidth: 680 }}>
      <h2>Settings</h2>

      <section className="card stack">
        <h3>Appearance</h3>
        <div className="row wrap">
          {(['light', 'dark', 'system'] as const).map((t) => (
            <button key={t} className={'btn small' + (s.theme === t ? ' primary' : '')} onClick={() => saveSettings({ theme: t })}>{t === 'system' ? 'Follow device' : t[0].toUpperCase() + t.slice(1)}</button>
          ))}
        </div>
        <label className="field">Bible view
          <select value={s.bibleView ?? (s.compact ? 'compact' : 'text')} onChange={(e) => saveSettings({ bibleView: e.target.value as 'compact' | 'text' | 'read' })}>
            <option value="compact">Checkboxes only</option><option value="text">Verse by verse with text</option><option value="read">Reading view (paragraphs)</option>
          </select></label>
      </section>

      <section className="card stack">
        <h3>Bible links</h3>
        <div className="muted small">Cross-references: Treasury of Scripture Knowledge (public domain).</div>
        <label className="field">BibleGateway translation for links
          <select value={s.linkVersion} onChange={(e) => saveSettings({ linkVersion: e.target.value })}>{versions.map((v) => <option key={v}>{v}</option>)}</select>
        </label>
        <div className="muted small">The text inside BibleBetter is the KJV (public domain). Verse numbers follow the KJV.</div>
      </section>

      <VoiceSettings />
      <ReminderSettings />

      <section className="card stack">
        <h3>Today screen</h3>
        <div className="row wrap">
          <label className="field" style={{ width: 160 }}>Morning starts<input type="time" value={s.morningStart} onChange={(e) => saveSettings({ morningStart: e.target.value })} /></label>
          <label className="field" style={{ width: 160 }}>Evening starts<input type="time" value={s.eveningStart} onChange={(e) => saveSettings({ eveningStart: e.target.value })} /></label>
        </div>
        <button className="btn small" style={{ alignSelf: 'flex-start' }} onClick={() => saveSettings({ walkthroughDone: false })}>Show the welcome walkthrough again</button>
      </section>

      <section className="card stack">
        <h3>Backup</h3>
        <div className="row wrap">
          <button className="btn primary" onClick={() => downloadBackup()}><Icon name="download" size={16} /> Export backup file</button>
          <button className="btn" onClick={() => file.current?.click()}><Icon name="upload" size={16} /> Import backup file</button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={async (e) => {
            const f = e.target.files?.[0]; e.target.value = '';
            if (!f) return;
            try { await doImport(JSON.parse(await f.text())); } catch (err) { toast(`Import failed: ${(err as Error).message}`); }
          }} />
        </div>
        {pendingImport && (
          <div className="banner" style={{ flexWrap: 'wrap' }}>
            <span style={{ flex: 1 }}>Backup from {pendingImport.exported_at?.slice(0, 10)}. How should it be imported?</span>
            <button className="btn small primary" onClick={() => finishImport('merge')}>Merge (keep newest)</button>
            <button className="btn small danger" onClick={() => finishImport('replace')}>Replace everything</button>
            <button className="btn small ghost" onClick={() => setPendingImport(null)}>Cancel</button>
          </div>
        )}
        {supabase && session && (
          <>
            <div className="row"><strong className="small">Weekly cloud snapshots</strong><span className="spacer" />
              <button className="btn small" disabled={!!busy} onClick={async () => { setBusy('snap'); try { await snapshotNow(); setSnaps(await listSnapshots()); toast('Snapshot saved'); } catch (e) { toast(`Snapshot failed: ${(e as Error).message}`); } setBusy(''); }}>Save snapshot now</button></div>
            <div className="muted small">Saved automatically every week to your Supabase storage. The last 8 are kept.</div>
            <div className="list">
              {snaps.map((f) => (
                <div className="item" key={f.name} style={{ padding: '8px 12px' }}>
                  <span className="grow small">{f.name.replace('BibleBetter-', '').replace('.json', '')}</span>
                  <button className="btn small" onClick={async () => { try { await doImport(await fetchSnapshot(f.name)); } catch (e) { toast(`Restore failed: ${(e as Error).message}`); } }}>Restore</button>
                </div>
              ))}
              {!snaps.length && <div className="muted small">No snapshots yet.</div>}
            </div>
          </>
        )}
        {folderSupported() && (
          <>
            <strong className="small">Auto-save to a folder on this PC</strong>
            <div className="row wrap">
              {folder ? <span className="small">Folder: <b>{folder.name}</b> {folder.ok ? '· saving weekly' : '· needs permission'}</span> : <span className="muted small">Off</span>}
              <span className="spacer" />
              {folder && !folder.ok && <button className="btn small primary" onClick={async () => { if (await saveToFolder(true)) { setFolder(await folderStatus()); toast('Saved to folder'); } }}>Re-allow</button>}
              <button className="btn small" onClick={async () => { try { await chooseFolder(); setFolder(await folderStatus()); toast('Backup saved to folder'); } catch { /* cancelled */ } }}>{folder ? 'Change folder' : 'Choose folder'}</button>
            </div>
          </>
        )}
      </section>

      <section className="card stack">
        <h3>Account & sync</h3>
        {supabase ? (
          <>
            <div className="small">{session ? <>Signed in as <b>{session.user.email}</b></> : 'Signed out'}</div>
            <div className="muted small">{sync}</div>
            <div className="row"><button className="btn small" onClick={() => void syncNow()}>Sync now</button>{session && <button className="btn small danger" onClick={onSignOut}>Sign out</button>}</div>
          </>
        ) : (
          <div className="muted small">Not connected to Supabase yet — your data is saved on this device only.</div>
        )}
      </section>

      <section className="card stack">
        <h3>Install BibleBetter</h3>
        <div className="small"><b>Android (Chrome):</b> menu ⋮ → <i>Add to Home screen</i> → <i>Install</i>. Long-press the icon for Today / Bible shortcuts.</div>
        <div className="small"><b>PC (Chrome or Edge):</b> click the install icon at the right of the address bar, or menu → <i>Install BibleBetter</i>.</div>
      </section>
      <div className="muted small">BibleBetter · Phase 1</div>
    </div>
  );
}

function VoiceSettings() {
  const s = useSettings();
  const [vs, setVs] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    const f = () => setVs(tts.voices());
    f();
    if (tts.ttsSupported()) speechSynthesis.addEventListener('voiceschanged', f);
    return () => { if (tts.ttsSupported()) speechSynthesis.removeEventListener('voiceschanged', f); };
  }, []);
  return (
    <section className="card stack">
      <h3>Read aloud & voice</h3>
      <div className="row wrap">
        <label className="field" style={{ flex: 1, minWidth: 200 }}>Voice<select value={s.ttsVoice ?? ''} onChange={(e) => saveSettings({ ttsVoice: e.target.value })}><option value="">Device default</option>{vs.map((x) => <option key={x.voiceURI} value={x.voiceURI}>{x.name}</option>)}</select></label>
        <label className="field" style={{ width: 200 }}>Speed · {(s.ttsRate ?? 1).toFixed(2)}×<input type="range" min={0.5} max={2} step={0.05} value={s.ttsRate ?? 1} onChange={(e) => saveSettings({ ttsRate: Number(e.target.value) })} /></label>
        <button className="btn small" style={{ alignSelf: 'flex-end' }} onClick={() => tts.playText(['In the beginning God created the heaven and the earth.'], 'Voice test')}><Icon name="volume" size={14} /> Test</button>
      </div>
      <label className="row small"><input type="checkbox" checked={!!s.autoCheckListening} onChange={(e) => saveSettings({ autoCheckListening: e.target.checked })} /> Check verses as they’re read aloud</label>
      <label className="row small"><input type="checkbox" checked={s.continueChapters !== false} onChange={(e) => saveSettings({ continueChapters: e.target.checked })} /> Keep reading into the next chapter</label>
      <label className="row small"><input type="checkbox" checked={s.keepScreenOn !== false} onChange={(e) => saveSettings({ keepScreenOn: e.target.checked })} /> Keep the screen on while reading aloud (Android stops speech when the screen locks)</label>
      <label className="field">Spoken replies to voice commands
        <select value={s.voiceReplies ?? 'brief'} onChange={(e) => saveSettings({ voiceReplies: e.target.value as 'off' | 'brief' | 'full' })}>
          <option value="off">Off — show on screen only</option><option value="brief">Brief — “Tagged Salvation”</option><option value="full">Full — “Tagged Romans 8:28 to 30 with Salvation”</option>
        </select></label>
      <label className="row small"><input type="checkbox" checked={!!s.handsFree} onChange={(e) => saveSettings({ handsFree: e.target.checked })} /> Hands-free mode: full spoken replies, and the mic listens again after each reply</label>
      <div className="muted small">Voice commands: tap the mic (or press V) and speak. Say “what can I say?” for the list. Speech-to-text uses Chrome’s online service, so it needs internet; reading aloud works offline.</div>
    </section>
  );
}

function ReminderSettings() {
  const s = useSettings();
  const r = s.reminders ?? { on: false, reading: '07:00', morning: null, evening: '20:30', quietFrom: '22:00', quietTo: '06:00' };
  const [deviceOn, setDeviceOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void currentSub().then((x) => setDeviceOn(!!x)); }, []);
  const update = async (patch: Partial<typeof r>) => {
    const next = { ...r, ...patch };
    await saveSettings({ reminders: next });
    try { await savePrefs(next); } catch (e) { toast(`Couldn’t update reminders: ${(e as Error).message}`); }
  };
  if (!supabase) return null;
  const time = (k: 'reading' | 'morning' | 'evening', label: string) => (
    <div className="row">
      <label className="row small" style={{ width: 170 }}><input type="checkbox" checked={!!r[k]} onChange={(e) => void update({ [k]: e.target.checked ? (k === 'morning' ? '06:30' : k === 'evening' ? '20:30' : '07:00') : null })} /> {label}</label>
      {r[k] && <input type="time" value={r[k]!} onChange={(e) => void update({ [k]: e.target.value })} style={{ width: 130 }} />}
    </div>
  );
  return (
    <section className="card stack">
      <h3>Reminders</h3>
      {!pushSupported() ? <div className="muted small">This browser can’t show notifications. Install BibleBetter from Chrome or Edge.</div> : (
        <>
          <div className="row wrap">
            <span className="small">{deviceOn ? 'Notifications are on for this device.' : 'Notifications are off for this device.'}</span><span className="spacer" />
            {!deviceOn ? <button className="btn small primary" disabled={busy} onClick={async () => { setBusy(true); try { await enablePush({ ...r, on: true }); await saveSettings({ reminders: { ...r, on: true } }); setDeviceOn(true); toast('Notifications turned on'); } catch (e) { toast((e as Error).message); } setBusy(false); }}><Icon name="bell" size={14} /> Turn on for this device</button>
              : <>
                <button className="btn small" onClick={async () => { try { await testPush(); toast('Test sent — it should arrive in a few seconds'); } catch (e) { toast((e as Error).message); } }}>Send a test</button>
                <button className="btn small" onClick={async () => { await disablePush(); setDeviceOn(false); toast('Notifications turned off for this device'); }}>Turn off</button>
              </>}
          </div>
          {time('morning', 'Morning')}
          {time('reading', 'Daily reading')}
          {time('evening', 'Evening review')}
          <div className="row small">Quiet hours <input type="time" value={r.quietFrom} onChange={(e) => void update({ quietFrom: e.target.value })} style={{ width: 120 }} /> to <input type="time" value={r.quietTo} onChange={(e) => void update({ quietTo: e.target.value })} style={{ width: 120 }} /></div>
          <div className="muted small">Reminders are sent by your Supabase project, so they arrive even when BibleBetter is closed. Each device you turn on gets them.</div>
        </>
      )}
    </section>
  );
}
