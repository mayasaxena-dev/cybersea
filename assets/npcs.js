// The crew's NPCs: npcs.html?g=<game>. What the GM has shared of each NPC (the NPCs tab; see
// session-model.js), as it was when shared, and the crew's own notes on them, which anyone
// signed in can edit.
import { bootstrap } from './games.js';
import { GameClient } from './api.js';
import { md } from './markup.js';
import { parseTrack, rowKey } from './codec.js';
import { staticPips } from './cards.js';
import { esc, escTxt, pageShell, refreshNav, readOnlyHTML, whenIdle, debounce, fitText, noGame, typingIn } from './core.js';
import { NPCS_TAB, parseNpcs } from './session-model.js';

const app = document.getElementById('app');
const game = bootstrap();
if (!game) noGame(app, 'npcs');
const client = new GameClient(game);
pageShell(app, client, 'npcs');
const store = client.tab(NPCS_TAB);
const main = document.createElement('main');
app.append(main);
let query = '';

const canEdit = () => client.canEdit(NPCS_TAB);
function render() {
  if (store.missing) { main.innerHTML = '<div class="empty-page"><p>The GM hasn’t shared any NPCs yet.</p></div>'; return; }
  if (!store.loaded) { main.innerHTML = '<div class="empty">Loading…</div>'; return; }
  const q = query.trim().toLowerCase();
  const npcs = parseNpcs(store.rows).filter(n => !q || `${n.name} ${n.tags} ${n.notes} ${n.crew}`.toLowerCase().includes(q));
  main.innerHTML = `<div class="mtools"><input type="search" class="in search" id="q" placeholder="Search NPCs" value="${esc(query)}" aria-label="Search NPCs" autocomplete="off"></div>
    ${canEdit() ? '' : readOnlyHTML(client, NPCS_TAB, 'the crew’s notes')}
    <div class="cols">${npcs.map(n => `<section class="card"><div class="shead"><h2>${escTxt(n.name)}</h2></div>
      ${n.tags ? `<div class="tagtext">${escTxt(n.tags)}</div>` : ''}
      ${n.harm ? `<div class="cc-row"><span class="lbl">Harm</span><span class="pips harm">${staticPips(parseTrack(n.harm))}</span></div>` : ''}
      ${n.notes ? `<div class="rich">${md(n.notes)}</div>` : ''}
      <div class="lbl">The crew’s notes</div>
      ${canEdit() ? `<textarea class="in rtext" data-crew="${esc(n.name)}" aria-label="The crew’s notes on ${esc(n.name)}">${escTxt(n.crew)}</textarea>`
      : n.crew ? `<div class="rich">${md(n.crew)}</div>` : '<div class="note">None yet.</div>'}</section>`).join('') || '<div class="empty">No matches.</div>'}</div>`;
  fitText(main.querySelectorAll('textarea'), 70);
}

const save = debounce(t => {
  const name = t.dataset.crew;
  const next = store.rows.filter(r => rowKey(r[0], r[1]) !== rowKey('crew', name));
  if (t.value.trim()) next.push(['crew', name, t.value, '']);
  store.change(store.rows, next);
}, 400);
main.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'q') { query = t.value; render(); document.getElementById('q')?.focus(); return; }
  if (t.dataset.crew && canEdit()) { fitText([t], 70); save(t); }
});

const later = whenIdle(main, () => typingIn(main));
store.on(() => later(render));
client.on(e => { if (e.list || e.me) { refreshNav(client, 'npcs'); later(render); } });
render();
client.watch(NPCS_TAB);
client.read().catch(() => render());
client.startPolling();
