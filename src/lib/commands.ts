import { BOOKS } from '../data/books';
import { db, alive, todayStr, type Settings, DEFAULT_SETTINGS, type Anchor, type Tag } from './db';
import { parseRef, refLabel, vid, vBook, vChap, vVerse, chapterVerseIds, formatVerses, verseRef, TOTAL_VERSES } from './ref';
import { ui, navigate, toast } from './store';
import { undoLast } from './write';
import { setChecked, setHighlight, addInbox } from './actions';
import { tagPassage, anchorLabel, anchorOf, normCode, anchorText } from './annot';
import { createPlan, parsePassage, addDays, planProgress, dayLabel, rangeVerses } from './plans';
import { loadKjv } from './hooks';
import * as tts from './tts';
import { wordsToNumbers } from './voice';
import { FUNCTIONS } from './layout';

// ---------------- replies ----------------
async function settings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, updated_at: 0, ...((await db.settings.get('main')) ?? {}) } as Settings;
}
/** Show (and, per the setting, speak) a reply. brief = short spoken form, full = complete form. */
export async function reply(full: string, brief?: string, opts: { undo?: boolean } = {}) {
  const s = await settings();
  const v = ui.get().voice;
  ui.set({ voice: { listening: false, interim: '', heard: v?.heard ?? '', reply: full, choices: [] } });
  if (opts.undo) toast(full, () => void undoLast(), 8000);
  const mode = s.handsFree ? 'full' : s.voiceReplies ?? 'brief';
  if (mode === 'full') await tts.say(full);
  else if (mode === 'brief' && brief !== '') await tts.say(brief ?? full);
  setTimeout(() => { if (ui.get().voice?.reply === full && !ui.get().voice?.listening) ui.set({ voice: null }); }, 4500);
}
function choose(question: string, choices: { label: string; run: () => void }[]) {
  const v = ui.get().voice;
  ui.set({ voice: { listening: false, interim: '', heard: v?.heard ?? '', reply: question, choices } });
  void settings().then((s) => { if ((s.voiceReplies ?? 'brief') !== 'off' || s.handsFree) void tts.say(question); });
}
export const pendingChoices = () => ui.get().voice?.choices ?? [];

// ---------------- parsing helpers ----------------
const COLORS: Record<string, string> = { yellow: 'butter', gold: 'butter', green: 'mint', mint: 'mint', blue: 'sky', purple: 'lavender', lavender: 'lavender', violet: 'lavender', orange: 'peach', peach: 'peach', pink: 'rose', red: 'rose', rose: 'rose' };

