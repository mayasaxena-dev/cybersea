// Rolls shared with the table: rolls made on a sheet go to the sheet's Rolls tab (roll_ in
// Code.gs), and a die button on every game page opens the latest of them. A roll someone else
// makes while the page is open pops up beside the button for a moment, and the button counts the
// ones not looked at yet. Sharing is on unless this browser turns it off.

import { ICON, fmt, escTxt, esc, bandOf, watchRolls } from './core.js';
import { ls, gkey } from './games.js';

export const ROLLS_TAB = 'Rolls';
const PEEK_MS = 7000;

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

export function rollHTML(r, { peek = false } = {}) {
  const [band, bandLabel] = bandOf(r.dice.length, r.total);
  return `<li class="rroll ${band}${peek ? ' rpeek' : ''}">` +
    `<div class="rhead"><b class="rwho">${escTxt(r.who)}</b>${r.as ? `<span class="ras">${escTxt(r.as)}</span>` : ''}` +
    `<span class="grow"></span><time datetime="${esc(r.when)}">${escTxt(whenText(r.when))}</time></div>` +
    `<div class="rline"><span class="rlabel">${escTxt(r.label)}</span><span class="grow"></span>` +
    `<span class="dice">${r.dice.map(d => `<span class="die">${d}</span>`).join('')}</span>` +
    (r.mod ? `<span class="mod">${fmt(r.mod)}</span>` : '') +
    `<span class="mod">=</span><span class="tot">${r.total}</span>${bandLabel ? `<span class="band">${bandLabel}</span>` : ''}</div></li>`;
}

// roller: () => ({ who, tab }), the sheet a roll on this page is made on; pages without one only show rolls.
export function sharedRolls(client, roller) {
  if (document.querySelector('.rl')) return;
  client.readAlong(ROLLS_TAB);
  const store = client.tab(ROLLS_TAB);
  const shareKey = gkey(client.game, 'rolls:share');
  const seenKey = gkey(client.game, 'rolls:seen');
  const sharing = () => ls.get(shareKey, true) !== false;
  const rolls = () => store.rows.map(parseRoll).filter(r => r.when && r.who);
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

  function draw() {
    if (!open) return drawCount();
    const list = rolls();
    const nearBottom = !panel.querySelector('ol') || panel.querySelector('ol').scrollHeight - panel.querySelector('ol').scrollTop - panel.querySelector('ol').clientHeight < 40;
    panel.innerHTML = '<div class="prow"><h2>Table rolls</h2><span class="grow"></span><button class="mini" data-rclose aria-label="Close">×</button></div>' +
      (list.length ? `<ol class="rlist">${list.map(r => rollHTML(r)).join('')}</ol>`
        : `<p class="status">${store.loaded || store.missing ? 'No rolls shared yet.' : 'Loading…'}</p>`) +
      (problem ? `<p class="status err">${escTxt(problem)}</p>` : '') +
      (roller ? `<label class="rshare"><input type="checkbox" data-rshare${sharing() ? ' checked' : ''}> Share my rolls with the table</label>` : '');
    const ol = panel.querySelector('ol');
    if (ol && nearBottom) ol.scrollTop = ol.scrollHeight;
    markSeen();
    drawCount();
  }

  function toggle(on = !open) {
    open = on;
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    btn.classList.toggle('on', open);
    if (open) { peekBox.innerHTML = ''; draw(); panel.querySelector('[data-rclose]')?.focus({ preventScroll: true }); }
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
  panel.addEventListener('click', e => { if (e.target.closest('[data-rclose]')) { toggle(false); btn.focus({ preventScroll: true }); } });
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

  if (roller) watchRolls(({ label, dice, mod, total }) => {
    if (!sharing() || client.locked || !client.role) return;
    const { who, tab } = roller();
    const me = client.me;
    const as = client.role === 'gm' ? 'GM' : me && me.toLowerCase() !== String(tab).toLowerCase() ? me : '';
    client.request({ op: 'roll', who, label, dice, mod, total, as })
      .then(r => {
        problem = '';
        ours = true;
        try { store.receive(r, r.at); } finally { ours = false; }
      })
      .catch(e => {
        problem = /unknown op/i.test(e.message) ? 'This game’s script needs updating before rolls can be shared (Cybersea → Update the script).'
          : `Your last roll wasn’t shared: ${e.message}`;
        draw();
      });
  });
  drawCount();
}
