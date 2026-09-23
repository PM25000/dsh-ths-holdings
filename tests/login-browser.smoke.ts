/** Opt-in test: opens a visible, isolated system browser against a local fixture only. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { launchLoginBrowser } from '../src/login-browser.ts'

let pageSignals: { getter: boolean; webdriver: boolean; widthGap: number; heightGap: number } | undefined
const server = createServer((req, res) => {
  if (req.url?.startsWith('/signals?')) {
    pageSignals = JSON.parse(new URL(req.url, 'http://localhost').searchParams.get('data')!)
    res.end('ok')
    return
  }
  res.setHeader('Set-Cookie', 'login_test=ok; Path=/; HttpOnly')
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(`<title>登录流程本机测试</title><p>正在测试本机登录流程，此窗口会自动关闭。</p>
    <script>
    let getter = false;
    const error = new Error('local test');
    Object.defineProperty(error, 'stack', { get() { getter = true; return 'local test'; } });
    console.log(error);
    setTimeout(() => fetch('/signals?data=' + encodeURIComponent(JSON.stringify({
      getter, webdriver: navigator.webdriver,
      widthGap: outerWidth-innerWidth, heightGap: outerHeight-innerHeight
    }))), 500);
    </script>`)
})
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  browser = await launchLoginBrowser(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
  let found = false
  for (let i = 0; i < 100; i++) {
    found = (await browser.cookies()).some(cookie => cookie.name === 'login_test' && cookie.value === 'ok')
    if (found && pageSignals) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.ok(found, 'HttpOnly cookie is read without attaching to the page')
  assert.equal(await browser.isClosed(), false)
  assert.ok(pageSignals, 'The visible page loads and reports its own signals')
  assert.equal(pageSignals.getter, false, 'Console serialization must not trigger the getter')
  assert.equal(pageSignals.webdriver, false)
  assert.ok(Math.abs(pageSignals.widthGap) < 160, 'No emulated viewport width mismatch')
  assert.ok(Math.abs(pageSignals.heightGap) < 200, 'No emulated viewport height mismatch')
  console.log(JSON.stringify({ cookieRead: found, pageSignals }))
} finally {
  try {
    await browser?.close()
    if (browser) assert.equal(browser.cleanupPending, false, 'The temporary profile is removed after exit')
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}
