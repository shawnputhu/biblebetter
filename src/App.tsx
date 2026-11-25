import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './lib/db';
import { supabase, setSession, startSyncLoop, syncNow } from './lib/sync';
import { ensureSetup, useDevice, useSettings, useTheme, saveSettings, isTyping, type Device } from './lib/hooks';
import { useLayout, fnDef, FUNCTIONS } from './lib/layout';
import { ui, useUI, setNavListener, navigate } from './lib/store';
import { undoLast } from './lib/write';
import { purgeOldTrash } from './lib/actions';
import { ensureStarterTags } from './lib/annot';
import { runWeeklyBackups } from './lib/backup';
import { Icon } from './components/Icon';
import { Toasts, Palette, CheatSheet, Capture, PanePicker, Placeholder, Walkthrough, SyncBadge, Modal } from './components/ui';
import Bible from './panes/Bible';
import Today, { ReflectModal } from './panes/Today';
import Reading from './panes/Reading';
import Readthroughs from './panes/Readthroughs';
import { Inbox, Trash, SettingsPane } from './panes/System';
import Notes from './panes/Notes';
import Search from './panes/Search';
import { Details, NoteEditor } from './panes/Details';
import { TagPicker } from './components/TagPicker';
import { RefPreview } from './components/RefText';
import { ShareSheet } from './components/Share';
import Plans from './panes/Plans';
import { VoiceOverlay, startVoice } from './components/Voice';
import { PlayerBar } from './components/Player';

const BASE = import.meta.env.BASE_URL;

