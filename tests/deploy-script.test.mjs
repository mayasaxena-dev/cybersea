// Unit tests for tools/deploy-script.mjs (deploying apps-script/ from GitHub Actions), with Google's
// token endpoint and the Apps Script API stood in for by a fake fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deploy, localFiles, DeployError } from '../tools/deploy-script.mjs';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.currentonly'];
const manifest = scopes => JSON.stringify({ oauthScopes: scopes });
const CREDS = { scriptId: 'S1', clientId: 'cid', clientSecret: 'csec', refreshToken: 'rtok' };
const OLD = [
  { name: 'appsscript', type: 'JSON', source: manifest(SCOPES) },
  { name: 'Code', type: 'SERVER_JS', source: 'old code' },
  { name: 'Mine', type: 'SERVER_JS', source: 'the GM’s own' },
];
const REPO = [{ name: 'appsscript', type: 'JSON', source: manifest(SCOPES) }, { name: 'Code', type: 'SERVER_JS', source: 'new code' }];

function setup({ head = OLD, versions = { 3: OLD }, deployments, apiError, tokenError } = {}) {
  const state = {
    head: head.map(f => ({ ...f })), versions: { ...versions }, calls: [],
    deployments: deployments || [
      { deploymentId: 'HEAD', deploymentConfig: { scriptId: 'S1', manifestFileName: 'appsscript' }, entryPoints: [{ entryPointType: 'WEB_APP' }] },
      { deploymentId: 'D1', deploymentConfig: { scriptId: 'S1', versionNumber: 3, manifestFileName: 'appsscript', description: 'site' }, entryPoints: [{ entryPointType: 'WEB_APP' }] },
    ],
  };
  const res = (status, body) => ({ ok: status < 300, status, json: async () => body });
  const fetchFn = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    state.calls.push(`${method} ${url}`);
    if (url === 'https://oauth2.googleapis.com/token') {
      assert.match(opts.body, /refresh_token=rtok/);
      return tokenError ? res(400, { error: tokenError }) : res(200, { access_token: 'tok' });
    }
    assert.equal(opts.headers.Authorization, 'Bearer tok');
    if (apiError) return res(403, { error: { message: apiError } });
    const path = url.replace('https://script.googleapis.com/v1/projects/S1', '');
    const body = opts.body && JSON.parse(opts.body);
    const v = path.match(/^\/content\?versionNumber=(\d+)$/);
    if (v) return res(200, { files: state.versions[v[1]] });
    if (path === '/content' && method === 'GET') return res(200, { files: state.head.map(f => ({ ...f, createTime: 'x' })) });
    if (path === '/content' && method === 'PUT') { state.head = body.files; return res(200, body); }
    if (path === '/versions') {
      const n = Math.max(...Object.keys(state.versions).map(Number)) + 1;
      state.versions[n] = state.head.map(f => ({ ...f }));
      return res(200, { versionNumber: n, description: body.description });
    }
    if (path === '/deployments' && method === 'GET') return res(200, { deployments: state.deployments });
    const d = path.match(/^\/deployments\/(.+)$/);
    if (d && method === 'PUT') {
      const dep = state.deployments.find(x => x.deploymentId === d[1]);
      dep.deploymentConfig = body.deploymentConfig;
      return res(200, dep);
    }
    return res(404, {});
  };
  return { state, run: (opts = {}) => deploy({ ...CREDS, repo: REPO, fetchFn, ...opts }) };
}

test('puts the repository’s files in the script, keeps the GM’s own and redeploys the web app in place', async () => {
  const t = setup();
  assert.equal(await t.run({ label: 'main@abc' }), 'Deployed as version 4 to 1 web app deployment. The URL stays the same.');
  assert.deepEqual(t.state.head.map(f => [f.name, f.source]), [['appsscript', manifest(SCOPES)], ['Code', 'new code'], ['Mine', 'the GM’s own']]);
  assert.equal(t.state.deployments[1].deploymentConfig.versionNumber, 4);
  assert.equal(t.state.deployments[1].deploymentConfig.description, 'site');
  assert.equal(t.state.deployments[0].deploymentConfig.versionNumber, undefined, 'HEAD is left alone');
  // Again: nothing to do.
  assert.match(await t.run(), /^Already up to date: the web app runs version 4/);
  assert.equal(Object.keys(t.state.versions).length, 2);
});

test('code saved earlier but never deployed still gets deployed', async () => {
  const t = setup({ head: [...REPO, OLD[2]] });
  assert.match(await t.run(), /^Deployed as version 4/);
  assert.ok(!t.state.calls.includes('PUT https://script.googleapis.com/v1/projects/S1/content'), 'the files were already there');
});

test('new permissions: saves the code but deploys only once they’re allowed', async () => {
  const more = [...SCOPES, 'https://www.googleapis.com/auth/script.projects'];
  const t = setup();
  const repo = [{ name: 'appsscript', type: 'JSON', source: manifest(more) }, REPO[1]];
  await assert.rejects(t.run({ repo }), e => e instanceof DeployError && e.code === 2 && /saved but not deployed.*script\.projects/.test(e.message));
  assert.equal(t.state.head[1].source, 'new code');
  assert.equal(t.state.deployments[1].deploymentConfig.versionNumber, 3);
  await assert.rejects(t.run({ repo }), e => e.code === 2, 'still waits without the go-ahead');
  assert.match(await t.run({ repo, scopesApproved: true }), /^Deployed as version 4/);
});

test('no SCRIPT_ID is “not set up”, other secrets missing is an error', async () => {
  const t = setup();
  assert.match(await t.run({ scriptId: '' }), /^Not set up/);
  assert.equal(t.state.calls.length, 0);
  await assert.rejects(t.run({ refreshToken: '' }), /GOOGLE_REFRESH_TOKEN isn't set/);
});

test('an expired or revoked refresh token says how to make a new one', async () => {
  await assert.rejects(setup({ tokenError: 'invalid_grant' }).run(), /invalid_grant.*GOOGLE_REFRESH_TOKEN/);
});

test('the Apps Script API off in the owner’s settings: says where to turn it on and changes nothing', async () => {
  const t = setup({ apiError: 'User has not enabled the Apps Script API. Enable it by visiting https://script.google.com/home/usersettings' });
  await assert.rejects(t.run(), /script\.google\.com\/home\/usersettings.*Nothing was changed/);
});

test('a script without a web app deployment changes nothing', async () => {
  const t = setup({ deployments: [] });
  await assert.rejects(t.run(), /no web app deployment/);
  assert.equal(t.state.head[1].source, 'old code');
});

test('reads the files apps-script/files.txt lists', () => {
  const files = localFiles(new URL('../apps-script/', import.meta.url));
  assert.ok(files.some(f => f.name === 'appsscript' && f.type === 'JSON'));
  assert.ok(files.some(f => f.name === 'Update' && f.type === 'SERVER_JS'));
});
