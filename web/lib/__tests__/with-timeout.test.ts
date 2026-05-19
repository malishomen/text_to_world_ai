import { withTimeout } from '@/lib/with-timeout';

describe('withTimeout', () => {
  it('resolves with the inner promise value when it resolves before timeout', async () => {
    const inner = Promise.resolve('ok');
    await expect(withTimeout(inner, 1000, 'label')).resolves.toBe('ok');
  });

  it('resolves with the inner value even when inner is slightly delayed', async () => {
    const inner = new Promise<string>((resolve) =>
      setTimeout(() => resolve('done'), 10),
    );
    await expect(withTimeout(inner, 500, 'op')).resolves.toBe('done');
  });

  it('rejects with `${label} timed out after ${ms}ms` when the inner promise is slower than the timeout', async () => {
    // never-settling promise
    const inner = new Promise<string>(() => {});
    await expect(withTimeout(inner, 20, 'slow-op')).rejects.toThrow(
      'slow-op timed out after 20ms',
    );
  });

  it('does not swallow inner-promise rejections — propagates the original error before the timeout fires', async () => {
    const originalErr = new Error('inner exploded');
    const inner = Promise.reject(originalErr);
    await expect(withTimeout(inner, 1000, 'label')).rejects.toBe(originalErr);
  });

  it('clears the timer after the inner promise settles (no dangling setTimeout)', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    try {
      await withTimeout(Promise.resolve('done'), 5_000, 'cleanup-check');
      expect(clearSpy).toHaveBeenCalled();
    } finally {
      clearSpy.mockRestore();
    }
  });

  it('clears the timer even when the inner promise rejects', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    try {
      await withTimeout(
        Promise.reject(new Error('boom')),
        5_000,
        'cleanup-on-reject',
      ).catch(() => {});
      expect(clearSpy).toHaveBeenCalled();
    } finally {
      clearSpy.mockRestore();
    }
  });
});