export default function App() {
  const [phase, setPhase] = useState<'loading' | 'auth' | 'ready'>('loading');
  const [recovering, setRecovering] = useState(false);
  const booted = useRef(false);
  const settings = useSettings();
  useTheme(settings.theme);

  const boot = async () => {
    if (booted.current) return;
    booted.current = true;
    startSyncLoop();
    await Promise.race([syncNow(), new Promise((r) => setTimeout(r, 8000))]);
    await ensureSetup();
    await ensureStarterTags();
    setPhase('ready');
    void purgeOldTrash();
    void runWeeklyBackups();
    setInterval(() => void runWeeklyBackups(), 6 * 3600 * 1000);
  };

  useEffect(() => {
    if (!supabase) { void boot(); return; }
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) void boot(); else setPhase('auth');
    });
    const { data: sub } = supabase.auth.onAuthStateChange((e, s) => {
      setSession(s);
      if (e === 'PASSWORD_RECOVERY') { setRecovering(true); return; }
      if (s) void boot();
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (recovering) return <SetPassword onDone={() => { setRecovering(false); void boot(); }} />;
  if (phase === 'loading') return <div className="auth"><img src={BASE + 'icon-192.png'} alt="" style={{ width: 56, borderRadius: 16 }} /></div>;
  if (phase === 'auth') return <Auth />;
  return <Shell />;
}

function Auth() {
  const [mode, setMode] = useState<'in' | 'up' | 'forgot'>('in');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState<{ text: string; ok?: boolean; resend?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const redirectTo = location.origin + BASE;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    if (mode === 'forgot') {
      const { error } = await supabase!.auth.resetPasswordForEmail(email, { redirectTo });
      setBusy(false);
      return setMsg(error ? { text: error.message } : { ok: true, text: 'Check your email for a reset link. It brings you back here to choose a new password.' });
    }
    const r = mode === 'in'
      ? await supabase!.auth.signInWithPassword({ email, password: pw })
      : await supabase!.auth.signUp({ email, password: pw, options: { emailRedirectTo: redirectTo } });
    setBusy(false);
    if (r.error) {
      const m = r.error.message;
      if (/not confirmed/i.test(m)) return setMsg({ text: 'Your email isn’t confirmed yet. Open the confirmation email, or send it again.', resend: true });
      if (/invalid login/i.test(m)) return setMsg({ text: 'Email or password is incorrect. Use “Forgot password?” to reset it.' });
      if (/already registered/i.test(m)) return setMsg({ text: 'That email already has an account — sign in instead, or reset the password.' });
      return setMsg({ text: m });
    }
    if (mode === 'up' && !r.data.session) setMsg({ ok: true, text: 'Account created. Open the confirmation email, then sign in here.', resend: true });
  };
  const resend = async () => {
    const { error } = await supabase!.auth.resend({ type: 'signup', email, options: { emailRedirectTo: redirectTo } });
    setMsg(error ? { text: error.message } : { ok: true, text: 'Confirmation email sent again.' });
  };
  const title = { in: 'Sign in to sync your devices', up: 'Create your account (first time only)', forgot: 'Reset your password' }[mode];
  return (
    <div className="auth">
      <form className="card stack" onSubmit={submit}>
        <div className="row"><img src={BASE + 'icon-192.png'} alt="" /><div><h2>BibleBetter</h2><div className="muted small">{title}</div></div></div>
        <label className="field">Email<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        {mode !== 'forgot' && <label className="field">Password<input type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} value={pw} onChange={(e) => setPw(e.target.value)} required minLength={8} /></label>}
        {msg && <div className="small" style={{ color: msg.ok ? 'var(--mint-text)' : 'var(--rose-text)' }}>{msg.text}</div>}
        {msg?.resend && <button type="button" className="btn small" onClick={resend} disabled={!email}>Resend confirmation email</button>}
        <button className="btn primary" disabled={busy}>{mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create account' : 'Send reset link'}</button>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button type="button" className="btn ghost small" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setMsg(null); }}>
            {mode === 'in' ? 'Create account' : 'Back to sign in'}
          </button>
          {mode === 'in' && <button type="button" className="btn ghost small" onClick={() => { setMode('forgot'); setMsg(null); }}>Forgot password?</button>}
        </div>
      </form>
    </div>
  );
}

function SetPassword({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase!.auth.updateUser({ password: pw });
    if (error) return setMsg(error.message);
    onDone();
  };
  return (
    <div className="auth">
      <form className="card stack" onSubmit={submit}>
        <h2>Choose a new password</h2>
        <label className="field">New password<input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={8} autoFocus /></label>
        {msg && <div className="small" style={{ color: 'var(--rose-text)' }}>{msg}</div>}
        <button className="btn primary">Save password</button>
      </form>
    </div>
  );
}

type Req = { n: number; params?: Record<string, unknown> };

function Shell() {
  const dev = useDevice();
  const device: Device = dev.device;
  const layout = useLayout(device);
  const focusedSlot = useUI((s) => s.focusedSlot);
  const phoneSlot = useUI((s) => s.phoneSlot);
  const [reqs, setReqs] = useState<{ left?: Req; right?: Req }>({});
  const reqN = useRef(1);
  const dual = dev.dual;
  const settingsRow = useLiveQuery(() => db.settings.get('main'), []);

  // where navigation lands
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  useEffect(() => {
    setNavListener((fn, params) => {
      const L = layoutRef.current;
      const st = ui.get();
      let slot: 'left' | 'right' = dual ? st.focusedSlot : st.phoneSlot;
      if (L.left === fn) slot = 'left';
      else if (L.right === fn) slot = 'right';
      else void L.setPane(slot, fn);
      ui.set(dual ? { focusedSlot: slot } : { phoneSlot: slot });
      setReqs((r) => ({ ...r, [slot]: { n: reqN.current++, params } }));
    });
  }, [dual]);

  // app-icon shortcuts (?open=today) and Android "Share → BibleBetter"
  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    const p = sp.get('open');
    if (p && FUNCTIONS.some((f) => f.key === p)) { navigate(p); history.replaceState(null, '', location.pathname); }
    if (location.pathname.endsWith('/share-target/') || location.pathname.endsWith('/share-target')) {
      ui.set({ share: { title: sp.get('title') ?? '', text: sp.get('text') ?? '', url: sp.get('url') ?? '' } });
      history.replaceState(null, '', BASE);
    }
  }, []);

  // global keyboard shortcuts
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); ui.set({ palette: !ui.get().palette }); return; }
      if (isTyping(e)) return;
      if (mod && e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); void layoutRef.current.undo(); return; }
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); void undoLast(); return; }
      if (mod && e.key === '\\') { e.preventDefault(); void layoutRef.current.swap(); return; }
      if (mod && e.key === '1') { e.preventDefault(); ui.set({ focusedSlot: 'left' }); return; }
      if (mod && e.key === '2') { e.preventDefault(); ui.set({ focusedSlot: 'right' }); return; }
      if (e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); ui.set({ capture: true }); return; }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); navigate('search'); return; }
      if ((e.key === 'v' || e.key === 'V') && !mod && !e.altKey) { e.preventDefault(); startVoice(); return; }
      if (e.key === '?' && !mod) { ui.set({ cheat: true }); }
    };
    window.addEventListener('keydown', f);
    const sw = () => void layoutRef.current.swap();
    document.addEventListener('bb-swap', sw);
    return () => { window.removeEventListener('keydown', f); document.removeEventListener('bb-swap', sw); };
  }, []);

  const signOut = async () => {
    await supabase?.auth.signOut();
    await db.delete();
    location.reload();
  };

  const render = (fn: string, slot: 'left' | 'right'): ReactNode => {
    const req = reqs[slot];
    const focused = dual ? focusedSlot === slot : phoneSlot === slot;
    switch (fn) {
      case 'today': return <div className="pane-body"><Today device={device} /></div>;
      case 'bible': return <Bible device={device} req={req} focused={focused} />;
      case 'readthroughs': return <div className="pane-body"><Readthroughs req={req} /></div>;
      case 'plans': return <div className="pane-body"><Plans device={device} req={req} /></div>;
      case 'notes': return <div className="pane-body"><Notes device={device} req={req} /></div>;
      case 'search': return <div className="pane-body"><Search device={device} req={req} /></div>;
      case 'inbox': return <div className="pane-body"><Inbox /></div>;
      case 'trash': return <div className="pane-body"><Trash /></div>;
      case 'settings': return <div className="pane-body"><SettingsPane onSignOut={signOut} /></div>;
      default: return <div className="pane-body"><Placeholder fn={fn} /></div>;
    }
  };

  const layoutExtra = [
    { id: 'swap', icon: 'swap', label: 'Swap panes', hint: 'Ctrl+\\', run: () => void layout.swap() },
    { id: 'undolayout', icon: 'history', label: 'Undo layout change', hint: 'Ctrl+Shift+Z', run: () => void layout.undo() },
    ...layout.recent.slice(1).map((r) => ({ id: 'pair' + r.id, icon: 'grid', label: `Layout: ${fnDef(r.left).name} + ${fnDef(r.right).name}`, run: () => void layout.set(r.left, r.right) })),
  ];

  const overlays = (
    <>
      <Palette extra={layoutExtra} />
      <CheatSheet />
      <Capture phone={!dual} />
      <ReflectModal />
      <TagPicker />
      <NoteEditor />
      <Details phone={!dual} />
      <RefPreview />
      <ShareSheet phone={!dual} />
      <PlayerBar />
      <VoiceOverlay />
      <Reading />
      <MoreSheet layout={layout} />
      {settingsRow && !settingsRow.walkthroughDone && <Walkthrough onDone={() => saveSettings({ walkthroughDone: true })} />}
      <Toasts />
    </>
  );

  if (dual) return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><img src={BASE + 'icon-192.png'} alt="" />BibleBetter</div>
        <button className="searchbox" onClick={() => ui.set({ palette: true })}><Icon name="search" size={16} /> Jump to a passage or command <span className="spacer" /><kbd>Ctrl K</kbd></button>
        <span className="spacer" />
        <button className="icon-btn" title="Voice command (V)" onClick={() => startVoice()}><Icon name="mic" /></button>
        <button className="icon-btn" title="Quick capture (Alt+N)" onClick={() => ui.set({ capture: true })}><Icon name="plus" /></button>
        <button className="icon-btn" title="Undo layout change (Ctrl+Shift+Z)" onClick={() => void layout.undo()} disabled={!layout.canUndo}><Icon name="history" /></button>
        <RecentPairs layout={layout} />
        <SyncBadge />
 <button className="icon-btn" title="Search everything (Ctrl+Shift+F)" onClick={() => navigate('search')}><Icon name="search" /></button>
        <button className="icon-btn" title="Keyboard shortcuts (?)" onClick={() => ui.set({ cheat: true })}><Icon name="keyboard" /></button>
        <button className="icon-btn" title="Settings" onClick={() => navigate('settings')}><Icon name="gear" /></button>
      </header>
      <DualPanes layout={layout} render={render} focusedSlot={focusedSlot} device={device} />
      {overlays}
    </div>
  );

  // ---------- phone (portrait) ----------
  const visible = phoneSlot === 'left' ? layout.left : layout.right;
  return (
    <div className="app has-bottombar">
      <header className="phone-head" {...edgeSwipe(() => ui.set({ phoneSlot: phoneSlot === 'left' ? 'right' : 'left' }), true)}>
        <div className="seg" role="tablist">
          {(['left', 'right'] as const).map((s) => {
            const d = fnDef(s === 'left' ? layout.left : layout.right);
            return <button key={s} role="tab" aria-selected={phoneSlot === s} className={phoneSlot === s ? 'on' : ''} onClick={() => ui.set({ phoneSlot: s })}><Icon name={d.icon} size={15} />{d.name}</button>;
          })}
        </div>
        <span className="spacer" />
        <SyncBadge />
      </header>
      <main className="phone-pane" {...edgeSwipe(() => ui.set({ phoneSlot: phoneSlot === 'left' ? 'right' : 'left' }), false)}>
        <section className="pane focused">{render(visible, phoneSlot)}</section>
      </main>
      <nav className="bottombar six">
        <button className={visible === 'today' ? 'on' : ''} onClick={() => navigate('today')}><Icon name="sun" size={22} />Today</button>
        <button className={visible === 'bible' ? 'on' : ''} onClick={() => navigate('bible')}><Icon name="book" size={22} />Bible</button>
        <button className="fab" aria-label="Quick capture" onClick={() => ui.set({ capture: true })}><Icon name="plus" size={26} /></button>
        <button onClick={() => startVoice()}><Icon name="mic" size={22} />Voice</button>
        <button className={visible === 'search' ? 'on' : ''} onClick={() => navigate('search')}><Icon name="search" size={22} />Search</button>
        <button onClick={() => ui.set({ more: true })}><Icon name="more" size={22} />More</button>
      </nav>
      {overlays}
    </div>
  );
}

