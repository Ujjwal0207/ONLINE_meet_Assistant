import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { AntigravityService } = require('../../../dist-electron/electron/services/AntigravityService.js');
let directory;
let executable;
let config;

before(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'natively-agy-test-'));
    executable = path.join(directory, 'fake agy');
    await fs.writeFile(executable, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
if (process.argv.includes('--help')) {
    console.log('Usage of agy: --input-format --output-format --disable-slash-commands');
    process.exit(0);
}
const emit = event => process.stdout.write(JSON.stringify(event) + '\\n');
const delta = text => emit({event:'step_update',step_update:{step_type:'agent_response',text_delta:text}});
const result = response => emit({event:'result',result:{status:'SUCCESS',response}});
let input = '';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
    const message = JSON.parse(input);
    const prompt = message.message.content;
    const agent = fs.readFileSync(path.join(process.cwd(),'.agents/agents/natively-answer.md'),'utf8');
    emit({event:'init',init:{agent:'natively-answer',tools:prompt === 'unsafe-tools' ? ['run_command'] : agent.includes('tools: [view_file]') ? ['view_file'] : []}});
    if (prompt === 'stream') {
        emit({event:'step_update',step_update:{step_type:'tool',text_delta:'NOT AN ANSWER'}});
        delta('Hello ');
        delta('🌏');
        result('Hello 🌏!');
    } else if (prompt === 'failure') {
        process.stderr.write('private-account@example.test secret-token:abcdef');
        emit({event:'result',result:{status:'ERROR',error:'authentication required'}});
        process.exitCode = 1;
    } else if (prompt === 'malformed') {
        process.stdout.write('not json\\n');
        setInterval(() => {}, 1000);
    } else if (prompt === 'empty') {
        result('');
    } else if (prompt === 'inconsistent') {
        delta('First');
        result('Different');
    } else if (prompt === 'wait') {
        delta(JSON.stringify({cwd:process.cwd(),pid:process.pid}));
        setInterval(() => {}, 1000);
    } else if (prompt === 'oversized') {
        process.stdout.write('x'.repeat(3 * 1024 * 1024));
        setInterval(() => {}, 1000);
    } else {
        const images = fs.readdirSync(process.cwd()).filter(file => file.startsWith('screenshot-'));
        result(JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2),prompt,agent:fs.readFileSync(path.join(process.cwd(),'.agents/agents/natively-answer.md'),'utf8'),images:images.map(file=>({name:file,bytes:fs.readFileSync(file).toString('base64')}))}));
    }
});
`, { mode: 0o700 });
    config = { enabled: true, path: executable, model: '', timeoutMs: 5000 };
});

after(async () => { await fs.rm(directory, { recursive: true, force: true }); });

test('default config and executable detection handle GUI-safe paths with spaces', async () => {
    assert.deepEqual(AntigravityService.normalizeConfig(), { enabled: false, path: 'agy', model: '', timeoutMs: 120000 });
    assert.equal((await AntigravityService.getStatus(config)).resolvedPath, executable);
    assert.equal((await AntigravityService.getStatus({ path: path.join(directory, 'missing') })).installed, false);
});

test('text request uses stdin verbatim, restricted agent, explicit model, and removes workspace', async () => {
    const prompt = 'Do not execute: $(touch unexpected) `echo bad`\n/model';
    const response = JSON.parse(await AntigravityService.run({ ...config, model: 'gemini-3.8-flash-medium' }, { prompt, instructions: 'Give concise answers.' }));
    assert.equal(response.prompt, prompt);
    assert.match(response.agent, /tools: \[\]/);
    assert.match(response.agent, /commandExecutionPolicy: off/);
    assert.match(response.agent, /Give concise answers/);
    assert.ok(response.args.includes('--disable-slash-commands'));
    assert.ok(response.args.includes('gemini-3.8-flash-medium'));
    assert.ok(!response.args.includes('--dangerously-skip-permissions'));
    assert.ok(!response.args.includes(prompt));
    await assert.rejects(fs.stat(response.cwd), { code: 'ENOENT' });
});

test('copies only supplied screenshots and enables only view_file', async () => {
    const screenshot = path.join(directory, 'private-name.png');
    const bytes = Buffer.from('test screenshot contents');
    await fs.writeFile(screenshot, bytes);
    const response = JSON.parse(await AntigravityService.run(config, { prompt: 'Read the screenshot', imagePaths: [screenshot] }));
    assert.match(response.agent, /tools: \[view_file\]/);
    assert.equal(response.images.length, 1);
    assert.equal(response.images[0].name, 'screenshot-1.png');
    assert.equal(response.images[0].bytes, bytes.toString('base64'));
    assert.ok(!response.prompt.includes(screenshot));
    assert.match(response.prompt, /screenshot-1\.png/);
    assert.deepEqual(await fs.readFile(screenshot), bytes);
    await assert.rejects(fs.stat(response.cwd), { code: 'ENOENT' });
});

test('rejects unsupported and excess attachments before launching the CLI', async () => {
    await assert.rejects(AntigravityService.run(config, { prompt: 'read', imagePaths: ['secret.txt'] }), /screenshots must be/);
    await assert.rejects(AntigravityService.run(config, { prompt: 'read', imagePaths: Array(6).fill('image.png') }), /up to five/);
});

test('streams response deltas only and adds final suffix without duplicating the answer', async () => {
    const chunks = [];
    for await (const chunk of AntigravityService.stream(config, { prompt: 'stream' })) chunks.push(chunk);
    assert.deepEqual(chunks, ['Hello ', '🌏', '!']);
});

test('CLI failure reports account action without leaking raw diagnostics', async () => {
    await assert.rejects(AntigravityService.run(config, { prompt: 'failure' }), error => {
        assert.match(error.message, /needs sign-in/);
        assert.doesNotMatch(error.message, /abcdef|private-account/);
        return true;
    });
});

test('malformed, oversized, empty, and inconsistent responses fail explicitly', async () => {
    await assert.rejects(AntigravityService.run(config, { prompt: 'malformed' }), /invalid response stream/);
    await assert.rejects(AntigravityService.run(config, { prompt: 'oversized' }), /oversized response event/);
    await assert.rejects(AntigravityService.run(config, { prompt: 'empty' }), /empty answer/);
    await assert.rejects(AntigravityService.run(config, { prompt: 'inconsistent' }), /inconsistent answer text/);
    await assert.rejects(AntigravityService.run(config, { prompt: 'unsafe-tools' }), /restricted answer agent/);
});

test('abort terminates child and removes its isolated workspace', async () => {
    const controller = new AbortController();
    const iterator = AntigravityService.stream(config, { prompt: 'wait', signal: controller.signal });
    const child = JSON.parse((await iterator.next()).value);
    controller.abort();
    await assert.rejects(iterator.next(), { name: 'AbortError' });
    await assert.rejects(fs.stat(child.cwd), { code: 'ENOENT' });
    assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
});

test('timeout terminates child and removes workspace', async () => {
    const iterator = AntigravityService.stream({ ...config, timeoutMs: 1000 }, { prompt: 'wait' });
    const child = JSON.parse((await iterator.next()).value);
    await assert.rejects(iterator.next(), /timed out/);
    await assert.rejects(fs.stat(child.cwd), { code: 'ENOENT' });
    assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
});

test('consumer ending iteration also terminates child and removes workspace', async () => {
    let child;
    for await (const chunk of AntigravityService.stream(config, { prompt: 'wait' })) {
        child = JSON.parse(chunk);
        break;
    }
    await assert.rejects(fs.stat(child.cwd), { code: 'ENOENT' });
    assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
});
