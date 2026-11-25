import { supabase, getSession } from './sync';
import { SUPABASE_URL } from '../config';
import type { Settings } from './db';

export const FN_URL = `${SUPABASE_URL}/functions/v1/reminders`;
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function b64ToBytes(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function currentSub() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/** Ask permission, subscribe this device, and store the subscription + reminder times in Supabase. */
export async function enablePush(prefs: NonNullable<Settings['reminders']>) {
  if (!supabase || !getSession()) throw new Error('Sign in first.');
  if (!pushSupported()) throw new Error('This browser can’t show notifications.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications are blocked. Allow them in the browser’s site settings.');
  const r = await fetch(`${FN_URL}?vapid=1`);
  if (!r.ok) throw new Error('The reminders function isn’t set up in Supabase yet (see the setup steps).');
  const { key } = await r.json();
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
  await savePrefs(prefs, sub);
}

export async function savePrefs(prefs: NonNullable<Settings['reminders']>, sub?: PushSubscription | null) {
  if (!supabase || !getSession()) return;
  sub ??= await currentSub();
  if (!sub) return;
  const { error } = await supabase.from('push_subs').upsert({
    endpoint: sub.endpoint, sub: sub.toJSON(), prefs, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, user_id: getSession()!.user.id,
  }, { onConflict: 'endpoint' });
  if (error) throw error;
}

export async function disablePush() {
  const sub = await currentSub();
  if (!sub) return;
  if (supabase) await supabase.from('push_subs').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}

export async function testPush() {
  const sub = await currentSub();
  if (!sub) throw new Error('Notifications aren’t turned on for this device.');
  const r = await fetch(FN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ test: true, endpoint: sub.endpoint }) });
  if (!r.ok) throw new Error(`Test failed (${r.status}).`);
}
