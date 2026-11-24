import { useEffect, useState } from 'react';
import { parseRef, refLabel } from '../lib/ref';
import { ui, useUI, toast } from '../lib/store';
import { addInbox } from '../lib/actions';
import { saveLink, saveNote } from '../lib/annot';
import { mutate } from '../lib/write';
import type { Anchor, InboxItem } from '../lib/db';
import { toRange } from './RefText';
import { Modal } from './ui';
import { Icon } from './Icon';

/** Text box that turns "rom 8:28-30" into a passage. */
export function PassageInput({ onChange, autoFocus }: { onChange: (a: Anchor | null) => void; autoFocus?: boolean }) {
  const [t, setT] = useState('');
  const r = t.trim() ? parseRef(t) : null;
  const range = r ? toRange(r) : null;
  useEffect(() => { onChange(range ? { s: range.s, e: range.e } : null); }, [range?.s, range?.e]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label className="field">Passage
      <input type="text" autoFocus={autoFocus} value={t} onChange={(e) => setT(e.target.value)} placeholder="e.g. Rom 8:28-30 or Ps 23" />
      <span className="small" style={{ color: range ? 'var(--mint-text)' : 'var(--muted)' }}>{range ? `✓ ${refLabel(r!)}` : t.trim() ? 'Type a book and chapter (and verse)' : ' '}</span>
    </label>
  );
}

export function ShareSheet({ phone }: { phone: boolean }) {
  const s = useUI((x) => x.share);
  const [mode, setMode] = useState<'inbox' | 'link' | 'note'>('link');
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const url = s ? (s.url || s.text.match(/https?:\/\/\S+/)?.[0] || '') : '';
  useEffect(() => {
    if (!s) return;
    setTitle(s.title);
    setText([s.title, s.text, s.url].filter(Boolean).join('\n'));
    setMode(url ? 'link' : 'note');
  }, [s]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!s) return null;
  const close = () => ui.set({ share: null });
  const save = async () => {
    if (mode === 'inbox') await addInbox(text);
    else if (!anchor) return toast('Choose a passage first', undefined, 2500);
    else if (mode === 'link') await saveLink({ ...anchor, url, title: title || url, comment: s.text && s.text !== url ? s.text.replace(url, '').trim() : '' });
    else await saveNote({ ...anchor, text });
    close();
  };
  const body = (
    <div className="stack" style={{ padding: phone ? 4 : 18 }}>
      <div className="row"><Icon name="share" /><h3>Save to BibleBetter</h3></div>
      <div className="tabs">
        {url && <button className={mode === 'link' ? 'on' : ''} onClick={() => setMode('link')}>Link on a passage</button>}
        <button className={mode === 'note' ? 'on' : ''} onClick={() => setMode('note')}>Note on a passage</button>
        <button className={mode === 'inbox' ? 'on' : ''} onClick={() => setMode('inbox')}>Inbox</button>
      </div>
      {mode !== 'inbox' && <PassageInput onChange={setAnchor} autoFocus />}
      {mode === 'link' ? (
        <>
          <div className="small muted" style={{ wordBreak: 'break-all' }}>{url}</div>
          <label className="field">Title<input type="text" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        </>
      ) : (
        <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} />
      )}
      <div className="row"><span className="spacer" /><button className="btn" onClick={close}>Cancel</button><button className="btn primary" onClick={save}>Save</button></div>
    </div>
  );
  return <Modal onClose={close} bottom={phone}>{phone ? <div className="sheet">{body}</div> : <div className="modal">{body}</div>}</Modal>;
}

/** Inbox item → note on a passage. */
export function FileInbox({ item, onClose }: { item: InboxItem; onClose: () => void }) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [text, setText] = useState(item.text);
  return (
    <Modal onClose={onClose}>
      <div className="modal stack" style={{ padding: 18 }}>
        <h3>File as a note</h3>
        <PassageInput onChange={setAnchor} autoFocus />
        <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="row"><span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!anchor} onClick={async () => {
            await saveNote({ ...anchor!, text });
            await mutate(null, (w) => w.purge('inbox_items', item.id));
            toast('Filed as a note');
            onClose();
          }}>File note</button></div>
      </div>
    </Modal>
  );
}
