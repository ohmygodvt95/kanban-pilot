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
    const ok = new UpdateCheck(
      '0.1.0',
      async () => new Response(JSON.stringify({ version: '0.3.0', agentKanban: true })),
    );
    await ok.refresh();
    expect(ok.latest()).toBe('0.3.0');
    // a same-named package that is not ours never triggers the notice
    const foreign = new UpdateCheck('0.1.0', async () => new Response(JSON.stringify({ version: '9.0.0' })));
    await foreign.refresh();
    expect(foreign.latest()).toBeNull();
    const same = new UpdateCheck(
      '0.3.0',
      async () => new Response(JSON.stringify({ version: '0.3.0', agentKanban: true })),
    );
    await same.refresh();
    expect(same.latest()).toBeNull();
    const down = new UpdateCheck('0.1.0', async () => {
      throw new Error('offline');
    });
    await down.refresh();
    expect(down.latest()).toBeNull();
  });
});
