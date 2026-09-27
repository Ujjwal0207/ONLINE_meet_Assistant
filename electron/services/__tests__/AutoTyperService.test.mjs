import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const services = path.resolve(import.meta.dirname, '..');
function loadSource(file, imports = {}) {
    const output = ts.transpileModule(fs.readFileSync(path.join(services, file), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', output)((name) => imports[name] ?? require(name), module, module.exports);
    return module.exports;
}
const script = loadSource('AutoTypeScript.ts');
const permissions = loadSource('AutoTypePermissions.ts');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(check) {
    const deadline = Date.now() + 2000;
    while (!check()) {
        assert.ok(Date.now() < deadline, 'timed out waiting for worker');
        await sleep(5);
    }
}
function harness({ hung = false, escapeTaken = false, trusted = true, packaged = true } = {}) {
    const states = [];
    const children = [];
    const shortcuts = new Map(escapeTaken ? [['Escape', () => {}]] : []);
    const fakeElectron = {
        app: { isPackaged: packaged, getName: () => 'Natively', getPath: () => packaged ? '/Applications/Natively.app/Contents/MacOS/Natively' : '/dev/Electron.app/Contents/MacOS/Electron' },
        systemPreferences: { isTrustedAccessibilityClient: () => trusted },
        BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (_, state) => states.push(state) } }] },
        globalShortcut: {
            register: (key, callback) => { shortcuts.set(key, callback); },
            unregister: (key) => { shortcuts.delete(key); },
            isRegistered: (key) => shortcuts.has(key),
        },
    };
    function spawn(_binary, args) {
        const child = new EventEmitter();
        child.stderr = new EventEmitter();
        child.config = JSON.parse(fs.readFileSync(args[4], 'utf8'));
        child.action = args[5];
        child.killed = false;
        let timer;
        child.finish = (code = 0, signal = null) => {
            if (timer) clearInterval(timer);
            child.emit('close', code, signal);
        };
        child.kill = (signal) => { child.killed = true; queueMicrotask(() => child.finish(null, signal)); return true; };
        children.push(child);
        if (child.action === 'restore') queueMicrotask(() => child.finish());
        else if (!hung) timer = setInterval(() => {
            if (!fs.existsSync(child.config.markerPath)) child.finish();
        }, 5);
        return child;
    }
    const { AutoTyperService } = loadSource('AutoTyperService.ts', {
        electron: fakeElectron,
        child_process: { spawn },
        './AutoTypeScript': script,
        './AutoTypePermissions': permissions,
    });
    return { service: AutoTyperService.getInstance(), states, children, shortcuts };
}

for (const mode of ['char', 'word', 'instant']) {
    test(`${mode} preserves exact tabs, spaces, blank lines, CRLF and Unicode`, () => {
        const source = 'function demo() {\r\n\tconst café = "🙂";  \r\n\r\n    return café;\r\n}\n';
        const units = script.buildAutoTypeUnits(source, mode, 240, true);
        assert.equal(units.map((unit) => unit.text).join(''), source);
        if (mode !== 'instant') assert.ok(units.every((unit) => Array.from(unit.text).length <= (mode === 'char' ? 2 : 16)));
    });
}
test('word mode splits syntax words and bounds minified lines without adding separators', () => {
    const source = `a${'b'.repeat(1000)}\t\n  c`;
    const units = script.buildAutoTypeUnits(source, 'word', 240, true);
    assert.ok(units.length > 100);
    assert.equal(units.map((unit) => unit.text).join(''), source);
    assert.ok(units.filter((unit) => /\s/u.test(unit.text)).every((unit) => unit.text.length === 1));
    assert.equal(units.reduce((total, unit) => total + unit.delayMs, 0), source.length * 240);
});

test('Escape during countdown settles the start request and leaves cancelled state', async () => {
    const { service, shortcuts, states, children } = harness();
    const running = service.start({ code: 'abc', mode: 'char', countdownSec: 5 });
    assert.equal(service.getState().status, 'countdown');
    shortcuts.get('Escape')();
    const result = await Promise.race([running, sleep(150).then(() => 'unresolved')]);
    assert.deepEqual(result, { success: false, error: 'Auto-typing cancelled.' });
    assert.equal(service.getState().status, 'cancelled');
    assert.equal(children.length, 0);
    assert.equal(shortcuts.has('Escape'), false);
    assert.equal(states.some((state) => state.status === 'error' || state.status === 'done'), false);
});

