import { describe, expect, it, vi } from 'vitest';
import { PushSecretService } from './push-secret-service';

describe('PushSecretService', () => {
  it('generates a 32-byte base64url secret and returns only metadata', async () => {
    let persisted = '';
    const rpc = vi.fn(async (_name: string, args: { p_new_value: string }) => {
      persisted = args.p_new_value;
      return { data: '2026-07-13T04:00:00.000Z', error: null };
    });
    const service = new PushSecretService({ rpc } as never);

    const result = await service.rotate();

    expect(persisted).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result).toEqual({ last4: persisted.slice(-4), rotated_at: '2026-07-13T04:00:00.000Z' });
    expect(JSON.stringify(result)).not.toContain(persisted);
    expect(rpc).toHaveBeenCalledWith('rotate_push_webhook_secret', { p_new_value: persisted });
  });

  it('rejects a generated secret shorter than 43 characters', async () => {
    const rpc = vi.fn();
    const service = new PushSecretService({ rpc } as never, () => 'too-short');
    await expect(service.rotate()).rejects.toThrow('at least 43');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('propagates RPC failures without exposing the generated secret', async () => {
    const secret = 'A'.repeat(43);
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'database unavailable' } }));
    const service = new PushSecretService({ rpc } as never, () => secret);
    await expect(service.rotate()).rejects.toThrow('database unavailable');
  });
});
