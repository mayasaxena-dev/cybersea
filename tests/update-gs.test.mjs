// Unit tests for apps-script/Update.gs (the Cybersea menu's Update the script), with GitHub and
// the Apps Script API stood in for by fakes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createGas, loadCodeGs } from '../tools/gas-fake.mjs';

const SHA = 'a'.repeat(40);
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.currentonly'];
const manifest = scopes => JSON.stringify({ oauthScopes: scopes });

// gh: {name: source} on GitHub (files.txt made from its keys); project: the script's files.
function setup({ gh, project, deployments, apiError, shaCode = 200 }) {
  const gas = createGas({ name: 'Cybersea', props: { GM_KEY: 'gm' }, tabs: {} });
  const { ctx } = loadCodeGs(gas);
  const calls = [];
  const state = { files: project.map(f => ({ ...f })), versions: 0, deployments };
  const res = (code, body) => ({ getResponseCode: () => code, getContentText: () => (typeof body === 'string' ? body : JSON.stringify(body)) });
  ctx.ScriptApp = { getScriptId: () => 'S1', getOAuthToken: () => 'tok' };
  ctx.UrlFetchApp = {
    fetch: (url, opts = {}) => {
      const method = opts.method || 'get';
      calls.push(`${method} ${url}`);
      if (url.startsWith('https://api.github.com/')) return res(shaCode, shaCode === 200 ? SHA : { message: 'rate limited' });
      const raw = url.match(/^https:\/\/raw\.githubusercontent\.com\/mayasaxena-dev\/cybersea\/([^/]+)\/apps-script\/(.+)$/);
      if (raw) {
        const files = { 'files.txt': '# list\n' + Object.keys(gh).join('\n') + '\n', ...gh };
        return raw[2] in files ? res(200, files[raw[2]]) : res(404, '404: Not Found');
      }
      assert.equal(opts.headers.Authorization, 'Bearer tok');
      if (apiError) return res(403, { error: { message: apiError } });
      const path = url.replace('https://script.googleapis.com/v1/projects/S1', '');
      const body = opts.payload && JSON.parse(opts.payload);
      if (path === '/content' && method === 'get') return res(200, { scriptId: 'S1', files: state.files.map(f => ({ ...f, createTime: 'x' })) });
      if (path === '/content' && method === 'put') { state.files = body.files; return res(200, body); }
      if (path === '/versions') return res(200, { versionNumber: ++state.versions + 4, description: body.description });
      if (path === '/deployments' && method === 'get') return res(200, { deployments: state.deployments });
      const d = path.match(/^\/deployments\/(.+)$/);
      if (d && method === 'put') {
        const dep = state.deployments.find(x => x.deploymentId === d[1]);
        dep.deploymentConfig = body.deploymentConfig;
        return res(200, dep);
      }
      return res(404, {});
    },
  };
  return { gas, ctx, calls, state, run: () => ctx.updateScript_() };
}

const DEPLOYMENTS = () => [
  { deploymentId: 'HEAD', deploymentConfig: { scriptId: 'S1', manifestFileName: 'appsscript' }, entryPoints: [{ entryPointType: 'WEB_APP' }] },
  { deploymentId: 'D1', deploymentConfig: { scriptId: 'S1', versionNumber: 3, manifestFileName: 'appsscript', description: 'site' }, entryPoints: [{ entryPointType: 'WEB_APP' }] },
];
const OLD = [
  { name: 'appsscript', type: 'JSON', source: manifest(SCOPES) },
  { name: 'Code', type: 'SERVER_JS', source: 'old code' },
  { name: 'Mine', type: 'SERVER_JS', source: 'the GM’s own' },
];