test('global Escape interrupts an active worker while an external editor has focus', async () => {
    const { service, children, shortcuts } = harness();
    const running = service.start({ code: 'a'.repeat(200), mode: 'char', countdownSec: 0, wordsPerMinute: 40 });
    await waitFor(() => children.length > 0);
    const directory = path.dirname(children[0].config.markerPath);
    assert.equal(children[0].config.units[0].delayMs, 300);
    shortcuts.get('Escape')();
    const result = await running;
    assert.equal(result.success, false);
    assert.equal(service.getState().status, 'cancelled');
    assert.equal(children[0].killed, false, 'cooperative cancellation allows clipboard restoration');
    assert.equal(fs.existsSync(directory), false);
});

test('UI cancel stops a run and an immediate restart retains its own process/state', async () => {
    const { service, children, shortcuts } = harness();
    const first = service.start({ code: 'first', mode: 'char', countdownSec: 0 });
    await waitFor(() => children.length === 1);
    const cancelled = service.cancel();
    const second = service.start({ code: 'second', mode: 'word', countdownSec: 0, wordsPerMinute: 60 });
    await cancelled;
    assert.equal((await first).success, false);
    await waitFor(() => children.length === 2);
    assert.equal(service.getState().status, 'typing');
    assert.equal(shortcuts.has('Escape'), true);
    assert.equal(children[1].config.units[0].delayMs, 1200);
    // A late close from the old child cannot clear the current child's handle.
    children[0].finish();
    await service.cancel();
    assert.equal((await second).success, false);
    assert.equal(service.getState().status, 'cancelled');
});

test('normal completion releases Escape and removes private temporary files', async () => {
    const { service, children, shortcuts } = harness();
    const running = service.start({ code: 'done', mode: 'char', countdownSec: 0 });
    await waitFor(() => children.length === 1);
    const directory = path.dirname(children[0].config.markerPath);
    assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
    children[0].finish();
    assert.deepEqual(await running, { success: true });
    assert.equal(service.getState().status, 'done');
    assert.equal(shortcuts.has('Escape'), false);
    assert.equal(fs.existsSync(directory), false);
});

test('stalled native input is killed and runs clipboard recovery instead of finishing the snippet', async () => {
    const { service, children } = harness({ hung: true });
    const running = service.start({ code: 'a'.repeat(500), mode: 'word', countdownSec: 0 });
    await waitFor(() => children.length === 1);
    await service.cancel();
    assert.equal((await running).success, false);
    assert.equal(children[0].killed, true);
    assert.equal(children[1].action, 'restore');
    assert.equal(service.getState().status, 'cancelled');
});

test('does not start if a global Escape stop cannot be registered', async () => {
    const { service, children, shortcuts } = harness({ escapeTaken: true });
    const result = await service.start({ code: 'abc', mode: 'char', countdownSec: 0 });
    assert.equal(result.success, false);
    assert.match(result.error, /Escape/);
    assert.equal(children.length, 0);
    assert.equal(shortcuts.has('Escape'), true, 'leaves another owner\'s shortcut untouched');
});


test('stops if rebuilding application shortcuts removes the Escape handler', async () => {
    const { service, children, shortcuts } = harness();
    const running = service.start({ code: 'abc', mode: 'char', countdownSec: 0 });
    await waitFor(() => children.length === 1);
    shortcuts.clear();
    assert.equal((await running).success, false);
    assert.equal(service.getState().status, 'cancelled');
});

for (const [diagnostic, expected] of [
    ['Not authorized to send Apple events to System Events. (-1743)', 'automation'],
    ['System Events got an error: osascript is not allowed assistive access. (-1719)', 'accessibility'],
    ['System Events got an error: osascript is not allowed to send keystrokes. (1002)', 'accessibility'],
]) {
    test(`worker error identifies ${expected} without mislabelling the permission`, async () => {
        const { service, children } = harness();
        const running = service.start({ code: 'test', mode: 'char', countdownSec: 0 });
        await waitFor(() => children.length === 1);
        children[0].stderr.emit('data', Buffer.from(diagnostic));
        children[0].finish(1);
        const result = await running;
        assert.equal(result.success, false);
        assert.equal(service.getState().errorCode, expected);
        assert.match(result.error, /fully quit and reopen Natively/);
        if (expected === 'automation') {
            assert.match(result.error, /Automation/);
            assert.doesNotMatch(result.error, /Accessibility/);
        }
    });
}

test('unrelated worker failures retain their actual cause', () => {
    assert.deepEqual(permissions.describeAutoTypeFailure('Permission denied: clipboard.json', 'Natively'), {
        message: 'Permission denied: clipboard.json',
    });
});

test('permission check identifies the running app instead of a different installed copy', () => {
    const production = harness({ trusted: false }).service.getPermissionStatus();
    assert.equal(production.granted, false);
    assert.equal(production.appName, 'Natively');
    assert.equal(production.appPath, '/Applications/Natively.app');
    const development = harness({ packaged: false }).service.getPermissionStatus();
    assert.match(development.appName, /Electron/);
    assert.equal(development.appPath, '/dev/Electron.app');
});
