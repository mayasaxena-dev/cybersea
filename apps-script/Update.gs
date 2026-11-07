/**
 * The Cybersea menu's Update the script: brings this script up to date with apps-script/ in the
 * repository on GitHub, then points the web app's deployment at the new version, so nobody pastes
 * files or edits the deployment by hand, and the site's URL and invite links stay the same.
 *
 * It uses the Apps Script API, which a script can only call once it's moved from the hidden
 * Google Cloud project every script starts with to one of the owner's own, with the API turned on
 * there and in the owner's Apps Script settings (SETUP.md, "Updating from the menu"). Until then
 * it says so and changes nothing; pasting the files by hand still works.
 *
 * The files come from the commit main points to (UPDATE_FROM in the script properties can name
 * another, as owner/repo@branch), all from that one commit. Files the project has that the
 * repository doesn't (a GM's own, say) are kept. An update that needs new permissions saves the
 * code but doesn't deploy it: picking Update the script again asks for them, then deploys, since
 * the web app runs as the owner and would fail without them.
 */

const UPDATE_FROM = 'mayasaxena-dev/cybersea@main';
const SCRIPT_API = 'https://script.googleapis.com/v1/projects/';

function updateScript() {
  const ui = SpreadsheetApp.getUi();
  const yes = ui.alert('Update the script',
    'Update this game’s script to the latest version on GitHub and deploy it? The site’s address and invite links stay the same.',
    ui.ButtonSet.OK_CANCEL);
  if (yes !== ui.Button.OK) return;
  ui.alert('Update the script', updateScript_(), ui.ButtonSet.OK);
}

// Does the update; returns what to tell the GM.
function updateScript_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return 'Another update is running. Try again in a minute.';
  try {
    const props = PropertiesService.getScriptProperties();
    const id = ScriptApp.getScriptId();
    const have = scriptApi_('get', id + '/content');
    if (have.error) return have.error;
    const from = sourceOf_(props.getProperty('UPDATE_FROM') || UPDATE_FROM);
    const got = fetchSource_(from);
    if (got.error) return got.error;

    const files = (have.files || []).map(f => ({ name: f.name, type: f.type, source: f.source }));
    let changed = false;
    for (const f of got.files) {
      const i = files.findIndex(x => x.name === f.name && x.type === f.type);
      if (i < 0) { files.push(f); changed = true; } else if (files[i].source !== f.source) { files[i] = f; changed = true; }
    }
    const short = got.commit.slice(0, 7);
    if (changed) {
      const put = scriptApi_('put', id + '/content', { files });
      if (put.error) return put.error;
      // Saved but not deployed until the deployment points at it, even if a step below fails.
      props.setProperty('UPDATE_UNDEPLOYED', got.commit);
      if (newScopes_(have.files, files).length) {
        return 'The new code (' + short + ') is saved but not deployed yet: it needs new permissions. Pick Cybersea → Update the script again and allow them to finish.';
      }
    } else if (!props.getProperty('UPDATE_UNDEPLOYED')) {
      return 'The script is already up to date (' + short + ').';
    }

    const version = scriptApi_('post', id + '/versions', { description: 'Update the script: ' + from.repo + '@' + short });
    if (version.error) return version.error;
    const list = scriptApi_('get', id + '/deployments');
    if (list.error) return list.error;
    // The web app deployments made with Deploy → New deployment (the HEAD one has no version).
    const webApps = (list.deployments || []).filter(d => d.deploymentConfig && d.deploymentConfig.versionNumber &&
      (d.entryPoints || []).some(e => e.entryPointType === 'WEB_APP'));
    for (const d of webApps) {
      const put = scriptApi_('put', id + '/deployments/' + d.deploymentId, {
        deploymentConfig: {
          scriptId: id, versionNumber: version.versionNumber, manifestFileName: 'appsscript',
          description: d.deploymentConfig.description || '',
        },
      });
      if (put.error) return put.error;
    }
    props.deleteProperty('UPDATE_UNDEPLOYED');
    return webApps.length
      ? 'Updated to ' + short + ' and deployed as version ' + version.versionNumber + '.'
      : 'Updated to ' + short + ' (version ' + version.versionNumber + '), but this script has no web app deployment to point at it. Deploy it as SETUP.md says.';
  } finally {
    lock.releaseLock();
  }
}

