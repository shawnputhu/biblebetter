import Dexie, { type Table } from 'dexie';

/** Fields every synced record carries. */
export interface Base {
  id: string;
  updated_at: number; // ms, set on every local change
  deleted_at?: number | null; // in Trash when set (and not purged)
  purged?: boolean; // gone for good (tombstone kept for sync)
  _dirty?: 0 | 1; // local only: needs pushing
}

export type Theme = 'light' | 'dark' | 'system';

export interface Settings extends Base {
  theme: Theme;
  linkVersion: string;
  morningStart: string; // "05:00"
  eveningStart: string; // "17:00"
  modeOverride?: { date: string; mode: 'morning' | 'evening' } | null;
  readFont: 'serif' | 'sans';
  readSize: number;
  readLine: number;
  compact: boolean;
  activeRt?: string;
  walkthroughDone?: boolean;
}

export interface Readthrough extends Base { name: string; start: string; finish?: string | null; created_at: number }
export interface VerseRead extends Base { rt: string; verse: number; checked: boolean; at: number } // id = rt|verse
export interface Reflection extends Base { rt: string; date: string; chapters: string[]; text: string } // id = rt|date
export interface Highlight extends Base { verse: number; color: string } // id = verse
export interface LayoutEntry extends Base { device: 'pc' | 'phone'; left: string; right: string; at: number }
export interface PaneState extends Base { state: Record<string, unknown> } // id = device:fn
export interface RecentItem extends Base { label: string; fn: string; params: Record<string, unknown>; at: number }
export interface InboxItem extends Base { text: string; created_at: number }
export interface Meta { key: string; value: unknown }

export const SYNC_TABLES = ['settings', 'readthroughs', 'verse_reads', 'reflections', 'highlights', 'layout_history', 'pane_state', 'recent_items', 'inbox_items'] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];
export const TRASH_TABLES: SyncTable[] = ['readthroughs', 'reflections', 'highlights', 'inbox_items'];

class BBDB extends Dexie {
  settings!: Table<Settings, string>;
  readthroughs!: Table<Readthrough, string>;
  verse_reads!: Table<VerseRead, string>;
  reflections!: Table<Reflection, string>;
  highlights!: Table<Highlight, string>;
  layout_history!: Table<LayoutEntry, string>;
  pane_state!: Table<PaneState, string>;
  recent_items!: Table<RecentItem, string>;
  inbox_items!: Table<InboxItem, string>;
  meta!: Table<Meta, string>;
  constructor() {
    super('biblebetter');
    this.version(1).stores({
      settings: 'id, _dirty',
      readthroughs: 'id, _dirty',
      verse_reads: 'id, rt, verse, at, _dirty',
      reflections: 'id, rt, date, _dirty',
      highlights: 'id, verse, _dirty',
      layout_history: 'id, device, at, _dirty',
      pane_state: 'id, _dirty',
      recent_items: 'id, at, _dirty',
      inbox_items: 'id, created_at, _dirty',
      meta: 'key',
    });
  }
}

export const db = new BBDB();

export const alive = <T extends Base>(r: T | undefined | null): r is T => !!r && !r.deleted_at && !r.purged;

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const r = await db.meta.get(key);
  return (r?.value as T) ?? fallback;
}
export const setMeta = (key: string, value: unknown) => db.meta.put({ key, value });

export const DEFAULT_SETTINGS: Omit<Settings, 'updated_at'> = {
  id: 'main',
  theme: 'system',
  linkVersion: 'ESV',
  morningStart: '04:00',
  eveningStart: '17:00',
  modeOverride: null,
  readFont: 'serif',
  readSize: 19,
  readLine: 1.75,
  compact: true,
  walkthroughDone: false,
};

export const todayStr = (d = new Date()) => {
  const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
};
export const dateOf = (ms: number) => todayStr(new Date(ms));
