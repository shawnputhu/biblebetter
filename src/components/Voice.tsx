import { useEffect, useRef, useState } from 'react';
import { listen, punctuate, voiceSupported, type Listener } from '../lib/voice';
import { runCommand, HELP } from '../lib/commands';
import { ui, useUI, toast } from '../lib/store';
import { db } from '../lib/db';
import * as tts from '../lib/tts';
import { Icon } from './Icon';

/** Mic for a text box: dictation with spoken punctuation. "save"/"cancel" on their own become commands. */
export function MicButton({ onText, onCommand, label = 'Dictate', autoStart }: { onText: (t: string) => void; onCommand?: (c: 'save' | 'cancel') => void; label?: string; autoStart?: boolean }) {
  const [on, setOn] = useState(false);
  const [interim, setInterim] = useState('');
  const l = useRef<Listener | null>(null);
  const start = () => {
    if (!voiceSupported()) { toast('Voice input needs Chrome or Edge.'); return; }
    tts.duck();
    setOn(true);
    l.current = listen({
      continuous: true,
      onInterim: setInterim,
      onFinal: (t) => {
        const c = t.toLowerCase().replace(/[.!]$/, '').trim();
        if (onCommand && /^(save( it| note| that)?|done,? save)$/.test(c)) { stop(); onCommand('save'); return; }
        if (onCommand && /^(cancel|never mind|discard)$/.test(c)) { stop(); onCommand('cancel'); return; }
        if (/^(done|stop listening|that'?s all)$/.test(c)) { stop(); return; }
        onText(punctuate(t));
      },
      onEnd: () => { setOn(false); setInterim(''); tts.unduck(); },
      onError: (m) => toast(m),
    });
  };
  const stop = () => { l.current?.stop(); l.current = null; setOn(false); setInterim(''); };
  useEffect(() => { if (autoStart) start(); return () => l.current?.stop(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <span className="mic-wrap">
      <button type="button" className={'icon-btn mic' + (on ? ' on' : '')} title={on ? 'Stop listening' : `${label} (speak; say “comma”, “period”, “new line”)`} aria-pressed={on} onClick={() => (on ? stop() : start())}>
        <Icon name="mic" />
      </button>
      {on && <span className="mic-interim small muted">{interim || 'Listening…'}</span>}
    </span>
  );
}

let active: Listener | null = null;
/** Main voice command: listen once, run the command, repeat in hands-free mode. */
export function startVoice() {
  if (!voiceSupported()) { toast('Voice commands need Chrome or Edge.'); return; }
  if (active) { active.stop(); return; }
  tts.duck();
  ui.set({ voice: { listening: true, interim: '', heard: '', reply: '', choices: ui.get().voice?.choices ?? [] } });
  let got = false;
  active = listen({
    onInterim: (t) => { const v = ui.get().voice; if (v) ui.set({ voice: { ...v, interim: t } }); },
    onFinal: (t) => {
      got = true;
      void (async () => {
        await runCommand(t);
        const s = await db.settings.get('main');
        if (s?.handsFree && !ui.get().player?.playing && !ui.get().noteFor) setTimeout(startVoice, 400);
        else if (!ui.get().voice?.choices.length) tts.unduck();
      })();
    },
    onEnd: () => {
      active = null;
      const v = ui.get().voice;
      if (!got && v?.listening) ui.set({ voice: v.choices.length ? { ...v, listening: false } : null });
      if (!got) tts.unduck();
    },
    onError: (m) => { ui.set({ voice: { listening: false, interim: '', heard: '', reply: m, choices: [] } }); setTimeout(() => ui.set({ voice: null }), 3500); },
  });
}

/** Floating panel: listening / what was heard / reply / choices / help. */
export function VoiceOverlay() {
  const v = useUI((s) => s.voice);
  if (!v) return null;
  const close = () => { active?.stop(); ui.set({ voice: null }); tts.unduck(); };
  return (
    <div className="voice-panel" role="status" aria-live="polite">
      <div className="row">
        <span className={'voice-dot' + (v.listening ? ' on' : '')}><Icon name="mic" size={16} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          {v.listening && <div>{v.interim || 'Listening…'}</div>}
          {!v.listening && v.heard && <div className="small muted">Heard: “{v.heard}”</div>}
          {v.reply && v.reply !== 'help' && <div>{v.reply}</div>}
        </div>
        <button className="icon-btn" onClick={close} aria-label="Close"><Icon name="x" /></button>
      </div>
      {v.choices.length > 0 && (
        <div className="stack" style={{ gap: 6, marginTop: 8 }}>
          {v.choices.map((c, i) => <button key={i} className="btn small" style={{ justifyContent: 'flex-start' }} onClick={() => { ui.set({ voice: null }); c.run(); }}>{i + 1}. {c.label}</button>)}
          <div className="muted small">Tap one, or say “the first one”.</div>
        </div>
      )}
      {v.reply === 'help' && (
        <div className="voice-help small">{HELP.map(([say, what]) => <div key={what}><b>{what}</b><div className="muted">{say}</div></div>)}</div>
      )}
    </div>
  );
}
