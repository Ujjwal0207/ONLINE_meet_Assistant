/**
 * Snapshot received text, independently of the UI's paced reveal. React rows
 * can still be empty (prose) or contain only a prefix (code) after the provider
 * has finished. A follow-up must receive the full answer already in memory.
 */
export function buildConversationContextFromMessages(items, live = {}) {
  const last = items[items.length - 1];
  return items
    .filter((message) => !message.isQuickActionLabel)
    .map((message) => {
      let text = message.text || '';
      if (message.role === 'system') {
        // A repaired final answer wins even before the done-handler microtask
        // has cleared the buffer containing the originally streamed draft.
        if (message.isStreaming && message.id === live.streamingMessageId && live.streamingText) {
          text = live.streamingText;
        }
        // RAG streams have no row id: their owner is the final streaming row.
        if (message === last && message.isStreaming && live.ragText) {
          text = live.ragText;
        }
      }
      if (!text.trim() || !['user', 'system', 'interviewer'].includes(message.role)) return '';
      const role = message.role === 'interviewer' ? 'Interviewer' : message.role === 'user' ? 'User' : 'Assistant';
      const prefix = message.hasScreenshot && message.role === 'user' ? '[Screenshot query] ' : '';
      return `${role}: ${prefix}${text.trim()}`;
    })
    .filter(Boolean)
    .slice(-20)
    .join('\n\n');
}

/** The query-only RAG API cannot carry chat history or an attached reference. */
export function shouldUseLiveRagPreflight({ attachmentCount = 0, conversationContext = '', referenceText = '' }) {
  return attachmentCount === 0 && !conversationContext.trim() && !referenceText.trim();
}