/** Swipe left/right to switch panes on the phone. On content, only from the screen edge (so verse swipes still work). */
function edgeSwipe(onSwipe: () => void, anywhere: boolean) {
  let sx = 0, sy = 0, ok = false;
  return {
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0]; sx = t.clientX; sy = t.clientY;
      ok = anywhere || sx < 28 || sx > window.innerWidth - 28;
    },
    onTouchEnd: (e: React.TouchEvent) => {
      if (!ok) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) onSwipe();
    },
  };
}

type LayoutApi = ReturnType<typeof useLayout>;

function DualPanes({ layout, render, focusedSlot, device }: { layout: LayoutApi; render: (fn: string, slot: 'left' | 'right') => ReactNode; focusedSlot: string; device: Device }) {
  const key = `bb-split-${device}`;
  const [ratio, setRatio] = useState(() => Number(localStorage.getItem(key)) || 0.5);
  const [drag, setDrag] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!drag) return;
    const mv = (e: PointerEvent) => {
      const r = box.current!.getBoundingClientRect();
      setRatio(Math.min(0.8, Math.max(0.2, (e.clientX - r.left) / r.width)));
    };
    const up = () => { setDrag(false); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
  }, [drag]);
  useEffect(() => { if (!drag) localStorage.setItem(key, String(ratio)); }, [drag, ratio, key]);
  const pane = (slot: 'left' | 'right', fn: string, other: string, flex: number) => (
    <section className={'pane' + (focusedSlot === slot ? ' focused' : '')} style={{ flex }} onPointerDownCapture={() => ui.get().focusedSlot !== slot && ui.set({ focusedSlot: slot })}>
      <div className="pane-head">
        <PanePicker current={fn} other={other} onPick={(k) => void layout.setPane(slot, k)} />
        <span className="spacer" />
        <button className="icon-btn" title="Swap panes (Ctrl+\)" onClick={() => void layout.swap()}><Icon name="swap" /></button>
      </div>
      {render(fn, slot)}
    </section>
  );
  return (
    <div className="panes" ref={box} style={drag ? { userSelect: 'none', cursor: 'col-resize' } : undefined}>
      {pane('left', layout.left, layout.right, ratio)}
      <div className={'divider' + (drag ? ' drag' : '')} onPointerDown={(e) => { e.preventDefault(); setDrag(true); }} onDoubleClick={() => setRatio(0.5)} role="separator" aria-orientation="vertical" title="Drag to resize · double-click to reset" />
      {pane('right', layout.right, layout.left, 1 - ratio)}
    </div>
  );
}