function lev(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** Turn speech like "romans chapter 8 verse 28 to 30" or "first corinthians 13" into a passage. */
export function speechRef(raw: string): { s: number; e: number; label: string; book: number; chapter?: number } | null {
  let t = wordsToNumbers(raw.toLowerCase())
    .replace(/\b(first|1st)\b\s+(?=[a-z])/g, '1 ').replace(/\b(second|2nd)\b\s+(?=[a-z])/g, '2 ').replace(/\b(third|3rd)\b\s+(?=[a-z])/g, '3 ')
    .replace(/\bthe book of\b/g, '').replace(/\bchapter\b/g, ' ').replace(/\b(verses?|v\.)\b/g, ':').replace(/\b(to|through|thru)\b/g, '-')
    .replace(/\s+/g, ' ').trim();
  t = t.replace(/(\d+)\s*:?\s*:\s*(\d+)/g, '$1:$2').replace(/(\d+)\s+(\d+)/g, '$1:$2').replace(/:\s*-/g, '-').replace(/\s*-\s*/g, '-');
  let r = parseRef(t);
  if (!r) {
    // fuzzy book name: "habakuk 2", "phillipians 4"
    const m = t.match(/^([1-3]?\s?[a-z ]+?)\s*(\d.*)?$/);
    if (m) {
      const name = m[1].trim();
      let best = -1, bd = 99;
      BOOKS.forEach((b, i) => { const dd = lev(name, b.name.toLowerCase()); if (dd < bd) { bd = dd; best = i; } });
      if (best >= 0 && bd <= Math.max(2, Math.floor(name.length / 4))) r = parseRef(`${BOOKS[best].name} ${m[2] ?? ''}`.trim());
    }
  }
  if (!r) return null;
  if (!r.chapter) return { s: vid(r.book, 1, 1), e: vid(r.book, 1, BOOKS[r.book - 1].v[0]), label: BOOKS[r.book - 1].name, book: r.book };
  const ids = chapterVerseIds(r.book, r.chapter);
  const s = r.verse ? vid(r.book, r.chapter, r.verse) : ids[0];
  const e = r.verse ? vid(r.book, r.chapter, r.verseEnd ?? r.verse) : ids[ids.length - 1];
  return { s, e, label: refLabel(r), book: r.book, chapter: r.chapter };
}

/** "this" = selected verses, else the verse being read aloud, else the open chapter. */
function context(): { anchor: Anchor; label: string; verses: number[] } | null {
  const sel = ui.get().bibleSel;
  if (sel.length) { const a = anchorOf(sel); return { anchor: a, label: anchorLabel(a), verses: [...sel].sort((x, y) => x - y) }; }
  const cur = tts.currentVerse();
  if (cur) return { anchor: { s: cur, e: cur }, label: verseRef(cur), verses: [cur] };
  const at = ui.get().bibleAt;
  if (at) { const ids = chapterVerseIds(at.book, at.chapter); return { anchor: { s: ids[0], e: ids[ids.length - 1] }, label: `${BOOKS[at.book - 1].name} ${at.chapter}`, verses: ids }; }
  return null;
}
/** "verses 28 to 30" relative to the open chapter. */
function versesInChapter(t: string): number[] | null {
  const at = ui.get().bibleAt;
  const m = wordsToNumbers(t).match(/^(?:verses?\s*)?(\d+)(?:\s*(?:-|to|through|thru|and)\s*(\d+))?$/);
  if (!m || !at) return null;
  const n = BOOKS[at.book - 1].v[at.chapter - 1];
  const a = Math.min(+m[1], n), b = Math.min(+(m[2] ?? m[1]), n);
  return Array.from({ length: Math.abs(b - a) + 1 }, (_, i) => vid(at.book, at.chapter, Math.min(a, b) + i));
}
function anchorFrom(target: string): { anchor: Anchor; label: string; verses: number[] } | null {
  const t = target.trim();
  if (!t || /^(this|it|that|these|them|here)$/.test(t)) return context();
  const inCh = versesInChapter(t);
  if (inCh) { const a = anchorOf(inCh); return { anchor: a, label: anchorLabel(a), verses: inCh }; }
  const r = speechRef(t);
  if (r) { const a = { s: r.s, e: r.e }; return { anchor: a, label: r.label, verses: rangeVerses([r.s, r.e]) }; }
  return null;
}

async function matchTags(spoken: string): Promise<{ found: Tag[]; unsure: { word: string; options: Tag[] }[]; missing: string[] }> {
  const tags = (await db.tags.toArray()).filter(alive);
  const found: Tag[] = [], unsure: { word: string; options: Tag[] }[] = [], missing: string[] = [];
  for (const raw of spoken.split(/\s*(?:,|\band\b|\balso\b|&)\s*/).map((x) => x.trim()).filter(Boolean)) {
    const w = raw.replace(/^(the|a|an)\s+/, '').replace(/\s+tag$/, '');
    const spelled = /^([a-z]\s+)+[a-z]$/.test(w) ? w.replace(/\s+/g, '') : null; // "s a l" -> sal
    const code = normCode(spelled ?? w.replace(/\s+dot\s+/g, '.'));
    const byCode = tags.find((x) => x.code.toUpperCase() === code);
    if (byCode) { found.push(byCode); continue; }
    const lw = w.toLowerCase();
    const exact = tags.filter((x) => x.name.toLowerCase() === lw);
    if (exact.length === 1) { found.push(exact[0]); continue; }
    const scored = tags.map((x) => ({ x, d: x.name.toLowerCase().startsWith(lw) ? 0 : x.name.toLowerCase().includes(lw) ? 1 : lev(lw, x.name.toLowerCase()) })).sort((a, b) => a.d - b.d);
    const good = scored.filter((s) => s.d <= Math.max(1, Math.floor(lw.length / 4)));
    if (good.length === 1 || (good.length > 1 && good[0].d < good[1].d)) found.push(good[0].x);
    else if (good.length > 1) unsure.push({ word: w, options: good.slice(0, 3).map((g) => g.x) });
    else missing.push(w);
  }
  return { found, unsure, missing };
}

export function briefingText(): Promise<string[]> {
  return (async () => {
    const s = await settings();
    const out: string[] = [];
    const h = new Date().getHours();
    out.push(`${h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'}. Today is ${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}.`);
    const rts = (await db.readthroughs.toArray()).filter(alive);
    const rt = rts.find((r) => r.id === s.activeRt) ?? rts[rts.length - 1];
    if (rt) {
      const reads = (await db.verse_reads.where('rt').equals(rt.id).toArray()).filter((r) => r.checked && alive(r));
      out.push(`In ${rt.name} you have read ${((reads.length / TOTAL_VERSES) * 100).toFixed(1)} percent of the Bible.`);
      const y = addDays(todayStr(), -1);
      const yc = reads.filter((r) => new Date(r.at).toISOString() && todayStr(new Date(r.at)) === y).length;
      if (yc) out.push(`Yesterday you read ${yc} verses.`);
    }
    const plans = (await db.plans.toArray()).filter((p) => alive(p) && p.status === 'active');
    for (const p of plans) {
      const reads = new Map((await db.verse_reads.where('rt').equals(p.rt).toArray()).filter((r) => r.checked && alive(r)).map((r) => [r.verse, r]));
      const pr = planProgress(p, reads);
      if (pr.today?.ranges.length) out.push(`Today's reading for ${p.name}: ${dayLabel(pr.today)}.`);
      if (pr.missed) out.push(`You are ${pr.missed} day${pr.missed > 1 ? 's' : ''} behind on ${p.name}.`);
    }
    if (out.length === 1) out.push('You have no reading plan for today. Say “make a plan for”, then a book and a number of days, to start one.');
    return out;
  })();
}

// ---------------- the command list ----------------
export const HELP: [string, string][] = [
  ['Go to Romans 8 · Open John 3:16 · Open notes', 'Navigate'],
  ['Read Romans 8 · Read this chapter · Read verses 28 to 30', 'Listen'],
  ['Pause · Resume · Repeat · Next verse · Previous verse · Slower · Faster', 'Control reading'],
  ['Select verses 28 to 30', 'Select'],
  ['Tag this Salvation · Tag verses 28 to 30 with Salvation and Family · Tag this S A L', 'Tag'],
  ['Note this … (then “save” or “cancel”)', 'Note'],
  ['Mark as read · Check chapter · Highlight this yellow · Undo', 'Reading'],
  ['Find verses about patience', 'Search'],
  ['Make a plan for Romans in 30 days · What’s today’s reading? · Morning briefing', 'Plans'],
  ['Capture … · Swap panes · Read my notes', 'Other'],
];

/** Run a spoken command. Returns true if understood. */
export async function runCommand(heard: string): Promise<boolean> {
  const t = heard.toLowerCase().replace(/[.!?]+$/g, '').replace(/^(please|ok|okay|hey bible better|bible better)\s+/, '').trim();
  ui.set({ voice: { listening: false, interim: '', heard, reply: '', choices: [] } });
  let m: RegExpMatchArray | null;

  // pending choice: "the first one", "second", "number 2"
  const ch = pendingChoices();
  if (ch.length && (m = t.match(/\b(first|1st|one|1|second|2nd|two|2|third|3rd|three|3)\b/))) {
    const i = ['first', '1st', 'one', '1'].includes(m[1]) ? 0 : ['second', '2nd', 'two', '2'].includes(m[1]) ? 1 : 2;
    if (ch[i]) { ch[i].run(); return true; }
  }
  if (/^(what can i say|help|commands|what can you do)$/.test(t)) { ui.set({ voice: { listening: false, interim: '', heard, reply: 'help', choices: [] } }); await tts.say('Here is what you can say.'); return true; }
  if (/^(undo|undo that|take that back)$/.test(t)) { await undoLast(); await reply('Undone.', 'Undone'); return true; }
  if (/^(pause|stop|stop reading|be quiet|quiet)$/.test(t)) { tts.pause(); await reply('Paused.', ''); return true; }
  if (/^(resume|continue|play|keep reading|go on)$/.test(t)) { tts.resume(); ui.set({ voice: null }); return true; }
  if (/^(repeat|repeat that|again|say that again|read that again)$/.test(t)) { tts.repeat(); ui.set({ voice: null }); return true; }
  if (/^(next|next verse|skip)$/.test(t)) { tts.step(1); ui.set({ voice: null }); return true; }
  if (/^(previous|previous verse|back|go back|last verse)$/.test(t)) { tts.step(-1); ui.set({ voice: null }); return true; }
  if ((m = t.match(/^(?:read |go |speak )?(slower|faster|slow down|speed up)$/))) {
    const s = await settings(); const up = /faster|speed up/.test(m[1]);
    const r = Math.round(((s.ttsRate ?? 1) + (up ? 0.15 : -0.15)) * 100) / 100;
    await tts.setRate(r); await reply(`Speed ${Math.max(0.5, Math.min(2, r)).toFixed(2)}×`, ''); return true;
  }
  if (/^(swap|swap panes|switch panes)$/.test(t)) { document.dispatchEvent(new CustomEvent('bb-swap')); ui.set({ voice: null }); return true; }
  if (/^(morning briefing|briefing|read (my )?(morning )?briefing|what'?s (on )?today|what'?s today'?s reading|today'?s reading)$/.test(t)) {
    const lines = await briefingText(); ui.set({ voice: null }); tts.playText(lines, 'Briefing'); return true;
  }
  if ((m = t.match(/^read (?:me )?(?:my )?notes(?: on (.+))?$/))) {
    const c = m[1] ? anchorFrom(m[1]) : context();
    if (!c) { await reply('Open a chapter first.'); return true; }
    const notes = (await db.notes.toArray()).filter((n) => alive(n) && n.s <= c.anchor.e && n.e >= c.anchor.s);
    if (!notes.length) { await reply(`No notes on ${c.label}.`); return true; }
    ui.set({ voice: null }); tts.playText(notes.map((n) => `${anchorLabel(n)}. ${n.text}`), `Notes on ${c.label}`); return true;
  }
  if ((m = t.match(/^(?:read|play|listen to)(?: aloud)?(?: me)? (.+)$/))) {
    const target = m[1].replace(/^(the|this) chapter$/, 'chapter');
    if (target === 'chapter') { const at = ui.get().bibleAt; if (!at) { await reply('Open a chapter first.'); return true; } ui.set({ voice: null }); void tts.playChapter(at.book, at.chapter); return true; }
    const c = anchorFrom(target);
    if (!c) return unknown(heard);
    ui.set({ voice: null });
    const r = speechRef(target);
    if (r?.chapter && r.s === chapterVerseIds(r.book, r.chapter)[0] && r.e === chapterVerseIds(r.book, r.chapter).slice(-1)[0]) { navigate('bible', { book: r.book, chapter: r.chapter }); void tts.playChapter(r.book, r.chapter); return true; }
    const vs = c.verses.length ? c.verses : rangeVerses([c.anchor.s, c.anchor.e]);
    navigate('bible', { book: vBook(vs[0]), chapter: vChap(vs[0]), verse: vVerse(vs[0]) });
    void tts.playVerses(vs, c.label); return true;
  }
  if ((m = t.match(/^(?:go to|open|show(?: me)?|turn to|take me to|jump to) (.+)$/))) {
    const what = m[1].replace(/^the /, '');
    const fn = FUNCTIONS.find((f) => f.name.toLowerCase().startsWith(what) || f.key === what || (what.startsWith('plan') && f.key === 'plans') || (what.startsWith('calendar') && f.key === 'plans') || (what.startsWith('timeline') && f.key === 'plans') || (what.startsWith('note') && f.key === 'notes') || (what.startsWith('tag') && f.key === 'notes') || (what.startsWith('read-through') && f.key === 'readthroughs') || (what.startsWith('read through') && f.key === 'readthroughs'));
    if (fn) { navigate(fn.key, what.startsWith('calendar') ? { tab: 'calendar' } : what.startsWith('timeline') ? { tab: 'timeline' } : undefined); ui.set({ voice: null }); return true; }
    const r = speechRef(what);
    if (!r) return unknown(heard);
    navigate('bible', { book: r.book, chapter: r.chapter ?? 0, verse: r.chapter && r.s !== chapterVerseIds(r.book, r.chapter)[0] ? vVerse(r.s) : 0 });
    ui.set({ voice: null }); return true;
  }
  if ((m = t.match(/^select (.+)$/))) {
    const c = anchorFrom(m[1]);
    if (!c || !c.verses.length) { await reply('Open the chapter first, then say “select verses 28 to 30”.'); return true; }
    ui.set({ selectReq: { n: Date.now(), verses: c.verses } }); await reply(`Selected ${c.label}.`, ''); return true;
  }
  if ((m = t.match(/^(?:mark|check)(?: (this|it|that|these|.+?))?(?: as)? read$/)) || (m = t.match(/^check (this|it|that|these)$/))) {
    const c = anchorFrom(m[1] ?? 'this'); const rt = (await settings()).activeRt;
    if (!c || !rt) return unknown(heard);
    const vs = c.verses.length ? c.verses : rangeVerses([c.anchor.s, c.anchor.e]);
    await setChecked(rt, vs, true); await reply(`Marked ${c.label} as read.`, 'Marked read', { undo: false }); return true;
  }
  if (/^(check|mark) (the |this )?(whole )?chapter( as read)?$/.test(t)) {
    const at = ui.get().bibleAt; const rt = (await settings()).activeRt;
    if (!at || !rt) { await reply('Open a chapter first.'); return true; }
    await setChecked(rt, chapterVerseIds(at.book, at.chapter), true); await reply(`Checked ${BOOKS[at.book - 1].name} ${at.chapter}.`, 'Chapter checked'); return true;
  }
  if ((m = t.match(/^uncheck(?: (.+))?$/))) {
    const c = anchorFrom(m[1] ?? 'this'); const rt = (await settings()).activeRt;
    if (!c || !rt) return unknown(heard);
    await setChecked(rt, c.verses, false); await reply(`Unchecked ${c.label}.`, 'Unchecked'); return true;
  }
  if ((m = t.match(/^(?:remove|clear) (?:the )?highlight(?: from (.+))?$/))) {
    const c = anchorFrom(m[1] ?? 'this'); if (!c) return unknown(heard);
    await setHighlight(c.verses, null); await reply(`Removed highlight from ${c.label}.`, 'Highlight removed'); return true;
  }
  if ((m = t.match(/^highlight\b\s*(.*)$/))) {
    const cm = m[1].match(/^(.*?)\s*(?:in )?(yellow|gold|green|mint|blue|purple|lavender|violet|orange|peach|pink|red|rose)?$/);
    const c = anchorFrom(cm?.[1] || 'this'); if (!c) return unknown(heard);
    const word = cm?.[2] ?? 'yellow';
    await setHighlight(c.verses.length ? c.verses : rangeVerses([c.anchor.s, c.anchor.e]), COLORS[word]);
    await reply(`Highlighted ${c.label} ${word}.`, 'Highlighted', { undo: true }); return true;
  }
  if ((m = t.match(/^tag\s+(.+)$/))) {
    let target = 'this', tagWords = m[1];
    const w = m[1].match(/^(.+?)\s+(?:with|as|under)\s+(.+)$/);
    const w2 = m[1].match(/^(this|it|that|these)\s+(.+)$/);
    if (w) { target = w[1]; tagWords = w[2]; } else if (w2) { target = w2[1]; tagWords = w2[2]; }
    const c = anchorFrom(target);
    if (!c) { await reply('Select verses or open a chapter first.'); return true; }
    const { found, unsure, missing } = await matchTags(tagWords);
    for (const tg of found) await tagPassage(tg, c.anchor);
    if (found.length) await reply(`Tagged ${c.label} with ${found.map((x) => x.name).join(' and ')}.`, `Tagged ${found.map((x) => x.name).join(' and ')}`, { undo: true });
    if (unsure.length) {
      const u = unsure[0];
      choose(`Which tag for “${u.word}”?`, u.options.map((o) => ({ label: `${o.name} (${o.code})`, run: () => void tagPassage(o, c.anchor).then(() => reply(`Tagged ${c.label} with ${o.name}.`, `Tagged ${o.name}`, { undo: true })) })));
      return true;
    }
    if (missing.length && !found.length) {
      choose(`I couldn’t find a tag called “${missing[0]}”.`, [
        { label: `Create tag “${missing[0]}” and tag ${c.label}`, run: () => void (async () => {
          const { saveTag } = await import('./annot');
          const name = missing[0].replace(/\b\w/g, (x) => x.toUpperCase());
          let code = normCode(name.replace(/\s+/g, '').slice(0, 4)), n = 2;
          const all = (await db.tags.toArray()).filter(alive);
          while (all.some((x) => x.code === code)) code = normCode(name.replace(/\s+/g, '').slice(0, 4)) + n++;
          const id = await saveTag({ name, code, parent: null, desc: '' });
          const tg = await db.tags.get(id); if (tg) await tagPassage(tg, c.anchor);
          await reply(`Created ${name} and tagged ${c.label}.`, `Tagged ${name}`, { undo: true });
        })() },
        { label: 'Open the tag picker', run: () => { ui.set({ voice: null, tagFor: c.anchor }); } },
      ]);
    }
    return true;
  }
  if ((m = t.match(/^(?:add |make |write |take )?(?:a )?note\b\s*(.*)$/))) {
    let rest = m[1], target = 'this';
    const on = rest.match(/^(?:on|to|for)\s+(verses?\s+\d+(?:\s*(?:-|to|through)\s*\d+)?|[1-3]?\s?[a-z ]+?\s\d+(?::\d+)?(?:-\d+)?)\b[:,]?\s*(.*)$/);
    if (on) { target = on[1]; rest = on[2]; }
    rest = rest.replace(/^(this|that|it|these)\b[:,]?\s*/, '').replace(/^(that|saying)\s+/, '');
    const c = anchorFrom(target);
    if (!c) { await reply('Select verses or open a chapter first.'); return true; }
    ui.set({ voice: null, noteFor: { anchor: c.anchor, text: rest ? rest[0].toUpperCase() + rest.slice(1) : '', voice: true } });
    return true;
  }
  if ((m = t.match(/^(?:find|search(?: for)?|look up|look for)(?: verses?| scriptures?| passages?)?(?: about| on| with| that mention)? (.+)$/))) {
    navigate('search', { q: m[1] }); ui.set({ voice: null }); return true;
  }
  if ((m = t.match(/^(?:make|create|start|build)(?: me)? (?:a )?(?:reading )?plan (?:for|to read) (.+?) in (\d+|[a-z -]+) (days?|weeks?|months?)$/))) {
    const n = +wordsToNumbers(m[2]) * (m[3].startsWith('week') ? 7 : m[3].startsWith('month') ? 30 : 1);
    const parts = m[1].split(/\s*(?:,|\band\b)\s*/).filter(Boolean);
    const passages = parts.map((p) => { const r = speechRef(p); return r ? (r.chapter ? p : BOOKS[r.book - 1].name) : p; });
    if (!n || parts.some((p) => !parsePassage(p) && !speechRef(p))) { await reply('I didn’t catch the passages. Try “make a plan for Romans in 30 days”.'); return true; }
    const fixed = parts.map((p) => { const r = speechRef(p); if (!r) return p; if (!r.chapter) return BOOKS[r.book - 1].name; return formatVerses([r.s, r.e]).includes(';') ? p : `${BOOKS[r.book - 1].name} ${r.chapter}`; });
    void passages;
    const s = await settings();
    const kjv = await loadKjv();
    const id = await createPlan({ name: `${parts.join(', ')} in ${n} days`.replace(/^\w/, (x) => x.toUpperCase()), rt: s.activeRt ?? '', passages: fixed, start: todayStr(), end: addDays(todayStr(), n - 1), skipWeekdays: [], skipDates: [], skipRanges: [], balance: 'words' }, kjv);
    navigate('plans', { plan: id });
    await reply(`Created a ${n}-day plan for ${parts.join(' and ')}. It starts today.`, 'Plan created', { undo: true }); return true;
  }
  if ((m = t.match(/^(?:capture|remember|save to inbox|inbox)[:,]?\s+(.+)$/))) {
    const text = m[1][0].toUpperCase() + m[1].slice(1);
    await addInbox(text); await reply(`Saved to your Inbox: “${text}”.`, 'Saved to Inbox'); return true;
  }
  // a bare reference: "romans 8" -> go there
  const r = speechRef(t);
  if (r && /\d/.test(t)) { navigate('bible', { book: r.book, chapter: r.chapter ?? 0, verse: r.chapter && r.s !== chapterVerseIds(r.book, r.chapter)[0] ? vVerse(r.s) : 0 }); ui.set({ voice: null }); return true; }
  return unknown(heard);
}

async function unknown(heard: string) {
  choose(`I'm not sure what to do with “${heard}”.`, [
    { label: `Search for “${heard}”`, run: () => { navigate('search', { q: heard }); ui.set({ voice: null }); } },
    { label: 'Save it to the Inbox', run: () => void addInbox(heard).then(() => reply('Saved to Inbox.', 'Saved')) },
  ]);
  return false;
}

export { anchorText };
