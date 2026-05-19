import {
  redactSecrets,
  logApiError,
  badRequest,
  unprocessable,
  fallbackOk,
} from '@/lib/api-errors';

// ---------------------------------------------------------------------------
// redactSecrets
// ---------------------------------------------------------------------------

describe('redactSecrets — string scanning', () => {
  it('redacts a HuggingFace bearer token in a curl-style string', () => {
    const got = redactSecrets('curl -H "Authorization: Bearer hf_AbCdEf12345"');
    expect(got).toContain('Bearer [REDACTED]');
    expect(got).not.toContain('hf_AbCdEf12345');
  });

  it("redacts a bare hf_ token: 'hf_abc123xyz' → '[REDACTED]'", () => {
    expect(redactSecrets('hf_abc123xyz')).toBe('[REDACTED]');
  });

  it('redacts the sk- portion of an OpenAI-style key embedded in another string', () => {
    const got = redactSecrets('token=sk-ABCDEFGHIJKLMNOPQRST1234');
    expect(got).toBe('token=[REDACTED]');
  });

  it('redacts a URL containing an hf_ token', () => {
    const got = redactSecrets('https://api.example.com/?token=hf_secret123');
    expect(got).toBe('https://api.example.com/?token=[REDACTED]');
  });

  it('leaves a plain string without secrets untouched', () => {
    expect(redactSecrets('hello world')).toBe('hello world');
  });
});

describe('redactSecrets — object key matching', () => {
  it("redacts an object key called 'api_key'", () => {
    expect(redactSecrets({ api_key: 'anything' })).toEqual({
      api_key: '[REDACTED]',
    });
  });

  it("redacts an object key called 'ACCESS_TOKEN' (case-insensitive)", () => {
    expect(redactSecrets({ ACCESS_TOKEN: 'foo' })).toEqual({
      ACCESS_TOKEN: '[REDACTED]',
    });
  });

  it("redacts 'password' but leaves the sibling field intact", () => {
    expect(redactSecrets({ user: 'alice', password: 'p1' })).toEqual({
      user: 'alice',
      password: '[REDACTED]',
    });
  });

  it("redacts a numeric value when the key matches 'secret'", () => {
    expect(redactSecrets({ secret: 42 })).toEqual({ secret: '[REDACTED]' });
  });

  it('redacts nested secret keys but preserves siblings', () => {
    expect(
      redactSecrets({ auth: { token: 'x', other: 'y' } }),
    ).toEqual({ auth: { token: '[REDACTED]', other: 'y' } });
  });
});

describe('redactSecrets — arrays', () => {
  it('walks an array element-wise, redacting tokens inside strings', () => {
    expect(redactSecrets(['hf_xyz', 'plain'])).toEqual([
      '[REDACTED]',
      'plain',
    ]);
  });

  it('walks a nested array of objects', () => {
    expect(
      redactSecrets([{ token: 'a' }, { ok: 'b' }]),
    ).toEqual([{ token: '[REDACTED]' }, { ok: 'b' }]);
  });
});

describe('redactSecrets — primitive / nullish pass-through', () => {
  it('returns numbers unchanged', () => {
    expect(redactSecrets(42)).toBe(42);
  });

  it('returns booleans unchanged', () => {
    expect(redactSecrets(true)).toBe(true);
    expect(redactSecrets(false)).toBe(false);
  });

  it('returns null unchanged', () => {
    expect(redactSecrets(null)).toBe(null);
  });

  it('returns undefined unchanged', () => {
    expect(redactSecrets(undefined)).toBe(undefined);
  });
});

describe('redactSecrets — non-plain object coercion', () => {
  it('coerces an Error to a redacted string', () => {
    const got = redactSecrets(new Error('Bearer hf_xx'));
    expect(typeof got).toBe('string');
    expect(got as unknown as string).toContain('Error');
    expect(got as unknown as string).toContain('Bearer [REDACTED]');
    expect(got as unknown as string).not.toContain('hf_xx');
  });
});

describe('redactSecrets — does not mutate input', () => {
  it('leaves the original object reference intact', () => {
    const original = { token: 'hf_x' };
    redactSecrets(original);
    expect(original.token).toBe('hf_x');
  });

  it('leaves the original nested object intact', () => {
    const original = { auth: { token: 'hf_x', other: 'y' } };
    redactSecrets(original);
    expect(original.auth.token).toBe('hf_x');
    expect(original.auth.other).toBe('y');
  });

  it('leaves the original array intact', () => {
    const original = ['hf_xyz', 'plain'];
    redactSecrets(original);
    expect(original[0]).toBe('hf_xyz');
    expect(original[1]).toBe('plain');
  });
});

