import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, alive, getMeta, type Tag } from '../lib/db';
import { ui, useUI, toast } from '../lib/store';
import { useTagIndex, tagPassage, untag, anchorLabel, anchorKey, saveTag, normCode, useTaggings } from '../lib/annot';
import { Modal } from './ui';
import { Icon } from './Icon';

export function TagChip({ tag, onRemove, onClick, small }: { tag: Tag; onRemove?: () => void; onClick?: () => void; small?: boolean }) {
  return (
    <span className={'tagchip' + (small ? ' small' : '')} style={{ ['--tc' as string]: tag.color }} onClick={onClick} title={tag.desc || tag.name}>
      <i />{tag.name}<code>{tag.code}</code>
      {onRemove && <button aria-label={`Remove ${tag.name}`} onClick={(e) => { e.stopPropagation(); onRemove(); }}>✕</button>}
    </span>
  );
}

export function TagPicker() {
  const anchor = useUI((s) => s.tagFor);
  const idx = useTagIndex();
  const taggings = useTaggings();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const recentIds = useLiveQuery(() => getMeta<string[]>('recentTags', []), [anchor]) ?? [];
  useEffect(() => { setQ(''); setSel(0); }, [anchor]);

  const applied = useMemo(() => (anchor ? taggings.filter((t) => anchorKey(t) === anchorKey(anchor)) : []), [taggings, anchor]);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) {
      const recent = recentIds.map((id) => idx.byId.get(id)).filter(Boolean) as Tag[];
      return [...recent, ...idx.tags.filter((x) => !recentIds.includes(x.id))];
    }
    const exact = idx.byCode.get(normCode(q));
    const rest = idx.tags.filter((x) => x !== exact && (x.name.toLowerCase().includes(t) || x.code.toLowerCase().includes(t) || x.desc.toLowerCase().includes(t)));
    return exact ? [exact, ...rest] : rest;
  }, [q, idx, recentIds]);

  if (!anchor) return null;
  const close = () => ui.set({ tagFor: null });
  const apply = async (tag?: Tag) => {
    if (!tag) return;
    await tagPassage(tag, anchor);
    setQ(''); setSel(0);
  };
  const createNew = async () => {
    const name = q.trim();
    if (!name) return;
    const code = normCode(name.split(/\s+/).map((w) => w.slice(0, name.includes(' ') ? 1 : 3)).join('')) || 'TAG';
    try {
      let c = code, n = 2;
      while ((await db.tags.toArray()).some((x) => alive(x) && x.code === c)) c = `${code}${n++}`;
      const id = await saveTag({ name, code: c, color: '#c8bef0', parent: null, desc: '' });
      const tag = await db.tags.get(id);
      if (tag) await apply(tag);
      toast(`Created tag ${name} (${c}) — edit it in Notes & Tags`, undefined, 3500);
    } catch (e) { toast((e as Error).message); }
  };
  return (
    <Modal onClose={close}>
      <div className="modal" role="dialog" aria-label="Tag passage">
        <div style={{ padding: '14px 16px 0' }}>
          <div className="muted small">Tag {anchorLabel(anchor)}</div>
          <div className="row wrap" style={{ marginTop: 8, gap: 6 }}>
            {applied.map((t) => idx.byId.get(t.tag) && <TagChip key={t.id} tag={idx.byId.get(t.tag)!} onRemove={() => untag(t)} />)}
          </div>
        </div>
        <input className="palette-input" autoFocus placeholder="Type a code (e.g. MAR) and press Enter, or search tags…" value={q}
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, list.length)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            if (e.key === 'Enter') { e.preventDefault(); if (sel < list.length) void apply(list[sel]); else void createNew(); }
          }} />
        <div className="palette-list">
          {list.slice(0, 40).map((t, i) => (
            <button key={t.id} className={'menu-item' + (i === sel ? ' sel' : '')} onMouseEnter={() => setSel(i)} onClick={() => apply(t)}>
              <i className="dot" style={{ background: t.color }} />
              <span>{idx.path(t.id)}</span>
              <span className="hint"><code>{t.code}</code>{applied.some((a) => a.tag === t.id) ? ' ✓' : ''}</span>
            </button>
          ))}
          {q.trim() && !idx.byCode.get(normCode(q)) && (
            <button className={'menu-item' + (sel === list.length ? ' sel' : '')} onClick={createNew}><Icon name="plus" /> Create tag “{q.trim()}”</button>
          )}
        </div>
        <div className="row" style={{ padding: '8px 14px 12px' }}><span className="muted small">Enter applies · keep typing to add more · Esc closes</span><span className="spacer" /><button className="btn small primary" onClick={close}>Done</button></div>
      </div>
    </Modal>
  );
}
