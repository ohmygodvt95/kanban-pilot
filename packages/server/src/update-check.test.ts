import { describe, expect, it } from 'vitest';
import { isNewer, UpdateCheck } from './update-check.js';

describe('update check', () => {
  it('compares numeric versions only', () => {
    expect(isNewer('0.2.0', '0.1.0')).toBe(true);
    expect(isNewer('0.1.0', '0.1.0')).toBe(false);
    expect(isNewer('1.0.0', '0.9.9')).toBe(true);
    expect(isNewer('dev', '0.1.0')).toBe(false);
    expect(isNewer('0.1.1', 'dev')).toBe(false);
  });

  it('reports a newer npm version and swallows failures', async () => {
    const ok = new UpdateCheck('0.1.0', async () => new Response(JSON.stringify({ version: '0.3.0' })));
    await ok.refresh();
    expect(ok.latest()).toBe('0.3.0');
    const same = new UpdateCheck('0.3.0', async () => new Response(JSON.stringify({ version: '0.3.0' })));
    await same.refresh();
    expect(same.latest()).toBeNull();
    const down = new UpdateCheck('0.1.0', async () => {
      throw new Error('offline');
    });
    await down.refresh();
    expect(down.latest()).toBeNull();
  });
});
