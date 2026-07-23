import { describe, it, expect, beforeEach } from 'vitest';
import { ConversationRepository } from './conversation-repository';
import { DEMO_CONVERSATIONS } from './demo-data/demo-conversations';
import { AI_PROCESSING_STALE_AFTER_MS } from '@/lib/ai-processing-status';

describe('ConversationRepository ai_processing methods (demo mode)', () => {
  let repo: ConversationRepository;

  beforeEach(() => {
    repo = new ConversationRepository();
    // Ensure demo data has the ai_processing fields
    DEMO_CONVERSATIONS.forEach((c) => {
      if (!('ai_processing' in c)) {
        (c as unknown as Record<string, unknown>).ai_processing = false;
      }
      if (!('ai_processing_started_at' in c)) {
        (c as unknown as Record<string, unknown>).ai_processing_started_at = null;
      }
    });
  });

  it('markAiProcessing sets ai_processing=true and ai_processing_started_at', async () => {
    const conv = DEMO_CONVERSATIONS[0];
    const before = conv.ai_processing;
    const beforeAt = conv.ai_processing_started_at;

    await repo.markAiProcessing(conv.id);

    expect(conv.ai_processing).toBe(true);
    expect(conv.ai_processing_started_at).not.toBe(beforeAt);
    expect(conv.ai_processing_started_at).toBeTruthy();
    // Restore
    conv.ai_processing = before;
    conv.ai_processing_started_at = beforeAt;
  });

  it('clearAiProcessing sets ai_processing=false and ai_processing_started_at=null', async () => {
    const conv = DEMO_CONVERSATIONS[0];
    conv.ai_processing = true;
    conv.ai_processing_started_at = new Date().toISOString();

    await repo.clearAiProcessing(conv.id);

    expect(conv.ai_processing).toBe(false);
    expect(conv.ai_processing_started_at).toBeNull();
  });

  it('markAiProcessing round-trip with clearAiProcessing', async () => {
    const conv = DEMO_CONVERSATIONS[0];

    await repo.markAiProcessing(conv.id);
    expect(conv.ai_processing).toBe(true);

    await repo.clearAiProcessing(conv.id);
    expect(conv.ai_processing).toBe(false);
    expect(conv.ai_processing_started_at).toBeNull();
  });

  it('clearAiProcessing is safe on unknown id (no-op)', async () => {
    // Should not throw
    await expect(
      repo.clearAiProcessing('unknown-id-12345')
    ).resolves.not.toThrow();
  });

  it('markAiProcessing is safe on unknown id (no-op)', async () => {
    // Should not throw
    await expect(
      repo.markAiProcessing('unknown-id-12345')
    ).resolves.not.toThrow();
  });
});
