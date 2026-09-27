import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const mainSource = readFileSync(new URL('../../main.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('main.ts', mainSource, ts.ScriptTarget.Latest, true);
const appState = ast.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'AppState');
// Run the production lifecycle methods without booting Electron or real audio hardware.
const members = new Set([
    'audioTestCapture', '_audioTestStartPromise', '_audioTestTeardown',
    'audioTestSystemCapture', '_audioTestEpoch', '_audioTestSystemProbeTimer',
    'startAudioTest', '_startAudioTestImpl', 'stopAudioTest',
]);
const selectedSource = appState.members.filter(node => members.has(node.name?.getText(ast))).map(node => node.getText(ast)).join('\n');
const compiled = ts.transpileModule(`export class AudioTestHarness { ${selectedSource} }`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

function harness(permission = async () => true) {
    const microphones = [];
    const systems = [];
    const timers = new Set();
    const events = [];
    class FakeCapture extends EventEmitter {
        constructor(deviceId, collection) {
            super();
            this.deviceId = deviceId;
            this.stopped = false;
            collection.push(this);
        }
        start() {}
        disablePreWarm() {}
        stop() { this.stopped = true; return this.teardown ?? Promise.resolve(); }
    }
    const exports = {};
    runInNewContext(compiled, {
        exports, Buffer, console: { log() {}, warn() {}, error() {} },
        MicrophoneCapture: class extends FakeCapture { constructor(id) { super(id, microphones); } },
        SystemAudioCapture: class extends FakeCapture { constructor(id) { super(id, systems); } },
        ensureMacMicrophoneAccess: permission,
        resolveMacScreenCaptureCapability: async () => ({ canCapture: true }),
        formatPermissionMessage: () => 'Microphone permission denied',
        setTimeout: callback => { timers.add(callback); return callback; },
        clearTimeout: callback => timers.delete(callback),
    });
    const state = new exports.AudioTestHarness();
    const target = { isDestroyed: () => false };
    state.settingsWindowHelper = { getSettingsWindow: () => target };
    state.getWindowHelper = () => ({ getLauncherWindow: () => null, getOverlayWindow: () => null });
    state.sendToWindow = (_target, event, payload) => events.push({ event, payload });
    return { state, microphones, systems, events, timers };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test('closing settings while microphone permission is pending creates no capture', async () => {
    const permission = deferred();
    const { state, microphones, systems } = harness(() => permission.promise);
    const pending = state.startAudioTest('mic-a');
    await flush();
    state.stopAudioTest();
    permission.resolve(true);
    await pending;
    assert.equal(microphones.length, 0);
    assert.equal(systems.length, 0);
});

test('latest device selection wins while an earlier permission request is pending', async () => {
    const permission = deferred();
    const { state, microphones } = harness(() => permission.promise);
    const first = state.startAudioTest('mic-a');
    await flush();
    const second = state.startAudioTest('mic-b');
    permission.resolve(true);
    await Promise.all([first, second]);
    assert.deepEqual(microphones.map(capture => capture.deviceId), ['mic-b']);
    state.stopAudioTest();
});

test('switching devices waits for the previous native handle to be released', async () => {
    const { state, microphones } = harness();
    await state.startAudioTest('mic-a');
    const release = deferred();
    microphones[0].teardown = release.promise;
    const pending = state.startAudioTest('mic-b');
    await flush();
    assert.equal(microphones[0].stopped, true);
    assert.equal(microphones.length, 1);
    release.resolve();
    await pending;
    assert.deepEqual(microphones.map(capture => capture.deviceId), ['mic-a', 'mic-b']);
    state.stopAudioTest();
});

test('system audio probe opens the selected output and is stopped with settings', async () => {
    const { state, systems, timers } = harness();
    await state.startAudioTest('mic-a', 'speaker-b');
    for (const callback of timers) callback();
    assert.deepEqual(systems.map(capture => capture.deviceId), ['speaker-b']);
    state.stopAudioTest();
    assert.equal(systems[0].stopped, true);
});

test('permission denial remains actionable and leaves no capture running', async () => {
    const { state, microphones } = harness(async () => false);
    await assert.rejects(state.startAudioTest('mic-a'), /Microphone permission denied/);
    assert.equal(microphones.length, 0);
});

function loadCapture(name, nativeModule) {
    const source = readFileSync(new URL(`../${name}.ts`, import.meta.url), 'utf8');
    const output = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports = {};
    runInNewContext(output, {
        exports, Buffer, setImmediate, setTimeout, clearTimeout,
        console: { log() {}, warn() {}, error() {} },
        require: name => name === 'events' ? { EventEmitter } : { loadNativeModule: () => nativeModule },
    });
    return exports[name];
}

for (const name of ['MicrophoneCapture', 'SystemAudioCapture']) {
    test(`${name} releases its native handle after a callback failure`, async () => {
        let dataCallback;
        let stops = 0;
        const Capture = loadCapture(name, {
            [name]: class {
                start(callback) { dataCallback = callback; }
                stop() { stops++; }
                getSampleRate() { return 16000; }
            },
        });
        const capture = new Capture('test-device');
        capture.on('error', () => {});
        capture.start();
        dataCallback(new Error('device disconnected'));
        await capture.destroy();
        assert.equal(stops, 1);
    });
}

test('microphone start failure releases its allocated native handle before disposal', async () => {
    let stops = 0;
    const Capture = loadCapture('MicrophoneCapture', {
        MicrophoneCapture: class {
            start() { throw new Error('device failed to start'); }
            stop() { stops++; }
        },
    });
    const capture = new Capture('test-device');
    capture.on('error', () => {});
    assert.throws(() => capture.start(), /device failed to start/);
    await capture.destroy();
    assert.equal(stops, 1);
});

test('a missing native microphone module is reported instead of displaying silent success', () => {
    const Capture = loadCapture('MicrophoneCapture', null);
    const capture = new Capture();
    assert.throws(() => capture.start(), /native audio module could not be loaded/);
});
