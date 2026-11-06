// Rolls shared with the table: rolls made on a sheet go to the sheet's Rolls tab (roll_ in
// Code.gs), and a die button on every game page opens the latest of them. A roll someone else
// makes while the page is open pops up beside the button for a moment, and the button counts the
// ones not looked at yet. Sharing is on unless this browser turns it off. On a sheet, a roll made
// with real dice can be entered by hand under one of the sheet's stats.

import { ICON, fmt, escTxt, esc, bandOf, watchRolls, armed } from './core.js';
import { ls, gkey } from './games.js';

export const ROLLS_TAB = 'Rolls';
const PEEK_MS = 7000;
const REAL_DICE = 'real dice';
const STAT_DICE = 2; // as a stat's roll on the sheet (doRoll in sheet.js)

// A Rolls row as { when, who, label, dice, mod, total, as } (columns as ROLLS_HEADER in Code.gs).
export function parseRoll([when = '', who = '', label = '', dice = '', mod = '', total = '', as = '']) {
  return {
    when: String(when),
    who: String(who),
    label: String(label),
    dice: String(dice).split(/[\s,]+/).filter(Boolean).map(Number),
    mod: parseInt(String(mod).replace('−', '-'), 10) || 0,
    total: Number(total),
    as: String(as),
  };
}

