import { useLiveQuery } from 'dexie-react-hooks';
import { db, alive, uid, type LayoutEntry, type PaneState, type RecentItem } from './db';
import { mutate } from './write';
import type { Device } from './hooks';
import { toast } from './store';
import { scheduleSync } from './sync';

export interface FnDef { key: string; name: string; phase: number; icon: string; system?: boolean }
export const FUNCTIONS: FnDef[] = [
  { key: 'today', name: 'Today', phase: 1, icon: 'sun', system: true },
  { key: 'bible', name: 'Bible', phase: 1, icon: 'book' },
  { key: 'readthroughs', name: 'Read-throughs', phase: 1, icon: 'layers' },
  { key: 'notes', name: 'Notes & Tags', phase: 1, icon: 'tag' },
  { key: 'plans', name: 'Plans & Calendar', phase: 1, icon: 'calendar' },
  { key: 'prayer', name: 'Prayer & People', phase: 4, icon: 'heart' },
  { key: 'idealme', name: 'Ideal Me', phase: 5, icon: 'star' },
  { key: 'stats', name: 'Statistics', phase: 6, icon: 'chart' },
  { key: 'study', name: 'Study', phase: 7, icon: 'pen' },
  { key: 'research', name: 'Research', phase: 8, icon: 'search' },
  { key: 'search', name: 'Search', phase: 1, icon: 'search', system: true },
  { key: 'inbox', name: 'Inbox', phase: 1, icon: 'inbox', system: true },
  { key: 'trash', name: 'Trash', phase: 1, icon: 'trash', system: true },
  { key: 'settings', name: 'Settings', phase: 1, icon: 'gear', system: true },
];
export const fnDef = (k: string) => FUNCTIONS.find((f) => f.key === k) ?? FUNCTIONS[0];

const DEFAULTS: Record<Device, { left: string; right: string }> = {
  pc: { left: 'today', right: 'bible' },
  phone: { left: 'today', right: 'bible' },
};

export function useLayoutHistory(device: Device): LayoutEntry[] {
  return (
    useLiveQuery(async () => (await db.layout_history.where('device').equals(device).toArray()).filter(alive).sort((a, b) => b.at - a.at), [device]) ?? []
  );
}

export function useLayout(device: Device) {
  const hist = useLayoutHistory(device);
  const cur = hist[0] ?? { ...DEFAULTS[device] };
  const set = async (left: string, right: string) => {
    if (left === cur.left && right === cur.right) return;
    await mutate(null, (w) => w.put<LayoutEntry>('layout_history', { id: uid(), device, left, right, at: Date.now() }));
  };
  const setPane = (slot: 'left' | 'right', fn: string) => {
    const other = slot === 'left' ? cur.right : cur.left;
    if (fn === other) return set(cur.right, cur.left); // picking the other pane's function swaps them
    return slot === 'left' ? set(fn, cur.right) : set(cur.left, fn);
  };
  const swap = () => set(cur.right, cur.left);
  const undo = async () => {
    if (!hist[0]) return toast('No earlier layout', undefined, 2000);
    await mutate(null, (w) => w.purge('layout_history', hist[0].id));
    toast('Layout restored', undefined, 2000);
  };
  const seen = new Set<string>();
  const recent = hist.filter((h) => { const k = h.left + '|' + h.right; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 6);
  return { left: cur.left, right: cur.right, setPane, swap, undo, set, recent, canUndo: hist.length > 0 };
}

// ---------- per-function resume state ----------
const pending = new Map<string, ReturnType<typeof setTimeout>>();
export function usePaneState<T extends Record<string, unknown>>(device: Device, fn: string, initial: T): [T, (p: Partial<T>) => void] {
  const id = `${device}:${fn}`;
  const row = useLiveQuery(() => db.pane_state.get(id), [id]);
  const state = { ...initial, ...((row?.state as T) ?? {}) } as T;
  const update = (p: Partial<T>) => {
    const next = { ...state, ...p };
    // write locally at once (instant UI), sync debounced
    void db.pane_state.put({ id, state: next, updated_at: Date.now(), _dirty: 1 } as PaneState);
    clearTimeout(pending.get(id));
    pending.set(id, setTimeout(() => scheduleSync(), 1500));
  };
  return [state, update];
}

export async function addRecent(label: string, fn: string, params: Record<string, unknown>) {
  const id = `${fn}:${JSON.stringify(params)}`;
  await db.recent_items.put({ id, label, fn, params, at: Date.now(), updated_at: Date.now(), _dirty: 1 } as RecentItem);
  scheduleSync(3000);
}
export function useRecent(n = 8): RecentItem[] {
  return useLiveQuery(async () => (await db.recent_items.orderBy('at').reverse().limit(30).toArray()).filter(alive).slice(0, n), [n]) ?? [];
}
