import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

// Opt-in only: uses the user's normal Antigravity account and request quota.
test('real Antigravity account answers text and reads a supplied image with restricted tools', { skip: process.env.RUN_ANTIGRAVITY_LIVE !== '1', timeout: 180000 }, async () => {
    const require = createRequire(import.meta.url);
    const childProcess = require('node:child_process');
    const originalSpawn = childProcess.spawn;
    const runs = [];
    childProcess.spawn = function (...args) {
        const child = originalSpawn.apply(this, args);
        const events = [];
        runs.push(events);
        let buffer = '';
        child.stdout.on('data', chunk => {
            buffer += chunk.toString();
            let newline;
            while ((newline = buffer.indexOf('\n')) >= 0) {
                const source = buffer.slice(0, newline);
                buffer = buffer.slice(newline + 1);
                try { events.push(JSON.parse(source)); } catch { /* Service reports malformed data. */ }
            }
        });
        return child;
    };
    const { AntigravityService } = require('../../../dist-electron/electron/services/AntigravityService.js');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'natively-agy-live-'));
    try {
        const config = { enabled: true, path: path.join(os.homedir(), '.local/bin/agy'), model: 'gemini-3.8-flash-medium', timeoutMs: 75000 };
        const response = await AntigravityService.run(config, { prompt: 'Reply with exactly NATIVELY_CONNECTED. Do not use tools.' });
        assert.match(response, /NATIVELY_CONNECTED/);
        const firstInit = runs[0].find(event => event.event === 'init');
        assert.equal(firstInit?.init?.agent, 'natively-answer');
        assert.deepEqual(firstInit?.init?.tools, []);

        const token = `SCREEN-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const screenshot = path.join(directory, 'question.png');
        await require('sharp')(Buffer.from(`<svg width="900" height="240" xmlns="http://www.w3.org/2000/svg"><rect width="900" height="240" fill="white"/><text x="35" y="140" font-size="54" font-family="Arial" fill="black">Read this code: ${token}</text></svg>`)).png().toFile(screenshot);
        const imageResponse = await AntigravityService.run(config, { prompt: 'Read the code printed in the attached screenshot. Reply only with the code, starting SCREEN-.', imagePaths: [screenshot] });
        assert.ok(imageResponse.includes(token), 'answer must contain the unpredictable code only present in the screenshot');
        const secondInit = runs[1].find(event => event.event === 'init');
        assert.equal(secondInit?.init?.agent, 'natively-answer');
        assert.deepEqual(secondInit?.init?.tools, ['view_file']);
        assert.ok(runs[1].some(event => event.event === 'step_update' && (event.step_update?.tool_name === 'view_file' || event.step_update?.tool_info?.name === 'view_file')), 'actual view_file tool call must have read the image');
    } finally {
        childProcess.spawn = originalSpawn;
        await fs.rm(directory, { recursive: true, force: true });
    }
});