// "14:05" today, "Nov 4" before.
function whenText(iso, now = new Date()) {
  const t = new Date(iso);
  if (isNaN(t)) return '';
  return t.toDateString() === now.toDateString()
    ? t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : t.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// del: the roll's index in the list, when this page may take it off.
export function rollHTML(r, { peek = false, del = null } = {}) {
  const [band, bandLabel] = bandOf(r.dice.length, r.total);
  return `<li class="rroll ${band}${peek ? ' rpeek' : ''}">` +
    `<div class="rhead"><b class="rwho">${escTxt(r.who)}</b>${r.as ? `<span class="ras">${escTxt(r.as)}</span>` : ''}` +
    `<span class="grow"></span><time datetime="${esc(r.when)}">${escTxt(whenText(r.when))}</time>` +
    (del != null ? `<button class="mini del" data-rdel="${del}" title="Delete this roll" aria-label="Delete this roll">×</button>` : '') + '</div>' +
    `<div class="rline"><span class="rlabel">${escTxt(r.label)}</span><span class="grow"></span>` +
    `<span class="dice">${r.dice.map(d => `<span class="die">${d}</span>`).join('')}</span>` +
    (r.mod ? `<span class="mod">${fmt(r.mod)}</span>` : '') +
    `<span class="mod">=</span><span class="tot">${r.total}</span>${bandLabel ? `<span class="band">${bandLabel}</span>` : ''}</div></li>`;
}

// The form for a roll made with real dice: a stat (stats: [{k, v}]) and a face per die.
function manualHTML(stats) {
  const die = i => `<input class="in rdie" type="number" inputmode="numeric" min="1" max="6" step="1" data-rdie="${i}" aria-label="Die ${i + 1}" placeholder="?">`;
  return '<form class="rmanual" data-rmanual novalidate><div class="lbl">Rolled real dice?</div><div class="urow">' +
    `<select class="in rstat" data-rstat aria-label="Stat">${stats.map((s, i) => `<option value="${i}">${escTxt(s.k)} ${fmt(s.v)}</option>`).join('')}</select>` +
    Array.from({ length: STAT_DICE }, (_, i) => die(i)).join('') +
    '<button class="pbtn primary">Share</button></div></form>';
}

// roller: () => ({ who, tab, stats }), the sheet a roll on this page is made on; pages without one only show rolls.
export function sharedRolls(client, roller) {
  if (document.querySelector('.rl')) return;
  client.readAlong(ROLLS_TAB);
  const store = client.tab(ROLLS_TAB);
  const shareKey = gkey(client.game, 'rolls:share');
  const seenKey = gkey(client.game, 'rolls:seen');
  const sharing = () => ls.get(shareKey, true) !== false;
  const rolls = () => store.rows.map(r => Object.assign(parseRoll(r), { row: r })).filter(r => r.when && r.who);
  // The GM takes any roll off; a player, the ones they made (honor system, as for edits).
  const mayDelete = r => {
    if (client.locked || !client.role) return false;
    if (client.role === 'gm') return true;
    const me = String(client.me || '').toLowerCase();
    return !!me && (r.as ? r.as.toLowerCase() === me : r.who.toLowerCase() === me);
  };
  const latest = () => rolls().at(-1)?.when || '';
  let open = false;
  let problem = '';
  let shown = store.loaded ? latest() : null; // the newest roll this page has accounted for
  let peekT;
  let ours = false; // the rows coming in are the answer to this page's own roll

  document.body.insertAdjacentHTML('beforeend',
    `<button class="ic rl" data-rolls title="Table rolls" aria-label="Table rolls" aria-expanded="false">${ICON.die}<span class="rcount" hidden></span></button>` +
    '<section class="rfeed" aria-label="Table rolls" hidden></section><ul class="rpeekbox" aria-live="polite"></ul>');
  const btn = document.querySelector('.rl');
  const panel = document.querySelector('.rfeed');
  const peekBox = document.querySelector('.rpeekbox');

  const seen = () => ls.get(seenKey, '') || '';
  const markSeen = () => { const l = latest(); if (l > seen()) ls.set(seenKey, l); };

  function drawCount() {
    const n = open ? 0 : rolls().filter(r => r.when > seen()).length;
    const c = btn.querySelector('.rcount');
    c.hidden = !n;
    c.textContent = n > 9 ? '9+' : String(n);
    btn.setAttribute('aria-label', n ? `Table rolls, ${n} new` : 'Table rolls');
  }

  // The list and its notes are redrawn as rolls come in; the form and the switch below them stay,
  // so typing in them isn't lost.
  panel.innerHTML = '<div class="prow"><h2>Table rolls</h2><span class="grow"></span><button class="mini" data-rclose aria-label="Close">×</button></div>' +
    '<div class="rbody"></div><div class="rform"></div>' +
    (roller ? `<label class="rshare"><input type="checkbox" data-rshare${sharing() ? ' checked' : ''}> Share my rolls with the table</label>` : '');
  const body = panel.querySelector('.rbody');
  const formBox = panel.querySelector('.rform');

  function draw() {
    if (!open) return drawCount();
    const list = rolls();
    const was = body.querySelector('ol');
    const nearBottom = !was || was.scrollHeight - was.scrollTop - was.clientHeight < 40;
    body.innerHTML = (list.length ? `<ol class="rlist">${list.map((r, i) => rollHTML(r, { del: mayDelete(r) ? i : null })).join('')}</ol>`
      : `<p class="status">${store.loaded || store.missing ? 'No rolls shared yet.' : 'Loading…'}</p>`) +
      (problem ? `<p class="status err">${escTxt(problem)}</p>` : '');
    const ol = body.querySelector('ol');
    if (ol && nearBottom) ol.scrollTop = ol.scrollHeight;
    markSeen();
    drawCount();
  }

  // The sheet's stats as they are when the panel opens; the chosen one is kept if it's still there.
  function drawForm() {
    const stats = roller?.().stats || [];
    const pick = formBox.querySelector('[data-rstat]');
    const keep = pick && pick.selectedOptions[0]?.textContent.split(' ')[0];
    formBox.innerHTML = stats.length ? manualHTML(stats) : '';
    const now = formBox.querySelector('[data-rstat]');
    const i = keep ? stats.findIndex(s => s.k === keep) : -1;
    if (now && i >= 0) now.value = String(i);
  }

  function toggle(on = !open) {
    open = on;
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    btn.classList.toggle('on', open);
    if (open) { peekBox.innerHTML = ''; drawForm(); draw(); panel.querySelector('[data-rclose]')?.focus({ preventScroll: true }); }
    else drawCount();
  }

  function peek(fresh) {
    if (open || !fresh.length) return;
    peekBox.innerHTML = fresh.slice(-3).map(r => rollHTML(r, { peek: true })).join('');
    clearTimeout(peekT);
    peekT = setTimeout(() => { peekBox.innerHTML = ''; }, PEEK_MS);
  }

  btn.addEventListener('click', () => toggle());
  peekBox.addEventListener('click', () => toggle(true));
  panel.addEventListener('click', e => {
    if (e.target.closest('[data-rclose]')) { toggle(false); btn.focus({ preventScroll: true }); return; }
    const del = e.target.closest('[data-rdel]');
    if (del && armed(del)) unroll(rolls()[+del.dataset.rdel]);
  });

  function unroll(r) {
    if (!r) return;
    client.request({ op: 'unroll', row: r.row })
      .then(res => { problem = ''; ours = true; try { store.receive(res, res.at); } finally { ours = false; } })
      .catch(e => {
        problem = /unknown op/i.test(e.message) ? 'This game’s script needs updating before rolls can be deleted (Cybersea → Update the script).'
          : `That roll wasn’t deleted: ${e.message}`;
        draw();
      });
  }
  panel.addEventListener('change', e => { if (e.target.matches('[data-rshare]')) ls.set(shareKey, e.target.checked); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && open && !document.getElementById('overlay')) toggle(false); });

  store.on(() => {
    // What came in since this page last looked; nothing on the first load, which is history.
    if (shown == null || ours) { shown = latest(); if (!seen() || ours) markSeen(); }
    else {
      const fresh = rolls().filter(r => r.when > shown);
      shown = latest() || shown;
      peek(fresh);
    }
    draw();
  });

  function share({ label, dice, mod, total }) {
    const { who, tab } = roller();
    const me = client.me;
    const as = client.role === 'gm' ? 'GM' : me && me.toLowerCase() !== String(tab).toLowerCase() ? me : '';
    return client.request({ op: 'roll', who, label, dice, mod, total, as })
      .then(r => {
        problem = '';
        ours = true;
        try { store.receive(r, r.at); } finally { ours = false; }
        return true;
      })
      .catch(e => {
        problem = /unknown op/i.test(e.message) ? 'This game’s script needs updating before rolls can be shared (Cybersea → Update the script).'
          : `Your last roll wasn’t shared: ${e.message}`;
        draw();
        return false;
      });
  }

  if (roller) watchRolls(roll => {
    if (sharing() && !client.locked && client.role) share(roll);
  });

  // Entered by hand, a roll is shared whatever the switch says: that's what the form is for.
  formBox.addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    const s = (roller().stats || [])[+form.querySelector('[data-rstat]').value];
    const inputs = [...form.querySelectorAll('[data-rdie]')];
    const dice = inputs.map(x => Number(x.value));
    const bad = inputs.find((x, i) => !(Number.isInteger(dice[i]) && dice[i] >= 1 && dice[i] <= 6));
    if (!s || bad) { (bad || inputs[0])?.focus(); problem = 'Enter each die as a number from 1 to 6.'; draw(); return; }
    const go = form.querySelector('button');
    go.disabled = true;
    const ok = await share({ label: `${s.k} · ${REAL_DICE}`, dice, mod: s.v, total: dice.reduce((a, b) => a + b, 0) + s.v });
    go.disabled = false;
    if (ok) inputs.forEach(x => { x.value = ''; });
  });
  drawCount();
}
