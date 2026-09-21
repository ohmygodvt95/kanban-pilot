import { describe, expect, it } from 'vitest';
import { isNewer, registryUrl, UpdateCheck } from './update-check.js';

describe('update check', () => {
  it('compares numeric versions only', () => {
    expect(isNewer('0.2.0', '0.1.0')).toBe(true);
    expect(isNewer('0.1.0', '0.1.0')).toBe(false);
    expect(isNewer('1.0.0', '0.9.9')).toBe(true);
    expect(isNewer('dev', '0.1.0')).toBe(false);
    expect(isNewer('0.1.1', 'dev')).toBe(false);
  });

  it('builds the registry url for plain and scoped names', () => {
    expect(registryUrl('kanban-pilot')).toBe('https://registry.npmjs.org/kanban-pilot/latest');
    expect(registryUrl('@acme/kanban-pilot')).toBe('https://registry.npmjs.org/@acme%2Fkanban-pilot/latest');
  });

  it('reports a newer npm version and swallows failures', async () => {
    const urls: string[] = [];
    const ok = new UpdateCheck('0.1.0', '@acme/kanban-pilot', async (input) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ version: '0.3.0', agentKanban: true }));
    });
    await ok.refresh();
    expect(ok.latest()).toBe('0.3.0');
    expect(urls).toEqual(['https://registry.npmjs.org/@acme%2Fkanban-pilot/latest']);
    // a same-named package that is not ours never triggers the notice
    const foreign = new UpdateCheck(
      '0.1.0',
      'kanban-pilot',
      async () => new Response(JSON.stringify({ version: '9.0.0' })),
    );
    await foreign.refresh();
    expect(foreign.latest()).toBeNull();
    const same = new UpdateCheck(
      '0.3.0',
      'kanban-pilot',
      async () => new Response(JSON.stringify({ version: '0.3.0', agentKanban: true })),
    );
    await same.refresh();
    expect(same.latest()).toBeNull();
    const down = new UpdateCheck('0.1.0', 'kanban-pilot', async () => {
      throw new Error('offline');
    });
    await down.refresh();
    expect(down.latest()).toBeNull();
  });
});
