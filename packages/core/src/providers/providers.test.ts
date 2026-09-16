import { describe, expect, it } from 'vitest';
import { GitHubIssueProvider } from './github.js';
import { GitLabIssueProvider } from './gitlab.js';
import { createDefaultProviders, detectProvider } from './index.js';
import { classifyLabels, statusComment } from './types.js';

describe('issue providers', () => {
  it('detects GitHub and GitLab (cloud + self-hosted) project refs from remote URLs', () => {
    const gh = new GitHubIssueProvider({});
    expect(gh.detectProjectRef('git@github.com:acme/app.git')).toBe('acme/app');
    expect(gh.detectProjectRef('https://github.com/acme/app')).toBe('acme/app');
    expect(gh.detectProjectRef('https://gitlab.com/acme/app.git')).toBeNull();
    const gl = new GitLabIssueProvider({});
    expect(gl.detectProjectRef('git@gitlab.com:group/sub/app.git')).toBe('https://gitlab.com/group/sub/app');
    expect(gl.detectProjectRef('https://gitlab.example.com/group/app.git')).toBe(
      'https://gitlab.example.com/group/app',
    );
    expect(gl.detectProjectRef('https://oauth2:tok@gitlab.example.com/g/app')).toBe(
      'https://gitlab.example.com/g/app',
    );
    expect(gl.detectProjectRef('https://github.com/acme/app')).toBeNull();
  });

  it('prefers the manual override and reports missing tokens', async () => {
    const registry = createDefaultProviders();
    expect(detectProvider(registry, 'git@github.com:acme/app.git')?.projectRef).toBe('acme/app');
    expect(detectProvider(registry, null)).toBeNull();
    const manual = detectProvider(registry, null, {
      provider: 'gitlab',
      projectRef: 'https://gitlab.com/g/p',
    });
    expect(manual?.provider.id).toBe('gitlab');
    expect((await new GitHubIssueProvider({}).check()).ok).toBe(false);
    expect((await new GitLabIssueProvider({ GITLAB_TOKEN: 'x' }).check()).ok).toBe(true);
  });

  it('classifies labels into kind and priority', () => {
    expect(classifyLabels(['bug', 'priority::high'])).toEqual({ kind: 'bug', priority: 'high' });
    expect(classifyLabels(['enhancement', 'P0'])).toEqual({ kind: 'feature', priority: 'urgent' });
    expect(classifyLabels(['docs'])).toEqual({ kind: 'chore', priority: null });
    expect(classifyLabels([])).toEqual({ kind: null, priority: null });
  });

  it('formats status comments', () => {
    expect(statusComment('in_review', { branch: 'ak/x', prUrl: 'https://p/r/1' })).toContain('https://p/r/1');
    expect(statusComment('done')).toContain('Merged locally');
  });
});
