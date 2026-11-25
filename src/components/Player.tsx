import { useEffect, useState } from 'react';
import { useUI, ui, navigate } from '../lib/store';
import { useSettings, saveSettings } from '../lib/hooks';
import * as tts from '../lib/tts';
import { verseRef, vBook, vChap, vVerse } from '../lib/ref';
import { Icon } from './Icon';

/** Floating read-aloud controls; stays visible while you move around the app. */
export function PlayerBar() {
  const p = useUI((s) => s.player);
  const s = useSettings();
  const [vs, setVs] = useState<SpeechSynthesisVoice[]>([]);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const f = () => setVs(tts.voices());
    f();
    if (tts.ttsSupported()) speechSynthesis.addEventListener('voiceschanged', f);
    return () => { if (tts.ttsSupported()) speechSynthesis.removeEventListener('voiceschanged', f); };
  }, []);
  if (!p) return null;
  const v = p.verses[p.idx];
  const total = p.verses.length || p.texts.length;
  return (
    <div className="player" role="region" aria-label="Read aloud">
      <div className="row" style={{ gap: 4 }}>
        <Icon name="volume" size={16} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="small" style={{ fontWeight: 650, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v ? verseRef(v) : p.label}</div>
          <div className="muted" style={{ fontSize: 11 }}>{p.label} · {p.idx + 1}/{total}{s.autoCheckListening && p.verses.length ? ' · auto-check on' : ''}</div>
        </div>
        <button className="icon-btn" title="Previous" onClick={() => tts.step(-1)}><Icon name="skipb" /></button>
        <button className="icon-btn active" title={p.playing ? 'Pause' : 'Play'} onClick={() => tts.toggle()}><Icon name={p.playing ? 'pause' : 'play'} /></button>
        <button className="icon-btn" title="Next" onClick={() => tts.step(1)}><Icon name="skipf" /></button>
        <button className="icon-btn" title="Repeat verse" onClick={() => tts.repeat()}><Icon name="undo" /></button>
        <button className="btn small ghost" title="Speed" onClick={() => setMore(!more)}>{(s.ttsRate ?? 1).toFixed(2).replace(/0$/, '')}×</button>
        <button className="icon-btn" title="Stop" onClick={() => tts.stop()}><Icon name="x" /></button>
      </div>
      {!p.follow && v && (
        <button className="btn small primary" style={{ marginTop: 6 }} onClick={() => { ui.set({ player: { ...p, follow: true } }); navigate('bible', { book: vBook(v), chapter: vChap(v), verse: vVerse(v), follow: true }); }}>Back to reading</button>
      )}
      {more && (
        <div className="stack" style={{ gap: 8, marginTop: 8 }}>
          <label className="row small">Speed <input type="range" min={0.5} max={2} step={0.05} value={s.ttsRate ?? 1} onChange={(e) => void tts.setRate(Number(e.target.value))} style={{ flex: 1 }} /></label>
          <label className="row small">Voice <select value={s.ttsVoice ?? ''} onChange={(e) => void saveSettings({ ttsVoice: e.target.value })} style={{ flex: 1, minHeight: 30 }}>
            <option value="">Default</option>{vs.map((x) => <option key={x.voiceURI} value={x.voiceURI}>{x.name}</option>)}</select></label>
          <label className="row small"><input type="checkbox" checked={!!s.autoCheckListening} onChange={(e) => void saveSettings({ autoCheckListening: e.target.checked })} /> Check verses as they’re read</label>
          <label className="row small"><input type="checkbox" checked={s.continueChapters !== false} onChange={(e) => void saveSettings({ continueChapters: e.target.checked })} /> Continue into the next chapter</label>
          <label className="row small"><input type="checkbox" checked={s.keepScreenOn !== false} onChange={(e) => void saveSettings({ keepScreenOn: e.target.checked })} /> Keep the screen on while reading</label>
        </div>
      )}
    </div>
  );
}
