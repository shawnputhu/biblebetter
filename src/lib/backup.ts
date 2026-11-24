import { db, SYNC_TABLES, getMeta, setMeta, todayStr } from './db';
import { supabase, getSession, scheduleSync } from './sync';

const WEEK = 7 * 24 * 3600 * 1000;
const KEEP = 8;

export interface BackupFile { app: 'BibleBetter'; version: 1; exported_at: string; tables: Record<string, unknown[]> }

export async function exportAll(): Promise<BackupFile> {
  const tables: Record<string, unknown[]> = {};
  for (const t of SYNC_TABLES) {
    const rows = await db.table(t).toArray();
    tables[t] = rows.filter((r) => !r.purged).map(({ _dirty, ...r }) => { void _dirty; return r; });
  }
  return { app: 'BibleBetter', version: 1, exported_at: new Date().toISOString(), tables };
}

export const backupName = () => `BibleBetter-backup-${todayStr()}.json`;

export function downloadJson(obj: unknown, name: string) {
  const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export async function downloadBackup() {
  downloadJson(await exportAll(), backupName());
  await setMeta('lastDownload', Date.now());
}

/** merge: keep whichever copy is newer. replace: imported data becomes the only data. */
export async function importAll(file: BackupFile, mode: 'merge' | 'replace') {
  if (file?.app !== 'BibleBetter' || !file.tables) throw new Error('This is not a BibleBetter backup file.');
  const now = Date.now();
  await db.transaction('rw', [...SYNC_TABLES], async () => {
    for (const t of SYNC_TABLES) {
      const incoming = (file.tables[t] ?? []) as { id: string; updated_at: number }[];
      const table = db.table(t);
      if (mode === 'replace') {
        const keep = new Set(incoming.map((r) => r.id));
        const existing = await table.toArray();
        await table.bulkPut(existing.filter((r) => !keep.has(r.id)).map((r) => ({ ...r, purged: true, deleted_at: now, updated_at: now, _dirty: 1 })));
        await table.bulkPut(incoming.map((r) => ({ ...r, updated_at: now, _dirty: 1 })));
      } else {
        const locals = await table.bulkGet(incoming.map((r) => r.id));
        await table.bulkPut(incoming.filter((r, i) => !locals[i] || locals[i].updated_at < r.updated_at).map((r) => ({ ...r, updated_at: now, _dirty: 1 })));
      }
    }
  });
  scheduleSync(200);
}

// ---------- weekly cloud snapshots (Supabase Storage, last 8 kept) ----------
export async function listSnapshots(): Promise<{ name: string }[]> {
  const s = getSession();
  if (!supabase || !s) return [];
  const { data, error } = await supabase.storage.from('backups').list(s.user.id, { sortBy: { column: 'name', order: 'desc' } });
  if (error) throw error;
  return (data ?? []).filter((f) => f.name.endsWith('.json'));
}

export async function snapshotNow() {
  const s = getSession();
  if (!supabase || !s) throw new Error('Sign in to save cloud snapshots.');
  const body = JSON.stringify(await exportAll());
  const path = `${s.user.id}/BibleBetter-${todayStr()}.json`;
  const { error } = await supabase.storage.from('backups').upload(path, new Blob([body], { type: 'application/json' }), { upsert: true });
  if (error) throw error;
  await setMeta('lastSnapshot', Date.now());
  const files = await listSnapshots();
  const old = files.slice(KEEP).map((f) => `${s.user.id}/${f.name}`);
  if (old.length) await supabase.storage.from('backups').remove(old);
}

export async function fetchSnapshot(name: string): Promise<BackupFile> {
  const s = getSession();
  const { data, error } = await supabase!.storage.from('backups').download(`${s!.user.id}/${name}`);
  if (error) throw error;
  return JSON.parse(await data.text());
}

// ---------- PC auto-save folder (File System Access API, Chrome/Edge desktop) ----------
type DirHandle = FileSystemDirectoryHandle & {
  queryPermission?: (o: { mode: string }) => Promise<string>;
  requestPermission?: (o: { mode: string }) => Promise<string>;
};
export const folderSupported = () => typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';

export async function chooseFolder() {
  const h = await (window as unknown as { showDirectoryPicker: (o: object) => Promise<DirHandle> }).showDirectoryPicker({ mode: 'readwrite' });
  await setMeta('folderHandle', h);
  await saveToFolder(true);
  return h.name;
}

export async function folderStatus(): Promise<{ name: string; ok: boolean } | null> {
  const h = await getMeta<DirHandle | null>('folderHandle', null);
  if (!h) return null;
  const p = h.queryPermission ? await h.queryPermission({ mode: 'readwrite' }) : 'granted';
  return { name: h.name, ok: p === 'granted' };
}

export async function saveToFolder(ask = false) {
  const h = await getMeta<DirHandle | null>('folderHandle', null);
  if (!h) return false;
  let p = h.queryPermission ? await h.queryPermission({ mode: 'readwrite' }) : 'granted';
  if (p !== 'granted' && ask && h.requestPermission) p = await h.requestPermission({ mode: 'readwrite' });
  if (p !== 'granted') return false;
  const fh = await h.getFileHandle(backupName(), { create: true });
  const w = await fh.createWritable();
  await w.write(JSON.stringify(await exportAll()));
  await w.close();
  await setMeta('lastFolderSave', Date.now());
  return true;
}

/** Called on start-up and daily: does whatever weekly backups are due. */
export async function runWeeklyBackups() {
  const now = Date.now();
  try {
    if (supabase && getSession() && now - (await getMeta<number>('lastSnapshot', 0)) > WEEK) await snapshotNow();
  } catch (e) { console.warn('snapshot failed', e); }
  try {
    if (now - (await getMeta<number>('lastFolderSave', 0)) > WEEK) await saveToFolder(false);
  } catch (e) { console.warn('folder save failed', e); }
}

export async function downloadDue() {
  const last = await getMeta<number>('lastDownload', 0);
  if (!last) { await setMeta('lastDownload', Date.now()); return false; } // first reminder a week after first use
  return Date.now() - last > WEEK;
}