// ---------------------------------------------------------------------------
// logApiError
// ---------------------------------------------------------------------------

describe('logApiError', () => {
  it('writes to console.error with the label as the first arg', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      logApiError('TEST_LABEL', new Error('boom'));
      expect(spy).toHaveBeenCalled();
      const firstCall = spy.mock.calls[0];
      expect(firstCall[0]).toBe('[TEST_LABEL]');
    } finally {
      spy.mockRestore();
    }
  });

  it('returns { name, message } (no stack in the return)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const err = new Error('something broke');
      const out = logApiError('X', err);
      expect(out).toEqual({ name: 'Error', message: 'something broke' });
      expect((out as unknown as Record<string, unknown>).stack).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });

  it('captures err.message, err.name, err.stack into the console payload', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const err = new Error('msg-here');
      err.name = 'CustomError';
      logApiError('LBL', err);
      const payload = spy.mock.calls[0][1] as Record<string, unknown>;
      expect(payload.name).toBe('CustomError');
      expect(payload.message).toBe('msg-here');
      expect(typeof payload.stack).toBe('string');
    } finally {
      spy.mockRestore();
    }
  });

  it('redacts secret patterns in err.message in both console output AND return value', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const err = new Error('Failed: Bearer hf_abc123 expired');
      const out = logApiError('AUTH', err);
      expect(out.message).toContain('Bearer [REDACTED]');
      expect(out.message).not.toContain('hf_abc123');
      const payload = spy.mock.calls[0][1] as Record<string, unknown>;
      expect(String(payload.message)).toContain('Bearer [REDACTED]');
      expect(String(payload.message)).not.toContain('hf_abc123');
    } finally {
      spy.mockRestore();
    }
  });

  it('does not crash on null input', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const out = logApiError('NULL', null);
      expect(typeof out.message).toBe('string');
      expect(typeof out.name).toBe('string');
    } finally {
      spy.mockRestore();
    }
  });

  it('does not crash on a plain string input', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const out = logApiError('STR', 'just a string');
      expect(typeof out.message).toBe('string');
      expect(typeof out.name).toBe('string');
    } finally {
      spy.mockRestore();
    }
  });

  it('does not crash on a numeric input', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const out = logApiError('NUM', 42);
      expect(typeof out.message).toBe('string');
      expect(typeof out.name).toBe('string');
    } finally {
      spy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// badRequest / unprocessable / fallbackOk
// ---------------------------------------------------------------------------

describe('badRequest', () => {
  it('returns a 400 response', async () => {
    const res = badRequest('bad input');
    expect(res.status).toBe(400);
  });

  it('puts the message under `error` in the JSON body', async () => {
    const res = badRequest('bad input');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('bad input');
  });

  it('merges details into the body', async () => {
    const res = badRequest('bad input', { field: 'dream', code: 'EMPTY' });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      error: 'bad input',
      field: 'dream',
      code: 'EMPTY',
    });
  });
});

describe('unprocessable', () => {
  it('returns a 422 response', async () => {
    const res = unprocessable('schema fail');
    expect(res.status).toBe(422);
  });

  it('puts the message under `error` in the JSON body', async () => {
    const res = unprocessable('schema fail');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('schema fail');
  });

  it('merges details into the body', async () => {
    const res = unprocessable('schema fail', { issue: 'missing.field' });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      error: 'schema fail',
      issue: 'missing.field',
    });
  });
});

describe('fallbackOk', () => {
  it('returns a 200 response', async () => {
    const res = fallbackOk({ data: 'value' });
    expect(res.status).toBe(200);
  });

  it('adds fallback: true when caller did not set it', async () => {
    const res = fallbackOk({ data: 'value' });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.fallback).toBe(true);
    expect(body.data).toBe('value');
  });

  it('does not overwrite fallback when caller already set it to false', async () => {
    const res = fallbackOk({ data: 'value', fallback: false });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.fallback).toBe(false);
  });

  it('preserves caller-supplied fallback: true', async () => {
    const res = fallbackOk({ data: 'value', fallback: true });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.fallback).toBe(true);
  });
});
