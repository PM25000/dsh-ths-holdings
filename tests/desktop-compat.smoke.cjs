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
  name: dsh-ths-holdings
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
    const entries = inventory.result.value.entries.filter(e => e.moduleName==='dsh-ths-holdings'||e.moduleName==='dsh-ths-holdings/skill');
    assert.equal(entries.length, 2, JSON.stringify(entries) + '\n' + stderr);
    for (const entry of entries) assert.equal(entry.fiberPhase, 'active', JSON.stringify(entry) + '\n' + stderr);
    assert(!inventory.result.value.entries.some(e => e.entryId.endsWith('ths-holdings-shared')), 'Shared container is hidden');
    const settingsRpc = async (method, args = {}) => {
      const result = await json('/api/settings/' + method, {
        type: 'client-request', rpcId: 'ths-settings-' + method, method: 'settings/' + method, payload: { args },
      });
      assert.equal(result.result?.ok, true, JSON.stringify(result));
      return result.result.value;
    };
    const settingsBefore = (await settingsRpc('describe')).namespaces.find(item => item.ns === 'ths-holdings');
    assert.deepEqual(settingsBefore.value, { pollMs: 20000, showCard: true });
    assert.equal(settingsBefore.autoGenerate, false);
    const settingsAfter = await settingsRpc('update', {
      ns: 'ths-holdings', patch: { pollMs: 5000, showCard: false }, expectedRevision: settingsBefore.revision,
    });
    assert.deepEqual(settingsAfter.value, { pollMs: 5000, showCard: false });
    assert.equal((await json('/api/stock-pnl')).poll_ms, 5000, 'Live Config updates reach card responses');
    const savedPatch = fs.readFileSync(path.join(profile, 'cordis.patch.yml'), 'utf8');
    assert(savedPatch.includes('showCard: false') && savedPatch.includes('pollMs: 5000'), 'Settings persist to the isolated profile');
    fs.writeFileSync(path.join(root, 'preferences-verification.json'), JSON.stringify({ defaults: settingsBefore.value, saved: settingsAfter.value, persisted: true, livePollingInterval: true }, null, 2));
    await settingsRpc('update', { ns: 'ths-holdings', patch: { showCard: true }, expectedRevision: (await settingsRpc('describe')).namespaces.find(item => item.ns === 'ths-holdings').revision });
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
    const bundle = await json('/api/ths-compat/bundle');
    assert.equal(bundle.meta.title.zh, '同花顺持仓插件', 'Plugin list and details use the bundle display name');
    assert.equal(bundle.rows.length, 2, 'Only the two feature rows have switches');
    assert.deepEqual(bundle.rows.map(row=>row.meta.title.zh).sort(), ['持仓报告 Skill', '同花顺持仓插件'].sort());
    const onlySkill = await json('/api/ths-compat/components/card/off');
    assert.deepEqual({ card: onlySkill.state.card, skill: onlySkill.state.skill }, { card: false, skill: true });
    assert.equal((await json('/api/stock-pnl/selection')).fund_key, 'compat-two');
    assert.equal((await json('/api/stock-pnl/verify')).valid, true, 'Login is available with only Skill enabled');
    const chat = await json('/api/ths-compat/chat');
    fs.writeFileSync(path.join(root, 'ordinary-chat-verification.json'), JSON.stringify(chat, null, 2));
    assert.equal(chat.userPrompt, true);
    assert.equal(chat.catalogVisible, true);
    assert.equal(chat.bodyLoaded, true);
    assert.equal(chat.positionsQueried, true);
    assert.equal(chat.reportPersisted, true);
    const skillMenu = await json('/api/skills/list', {
      type: 'client-request', rpcId: 'ths-chat-skill-menu', method: 'skills/list', payload: { args: { request: { sessionId: chat.sessionId } } },
    });
    assert.equal(skillMenu.result?.ok, true, JSON.stringify(skillMenu));
    const listedSkill = skillMenu.result.value.skills.find(skill => skill.name === 'ths-portfolio-report');
    assert(listedSkill, 'The ordinary composer / menu lists the bundled Skill');
    assert.equal(listedSkill.modelInvocable, true);
    fs.writeFileSync(path.join(root, 'skill-menu-verification.json'), JSON.stringify({ skill: listedSkill.name, modelInvocable: listedSkill.modelInvocable, slashMenuVisible: true }, null, 2));
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
    const neither = await json('/api/ths-compat/components/skill/off');
    assert.equal(neither.state.card || neither.state.skill, false);
    assert.equal((await request('/api/stock-pnl')).status, 404, 'Last component releases the shared routes');
    assert.deepEqual((await json('/api/ths-compat/model')).tools, []);
    const onlyCard = await json('/api/ths-compat/components/card/on');
    assert.equal(onlyCard.state.card, true); assert.equal(onlyCard.state.skill, false);
    assert.deepEqual((await json('/api/ths-compat/model')).tools, []);
    assert.equal((await json('/api/stock-pnl')).error, '');
    assert.equal((await json('/api/stock-pnl/selection')).fund_key, 'compat-two');
    assert.deepEqual((await settingsRpc('describe')).namespaces.find(item=>item.ns==='ths-holdings').value, { pollMs: 5000, showCard: true });
    for(let cycle=0;cycle<2;cycle++) {
      await json('/api/ths-compat/components/card/off');
      assert.equal((await request('/api/stock-pnl')).status,404);
      await json('/api/ths-compat/components/card/on');
      assert.equal((await json('/api/stock-pnl')).error,'');
    }
    await json('/api/ths-compat/components/skill/on');
    assert.equal((await json('/api/ths-compat/model')).tools.length,3);
    fs.writeFileSync(path.join(root,'components-verification.json'),JSON.stringify({twoVisibleComponents:true,localizedNames:true,skillOnlyChat:true,skillOnlySchedule:scheduling.supported,cardOnly:true,neitherReleasesRoutes:true,repeatToggle:true,settingsPreserved:true},null,2));
    assert.ok(!stderr.includes('skipping profile bundle "dsh-ths-holdings"'));
    console.log(JSON.stringify({ host: runtimeVersion, plugin: 'active', components: 2, skillMounted:true, modelTools:3, positionQuery:true, ordinaryChat:true, ordinaryChatCatalog:chat.catalogVisible, slashMenuVisible:true, ordinaryChatWithoutSchedule:!chat.scheduleServicePresent, coldScheduleReport:scheduling.supported, missingScheduleServices:scheduling.missing??[], gatewayRecovery: true, sustainedGatewayFailureSanitized: true, gatewayRefusals, credentialSave: true,
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
