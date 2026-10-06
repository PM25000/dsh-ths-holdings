/** Opt-in integration test against an installed Desktop, isolated from the user's DSH home. */
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { createServer } = require('node:http');

const repo = path.resolve(__dirname, '..');
const resources = process.env.DSH_DESKTOP_RESOURCES || path.join(process.env.LOCALAPPDATA || '', 'Programs', 'DeepSeek Harness', 'resources');
const executable = process.env.DSH_DESKTOP_EXECUTABLE || path.join(resources, '..', 'DeepSeek Harness.exe');
assert.ok(fs.existsSync(executable), 'Set DSH_DESKTOP_EXECUTABLE and DSH_DESKTOP_RESOURCES for the installed Desktop');
assert.ok(fs.existsSync(path.join(repo, 'lib', 'index.js')), 'Run npm run build first');
fs.mkdirSync(path.join(repo, 'dist'), { recursive: true });
const root = fs.mkdtempSync(path.join(repo, 'dist', 'desktop-compat-'));
const profile = path.join(root, 'profile');
const home = path.join(root, 'home');
fs.mkdirSync(path.join(profile, 'node_modules'), { recursive: true });
fs.mkdirSync(home, { recursive: true });
fs.symlinkSync(repo, path.join(profile, 'node_modules', 'dsh-ths-holdings'), process.platform === 'win32' ? 'junction' : 'dir');
fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify({
  name: 'ths-desktop-compat-test', private: true,
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-ths-holdings'] } },
  dependencies: { 'dsh-ths-holdings': `file:${repo.replaceAll('\\', '/')}` },
}));
fs.writeFileSync(path.join(profile, 'cordis.patch.yml'), `
- id: webserver
  config: { host: '127.0.0.1', port: 0 }
- id: desktop-product-telemetry
  disabled: true
- id: product-analytics
  disabled: true
- id: ths-holdings
  config: { cookieEnv: THS_COMPAT_COOKIE, fundKeyEnv: THS_COMPAT_FUND }
`);

// Only the external ledger is a fixture; loading, credentials, routes and UI use the real host.
let lastPnlFundKey;
const ledger = createServer(async (req, res) => {
  if (!(req.headers.cookie || '').includes('userid=compat-test')) {
    res.writeHead(403); res.end(); return;
  }
  let body = '';
  for await (const chunk of req) body += chunk;
  res.setHeader('Content-Type', 'application/json');
  let ex_data;
  if (req.url.includes('account_list')) ex_data = { common: [
    { fund_key: 'compat-one', manualname: '兼容性测试组合一', brokername: '测试' },
    { fund_key: 'compat-two', manualname: '兼容性测试组合二', brokername: '测试' },
  ] };
  else if (req.url.includes('time_share')) {
    lastPnlFundKey = new URLSearchParams(body).get('fund_key');
    ex_data = { data: [{ time: 1, zf: -1 }, { time: 2, zf: 2.5 }] };
  }
  else if (req.url.includes('getQuotes')) ex_data = [{ zqdm: '1A0001', xianjia: 3030, zuoshou: 3000 }];
  else { res.writeHead(404); res.end(); return; }
  res.end(JSON.stringify({ error_code: '0', ex_data }));
});

