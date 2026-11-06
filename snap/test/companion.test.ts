import { describe, it, expect, vi } from 'vitest';
import { waitForReceipt } from '../companion/poll.js';

const TX = '0x' + 'ab'.repeat(32);

describe('waitForReceipt', () => {
  it('resolves {mined:true,status} once a non-null receipt appears', async () => {
    const getReceipt = vi
      .fn<[string], Promise<{ status?: string | null } | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ status: '0x1' });

    const r = await waitForReceipt(TX, { getReceipt }, { intervalMs: 0, maxTries: 10 });

    expect(r).toEqual({ mined: true, status: '0x1' });
    expect(getReceipt).toHaveBeenCalledTimes(3);
    expect(getReceipt).toHaveBeenCalledWith(TX);
  });

  it('returns {mined:false} after exhausting maxTries of only nulls', async () => {
    const getReceipt = vi
      .fn<[string], Promise<{ status?: string | null } | null>>()
      .mockResolvedValue(null);

    const r = await waitForReceipt(TX, { getReceipt }, { intervalMs: 0, maxTries: 4 });

    expect(r).toEqual({ mined: false });
    expect(getReceipt).toHaveBeenCalledTimes(4);
  });

  it('uses an injected sleep dep when provided (kept fast, no real timers)', async () => {
    const getReceipt = vi
      .fn<[string], Promise<{ status?: string | null } | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ status: '0x0' });
    const sleep = vi.fn<[number], Promise<void>>().mockResolvedValue(undefined);

    const r = await waitForReceipt(TX, { getReceipt, sleep }, { intervalMs: 1500, maxTries: 5 });

    expect(r).toEqual({ mined: true, status: '0x0' });
    // one null -> one wait before the second (successful) poll
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(1500);
  });
});
