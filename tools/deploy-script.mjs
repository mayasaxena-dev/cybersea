#!/usr/bin/env node
// Deploys apps-script/ to a game's Apps Script project from GitHub Actions
// (.github/workflows/deploy-script.yml), the way Cybersea → Update the script does from the sheet:
// puts the files listed in apps-script/files.txt in the project (keeping files the repository
// doesn't have, such as a GM's own), saves a version and points every web app deployment at it,
// so the URL and invite links stay the same.
//
// Everything secret comes from the environment, never from the repository:
//   SCRIPT_ID                  the game's script id (Apps Script → Project Settings → IDs)
//   GOOGLE_CLIENT_ID           an OAuth client of the game's Google Cloud project
//   GOOGLE_CLIENT_SECRET       …its secret
//   GOOGLE_REFRESH_TOKEN       the script owner's refresh token for that client, with the
//                              script.projects and script.deployments scopes
// and, optionally:
//   SCOPES_APPROVED=true       deploy even though appsscript.json asks for new permissions (once
//                              the owner has allowed them in the editor)
//   DEPLOY_LABEL               what the version's description names, like main@abc1234
//
// Exit codes: 0 deployed or already up to date, 1 failed, 2 saved but waiting for permissions.

import { readFileSync } from 'node:fs';

const SCRIPT_API = 'https://script.googleapis.com/v1/projects/';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TYPES = { gs: 'SERVER_JS', json: 'JSON', html: 'HTML' };

export class DeployError extends Error {
  constructor(message, code = 1) { super(message); this.code = code; }
}

// The repository's apps-script/ files, as the Apps Script API names them.
export function localFiles(dir) {
  const read = name => readFileSync(new URL(name, dir), 'utf8');
  const names = read('files.txt').split('\n').map(s => s.trim()).filter(s => s && s[0] !== '#');
  const files = names.map(name => {
    const m = name.match(/^([\w-]+)\.(gs|json|html)$/);
    if (!m) throw new DeployError(`apps-script/files.txt lists a file the Apps Script API can't take (${name}).`);
    return { name: m[1], type: TYPES[m[2]], source: read(name) };
  });
  if (!files.some(f => f.type === 'JSON' && f.name === 'appsscript')) throw new DeployError('apps-script/files.txt has no appsscript.json.');
  return files;
}

// project's files with the repository's put over those of the same name and type.
export function merge(project, repo) {
  const files = (project || []).map(f => ({ name: f.name, type: f.type, source: f.source }));
  for (const f of repo) {
    const i = files.findIndex(x => x.name === f.name && x.type === f.type);
    if (i < 0) files.push({ ...f }); else files[i] = { ...f };
  }
  return files;
}

const same = (a, b) => a.length === b.length && a.every(f => b.some(x => x.name === f.name && x.type === f.type && x.source === f.source));

// Scopes the new manifest asks for that the old one didn't.
export function newScopes(before, after) {
  const scopes = files => {
    const f = (files || []).find(x => x.type === 'JSON' && x.name === 'appsscript');
    try { return (f && JSON.parse(f.source).oauthScopes) || []; } catch (e) { return []; }
  };
  const had = scopes(before);
  return scopes(after).filter(s => !had.includes(s));
}

async function accessToken({ clientId, clientSecret, refreshToken }, fetchFn) {
  const res = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }).toString(),
  });
  const out = await res.json().catch(() => ({}));
  if (res.ok && out.access_token) return out.access_token;
  if (out.error === 'invalid_grant') {
    throw new DeployError('Google turned the refresh token down (invalid_grant): it was revoked, or expired because the OAuth app is still in testing. Make a new one as the README says ("Deploying from GitHub") and update GOOGLE_REFRESH_TOKEN.');
  }
  throw new DeployError(`Couldn't get an access token from Google (${res.status} ${out.error || ''}). Check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.`);
}

