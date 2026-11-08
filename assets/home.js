// Crew home: index.html?g=<game>. Without a game: your games, and joining one by invite.
import { bootstrap, href, listGames, joinGame, inviteFromText } from './games.js';
import { GameClient } from './api.js';
import { gameRules, TABS } from './rules.js';
import { characterRows } from './build.js';
import { SHIP } from './system.js';
import { md, short } from './markup.js';
import { esc, escTxt, pageShell, refreshNav, modal, closeModal, pickerHTML, pick } from './core.js';
import { crewCardHTML } from './cards.js';
import { showPictures } from './pictures.js';
import { wireShare } from './share.js';

const app = document.getElementById('app');
const game = bootstrap();

if (!game) {
  pageShell(app, null, 'home');
  const games = listGames();
  app.insertAdjacentHTML('beforeend', `<main class="welcome">
    <section class="card setup">
      <h2>Your games</h2>
      ${games.length ? `<div class="glist">${games.map(g => `<a class="gamelink" href="${esc(href('index.html', g))}">${escTxt(g.name)}</a>`).join('')}</div>` : '<p class="note">None yet. Ask whoever runs your game for an invite link.</p>'}
      <form class="prow" data-join><input class="in tok" placeholder="Paste an invite link" aria-label="Invite link"><button class="pbtn primary">Join</button></form>
      <div class="status" data-msg></div>
    </section>
    <section class="card setup">
      <h2>Start a new game</h2>
      <p>Each game is its own Google Sheet. Make one from the template, deploy its script, then share invite links. The steps are in <a href="SETUP.md">SETUP.md</a>; <a href="diag.html">diag.html</a> checks the deployment and adds the game here.</p>
    </section>
  </main>`);
  app.querySelector('[data-join]').addEventListener('submit', e => {
    e.preventDefault();
    const inv = inviteFromText(e.target.querySelector('input').value);
    if (!inv) { app.querySelector('[data-msg]').textContent = 'That doesn’t look like an invite link.'; return; }
    location.href = href('index.html', joinGame(inv));
  });
} else {
  const client = new GameClient(game);
  pageShell(app, client, 'home');
  const main = document.createElement('main');
  app.append(main);
  showPictures(main, client);
  let R = gameRules(client);
  for (const t of TABS) client.tab(t).on(() => { R = gameRules(client); render(); }); // crew cards name tracks as the System tab does

  const characters = () => client.list.filter(t => t.kind === 'character').map(t => t.name);

  wireShare(main, client);
  let listed = false; // the server's tab list has arrived, so an empty crew really is empty

  // Crew who haven't signed in as a character get asked (until they pick one or say they're just looking).
  const askWho = names => client.role === 'crew' && listed && names.length && !client.me && client.game.as !== '';

  function render() {
    const me = client.me;
    const names = characters().sort((a, b) => (b === me) - (a === me));
    main.innerHTML = `${askWho(names) ? `<section class="card whoami">
        <h2>Sign in as your character</h2>
        ${pickerHTML(client, { looking: true })}
        <p class="note">The crew sees who’s signed in. To sign out later, use the button at the top right.</p>
      </section>` : ''}
      ${names.length ? `<div class="crew">${names.map(n => crewCardHTML(client, n, { me: n === me, share: client.role === 'gm' })).join('')}</div>` : listed ? '<p class="note">No characters yet.</p>' : ''}
      <button class="add" data-act="new">+ New character</button>`;
    document.title = client.game.name || 'Cybersea';
  }

  function newCharacter() {
    const pbs = R.playbooks().filter(p => String(p.meta.type || '').toLowerCase() !== SHIP);
    if (!pbs.length) { modal('<p>The Rules tab has no playbooks yet.</p><div class="prow"><span class="grow"></span><button class="pbtn" data-close>OK</button></div>'); return; }
    const form = { name: '', player: '', playbook: pbs[0].name, oddity: '', kit: '', extraMove: '' };
    const opt = (v, label, cur) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${escTxt(label)}</option>`;
    const draw = (focus = 'name') => {
      const pb = R.playbook(form.playbook);
      const o = modal(`
        <div class="prow"><h2>New character</h2><span class="grow"></span><button class="mini" data-close aria-label="Close">×</button></div>
        <label class="field"><span class="lbl">Name</span><input class="in" data-f="name" value="${esc(form.name)}" required></label>
        <label class="field"><span class="lbl">Player</span><input class="in" data-f="player" value="${esc(form.player)}"></label>
        <label class="field"><span class="lbl">Playbook</span><select class="in" data-f="playbook">${pbs.map(p => opt(p.name, p.name, form.playbook)).join('')}</select></label>
        ${pb.text ? `<div class="mbody rule">${md(pb.text)}</div>` : ''}
        ${pb.oddities.length ? `<label class="field"><span class="lbl">Oddity</span><select class="in" data-f="oddity">${pb.oddities.map(x => opt(x.name, `${x.name} (${x.meta.traits || ''}): ${short(x.text)}`, form.oddity)).join('')}</select></label>` : ''}
        ${pb.kits.length ? `<label class="field"><span class="lbl">Kit</span><select class="in" data-f="kit">${pb.kits.map(x => opt(x.name, `${x.name}: ${short(x.text)}`, form.kit)).join('')}</select></label>` : ''}
        ${+pb.meta.pick ? `<label class="field"><span class="lbl">Extra starting move</span><select class="in" data-f="extraMove">${pb.moves.filter(m => !m.meta.start).map(m => opt(m.name, `${m.name}: ${short(m.text)}`, form.extraMove)).join('')}</select></label>` : ''}
        <div class="prow"><span class="grow"></span><button class="pbtn" data-close>Cancel</button><button class="pbtn primary" data-create>Create</button></div>
        <div class="status" data-msg></div>`, { label: 'New character', wide: true });
      o.addEventListener('input', e => { if (e.target.dataset.f) form[e.target.dataset.f] = e.target.value; });
      o.addEventListener('change', e => { if (e.target.dataset.f) form[e.target.dataset.f] = e.target.value; if (e.target.dataset.f === 'playbook') { form.oddity = ''; form.kit = ''; form.extraMove = ''; draw('playbook'); } });
      o.querySelector('[data-create]').addEventListener('click', async () => {
        const msg = o.querySelector('[data-msg]');
        const name = form.name.trim();
        if (!name) { msg.textContent = 'Give them a name.'; return; }
        const p = R.playbook(form.playbook);
        const extra = +p.meta.pick ? form.extraMove || p.moves.find(m => !m.meta.start)?.name : undefined;
        msg.textContent = 'Creating…';
        try {
          const rows = characterRows(R, { name, player: form.player.trim(), playbook: form.playbook, oddity: form.oddity || p.oddities[0]?.name, kit: form.kit || p.kits[0]?.name, extraMove: extra });
          const r = await client.request({ op: 'create', tab: name, rows });
          client.tab(r.tab).receive(r, r.at);
          if (client.role === 'crew' && !client.me) client.setMe(r.tab); // a player's new character is theirs
          closeModal();
          location.href = href('sheet.html', client.game, { c: r.tab });
        } catch (e) { msg.textContent = e.message; }
      });
      o.querySelector(`[data-f="${focus}"]`).focus();
    };
    draw();
  }

  main.addEventListener('click', e => {
    if (e.target.closest('[data-act="new"]')) newCharacter();
    const p = e.target.closest('[data-me]');
    if (p) pick(client, p);
  });
  client.on(e => { if (e.me) render(); });
  client.on(e => {
    if (e.list) {
      refreshNav(client, 'home');
      const want = characters();
      const fresh = want.filter(n => !client.watched.has(n));
      want.forEach(n => client.watch(n));
      if (fresh.length) client.read().catch(() => {});
    }
  });
  render();
  for (const n of characters()) client.tab(n).on(render);
  client.on(e => { if (e.list) { listed = true; for (const n of characters()) client.tab(n).on(render); render(); } });
  // Rules is read once per visit (cached by digest); only the crew's tabs are polled.
  client.watch(...characters());
  client.read([...TABS, ...client.watched]).catch(() => render());
  client.startPolling();
}
