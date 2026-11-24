import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../config';
import { db, SYNC_TABLES, getMeta, setMeta, type SyncTable } from './db';
import { ui } from './store';

export const supabase: SupabaseClient | null =
  SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: true, autoRefreshToken: true } })
    : null;

let session: Session | null = null;
export const getSession = () => session;
export const setSession = (s: Session | null) => { session = s; refreshStatus(); };

function refreshStatus() {
  if (!supabase) return ui.set({ sync: 'local', syncDetail: 'Saved on this device only' });
  if (!session) return ui.set({ sync: 'signed-out', syncDetail: 'Signed out' });
  if (!navigator.onLine) return ui.set({ sync: 'offline', syncDetail: 'Offline — changes are saved and will sync later' });
}

let running = false;
let again = false;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Debounced sync after local changes. */
export function scheduleSync(delay = 1200) {
  if (!supabase) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), delay);
}

const CHUNK = 500;

async function push(uid: string) {
  for (const t of SYNC_TABLES) {
    const dirty = await db.table(t).where('_dirty').equals(1).toArray();
    for (let i = 0; i < dirty.length; i += CHUNK) {
      const part = dirty.slice(i, i + CHUNK);
      const rows = part.map((r) => {
        const { _dirty, ...data } = r;
        void _dirty;
        return { user_id: uid, kind: t, id: r.id, data, updated_at: r.updated_at };
      });
      const { error } = await supabase!.from('records').upsert(rows, { onConflict: 'user_id,kind,id' });
      if (error) throw error;
      // mark clean only if not changed again meanwhile
      await db.transaction('rw', db.table(t), async () => {
        for (const r of part) {
          const cur = await db.table(t).get(r.id);
          if (cur && cur.updated_at === r.updated_at) await db.table(t).update(r.id, { _dirty: 0 });
        }
      });
    }
  }
}

async function pull() {
  let cursor = await getMeta<string>('cursor', '1970-01-01T00:00:00Z');
  for (;;) {
    const { data, error } = await supabase!
      .from('records')
      .select('kind,id,data,updated_at,server_updated_at')
      .gt('server_updated_at', cursor)
      .order('server_updated_at', { ascending: true })
      .limit(1000);
    if (error) throw error;
    if (!data?.length) break;
    const byTable = new Map<string, typeof data>();
    data.forEach((r) => { if (!byTable.has(r.kind)) byTable.set(r.kind, []); byTable.get(r.kind)!.push(r); });
    for (const [kind, rows] of byTable) {
      if (!(SYNC_TABLES as readonly string[]).includes(kind)) continue;
      const t = db.table(kind as SyncTable);
      await db.transaction('rw', t, async () => {
        const locals = await t.bulkGet(rows.map((r) => r.id));
        const put = rows.filter((r, i) => !locals[i] || locals[i].updated_at <= Number(r.updated_at)).map((r) => ({ ...r.data, _dirty: 0 }));
        if (put.length) await t.bulkPut(put);
      });
    }
    cursor = data[data.length - 1].server_updated_at as string;
    await setMeta('cursor', cursor);
    if (data.length < 1000) break;
  }
}

export async function syncNow(): Promise<void> {
  if (!supabase) return refreshStatus();
  if (!session) return refreshStatus();
  if (!navigator.onLine) return refreshStatus();
  if (running) { again = true; return; }
  running = true;
  ui.set({ sync: 'syncing', syncDetail: 'Syncing…' });
  try {
    await push(session.user.id);
    await pull();
    await setMeta('lastSync', Date.now());
    ui.set({ sync: 'synced', syncDetail: `Synced ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` });
  } catch (e) {
    console.error(e);
    ui.set({ sync: navigator.onLine ? 'error' : 'offline', syncDetail: navigator.onLine ? `Sync problem: ${(e as Error).message ?? e}` : 'Offline' });
  } finally {
    running = false;
    if (again) { again = false; scheduleSync(300); }
  }
}

/** Background loop: every 10 s while visible, on focus and when coming back online. */
export function startSyncLoop() {
  refreshStatus();
  if (!supabase) return;
  void syncNow();
  setInterval(() => { if (document.visibilityState === 'visible') void syncNow(); }, 10_000);
  window.addEventListener('online', () => void syncNow());
  window.addEventListener('offline', refreshStatus);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void syncNow(); });
}
