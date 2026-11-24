import { useSyncExternalStore } from 'react';

/** Minimal global UI store (not persisted). */
export type SyncStatus = 'local' | 'signed-out' | 'syncing' | 'synced' | 'offline' | 'error';

export interface Toast { id: number; text: string; undo?: () => void }

export interface UIState {
  toasts: Toast[];
  palette: boolean;
  cheat: boolean;
  capture: boolean;
  more: boolean;
  focusedSlot: 'left' | 'right';
  phoneSlot: 'left' | 'right';
  sync: SyncStatus;
  syncDetail: string;
  reading: { book: number; chapter: number } | null;
  reflectFor: { chapter?: string } | null;
}

let state: UIState = {
  toasts: [],
  palette: false,
  cheat: false,
  capture: false,
  more: false,
  focusedSlot: 'left',
  phoneSlot: 'left',
  sync: 'local',
  syncDetail: '',
  reading: null,
  reflectFor: null,
};
const subs = new Set<() => void>();

export const ui = {
  get: () => state,
  set(patch: Partial<UIState>) {
    state = { ...state, ...patch };
    subs.forEach((f) => f());
  },
  subscribe(f: () => void) {
    subs.add(f);
    return () => subs.delete(f);
  },
};

export function useUI<T>(sel: (s: UIState) => T): T {
  return useSyncExternalStore(ui.subscribe, () => sel(state));
}

let tid = 1;
export function toast(text: string, undo?: () => void, ms = 5000) {
  const id = tid++;
  ui.set({ toasts: [{ id, text, undo }] }); // one at a time; Ctrl+Z still undoes earlier changes
  setTimeout(() => ui.set({ toasts: state.toasts.filter((t) => t.id !== id) }), ms);
}
export const dismissToast = (id: number) => ui.set({ toasts: state.toasts.filter((t) => t.id !== id) });

/** Navigation requests: a pane function + params, opened in the focused pane. */
type NavListener = (fn: string, params?: Record<string, unknown>) => void;
let navListener: NavListener | null = null;
export const setNavListener = (f: NavListener) => { navListener = f; };
export const navigate = (fn: string, params?: Record<string, unknown>) => navListener?.(fn, params);
