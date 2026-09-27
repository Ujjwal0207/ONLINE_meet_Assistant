// Opt-in live smoke test: launches the built app and sends a harmless request
// through its real preload/IPC connection. Requires an authenticated agy CLI.
// Uses the current app profile and selects Antigravity as requested by the user.
const { _electron } = require('playwright');
const path = require('node:path');

(async () => {
  const app = await _electron.launch({
    args: [path.resolve(__dirname, '..')],
    env: { ...process.env, NODE_ENV: 'production', NATIVELY_DISABLE_PHONE_MIRROR: '1' },
    timeout: 45000,
  });
  try {
    let page;
    const deadline = Date.now() + 45000;
    while (!page && Date.now() < deadline) {
      for (const candidate of app.windows()) {
        if (await candidate.evaluate(() => typeof window.electronAPI?.getAntigravityConfig === 'function').catch(() => false)) {
          page = candidate;
          break;
        }
      }
      if (!page) await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!page) throw new Error('Assistant window did not expose Antigravity IPC.');
    const status = await page.evaluate(() => window.electronAPI.getAntigravityStatus());
    console.log('Installation:', JSON.stringify(status));
    if (!status.installed) throw new Error(status.error);
    const saved = await page.evaluate(async () => {
      const result = await window.electronAPI.setAntigravityConfig({ enabled: true, path: 'agy', model: 'gemini-3.8-flash-medium', timeoutMs: 120000 });
      if (!result.success) throw new Error(result.error);
      const selected = await window.electronAPI.setDefaultModel('antigravity');
      if (!selected.success) throw new Error(selected.error);
      return window.electronAPI.getCurrentLlmConfig();
    });
    console.log('Selected provider:', JSON.stringify(saved));
    if (process.argv.includes('--setup-only')) {
      await page.evaluate(() => window.electronAPI.openSettingsTab('ai-providers'));
      console.log('PASS: Antigravity installation and model-selection IPC; live request not run.');
      return;
    }
    const test = await page.evaluate(() => window.electronAPI.testAntigravity());
    console.log('Live connection:', JSON.stringify(test));
    if (!test.success || !test.response?.includes('Antigravity connected')) throw new Error(test.error || 'Unexpected test response.');
    const answer = await page.evaluate(() => new Promise((resolve, reject) => {
      const api = window.electronAPI;
      let output = '';
      const cleanups = [];
      const cleanup = () => { clearTimeout(timer); cleanups.forEach(fn => fn()); };
      const timer = setTimeout(() => { cleanup(); reject(new Error('Chat smoke test timed out.')); }, 150000);
      cleanups.push(api.onGeminiStreamToken(token => { output += token; }));
      cleanups.push(api.onGeminiStreamDone(data => { cleanup(); resolve(data?.finalText || output); }));
      cleanups.push(api.onGeminiStreamError(error => { cleanup(); reject(new Error(error)); }));
      api.streamGeminiChat('What is 17 plus 26? Reply with just the number.', [], '').catch(error => { cleanup(); reject(error); });
    }));
    console.log('Chat pipeline answer:', JSON.stringify(answer));
    if (!String(answer).includes('43')) throw new Error('Chat did not return the expected answer.');
    await page.evaluate(() => window.electronAPI.openSettingsTab('ai-providers'));
    console.log('PASS: renderer → IPC → Antigravity → renderer.');
  } finally {
    await app.close();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