function RecentPairs({ layout }: { layout: LayoutApi }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="picker">
      <button className="icon-btn" title="Recent layouts" onClick={() => setOpen(!open)}><Icon name="grid" /></button>
      {open && (
        <div className="menu" style={{ left: 'auto', right: 0 }} onMouseLeave={() => setOpen(false)}>
          <div className="menu-label">Recent layouts</div>
          {layout.recent.map((r, i) => (
            <button key={r.id} className={'menu-item' + (i === 0 ? ' sel' : '')} onClick={() => { void layout.set(r.left, r.right); setOpen(false); }}>
              {fnDef(r.left).name} + {fnDef(r.right).name}<span className="hint">{i === 0 ? 'now' : ''}</span>
            </button>
          ))}
          {!layout.recent.length && <div className="muted small" style={{ padding: 10 }}>No layout changes yet.</div>}
        </div>
      )}
    </div>
  );
}

function MoreSheet({ layout }: { layout: LayoutApi }) {
  const open = useUI((s) => s.more);
  const phoneSlot = useUI((s) => s.phoneSlot);
  if (!open) return null;
  const close = () => ui.set({ more: false });
  const cur = phoneSlot === 'left' ? layout.left : layout.right;
  return (
    <Modal bottom onClose={close}>
      <div className="sheet">
        <div className="menu-label">Show in this pane</div>
        {FUNCTIONS.filter((f) => !f.system || f.key === 'today').map((f) => (
          <button key={f.key} className={'menu-item' + (f.key === cur ? ' sel' : '')} onClick={() => { void layout.setPane(phoneSlot, f.key); close(); }}>
            <Icon name={f.icon} /> {f.name}<span className="hint">{f.phase > 1 ? `Phase ${f.phase}` : ''}</span>
          </button>
        ))}
        <div className="menu-sep" />
        <button className="menu-item" onClick={() => { ui.set({ palette: true }); close(); }}><Icon name="keyboard" /> Commands</button>
        <button className="menu-item" onClick={() => { navigate('inbox'); close(); }}><Icon name="inbox" /> Inbox</button>
        <button className="menu-item" onClick={() => { navigate('trash'); close(); }}><Icon name="trash" /> Trash</button>
        <button className="menu-item" onClick={() => { navigate('settings'); close(); }}><Icon name="gear" /> Settings</button>
        <div className="menu-sep" />
        <div className="menu-label">Layout</div>
        <button className="menu-item" onClick={() => { void layout.swap(); close(); }}><Icon name="swap" /> Swap the two panes</button>
        <button className="menu-item" disabled={!layout.canUndo} onClick={() => { void layout.undo(); close(); }}><Icon name="history" /> Undo layout change</button>
        {layout.recent.slice(1).map((r) => (
          <button key={r.id} className="menu-item" onClick={() => { void layout.set(r.left, r.right); close(); }}><Icon name="grid" /> {fnDef(r.left).name} + {fnDef(r.right).name}</button>
        ))}
        <button className="menu-item" onClick={() => { void undoLast(); close(); }}><Icon name="undo" /> Undo last change</button>
      </div>
    </Modal>
  );
}