test('updates the code from the pinned commit, keeps the GM’s own files and redeploys the web app', () => {
  const t = setup({ gh: { 'appsscript.json': manifest(SCOPES), 'Code.gs': 'new code', 'Update.gs': 'update' }, project: OLD, deployments: DEPLOYMENTS() });
  assert.equal(t.run(), 'Updated to aaaaaaa and deployed as version 5.');
  assert.deepEqual(t.state.files.map(f => [f.name, f.type, f.source]), [
    ['appsscript', 'JSON', manifest(SCOPES)], ['Code', 'SERVER_JS', 'new code'], ['Mine', 'SERVER_JS', 'the GM’s own'], ['Update', 'SERVER_JS', 'update'],
  ]);
  assert.ok(t.calls.filter(c => c.includes('raw.githubusercontent')).every(c => c.includes(`/${SHA}/`)));
  assert.equal(t.state.deployments[1].deploymentConfig.versionNumber, 5);
  assert.equal(t.state.deployments[1].deploymentConfig.description, 'site');
  assert.equal(t.state.deployments[0].deploymentConfig.versionNumber, undefined, 'HEAD is left alone');
  assert.equal(t.ctx.PropertiesService.getScriptProperties().getProperty('UPDATE_UNDEPLOYED'), null);
  // Run again: nothing to do.
  assert.equal(t.run(), 'The script is already up to date (aaaaaaa).');
  assert.equal(t.state.versions, 1);
});

test('falls back to the branch when GitHub’s API turns the commit lookup down', () => {
  const t = setup({ gh: { 'appsscript.json': manifest(SCOPES), 'Code.gs': 'new code' }, project: OLD, deployments: DEPLOYMENTS(), shaCode: 403 });
  assert.equal(t.run(), 'Updated to main and deployed as version 5.');
  assert.ok(t.calls.some(c => c.includes('/cybersea/main/apps-script/Code.gs')));
});

test('new permissions: saves the code, deploys only on the next run (after they’re allowed)', () => {
  const more = [...SCOPES, 'https://www.googleapis.com/auth/script.projects'];
  const t = setup({ gh: { 'appsscript.json': manifest(more), 'Code.gs': 'new code' }, project: OLD, deployments: DEPLOYMENTS() });
  assert.match(t.run(), /saved but not deployed yet: it needs new permissions/);
  assert.equal(t.state.versions, 0);
  assert.equal(t.state.deployments[1].deploymentConfig.versionNumber, 3);
  assert.equal(t.run(), 'Updated to aaaaaaa and deployed as version 5.');
  assert.equal(t.state.deployments[1].deploymentConfig.versionNumber, 5);
});

test('the Apps Script API off in the script’s project: says how to set it up and changes nothing', () => {
  const t = setup({ gh: { 'Code.gs': 'x' }, project: OLD, deployments: DEPLOYMENTS(), apiError: 'Apps Script API has not been used in project 123 before or it is disabled.' });
  assert.match(t.run(), /isn’t on for this script’s Google Cloud project.*Nothing was changed/);
  assert.ok(!t.calls.some(c => c.includes('github')));
  const u = setup({ gh: { 'Code.gs': 'x' }, project: OLD, deployments: DEPLOYMENTS(), apiError: 'User has not enabled the Apps Script API. Enable it by visiting https://script.google.com/home/usersettings' });
  assert.match(u.run(), /script\.google\.com\/home\/usersettings/);
});

test('a file missing on GitHub changes nothing', () => {
  const t = setup({ gh: { 'appsscript.json': manifest(SCOPES), 'Code.gs': 'new' }, project: OLD, deployments: DEPLOYMENTS() });
  const fetch = t.ctx.UrlFetchApp.fetch;
  t.ctx.UrlFetchApp.fetch = (url, o) => (url.endsWith('/Code.gs') ? { getResponseCode: () => 404, getContentText: () => '' } : fetch(url, o));
  assert.match(t.run(), /Couldn’t read Code\.gs from GitHub \(404\)\. Nothing was changed\./);
  assert.equal(t.state.files[1].source, 'old code');
});

test('apps-script/files.txt lists every file of the Apps Script project', () => {
  const listed = readFileSync(new URL('../apps-script/files.txt', import.meta.url), 'utf8').split('\n').map(s => s.trim()).filter(s => s && s[0] !== '#');
  const files = readdirSync(new URL('../apps-script/', import.meta.url)).filter(f => /\.(gs|json|html)$/.test(f));
  assert.deepEqual([...listed].sort(), files.sort());
});
