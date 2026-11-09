// Player reference: rules.html?g=<game>. Everything in the Rules tab the crew can see.
import { bootstrap } from './games.js';
import { GameClient } from './api.js';
import { gameRules, TABS } from './rules.js';
import { esc, pageShell, refreshNav, debounce, noGame } from './core.js';
import { SECTIONS, sectionHTML, searchAllHTML, sectionHasContent } from './refview.js';
import { shareButtonHTML, wireShare } from './share.js';

const app = document.getElementById('app');
const game = bootstrap();
if (!game) noGame(app, 'rules');
const client = new GameClient(game);
pageShell(app, client, 'rules');
const store = client.tab('Rules');
const main = document.createElement('main');
app.append(main);
const KEYS = ['moves', 'playbooks', 'tags', 'reference', 'world', 'other'];
let R = gameRules(client);
let tab = 'moves';
// rules.html?tag=<name>&group=<group> (a crew member's tag chip) opens the Tags tab at that tag.
const params = new URLSearchParams(location.search);
let showTag = params.get('tag') || '';
if (showTag) tab = 'tags';
let hlRec = null; // the tag revealed, kept highlighted across redraws
function revealTag() {
  if (hlRec != null) main.querySelector(`.gloss[data-rec="${hlRec}"]`)?.classList.add('hl');
  if (!showTag || !store.loaded) return;
  const low = s => String(s || '').toLowerCase();
  const group = params.get('group');
  const rec = R.recs.find(r => r.kind === 'tag' && low(r.name) === low(showTag) && (group == null || low(r.group) === low(group)));
  const el = rec && main.querySelector(`.gloss[data-rec="${rec.i}"]`);
  if (!el) return;
  showTag = '';
  hlRec = rec.i;
  el.classList.add('hl');
  el.scrollIntoView({ block: 'center' });
}
let query = '';

// The GM's Share buttons, on the rules the crew can see.
function addShares() {
  if (client.role !== 'gm') return;
  main.querySelectorAll('[data-rec]').forEach(el => {
    const r = R.recs.find(x => String(x.i) === el.dataset.rec);
    if (!r || String(r.vis).trim().toLowerCase() === 'gm' || el.querySelector('[data-share]')) return;
    const at = el.querySelector('summary') || el.querySelector('b') || el;
    at.insertAdjacentHTML('beforeend', ` ${shareButtonHTML({ type: 'rule', ref: r.name, title: r.name })}`);
  });
}
wireShare(main, client);
const search = debounce(() => {
  const ref = document.getElementById('ref');
  if (ref) ref.innerHTML = query.trim() ? searchAllHTML(R, KEYS, query) : sectionHTML(R, tab);
  addShares();
});
function render() {
  search.cancel();
  if (!store.loaded) { main.innerHTML = '<div class="empty">Loading…</div>'; return; }
  const tabs = KEYS.filter(k => k === 'moves' || sectionHasContent(R, k));
  if (!tabs.includes(tab)) tab = tabs[0];
  main.innerHTML = `
    <div class="mtools">
      <input type="search" class="in search" id="q" placeholder="Search all rules" value="${esc(query)}" aria-label="Search rules" autocomplete="off">
      <div class="cats">${tabs.map(k => `<button data-tab="${k}" aria-pressed="${!query && tab === k}" class="${!query && tab === k ? 'on' : ''}">${SECTIONS[k].label}</button>`).join('')}</div>
    </div>
    <div id="ref">${query.trim() ? searchAllHTML(R, tabs, query) : sectionHTML(R, tab)}</div>`;
  addShares();
  revealTag();
}

main.addEventListener('click', e => {
  const b = e.target.closest('[data-tab]');
  if (b) { tab = b.dataset.tab; query = ''; render(); }
});
main.addEventListener('input', e => {
  if (e.target.id !== 'q') return;
  query = e.target.value;
  search();
  main.querySelectorAll('.cats button').forEach(b => { const on = !query && b.dataset.tab === tab; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
});
document.addEventListener('keydown', e => {
  if (e.key === '/' && !e.target.closest('input,textarea,select')) { e.preventDefault(); document.getElementById('q')?.focus(); }
});
for (const t of TABS) client.tab(t).on(() => { R = gameRules(client); render(); });
client.on(e => { if (e.list) { refreshNav(client, 'rules'); render(); } });
render();
client.read(TABS).catch(() => render());