async function main() {
  await new Promise(resolve => ledger.listen(0, '127.0.0.1', resolve));
  const runtime = path.join(resources, 'app.asar', 'dsh');
  const preload = path.join(root, 'ledger-fixture.cjs');
  fs.writeFileSync(preload, `const runtimeVersion = require(${JSON.stringify(path.join(runtime, 'package.json'))}).version;
process.env.DSH_CLIENT_VERSION = runtimeVersion;
process.send?.({ type: 'compat-runtime', version: runtimeVersion });
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.hostname === 'tzzb.10jqka.com.cn') return originalFetch('http://127.0.0.1:${ledger.address().port}' + url.pathname + url.search, init);
  return originalFetch(input, init);
};\n`);
  const child = spawn(executable, ['--expose-internals', '--require', preload,
    path.join(runtime, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'index.js'),
    runtime, profile, path.join(resources, 'runtime', 'primary-runtime')], {
    cwd: profile, windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_HOME: home },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.on('data', () => {});
  const exit = new Promise(resolve => {
    child.once('exit', resolve);
    child.on('error', () => { if (child.pid === undefined) resolve(); });
  });
  const deadline = setTimeout(() => child.kill(), process.argv.includes('--serve') ? 15 * 60_000 : 90_000);
  let stopPoll;
  let runtimeVersion;
  try {
    const ready = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.once('exit', code => reject(new Error(`Desktop host exited (${code}): ${stderr}`)));
      child.on('message', m => {
        if (m.type === 'compat-runtime') runtimeVersion = m.version;
        if (m.type === 'ready') resolve(m);
        if (m.type === 'fatal') reject(new Error(m.message));
      });
    });
    assert.ok(runtimeVersion, 'The installed runtime reports its version');
    const auth = await fetch(ready.url, { redirect: 'manual' });
    const cookie = auth.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    const origin = new URL(ready.url).origin;
    const request = (route, value) => fetch(origin + route, {
      ...(value === undefined ? {} : { method: 'POST', body: JSON.stringify(value) }),
      headers: { Cookie: cookie, 'Content-Type': 'application/json', Origin: origin },
    });
    const json = async (route, value) => {
      const res = await request(route, value);
      assert.equal(res.status, 200, route);
      return res.json();
    };
    const inventory = await json('/api/pluginInventory/list', {
      type: 'client-request', rpcId: 'ths-compat', method: 'pluginInventory/list', payload: { args: {} },
    });
    assert.equal(inventory.result?.ok, true);
    const entry = inventory.result.value.entries.find(e => e.moduleName === 'dsh-ths-holdings');
    assert.equal(entry?.fiberPhase, 'active', JSON.stringify(entry));
    assert.equal((await json('/api/stock-pnl/verify')).configured, false);
    assert.equal((await json('/api/stock-pnl/cookie', { value: 'userid=compat-test; sid=fixture' })).saved, true);
    assert.equal((await json('/api/stock-pnl/verify')).valid, true);
    const portfolios = await json('/api/stock-pnl/portfolios');
    assert.equal(portfolios.length, 2);
    assert.equal((await json('/api/stock-pnl/fund-key', { value: 'compat-two' })).saved, true);
    const stats = await json('/api/stock-pnl');
    assert.equal(stats.error, '');
    assert.equal(stats.pnl_pct, 2.5);
    assert.equal(stats.sh_pct, 1);
    assert.equal(lastPnlFundKey, 'compat-two', 'The snapshot uses the credential saved by the host');
    assert.equal((await request('/api/stock-pnl/cookie', { value: ';;;' })).status, 400);
    assert.equal((await json('/api/stock-pnl/verify')).valid, true);
    assert.ok(!stderr.includes('skipping profile bundle "dsh-ths-holdings"'));
    console.log(JSON.stringify({ host: runtimeVersion, plugin: entry.fiberPhase, credentialSave: true,
      verification: true, portfolios: portfolios.length, snapshot: true, exemptionRequired: false }));
    if (process.argv.includes('--serve')) {
      // A private local handoff for manual UI verification; never print the authenticated URL.
      fs.writeFileSync(path.join(root, 'ready.json'), JSON.stringify({ url: ready.url, origin }), { mode: 0o600 });
      console.log(`UI_READY ${root}`);
      await new Promise(resolve => { stopPoll = setInterval(() => {
        if (fs.existsSync(path.join(root, 'stop'))) resolve();
      }, 500); child.once('exit', resolve); });
    }
  } finally {
    clearInterval(stopPoll);
    if (child.connected) child.send({ type: 'shutdown' }, () => {});
    const killer = setTimeout(() => child.kill(), 10_000);
    await exit;
    clearTimeout(killer);
    clearTimeout(deadline);
    fs.rmSync(path.join(root, 'ready.json'), { force: true });
    fs.writeFileSync(path.join(root, 'stderr.log'), stderr);
    await new Promise(resolve => ledger.close(resolve));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