function api(token, fetchFn) {
  return async (method, path, body) => {
    const res = await fetchFn(SCRIPT_API + path, {
      method,
      headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const out = await res.json().catch(() => ({}));
    if (res.ok) return out;
    const msg = String((out.error && out.error.message) || res.status);
    if (/User has not enabled the Apps Script API/i.test(msg)) {
      throw new DeployError('Turn on "Google Apps Script API" at script.google.com/home/usersettings (signed in as the script\'s owner), then run this again. Nothing was changed.');
    }
    if (/has not been used in project|is disabled|SERVICE_DISABLED/i.test(msg)) {
      throw new DeployError('The Apps Script API isn\'t enabled in the Google Cloud project of the OAuth client. Enable it there (APIs & Services → Library). Nothing was changed.');
    }
    if (res.status === 404) throw new DeployError('Apps Script found no project with that SCRIPT_ID that this account can edit. Nothing was changed.');
    throw new DeployError(`The Apps Script API said no to ${method} ${path.replace(/^[^/]+/, '<script>')} (${msg}). Run it again; it picks up where it stopped.`);
  };
}

// Deploys repo (the files from localFiles) to the project; returns what to say.
export async function deploy({ scriptId, clientId, clientSecret, refreshToken, scopesApproved = false, label = '', repo, fetchFn = fetch, log = () => {} }) {
  const secrets = { SCRIPT_ID: scriptId, GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret, GOOGLE_REFRESH_TOKEN: refreshToken };
  const missing = Object.keys(secrets).filter(k => !secrets[k]);
  // No script id: this environment has no game set up for it, which isn't a failure.
  if (!scriptId) return 'Not set up: this environment has no SCRIPT_ID secret, so nothing was deployed (README, "Deploying from GitHub").';
  if (missing.length) throw new DeployError(`${missing.join(', ')} ${missing.length > 1 ? 'aren\'t' : 'isn\'t'} set. Add ${missing.length > 1 ? 'them' : 'it'} to this environment's secrets as the README says ("Deploying from GitHub").`);
  const call = api(await accessToken({ clientId, clientSecret, refreshToken }, fetchFn), fetchFn);
  const id = encodeURIComponent(scriptId);

  const list = await call('GET', id + '/deployments');
  // The web app deployments made with Deploy → New deployment (the HEAD one has no version).
  const webApps = (list.deployments || []).filter(d => d.deploymentConfig && d.deploymentConfig.versionNumber &&
    (d.entryPoints || []).some(e => e.entryPointType === 'WEB_APP'));
  if (!webApps.length) throw new DeployError('This script has no web app deployment to update. Deploy it once by hand (README, "3. Deploy it"), then run this again.');

  // What the web app runs now: the newest version any of its deployments is on.
  const live = Math.max(...webApps.map(d => d.deploymentConfig.versionNumber));
  const liveFiles = (await call('GET', `${id}/content?versionNumber=${live}`)).files || [];
  const head = (await call('GET', id + '/content')).files || [];
  const want = merge(head, repo);
  const liveHasRepo = same(merge(liveFiles, repo), liveFiles.map(f => ({ name: f.name, type: f.type, source: f.source })));
  if (liveHasRepo && webApps.every(d => d.deploymentConfig.versionNumber === live)) return `Already up to date: the web app runs version ${live}, which has these files.`;

  if (!same(want, head.map(f => ({ name: f.name, type: f.type, source: f.source })))) {
    await call('PUT', id + '/content', { files: want });
    log('Saved the new files in the script.');
  }
  const added = newScopes(liveFiles, want);
  if (added.length && !scopesApproved) {
    throw new DeployError(
      `The new code is saved but not deployed: appsscript.json asks for new permissions (${added.join(', ')}), and the web app would fail until the owner allows them. ` +
      'Open the script in the Apps Script editor, pick onOpen in the function list, click Run and allow what it asks. ' +
      'Then run this workflow again from the Actions tab with "New permissions are allowed" ticked.', 2);
  }

  const version = await call('POST', id + '/versions', { description: ('Deployed from GitHub ' + label).trim() });
  for (const d of webApps) {
    await call('PUT', `${id}/deployments/${encodeURIComponent(d.deploymentId)}`, {
      deploymentConfig: { scriptId, versionNumber: version.versionNumber, manifestFileName: 'appsscript', description: d.deploymentConfig.description || '' },
    });
  }
  return `Deployed as version ${version.versionNumber} to ${webApps.length} web app deployment${webApps.length > 1 ? 's' : ''}. The URL stays the same.`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = process.env;
  try {
    const msg = await deploy({
      scriptId: env.SCRIPT_ID, clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, refreshToken: env.GOOGLE_REFRESH_TOKEN,
      scopesApproved: env.SCOPES_APPROVED === 'true', label: env.DEPLOY_LABEL || '',
      repo: localFiles(new URL('../apps-script/', import.meta.url)), log: console.log,
    });
    console.log(msg);
  } catch (e) {
    if (!(e instanceof DeployError)) throw e;
    console.error(env.GITHUB_ACTIONS ? `::error::${e.message}` : e.message);
    process.exit(e.code);
  }
}
