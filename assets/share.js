// Sharing with the crew: the GM's Share buttons (on the GM page, the Map, Lore, Rules, Crew and
// Ship pages) file something into a folder of the Session tab's desktop (session-model.js), and
// do what sharing it means: a place goes on the crew's map, an NPC's ticked parts are copied to
// the NPCs tab, a secret or note is copied to the Lore page.
import { esc, escTxt, modal, closeModal, toast } from './core.js';
import { ls, gkey } from './games.js';
import { logId, rowKey } from './codec.js';
import { SESSION_TAB, NPCS_TAB, parseSession, shareRow, cleanPath, mergeNpc, joinRef } from './session-model.js';

// The Lore category a revealed secret or note goes under.
export const REVEALED = 'Revealed';

const hasTab = (client, name) => client.list.some(t => t.name.trim().toLowerCase() === name.toLowerCase());

// Changes a tab the GM may need to make first: next(rows) gives its rows after the change.
export async function writeRows(client, name, next) {
  const s = client.tab(name);
  if (!hasTab(client, name)) {
    const r = await client.request({ op: 'create', tab: name, rows: next([]) });
    if (r.code === 'exists') { s.change(s.rows, next(s.rows)); return; }
    s.receive(r, r.at);
    client.list = [...client.list, { name: r.tab || name, kind: name.toLowerCase() }];
    client.emit({ list: true });
    return;
  }
  s.change(s.rows, next(s.rows));
}

// The Share button: data-share holds what to share (see openShare), as JSON.
export const shareButtonHTML = (spec, label = 'Share') =>
  `<button class="pbtn share" data-share="${esc(JSON.stringify(spec))}" title="Share with the crew on the Session page">${escTxt(label)}</button>`;

// Wires a page's Share buttons. extra(spec) may add what the dialog needs (an NPC's parts, a secret's text).
export function wireShare(root, client, extra = s => s) {
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-share]');
    if (!b || client.role !== 'gm') return;
    e.preventDefault();
    e.stopPropagation();
    let spec;
    try { spec = JSON.parse(b.dataset.share); } catch { return; }
    openShare(client, extra(spec) || spec);
  }, true);
}

const lastKey = client => gkey(client.game, 'share:folder');

/*
 * spec: {type, ref, title, body?} as the Session tab keeps it (SHARE_TYPES in session-model.js),
 * plus for type 'npc' {npc: {tags, harm, notes}} to pick from, and for 'secret' (a secret or note
 * from the GM page) {body}: it's copied to the Lore page and shared from there.
 */
export function openShare(client, spec) {
  const S = parseSession(client.tab(SESSION_TAB).rows);
  const def = S.current?.title || ls.get(lastKey(client), '') || '';
  const folders = [...new Set([...(S.current ? [S.current.title] : []), ...S.folders])];
  const npc = spec.type === 'npc' ? spec.npc || {} : null;
  const part = (k, label, v) => `<label class="eff${v ? '' : ' off'}"><input type="checkbox" data-part="${k}"${v ? ' checked' : ' disabled'}>${escTxt(label)}${v ? `<span class="cnt">${escTxt(String(v).slice(0, 60))}</span>` : ''}</label>`;
  const o = modal(`
    <div class="prow"><h2>Share ${escTxt(spec.title || spec.ref || spec.type)}</h2><span class="grow"></span><button class="mini" data-close aria-label="Close">×</button></div>
    <div class="note">It goes in the folder you pick, on everyone’s Session page.${spec.type === 'place' || spec.type === 'level' ? ' It goes on the crew’s map too.' : spec.type === 'secret' ? ' It goes on the Lore page too.' : ''}</div>
    ${npc ? `<div class="mhd lbl">Parts to share</div><div class="opts">${part('tags', 'Tags', npc.tags)}${part('harm', 'Harm', npc.harm)}${part('notes', 'Notes', npc.notes)}</div>
      <div class="note">Parts you leave out stay as the crew last saw them.</div>` : ''}
    <label class="field"><span class="lbl">Folder</span>
      <select class="in" data-folder>${folders.map(f => `<option value="${esc(f)}"${f === def ? ' selected' : ''}>${escTxt(f)}</option>`).join('')}<option value=""${folders.includes(def) ? '' : ' selected'}>New folder…</option></select></label>
    <label class="field" data-newf${folders.includes(def) ? ' hidden' : ''}><span class="lbl">New folder (use / for one inside another)</span><input class="in" data-newfolder value="${esc(folders.includes(def) ? '' : def)}" placeholder="Vega Station"></label>
    <div class="prow"><span class="status" data-msg></span><span class="grow"></span><button class="pbtn" data-close>Cancel</button><button class="pbtn primary" data-go>Share</button></div>`, { label: 'Share' });
  const sel = o.querySelector('[data-folder]');
  sel.addEventListener('change', () => { o.querySelector('[data-newf]').hidden = !!sel.value; });
  o.querySelector('[data-go]').addEventListener('click', async () => {
    const folder = cleanPath(sel.value || o.querySelector('[data-newfolder]').value);
    const say = m => { o.querySelector('[data-msg]').textContent = m; };
    if (!folder) { say('Pick a folder or name a new one.'); return; }
    const parts = {};
    if (npc) o.querySelectorAll('[data-part]:checked').forEach(b => { parts[b.dataset.part] = npc[b.dataset.part]; });
    if (npc && !Object.keys(parts).length && !client.tab(NPCS_TAB).rows.some(r => rowKey(r[0], r[1]) === rowKey('npc', spec.ref))) parts.tags = npc.tags || '';
    o.querySelector('[data-go]').disabled = true;
    say('Sharing…');
    try {
      await share(client, spec, folder, parts);
      ls.set(lastKey(client), folder);
      closeModal();
      toast(`Shared to ${folder}`);
    } catch (e) {
      o.querySelector('[data-go]').disabled = false;
      say(e.message);
    }
  });
}

// Does the share: what it means for its kind, then its row in the folder.
export async function share(client, spec, folder, parts = {}) {
  let { type, ref, body = '' } = spec;
  if (type === 'place') await client.request({ op: 'show', location: ref, on: true });
  if (type === 'level') { const [loc, level] = ref.split(' / '); await client.request({ op: 'show', location: loc, level, on: true }); }
  if (type === 'npc') await writeRows(client, NPCS_TAB, rows => mergeNpc(rows, ref, parts));
  if (type === 'secret') {
    await writeRows(client, 'Lore', rows => [...rows.filter(r => rowKey(r[0], r[1]) !== rowKey(REVEALED, spec.title)), [REVEALED, spec.title, body, 'GM']]);
    type = 'lore';
    ref = joinRef(REVEALED, spec.title);
    body = '';
  }
  if (type === 'place' || type === 'level') client.read(['Map']).catch(() => {});
  const S = parseSession(client.tab(SESSION_TAB).rows);
  const newFolder = !S.folders.includes(folder);
  await writeRows(client, SESSION_TAB, rows => [...rows, ...(newFolder ? [['folder', folder, '', '']] : []), shareRow(logId(), folder, { type, ref, body })]);
}
