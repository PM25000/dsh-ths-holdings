/** Opt-in integration test against an installed Desktop, isolated from the user's DSH home. */
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { createServer } = require('node:http');
const { pathToFileURL } = require('node:url');

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
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app',
    ...(process.argv.includes('--with-schedule') ? ['@deepseek-ai/dsh-experimental-schedule-bundle'] : []),
    'dsh-ths-holdings'] } },
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

const diagnosticRoot=path.join(root,'probe');
fs.mkdirSync(diagnosticRoot);
fs.writeFileSync(path.join(diagnosticRoot,'package.json'),JSON.stringify({name:'ths-compat-probe',private:true,type:'module'}));
const diagnostic=path.join(diagnosticRoot,'model-probe.mjs');
fs.writeFileSync(diagnostic, fs.readFileSync(path.join(__dirname,'desktop-probe.mjs'),'utf8').replace('__DSH_LLM_MODULE__',pathToFileURL(path.join(resources,'app.asar','dsh','node_modules','@deepseek-ai','dsh-llm','lib','index.js')).href));
fs.appendFileSync(path.join(profile,'cordis.patch.yml'), '\n- insert:\n    - id: ths-compat-probe\n      name: ' + JSON.stringify(diagnostic.replaceAll('\\','/')) + '\n');

// Only the external ledger is a fixture; loading, credentials, routes and UI use the real host.
let lastPnlFundKey;
let rejectAll = false, gatewayRefusals = 0;
const refusalBudget = new Map();
const ledger = createServer(async (req, res) => {
  if (!(req.headers.cookie || '').includes('userid=compat-test')) {
    res.writeHead(403); res.end(); return;
  }
  const remaining = refusalBudget.get(req.url) ?? 2;
  if (rejectAll || remaining > 0) {
    refusalBudget.set(req.url, remaining - 1); gatewayRefusals++;
    res.writeHead(403, { 'Content-Type': 'text/html' }); res.end('Nginx forbidden private-upstream-body'); return;
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
    ex_data = { data: [{ time: 1, zf: -1, yk: -40 }, { time: 2, zf: 2.5, yk: 100 }] };
  }
  else if (req.url.includes('stock_position')) ex_data = { money_remain:'20',total_value:'30.3',total_asset:'50.3',total_liability:'0',position_rate:'0.6024',upload_time:'1792048335000',position:[{market:'1',code:'000001',name:'示例',count:'3',cost:'10.01',price:'10.1',value:'30.3',hold_profit:'0.27',hold_rate:'0.00899',pre_profit:'0.3',pre_rate:'0.01',position_rate:'1'}] };
  else if (req.url.includes('sort_list')) ex_data = {list:[{market:'1',code:'000001',name:'示例完整名称'}]};
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
      assert.equal(res.status, 200, route + (res.status === 200 ? '' : ': ' + await res.text()));
      return res.json();
    };
    const inventory = await json('/api/pluginInventory/list', {
      type: 'client-request', rpcId: 'ths-compat', method: 'pluginInventory/list', payload: { args: {} },
    });
    fs.writeFileSync(path.join(root, 'inventory.json'), JSON.stringify(inventory, null, 2));
    fs.writeFileSync(path.join(root, 'host.stderr.log'), stderr);
    assert.equal(inventory.result?.ok, true);
    const entry = inventory.result.value.entries.find(e => e.moduleName === 'dsh-ths-holdings');
    assert.equal(entry?.fiberPhase, 'active', JSON.stringify(entry) + '\n' + stderr);
    assert.equal((await json('/api/stock-pnl/verify')).configured, false);
    assert.equal((await json('/api/stock-pnl/cookie', { value: 'userid=compat-test; sid=fixture' })).saved, true);
    assert.equal((await json('/api/stock-pnl/verify')).valid, true);
    const portfolios = await json('/api/stock-pnl/portfolios');
    assert.equal(portfolios.length, 2);
    assert.equal((await json('/api/stock-pnl/fund-key', { value: 'compat-two' })).saved, true);
    const capabilities = await json('/api/ths-compat/model');
    fs.writeFileSync(path.join(root,'model-capabilities.json'),JSON.stringify(capabilities,null,2));
    assert.equal(capabilities.skill,'ths-portfolio-report',JSON.stringify(capabilities));
    assert.deepEqual(capabilities.tools.sort(),['ths_get_pnl','ths_get_positions','ths_list_portfolios']);
    assert.equal(capabilities.result.isError,false,JSON.stringify(capabilities.result));
    const positionResult=JSON.parse(capabilities.result.content.filter(c=>c.type==='text').map(c=>c.text).join(''));
    assert.equal(positionResult.status,'ok',JSON.stringify(positionResult));
    assert.equal(positionResult.data.positions[0].name,'示例完整名称');
    const scheduling=await json('/api/ths-compat/schedule');
    fs.writeFileSync(path.join(root,'schedule-verification.json'),JSON.stringify(scheduling,null,2));
    if (scheduling.supported) {
      assert.equal(scheduling.coldSessionRestored,true);
      assert.equal(scheduling.timerDelivered,true);
      assert.equal(scheduling.reportPersisted,true);
    } else {
      assert(scheduling.missing?.includes('schedule'), JSON.stringify(scheduling));
      if(process.argv.includes('--require-schedule')) throw new Error('Installed Desktop has no schedule service: upgrade/configure the host before scheduled-report acceptance');
    }
    const stats = await json('/api/stock-pnl');
    assert.equal(stats.error, '');
    assert.equal(stats.pnl_pct, 2.5);
    assert.equal(stats.sh_pct, 1);
    assert.equal(lastPnlFundKey, 'compat-two', 'The snapshot uses the credential saved by the host');
    assert(gatewayRefusals >= 10, 'Every read path must recover from the injected refusals');
    rejectAll = true;
    const refused = await json('/api/stock-pnl');
    assert.equal(refused.token_expired, false);
    assert(refused.error.includes('稍后'));
    assert(!/403|Nginx|private-upstream-body/.test(refused.error));
    const verifyBlocked = await json('/api/stock-pnl/verify');
    assert.equal(verifyBlocked.reason, 'blocked');
    assert(!verifyBlocked.hint.includes('重新登录'));
    rejectAll = false;
    assert.equal((await json('/api/stock-pnl')).error, '');
    assert.equal((await request('/api/stock-pnl/cookie', { value: ';;;' })).status, 400);
    assert.equal((await json('/api/stock-pnl/verify')).valid, true);
    assert.ok(!stderr.includes('skipping profile bundle "dsh-ths-holdings"'));
    console.log(JSON.stringify({ host: runtimeVersion, plugin: entry.fiberPhase, skillMounted:true, modelTools:3, positionQuery:true, coldScheduleReport:scheduling.supported, missingScheduleServices:scheduling.missing??[], gatewayRecovery: true, sustainedGatewayFailureSanitized: true, gatewayRefusals, credentialSave: true,
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
