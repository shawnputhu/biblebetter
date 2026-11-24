import { db, SYNC_TABLES, type Base, type SyncTable } from './db';
import { toast, ui } from './store';
import { scheduleSync } from './sync';

type Row = Base & Record<string, unknown>;
interface Before { table: SyncTable; id: string; row: Row | undefined }

const undoStack: { label: string; before: Before[] }[] = [];

const tbl = (t: SyncTable) => db.table<Row, string>(t);

/** A writer that records what each row looked like before it was changed, so the change can be undone. */
class Writer {
  before = new Map<string, Before>();
  private async remember(table: SyncTable, ids: string[]) {
    const need = ids.filter((id) => !this.before.has(table + '|' + id));
    if (!need.length) return;
    const rows = await tbl(table).bulkGet(need);
    need.forEach((id, i) => this.before.set(table + '|' + id, { table, id, row: rows[i] ? { ...rows[i]! } : undefined }));
  }
  async put<T extends Base>(table: SyncTable, row: Omit<T, 'updated_at'> & { updated_at?: number }) {
    await this.putMany(table, [row]);
  }
  async putMany<T extends Base>(table: SyncTable, rows: (Omit<T, 'updated_at'> & { updated_at?: number })[]) {
    if (!rows.length) return;
    await this.remember(table, rows.map((r) => r.id));
    const now = Date.now();
    await tbl(table).bulkPut(rows.map((r) => ({ ...(r as Row), updated_at: now, _dirty: 1 as const })));
  }
  async patch(table: SyncTable, id: string, patch: Record<string, unknown>) {
    await this.remember(table, [id]);
    const cur = await tbl(table).get(id);
    if (!cur) return;
    await tbl(table).put({ ...cur, ...patch, updated_at: Date.now(), _dirty: 1 });
  }
  /** Move to Trash (restorable for 30 days). */
  trash(table: SyncTable, id: string) { return this.patch(table, id, { deleted_at: Date.now() }); }
  restore(table: SyncTable, id: string) { return this.patch(table, id, { deleted_at: null }); }
  /** Gone for good (a tombstone is kept so other devices learn about it). */
  purge(table: SyncTable, id: string) { return this.patch(table, id, { purged: true, deleted_at: Date.now() }); }
}

/**
 * Run a change. With a label it can be undone (toast with Undo + Ctrl+Z).
 */
export async function mutate(label: string | null, fn: (w: Writer) => Promise<void>, opts: { silent?: boolean } = {}) {
  const w = new Writer();
  // No wrapping transaction: Dexie transactions can't span nested async calls. Each write is atomic on its own.
  await fn(w);
  scheduleSync();
  if (label) {
    const entry = { label, before: [...w.before.values()] };
    undoStack.push(entry);
    if (undoStack.length > 50) undoStack.shift();
    if (!opts.silent) toast(label, () => undoEntry(entry));
  }
}

async function undoEntry(entry: { label: string; before: Before[] }) {
  const i = undoStack.indexOf(entry);
  if (i >= 0) undoStack.splice(i, 1);
  const now = Date.now();
  await db.transaction('rw', [...SYNC_TABLES], async () => {
    for (const b of entry.before) {
      if (b.row) await tbl(b.table).put({ ...b.row, updated_at: now, _dirty: 1 });
      else {
        const cur = await tbl(b.table).get(b.id);
        if (cur) await tbl(b.table).put({ ...cur, purged: true, deleted_at: now, updated_at: now, _dirty: 1 });
      }
    }
  });
  scheduleSync();
  ui.set({ toasts: [] });
  toast(`Undone: ${entry.label}`, undefined, 2500);
}

export async function undoLast() {
  const e = undoStack[undoStack.length - 1];
  if (e) await undoEntry(e);
  else toast('Nothing to undo', undefined, 2000);
}