// 'owner/repo@branch' -> {repo, ref}.
function sourceOf_(s) {
  const m = String(s).trim().match(/^([\w.-]+\/[\w.-]+)(?:@(.+))?$/);
  return m ? { repo: m[1], ref: m[2] || 'main' } : sourceOf_(UPDATE_FROM);
}

// The apps-script/ files of from's latest commit: {commit, files: [{name, type, source}]}, or {error}.
function fetchSource_(from) {
  // Pin the commit so every file comes from the same one (raw files are cached for a few minutes).
  // GitHub's API allows few calls per address, and Apps Script shares Google's, so fall back to
  // the branch if it says no.
  const head = UrlFetchApp.fetch('https://api.github.com/repos/' + from.repo + '/commits/' + encodeURIComponent(from.ref),
    { headers: { Accept: 'application/vnd.github.sha' }, muteHttpExceptions: true });
  const sha = head.getResponseCode() === 200 ? head.getContentText().trim() : '';
  const commit = /^[0-9a-f]{40}$/.test(sha) ? sha : from.ref;
  const raw = name => UrlFetchApp.fetch('https://raw.githubusercontent.com/' + from.repo + '/' + commit + '/apps-script/' + name,
    { muteHttpExceptions: true });
  const listed = raw('files.txt');
  if (listed.getResponseCode() !== 200) return { error: 'Couldn’t read the script’s files from GitHub (' + from.repo + ', ' + listed.getResponseCode() + '). Nothing was changed.' };
  const names = listed.getContentText().split('\n').map(s => s.trim()).filter(s => s && s[0] !== '#');
  const files = [];
  for (const name of names) {
    const m = name.match(/^([\w-]+)\.(gs|json|html)$/);
    if (!m) return { error: 'GitHub lists a file this can’t bring in (' + name + '). Nothing was changed.' };
    const res = raw(name);
    if (res.getResponseCode() !== 200) return { error: 'Couldn’t read ' + name + ' from GitHub (' + res.getResponseCode() + '). Nothing was changed.' };
    files.push({ name: m[1], type: { gs: 'SERVER_JS', json: 'JSON', html: 'HTML' }[m[2]], source: res.getContentText() });
  }
  if (!files.some(f => f.type === 'JSON')) return { error: 'GitHub’s files have no appsscript.json. Nothing was changed.' };
  return { commit, files };
}

// Scopes the new manifest asks for that the old one didn't.
function newScopes_(before, after) {
  const scopes = files => {
    const f = (files || []).find(x => x.type === 'JSON' && x.name === 'appsscript');
    try { return (f && JSON.parse(f.source).oauthScopes) || []; } catch (e) { return []; }
  };
  const had = scopes(before);
  return scopes(after).filter(s => had.indexOf(s) < 0);
}

// A call to the Apps Script API as the person running the script: its answer, or {error}.
function scriptApi_(method, path, body) {
  const opts = { method, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true };
  if (body) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(body); }
  const res = UrlFetchApp.fetch(SCRIPT_API + path, opts);
  const code = res.getResponseCode();
  let out = {};
  try { out = JSON.parse(res.getContentText() || '{}'); } catch (e) {}
  if (code >= 200 && code < 300) return out;
  const msg = String((out.error && out.error.message) || code);
  if (/has not been used in project|is disabled|SERVICE_DISABLED/i.test(msg)) {
    return { error: 'The Apps Script API isn’t on for this script’s Google Cloud project, so it can’t update itself. SETUP.md, “Updating from the menu”, says how to set that up; until then, paste the files by hand. Nothing was changed.' };
  }
  if (/User has not enabled the Apps Script API/i.test(msg)) {
    return { error: 'Turn on “Google Apps Script API” at script.google.com/home/usersettings, then try again. Nothing was changed.' };
  }
  return { error: 'The Apps Script API said no (' + msg + '). Try again; what’s left is picked up where it stopped.' };
}
