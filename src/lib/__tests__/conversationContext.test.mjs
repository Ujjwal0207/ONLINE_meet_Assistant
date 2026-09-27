import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildConversationContextFromMessages, shouldUseLiveRagPreflight } from '../conversationContext.mjs';

test('immediate follow-up includes the full prose answer while its reveal is still pending', () => {
  const messages = [
    { id: 'q', role: 'user', text: 'Why use a hash map for two sum?' },
    { id: 'a', role: 'system', text: '', isStreaming: true },
  ];
  const fullAnswer = 'Store each value and its index. Look up target minus the current value before inserting.';
  const context = buildConversationContextFromMessages(messages, {
    streamingMessageId: 'a', streamingText: fullAnswer,
  });
  assert.equal(context, `User: Why use a hash map for two sum?\n\nAssistant: ${fullAnswer}`);
  assert.equal(messages[1].text, '', 'snapshot must not mutate React state');
  assert.equal(shouldUseLiveRagPreflight({ conversationContext: context }), false,
    'follow-up must not be intercepted by the query-only meeting endpoint');
});

test('code follow-up receives the complete code, preserving indentation and the final lines', () => {
  const answer = '```python\ndef solve(nums):\n    seen = {}\n    for i, n in enumerate(nums):\n        seen[n] = i\n    return seen\n```';
  const context = buildConversationContextFromMessages([
    { id: 'q', role: 'user', text: 'Show the implementation' },
    { id: 'a', role: 'system', text: answer.slice(0, 25), isStreaming: true },
  ], { streamingMessageId: 'a', streamingText: answer });
  assert.ok(context.endsWith(`Assistant: ${answer}`));
  assert.equal(context.split('Assistant:').length, 2, 'replace the paced prefix instead of duplicating it');
});

test('RAG follow-up snapshots all received text before the final row is sealed', () => {
  const context = buildConversationContextFromMessages([
    { id: 'q', role: 'user', text: 'What did we decide?' },
    { id: 'a', role: 'system', text: 'We', isStreaming: true },
  ], { streamingMessageId: 'a', streamingText: '', ragText: 'We will deploy on Friday after testing.' });
  assert.match(context, /Assistant: We will deploy on Friday after testing\.$/);
});

test('stale buffers cannot overwrite another message or resurrect a cleared chat', () => {
  const live = { streamingMessageId: 'old', streamingText: 'stale text', ragText: 'stale RAG text' };
  assert.equal(buildConversationContextFromMessages([], live), '');
  assert.equal(buildConversationContextFromMessages([
    { id: 'new', role: 'system', text: 'Current answer', isStreaming: false },
  ], live), 'Assistant: Current answer');
});

test('a finalized repair wins over the stale streamed draft with the same row id', () => {
  const context = buildConversationContextFromMessages([
    { id: 'q', role: 'user', text: 'Write binary search' },
    { id: 'a', role: 'system', text: 'Corrected answer with the right boundary checks.', isStreaming: false },
  ], {
    streamingMessageId: 'a',
    streamingText: 'Original draft with an off-by-one error.',
    ragText: 'Stale RAG draft.',
  });
  assert.ok(context.endsWith('Assistant: Corrected answer with the right boundary checks.'));
  assert.ok(!context.includes('off-by-one'));
  assert.ok(!context.includes('Stale RAG'));
});

test('existing history labels, screenshots and bounded recent window remain intact', () => {
  const messages = [
    { id: 'quick', role: 'user', text: 'Recap', isQuickActionLabel: true },
    { id: 'empty', role: 'system', text: '' },
    ...Array.from({ length: 22 }, (_, i) => ({ id: `i${i}`, role: 'interviewer', text: `Question ${i}` })),
    { id: 'image', role: 'user', text: 'Explain this', hasScreenshot: true },
  ];
  const context = buildConversationContextFromMessages(messages);
  assert.equal(context.split('\n\n').length, 20);
  assert.ok(context.startsWith('Interviewer: Question 3'));
  assert.ok(context.endsWith('User: [Screenshot query] Explain this'));
  assert.ok(!context.includes('Recap'));
});

test('first standalone meeting question keeps RAG, but reference and image requests use regular chat', () => {
  assert.equal(shouldUseLiveRagPreflight({}), true);
  assert.equal(shouldUseLiveRagPreflight({ conversationContext: '  ', referenceText: '  ' }), true);
  assert.equal(shouldUseLiveRagPreflight({ referenceText: 'My resume and project notes' }), false);
  assert.equal(shouldUseLiveRagPreflight({ attachmentCount: 1 }), false);
});

test('typed and voice submit snapshot buffers before clearing and forward history and reference text', () => {
  const source = fs.readFileSync(new URL('../../components/NativelyInterface.tsx', import.meta.url), 'utf8');
  const voice = source.slice(source.indexOf('const handleAnswerNow = async'), source.indexOf('const selectSkill = useCallback'));
  const typed = source.slice(source.indexOf('const handleManualSubmit = async'), source.indexOf('// Code-containing messages'));
  for (const region of [voice, typed]) {
    const snapshot = region.indexOf('const conversationContextForSubmit = snapshotConversationContext()');
    assert.ok(snapshot >= 0);
    assert.ok(snapshot < region.indexOf('flushToken()'), 'must capture before the streaming buffer is cleared');
    assert.ok(region.indexOf('forceFinalizeStaleRagStream()') < region.indexOf("role: 'user'", snapshot),
      'seal the old RAG row before appending the new question');
    assert.match(region, /shouldUseLiveRagPreflight\(\{\s*attachmentCount: currentAttachments.length,\s*conversationContext: conversationContextForSubmit,\s*referenceText: refToSend/);
    const dispatch = region.slice(region.indexOf('await window.electronAPI.streamGeminiChat('));
    assert.match(dispatch, /conversationContextForSubmit/);
    assert.match(dispatch, /referenceText: refToSend/);
  }
});
