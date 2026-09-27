export interface ConversationContextMessage {
  id: string;
  role: string;
  text: string;
  isQuickActionLabel?: boolean;
  hasScreenshot?: boolean;
  isStreaming?: boolean;
}

export function buildConversationContextFromMessages(
  items: ConversationContextMessage[],
  live?: { streamingMessageId?: string | null; streamingText?: string; ragText?: string },
): string;

export function shouldUseLiveRagPreflight(options: {
  attachmentCount?: number;
  conversationContext?: string;
  referenceText?: string;
}): boolean;
