import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  commitAll,
  createWorktree,
  detectBaseBranch,
  diffWorktree,
  git,
  hasChanges,
  isGitRepo,
  listWorktrees,
  mergeBranch,
  push,
  readRepoConfig,
  removeWorktree,
  seededFiles,
} from './git.js';

async function makeRepo(dir: string) {
  await mkdir(dir, { recursive: true });
  await git(dir, ['init', '-q', '-b', 'main']);
  await git(dir, ['config', 'user.name', 'test']);
  await git(dir, ['config', 'user.email', 'test@example.com']);
  await writeFile(join(dir, 'README.md'), '# demo\n');
  await git(dir, ['add', '-A']);
  await git(dir, ['commit', '-q', '-m', 'init']);
}

describe('git module (real git, temp repo)', () => {
  let root: string;
  let repo: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ak-git-'));
    repo = join(root, 'repo');
    await makeRepo(repo);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('detects repos and base branch', async () => {
    expect(await isGitRepo(repo)).toBe(true);
    expect(await isGitRepo(root)).toBe(false);
    expect(await detectBaseBranch(repo)).toBe('main');
  });

  it('creates a worktree, seeds templates, diffs, commits and merges', async () => {
    const templates = join(root, 'templates');
    await writeFile(join(root, 'CLAUDE.md'), 'x'); // not in templates dir; ensure lookup is per dir
    await mkdir(templates, { recursive: true });
    await writeFile(join(templates, 'CLAUDE.md'), '# rules\n');
    const wt = join(root, 'wt', 'a1');
    const res = await createWorktree({
      repoPath: repo,
      baseBranch: 'main',
      branch: 'ak/demo-1',
      worktreePath: wt,
      templateDirs: [templates],
      instructionFiles: ['CLAUDE.md'],
    });
    expect(res.baseCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(res.seededFiles).toEqual(['CLAUDE.md']);
    expect(await readFile(join(wt, 'CLAUDE.md'), 'utf8')).toBe('# rules\n');
    expect(await listWorktrees(repo)).toContain(wt);

    // seeded file is excluded from diff/commit
    expect(await seededFiles(wt, res.baseCommit, ['CLAUDE.md', 'AGENTS.md'])).toEqual(['CLAUDE.md']);
    const exclude = ['CLAUDE.md'];
    expect(await hasChanges(wt, res.baseCommit, { exclude })).toBe(false);
    expect(await hasChanges(wt, res.baseCommit)).toBe(true);
    await writeFile(join(wt, 'src.txt'), 'line1\nline2\n');
    await writeFile(join(wt, 'README.md'), '# demo\nmore\n');
    const diff = await diffWorktree(wt, res.baseCommit, { exclude });
    const paths = diff.files.map((f) => f.path).sort();
    expect(paths).toEqual(['README.md', 'src.txt']);
    const src = diff.files.find((f) => f.path === 'src.txt');
    expect(src).toMatchObject({ status: 'added', additions: 2, deletions: 0 });
    expect(diff.files.find((f) => f.path === 'README.md')?.status).toBe('modified');
    expect(diff.patch).toContain('+line2');

    const sha = await commitAll(wt, 'demo change\n\nTask: t1', { exclude });
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(await commitAll(wt, 'nothing', { exclude })).toBeNull();
    expect((await git(wt, ['ls-tree', '--name-only', 'HEAD'])).stdout).not.toContain('CLAUDE.md');
    // diff after commit still reports everything vs base
    expect((await diffWorktree(wt, res.baseCommit, { exclude })).files.length).toBe(2);

    // push without remote is a soft failure
    const p = await push(wt, 'ak/demo-1');
    expect(p.ok).toBe(false);

    // main tree has main checked out and is clean → merge in place
    const merged = await mergeBranch(repo, 'main', 'ak/demo-1', 'merge demo', join(root, 'tmp'));
    expect(merged.via).toBe('main-worktree');
    expect(await readFile(join(repo, 'src.txt'), 'utf8')).toBe('line1\nline2\n');

    await removeWorktree(repo, wt, 'ak/demo-1', { deleteBranch: false });
    expect(await listWorktrees(repo)).not.toContain(wt);
    const branches = (await git(repo, ['branch', '--list', 'ak/demo-1'])).stdout;
    expect(branches).toContain('ak/demo-1');
  });

  it('merges via a temp worktree when base branch is not checked out, and rejects dirty trees', async () => {
    const wt = join(root, 'wt', 'a2');
    await createWorktree({
      repoPath: repo,
      baseBranch: 'main',
      branch: 'ak/x-2',
      worktreePath: wt,
    });
    await writeFile(join(wt, 'new.txt'), 'hi\n');
    await commitAll(wt, 'add new');

    // switch main repo to another branch
    await git(repo, ['checkout', '-q', '-b', 'feature']);
    const merged = await mergeBranch(repo, 'main', 'ak/x-2', 'merge x', join(root, 'tmp'));
    expect(merged.via).toBe('temp-worktree');
    expect((await git(repo, ['show', 'main:new.txt'])).stdout).toBe('hi');
    expect(await listWorktrees(repo)).toHaveLength(2); // repo + wt, temp removed

    // dirty main tree on base branch → error
    await git(repo, ['checkout', '-q', 'main']);
    await writeFile(join(repo, 'README.md'), 'dirty');
    const wt3 = join(root, 'wt', 'a3');
    await createWorktree({ repoPath: repo, baseBranch: 'main', branch: 'ak/x-3', worktreePath: wt3 });
    await writeFile(join(wt3, 'z.txt'), 'z');
    await commitAll(wt3, 'z');
    await expect(mergeBranch(repo, 'main', 'ak/x-3', 'm', join(root, 'tmp'))).rejects.toThrow(/uncommitted/);
  });

  it('reports merge conflicts and aborts cleanly', async () => {
    const wt = join(root, 'wt', 'c1');
    await createWorktree({ repoPath: repo, baseBranch: 'main', branch: 'ak/c-1', worktreePath: wt });
    await writeFile(join(wt, 'README.md'), 'from agent\n');
    await commitAll(wt, 'agent');
    await writeFile(join(repo, 'README.md'), 'from user\n');
    await git(repo, ['commit', '-q', '-am', 'user']);
    await expect(mergeBranch(repo, 'main', 'ak/c-1', 'm', join(root, 'tmp'))).rejects.toThrow(
      /merge of ak\/c-1 failed/,
    );
    expect((await git(repo, ['status', '--porcelain'])).stdout).toBe('');
  });

  it('discarding a worktree deletes the branch', async () => {
    const wt = join(root, 'wt', 'd1');
    await createWorktree({ repoPath: repo, baseBranch: 'main', branch: 'ak/d-1', worktreePath: wt });
    await removeWorktree(repo, wt, 'ak/d-1', { deleteBranch: true });
    expect((await git(repo, ['branch', '--list', 'ak/d-1'])).stdout).toBe('');
  });

  it('reads optional .agent-kanban.json', async () => {
    expect(await readRepoConfig(repo)).toBeNull();
    await writeFile(join(repo, '.agent-kanban.json'), JSON.stringify({ test_script: 'npm test' }));
    expect(await readRepoConfig(repo)).toEqual({ test_script: 'npm test' });
  });
});
