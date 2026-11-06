// The log's actions for a character sheet: Session Begins, Session Ends, Chapter's End,
// Begin/Leave Downtime and Level Up, or whatever the game calls them. Rules rows with action=
// (procedure and move rows) name each action and give the text its dialog shows; choice rows
// with the action as their Group are its options (see system.js). What each one does is here.
// ctx = {st(), rules(), changed(), render(), editing(), used(key, n, line, undo), keep}; used offers a change
// for the log (usage.js).

import { esc, escTxt, fmt, fmtDate, modal, closeModal, toast } from './core.js';
import { md } from './markup.js';
import { logId } from './codec.js';
import { systemOf, typeOf, floorOf, trackSize, sum, effects, atSession, rollOf, cap } from './system.js';

// The actions the site knows, in the order the log shows them.
const ORDER = ['session-begin', 'session-end', 'chapter-end', 'begin-downtime', 'leave-downtime', 'level-up'];
const low = s => String(s ?? '').trim().toLowerCase();

export function makeActions(ctx) {
  const st = () => ctx.st();
  const R = () => ctx.rules();
  const sys = () => systemOf(R(), typeOf(R(), st().info.playbook));
  const byName = name => (name ? st().tracks[name.toLowerCase()] || null : null);
  const track = role => byName(sys().name(role));
  const word = role => sys().word(role);
  const marks = t => (t?.pips || []).filter(v => v === 1).length;
  const level = () => parseInt(st().info.level, 10) || 0;
  const nums = () => ({ stats: st().stats, level: level() });
  const xpCount = () => marks(track('xp'));
  const xpNeeded = () => {
    const d = sys().track('xp');
    return d?.size ? trackSize({ size: d.size }, nums()) : track('xp')?.pips.length || 0;
  };

  const rowsOf = id => R().recs.filter(r => low(r.meta.action) === id);
  const has = id => rowsOf(id).length > 0;
  const label = id => rowsOf(id).find(r => r.meta.label)?.meta.label || rowsOf(id)[0]?.name || id;
  const choices = id => R().by('choice', id);
  // The move group that holds the downtime moves: the one Begin Downtime's move row is in.
  const dtGroup = () => low(rowsOf('begin-downtime').find(r => r.kind === 'move')?.group);

  const section = title => (title ? st().sections.find(s => s.title.toLowerCase() === title.toLowerCase()) : null);
  const bondDef = () => sys().section('bonds');
  const bondSize = () => sum(bondDef()?.size) || Infinity;
  const usedBonds = () => st().bonds.reduce((n, b) => n + b.pips.filter(v => v === 2).length, 0);
  const bondCount = b => b.pips.filter(v => v > 0).length;
  const playbook = () => R().playbook(st().info.playbook);
  const unmarkedMoves = () => (playbook()?.moves || []).filter(m => !st().moves.some(x => x.name.toUpperCase() === m.name.toUpperCase() && x.marked));

  // The character's vice, oddity and marked moves that do something when a session starts or ends.
  function sessionMoves(when) {
    const pb = playbook();
    const mine = name => st().moves.find(x => x.name.toUpperCase() === name.toUpperCase());
    // The one the sheet names, when the playbook offers a choice.
    const chosen = (list, role, all) => {
      const v = (section(sys().title(role))?.text || '').toLowerCase();
      const named = list.filter(x => v.includes(x.name.toLowerCase()));
      return named.length || !all ? named : list;
    };
    const moves = (pb?.moves || []).filter(m => mine(m.name)?.marked).map(m => ({ ...m, text: mine(m.name).text || m.text }));
    return [...chosen(pb?.vices || [], 'vice', true), ...chosen(pb?.oddities || [], 'oddity', false), ...moves]
      .filter(m => atSession(when, m.meta)).map(m => ({ name: m.name, text: m.text, meta: m.meta, gains: effects(m.meta.gain) }));
  }
  let sessMoves = [];
  const gainText = e => `+${e.from ? marks(byName(e.from)) : e.n} ${word(e.role)}`;
  const sessionList = (when, none) => {
    sessMoves = sessionMoves(when);
    if (!sessMoves.length) return none ? `<div class="status">${none}</div>` : '';
    const what = m => {
      const r = rollOf(m.meta, st().stats);
      return [...m.gains.map(gainText), r && `roll ${r.stat ? `${r.label} ${fmt(r.mod)}` : r.label} on the Moves tab`].filter(Boolean).join(', ');
    };
    return '<div class="opts">' + sessMoves.map((m, k) =>
      `<div class="opt endm"><label class="eff"><input type="checkbox" data-eff="sess:${k}">${escTxt(m.name)}` +
      `${what(m) ? `<span class="cnt">${escTxt(what(m))}</span>` : ''}</label><div class="mbody">${md(m.text)}</div></div>`).join('') + '</div>';
  };
  // Tick a listed move: log it, and mark what it says to.
  function runSessionMoves(on, items) {
    sessMoves.forEach((m, k) => {
      if (!on(`sess:${k}`)) return;
      const got = gain(m.gains, m.name);
      items.push(got.length ? `${m.name}: ${got.join(', ')}` : m.name);
    });
  }

  function markN(pipsArr, n) {
    let done = 0;
    for (let j = 0; j < pipsArr.length && done < n; j++) if (pipsArr[j] === 0) { pipsArr[j] = 1; done++; }
    return done;
  }
  function healN(role, n) {
    const h = track(role);
    let done = 0;
    for (let j = (h?.pips.length || 0) - 1; j >= 0 && done < n; j--) if (h.pips[j] === 1) { h.pips[j] = 0; done++; }
    return done;
  }
  // Mark the next experience tally and note why in the experience section, e.g. "1 (Chapter’s End)".
  function markXp(reason) {
    const t = track('xp');
    const j = t ? t.pips.indexOf(0) : -1;
    if (j < 0) return false;
    t.pips[j] = 1;
    const s = section(sys().title('xp'));
    if (s) s.text = (s.text.trim() ? s.text.replace(/\s+$/, '') + '\n' : '') + `- 1 (${reason})`;
    return true;
  }
  // gain=…: mark tracks, as many as there's room for. Returns what was marked, e.g. ["+2 luck"].
  function gain(list, reason) {
    const got = [];
    for (const e of list) {
      const want = e.from ? marks(byName(e.from)) : e.n || 0;
      let n = 0;
      if (e.role === 'xp') while (n < want && markXp(reason)) n++;
      else if (track(e.role)) n = markN(track(e.role).pips, want);
      if (n) got.push(`+${n} ${word(e.role)}`);
    }
    return got;
  }
  // Leave Downtime heals harm taken before downtime began, not fresh harm taken during it.
  function healable() {
    const h = track('harm')?.pips || [];
    const before = st().state.downtime?.harm || h;
    return h.map((v, j) => v === 1 && before[j] === 1);
  }
  // Session Begins refills tracks with refill= up to it (at least a house rule's floor).
  const refills = () => sys().tracks.filter(t => t.refill && byName(t.name)).map(t => {
    const pips = byName(t.name).pips;
    return { t, pips, have: marks({ pips }), target: Math.min(pips.length, Math.max(floorOf(R(), t.role), sum(t.refill, nums()))) };
  });

  // A choice row's effect, and whether it would do anything now.
  const usable = c => (low(c.meta.refresh) === 'bonds' ? usedBonds() > 0 : true);
  const choiceLabel = c => (low(c.meta.refresh) === 'bonds' ? `${c.name} (${usedBonds()})` : c.name);
  function doChoice(c, reason, items) {
    if (low(c.meta.refresh) === 'bonds') {
      let n = 0;
      st().bonds.forEach(b => { b.pips = b.pips.map(v => (v === 2 ? (n++, 1) : v)); });
      if (n) items.push(`${c.name} (${n})`);
    }
    items.push(...gain(effects(c.meta.gain), reason));
    for (const e of effects(c.meta.heal)) {
      const n = healN(e.role, e.n ?? Infinity);
      if (n) items.push(`Healed ${n} ${word(e.role)}`);
    }
  }

  const eff = (key, text, ok) =>
    `<label class="eff${ok ? '' : ' off'}"><input type="checkbox" data-eff="${esc(key)}"${ok ? ' checked' : ' disabled'}>${escTxt(text)}</label>`;
  const select = (k, items) => `<select class="in sub" data-sub="${k}">${items.map(([v, t]) => `<option value="${esc(v)}">${escTxt(t)}</option>`).join('')}</select>`;

  function controls(kind) {
    const s = st();
    if (kind === 'session-begin') {
      return refills().map(({ t, have, target }, i) => eff(`refill:${i}`, `Refresh ${word(t.role) || t.name.toLowerCase()} up to ${target} (${have})`, have < target)).join('') + sessionList('start', '');
    }
    if (kind === 'session-end') return sessionList('end', 'Nothing on this sheet happens at the end of a session.');
    if (kind === 'chapter-end') {
      const cs = choices(kind);
      const picks = Math.max(0, ...rowsOf(kind).map(r => parseInt(r.meta.picks, 10) || 0));
      const pickable = cs.map((c, k) => [c, k]).filter(([c]) => c.meta.pick);
      const pick = n => `<select class="in" data-pick="${n}" aria-label="Choice ${n + 1}"><option value="">—</option>` +
        pickable.map(([c, k]) => `<option value="${k}">${escTxt(c.name)}</option>`).join('') + '</select>';
      return cs.map((c, k) => (c.meta.pick ? '' : eff(`choice:${k}`, choiceLabel(c), usable(c)))).join('') +
        (pickable.length && picks ? `<div class="picks">${Array.from({ length: picks }, (_, n) => pick(n)).join('')}</div>` : '');
    }
    if (kind === 'begin-downtime') {
      return '<div class="opts">' + choices(kind).map((c, k) => {
        const n = sum(c.meta.slots);
        return `<label class="optl"><input type="radio" name="where" value="${k}"${k ? '' : ' checked'}><span>${escTxt(c.name)}</span>` +
          `${c.meta.slots != null ? `<span class="cnt">${n} ${escTxt(cap(dtGroup()))} move${n === 1 ? '' : 's'}</span>` : ''}</label>`;
      }).join('') + '</div>';
    }
    if (kind === 'leave-downtime') {
      const n = healable().filter(Boolean).length;
      return track('harm') ? eff('heal', `Heal all ${word('harm')} (${n})`, n > 0) : '';
    }
    if (kind === 'level-up') {
      let h = `<div class="lvl">Level ${level()} → ${level() + 1}</div><div class="opts">`;
      R().advances().forEach((a, k) => {
        const text = a.text.trim() || a.name;
        const kindA = a.meta.kind;
        const taken = s.advances[kindA || text] || 0;
        const top = parseInt(a.meta.cap, 10);
        let sub = '';
        let ok = true;
        if (kindA === 'trait') {
          const opts = s.stats.filter(x => !(x.v >= top)).map(x => [x.k, `${x.k} ${fmt(x.v)}`]);
          ok = taken < (parseInt(a.meta.max, 10) || Infinity) && opts.length > 0;
          sub = select(k, opts);
        } else if (kindA === 'bond') {
          const rows = s.bonds.map((b, j) => [j, `${b.name} (${bondCount(b)})`, b]).filter(x => bondCount(x[2]) < Math.min(bondSize(), x[2].pips.length));
          ok = rows.length > 0;
          sub = select(k, rows.map(x => [x[0], x[1]]));
        } else if (kindA === 'move') {
          const ms = unmarkedMoves().map(m => [m.name, m.name]);
          ok = ms.length > 0;
          sub = select(k, ms);
        } else if (kindA === 'oddity') {
          sub = `<input class="in sub" data-sub="${k}" aria-label="${esc(sys().title('oddity') || 'Name')}">`;
        }
        h += `<div class="opt${ok ? '' : ' off'}"><label class="optl"><input type="radio" name="adv" value="${k}"${ok ? '' : ' disabled'}>` +
          `<span>${escTxt(text)}</span>${taken ? `<span class="cnt">×${taken}</span>` : ''}</label>${ok ? sub : ''}</div>`;
      });
      return h + '<div class="opt"><label class="optl"><input type="radio" name="adv" value="other"><input class="in other" aria-label="Other advance"></label></div></div>';
    }
    return '';
  }

  function open(kind) {
    const title = label(kind);
    let h = `<div class="prow"><h2>${escTxt(title)}</h2><span class="grow"></span><button class="mini" data-close aria-label="Close">×</button></div>`;
    for (const r of rowsOf(kind)) if (r.text) h += `<div class="mbody rule">${md(r.text)}</div>`;
    h += controls(kind) +
      `<textarea class="in anote" placeholder="Note" aria-label="Note"></textarea>
       <div class="prow"><span class="grow"></span><button class="pbtn" data-close>Cancel</button><button class="pbtn primary" data-run>${escTxt(title)}</button></div>`;
    const o = modal(h, { label: title, wide: true });
    const pickRadio = el => { const r = el.closest('.opt')?.querySelector('input[type=radio]'); if (r && !r.disabled) r.checked = true; };
    o.addEventListener('focusin', e => { if (e.target.matches('.sub, .other')) pickRadio(e.target); });
    o.addEventListener('change', e => { if (e.target.matches('.sub')) pickRadio(e.target); });
    o.addEventListener('click', e => { if (e.target.closest('[data-run]')) run(kind, o); });
  }

  function run(kind, o) {
    const s = st();
    const on = k => !!o.querySelector(`[data-eff="${k}"]`)?.checked;
    const items = [];
    const title = label(kind);
    if (kind === 'session-begin') {
      for (const [i, { t, pips, have, target }] of refills().entries()) {
        const n = on(`refill:${i}`) && target > have ? markN(pips, target - have) : 0;
        if (n) items.push(`+${n} ${word(t.role) || t.name.toLowerCase()}`);
      }
      runSessionMoves(on, items);
    } else if (kind === 'session-end') {
      runSessionMoves(on, items);
    } else if (kind === 'chapter-end') {
      const cs = choices(kind);
      cs.forEach((c, k) => { if (!c.meta.pick && on(`choice:${k}`)) doChoice(c, title, items); });
      o.querySelectorAll('[data-pick]').forEach(sel => { if (sel.value !== '' && cs[+sel.value]) doChoice(cs[+sel.value], title, items); });
    } else if (kind === 'begin-downtime') {
      const c = choices(kind)[+(o.querySelector('input[name=where]:checked')?.value || 0)];
      s.state.downtime = { at: Date.now(), where: c?.name || '', slots: c ? sum(c.meta.slots) : 0, harm: (track('harm')?.pips || []).slice(), moves: [] };
      if (c) items.push(c.name);
    } else if (kind === 'leave-downtime') {
      (s.state.downtime?.moves || []).forEach(m => items.push(`${m.name} (${m.total})`));
      if (on('heal') && track('harm')) {
        const heal = healable();
        const n = heal.filter(Boolean).length;
        track('harm').pips = track('harm').pips.map((v, j) => (heal[j] ? 0 : v));
        if (n) items.push(`Healed ${n} ${word('harm')}`);
      }
      s.state.downtime = null;
    } else if (kind === 'level-up') {
      const next = level() + 1;
      const pick = o.querySelector('input[name=adv]:checked');
      let fullBond = null;
      items.push(`Level ${next}`);
      if (pick && pick.value !== 'other') {
        const k = +pick.value;
        const a = R().advances()[k];
        const text = a.text.trim() || a.name;
        const sub = o.querySelector(`[data-sub="${k}"]`);
        const key = a.meta.kind || text;
        s.advances[key] = (s.advances[key] || 0) + 1;
        items.push(text);
        if (a.meta.kind === 'trait' && sub) {
          const stat = s.stats.find(x => x.k === sub.value);
          const top = parseInt(a.meta.cap, 10);
          if (stat) { stat.v = Number.isFinite(top) ? Math.min(top, stat.v + 1) : stat.v + 1; items.push(`${stat.k} ${fmt(stat.v)}`); }
        } else if (a.meta.kind === 'bond' && sub) {
          const b = s.bonds[+sub.value];
          const j = b ? b.pips.indexOf(0) : -1;
          if (j >= 0) { b.pips[j] = 1; items.push(`+1: ${b.name}`); if (bondCount(b) >= Math.min(bondSize(), b.pips.length)) fullBond = b.name; }
        } else if (a.meta.kind === 'move' && sub) {
          const m = s.moves.find(x => x.name.toUpperCase() === sub.value.toUpperCase());
          if (m) m.marked = true; else s.moves.push({ name: sub.value, marked: true, text: '' });
          items.push(sub.value);
        } else if (a.meta.kind === 'oddity' && sub && sub.value.trim()) {
          const odd = section(sys().title('oddity'));
          if (odd) odd.text = (odd.text.trim() ? odd.text.replace(/\s+$/, '') + '\n\n' : '') + `**${sub.value.trim()}**`;
          items.push(sub.value.trim());
        }
      } else {
        const t = (o.querySelector('.other')?.value || '').trim();
        if (t) items.push(t);
      }
      // Level up: erase all experience tally marks; the next level may need more.
      s.info.level = String(next);
      const xt = track('xp');
      if (xt) xt.pips = Array(xpNeeded()).fill(0);
      // Filling a bond through this advance gives what a full bond does (full=…) immediately.
      if (fullBond) items.push(...gain(effects(bondDef()?.full), fullBond));
    }
    const note = (o.querySelector('.anote')?.value || '').trim();
    const at = Date.now();
    s.log.push({ id: logId(at), at, title, items, note });
    ctx.changed();
    closeModal();
    ctx.render();
  }

  // tools(entry, i) adds buttons to an entry's header (e.g. Undo for an item use).
  function logHTML(editing, readOnly = false, tools = () => '') {
    const s = st();
    const dt = s.state.downtime;
    const xp = xpCount();
    const need = xpNeeded();
    const btn = (kind, text, cls = '', attrs = '') => `<button class="act${cls}" data-act="run" data-kind="${kind}"${attrs}>${text}</button>`;
    const shown = ORDER.filter(k => has(k) && !(k === 'begin-downtime' && dt) && !(k === 'leave-downtime' && !dt));
    let h = readOnly ? '' : '<div class="actions">' + shown.map(k =>
      k === 'level-up' ? btn(k, `${escTxt(label(k))}<span class="cnt">${xp}/${need}</span>`, '', xp < need ? ' disabled' : '')
        : btn(k, escTxt(label(k)), k === 'leave-downtime' ? ' live' : '')).join('') + '</div>';
    if (dt) {
      const moves = dt.moves || [];
      const g = cap(dtGroup());
      h += `<div class="dtbar">${escTxt(g)} <time>${fmtDate(dt.at)}</time>` +
        `<span class="cnt">${escTxt(dt.where || '')} ${moves.length}/${escTxt(dt.slots ?? '–')}</span>` +
        (moves.length ? `<span class="dtm">${moves.map(m => escTxt(`${m.name} (${m.total})`)).join(' · ')}</span>` : '') +
        `<button class="pill" data-act="dt-moves">${escTxt(g)} moves</button></div>`;
    }
    const entries = s.log.map((e, i) =>
      `<article class="entry"><div class="ehead"><span class="et">${escTxt(e.title)}</span><time>${e.at ? fmtDate(e.at) : ''}</time>` + tools(e, i) +
      (editing ? `<button class="mini del" data-act="rm-log" data-i="${i}" aria-label="Delete">×</button>` : '') + '</div>' +
      (e.items.length ? `<ul class="eitems">${e.items.map(t => `<li>${escTxt(t)}</li>`).join('')}</ul>` : '') +
      (editing ? `<textarea class="in enote" data-log="${i}" aria-label="Note">${escTxt(e.note || '')}</textarea>`
               : e.note ? `<p class="enote">${escTxt(e.note)}</p>` : '') +
      '</article>').reverse().join('');
    return h + (entries || '<div class="empty">Nothing logged yet.</div>');
  }

  // The action a move runs (action= on its Rules row), and whether it can run now: only one of
  // Begin and Leave Downtime applies at a time.
  function forMove(move) {
    const kind = low(move.meta?.action);
    if (kind !== 'begin-downtime' && kind !== 'leave-downtime') return null;
    const dt = !!st().state.downtime;
    const begin = kind === 'begin-downtime';
    return { kind, label: label(kind), ok: begin ? !dt : dt, why: begin ? `${label('leave-downtime')} first` : `${label('begin-downtime')} first` };
  }

  // Why a move can't be made now, or '': a move in the downtime group (the group of the move
  // with action=begin-downtime) needs a downtime with a slot left (slots= on where it began).
  function why(move) {
    const g = dtGroup();
    if (!g || low(move.cat) !== g || move.meta?.action) return '';
    const dt = st().state.downtime;
    if (!dt) return `${label('begin-downtime')} first`;
    if (dt.slots > 0 && (dt.moves || []).length >= dt.slots) return `No ${g} moves left`;
    return '';
  }

  // What a move spends outright (spend=luck:1; luck:x asks how much), and whether there's enough.
  function cost(move) {
    const e = effects(move.meta?.spend)[0];
    const t = e && track(e.role);
    if (!t) return null;
    const have = marks(t);
    return { role: e.role, word: word(e.role), n: e.n, have, ok: have >= (e.n || 1) };
  }

  function spend(move) {
    const c = cost(move);
    if (!c?.ok) return;
    const take = n => {
      const undo = ctx.keep?.tracks(track(c.role).name);
      const l = track(c.role).pips;
      let done = 0;
      for (let j = l.length - 1; j >= 0 && done < n; j--) if (l[j] === 1) { l[j] = 0; done++; }
      ctx.changed();
      ctx.render();
      toast(`Spent ${done} ${c.word}: ${move.name} (${c.have - done} left)`);
      const name = track(c.role).name;
      ctx.used?.(`spend:${move.name}`, done, k => `${move.name}: ${name} −${k}`, undo);
    };
    if (c.n) { take(c.n); return; }
    const o = modal(`<div class="prow"><h2>${escTxt(move.name)}</h2><span class="grow"></span><button class="mini" data-close aria-label="Close">×</button></div>
      <label class="field"><span class="lbl">${escTxt(cap(c.word))} to spend (${c.have})</span><input class="in" type="number" data-spend-n min="1" max="${c.have}" value="1"></label>
      <div class="prow"><span class="grow"></span><button class="pbtn" data-close>Cancel</button><button class="pbtn primary" data-spend>Spend ${escTxt(c.word)}</button></div>`, { label: move.name });
    o.querySelector('[data-spend-n]').focus();
    o.addEventListener('click', e => {
      if (!e.target.closest('[data-spend]')) return;
      const n = Math.min(c.have, Math.max(1, parseInt(o.querySelector('[data-spend-n]').value, 10) || 1));
      closeModal();
      take(n);
    });
  }

  // Count downtime moves rolled during downtime.
  function noteRoll(move, total) {
    const dt = st().state.downtime;
    if (!dt || !dtGroup() || low(move.cat) !== dtGroup()) return false;
    (dt.moves = dt.moves || []).push({ name: move.name, total });
    return true;
  }

  return { open, logHTML, noteRoll, forMove, why, cost, spend, dtGroup };
}
