import { access, copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { DiffFile, DiffResult } from '@agent-kanban/shared';
import { execa } from 'execa';
import { CoreError } from '../util/errors.js';

export interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function git(cwd: string, args: string[], opts: { reject?: boolean; timeout?: number } = {}) {
  const res = await execa('git', args, {
    cwd,
    reject: false,
    timeout: opts.timeout ?? 120_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
    stripFinalNewline: true,
  });
  const out: GitResult = { stdout: res.stdout ?? '', stderr: res.stderr ?? '', exitCode: res.exitCode ?? -1 };
  if (res.exitCode === undefined && !out.stderr)
    out.stderr = res.shortMessage ?? res.message ?? 'spawn failed';
  if (opts.reject !== false && out.exitCode !== 0) {
    throw new CoreError(
      'GIT_ERROR',
      `git ${args[0]} failed (exit ${out.exitCode}): ${(out.stderr || out.stdout).trim()}`,
      {
        args,
        cwd,
      },
    );
  }
  return out;
}

export async function isGitRepo(path: string): Promise<boolean> {
  try {
    await access(path);
  } catch {
    return false;
  }
  const r = await git(path, ['rev-parse', '--is-inside-work-tree'], { reject: false });
  return r.exitCode === 0 && r.stdout.trim() === 'true';
}

export async function repoToplevel(path: string): Promise<string> {
  return (await git(path, ['rev-parse', '--show-toplevel'])).stdout.trim();
}

/** Detect the default branch: origin/HEAD → main → master → current branch. */
export async function detectBaseBranch(repoPath: string): Promise<string> {
  const originHead = await git(repoPath, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], {
    reject: false,
  });
  if (originHead.exitCode === 0 && originHead.stdout.trim()) {
    return originHead.stdout.trim().replace(/^origin\//, '');
  }
  for (const candidate of ['main', 'master']) {
    const r = await git(repoPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${candidate}`], {
      reject: false,
    });
    if (r.exitCode === 0) return candidate;
  }
  const current = await git(repoPath, ['symbolic-ref', '--short', 'HEAD'], { reject: false });
  return current.exitCode === 0 && current.stdout.trim() ? current.stdout.trim() : 'main';
}

export async function currentBranch(cwd: string): Promise<string | null> {
  const r = await git(cwd, ['symbolic-ref', '--short', 'HEAD'], { reject: false });
  return r.exitCode === 0 ? r.stdout.trim() : null;
}

export async function isClean(cwd: string): Promise<boolean> {
  const r = await git(cwd, ['status', '--porcelain', '--untracked-files=normal']);
  return r.stdout.trim() === '';
}

export async function hasRemote(repoPath: string, name = 'origin'): Promise<boolean> {
  const r = await git(repoPath, ['remote'], { reject: false });
  return r.stdout
    .split('\n')
    .map((s) => s.trim())
    .includes(name);
}

async function refExists(repoPath: string, ref: string): Promise<boolean> {
  const r = await git(repoPath, ['rev-parse', '--verify', '--quiet', ref], { reject: false });
  return r.exitCode === 0;
}

export interface CreateWorktreeInput {
  repoPath: string;
  baseBranch: string;
  branch: string;
  worktreePath: string;
  /** Candidate directories holding instruction templates, first match wins. */
  templateDirs?: string[];
  /** Instruction files to seed if missing in the repo (e.g. CLAUDE.md). */
  instructionFiles?: string[];
}

export interface CreateWorktreeResult {
  baseCommit: string;
  baseRef: string;
  seededFiles: string[];
  warnings: string[];
}

export async function createWorktree(input: CreateWorktreeInput): Promise<CreateWorktreeResult> {
  const { repoPath, baseBranch, branch, worktreePath } = input;
  const warnings: string[] = [];
  if (await hasRemote(repoPath)) {
    const fetch = await git(repoPath, ['fetch', 'origin', baseBranch], { reject: false, timeout: 60_000 });
    if (fetch.exitCode !== 0) warnings.push(`fetch origin ${baseBranch} failed: ${fetch.stderr.trim()}`);
  }
  let baseRef: string;
  if (await refExists(repoPath, `refs/heads/${baseBranch}`)) baseRef = baseBranch;
  else if (await refExists(repoPath, `refs/remotes/origin/${baseBranch}`)) baseRef = `origin/${baseBranch}`;
  else {
    throw new CoreError('GIT_ERROR', `base branch "${baseBranch}" not found locally or on origin`);
  }
  await mkdir(dirname(worktreePath), { recursive: true });
  await git(repoPath, ['worktree', 'add', '-b', branch, worktreePath, baseRef]);
  const baseCommit = (await git(worktreePath, ['rev-parse', 'HEAD'])).stdout.trim();

  const seededFiles: string[] = [];
  for (const file of input.instructionFiles ?? []) {
    const target = join(worktreePath, file);
    if (await exists(target)) continue;
    for (const dir of input.templateDirs ?? []) {
      const src = join(dir, file);
      if (await exists(src)) {
        await mkdir(dirname(target), { recursive: true });
        await copyFile(src, target);
        seededFiles.push(file);
        break;
      }
    }
  }
  return { baseCommit, baseRef, seededFiles, warnings };
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Pathspec that excludes the given paths (e.g. seeded instruction files). */
function pathspec(exclude: string[] = []): string[] {
  return ['--', '.', ...exclude.map((p) => `:(exclude)${p}`)];
}

/** Stage everything except `exclude`; excluded paths that were staged earlier are unstaged. */
async function stageAll(worktreePath: string, exclude: string[] = []): Promise<void> {
  await git(worktreePath, ['add', '-A', ...pathspec(exclude)]);
  if (exclude.length) await git(worktreePath, ['reset', '-q', '--', ...exclude], { reject: false });
}

/**
 * Files from `candidates` that exist in the worktree but not in `baseCommit`
 * (i.e. were seeded by agent-kanban, not part of the repo).
 */
export async function seededFiles(
  worktreePath: string,
  baseCommit: string,
  candidates: string[],
): Promise<string[]> {
  const out: string[] = [];
  for (const file of candidates) {
    if (!(await exists(join(worktreePath, file)))) continue;
    const inBase = await git(worktreePath, ['cat-file', '-e', `${baseCommit}:${file}`], { reject: false });
    if (inBase.exitCode !== 0) out.push(file);
  }
  return out;
}

export interface DiffOptions {
  /** Paths excluded from diff/commit (seeded instruction files). */
  exclude?: string[];
}

/**
 * Diff of everything in the worktree (committed + staged + unstaged + untracked)
 * against the attempt's base commit. Stages all changes as a side effect, which is
 * harmless because the system commits everything anyway.
 */
export async function diffWorktree(
  worktreePath: string,
  baseCommit: string,
  opts: DiffOptions = {},
): Promise<DiffResult> {
  await stageAll(worktreePath, opts.exclude);
  const spec = pathspec(opts.exclude);
  const numstat = await git(worktreePath, ['diff', '--cached', '--numstat', '-M', baseCommit, ...spec]);
  const nameStatus = await git(worktreePath, [
    'diff',
    '--cached',
    '--name-status',
    '-M',
    baseCommit,
    ...spec,
  ]);
  const patch = await git(worktreePath, ['diff', '--cached', '-M', '--no-color', baseCommit, ...spec]);

  const statusByPath = new Map<string, { status: DiffFile['status']; oldPath: string | null }>();
  for (const line of nameStatus.stdout.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const code = parts[0] ?? '';
    if (code.startsWith('R')) {
      statusByPath.set(parts[2] ?? '', { status: 'renamed', oldPath: parts[1] ?? null });
    } else {
      const status: DiffFile['status'] = code === 'A' ? 'added' : code === 'D' ? 'deleted' : 'modified';
      statusByPath.set(parts[1] ?? '', { status, oldPath: null });
    }
  }
  const files: DiffFile[] = [];
  for (const line of numstat.stdout.split('\n')) {
    if (!line.trim()) continue;
    const [add, del, ...rest] = line.split('\t');
    let path = rest.join('\t');
    let oldPath: string | null = null;
    // rename form: "old => new" or "{a => b}/x"
    const arrow = path.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
    if (arrow) {
      oldPath = `${arrow[1]}${arrow[2]}${arrow[4]}`;
      path = `${arrow[1]}${arrow[3]}${arrow[4]}`;
    } else if (path.includes(' => ')) {
      const [o, n] = path.split(' => ');
      oldPath = o ?? null;
      path = n ?? path;
    }
    const binary = add === '-' || del === '-';
    const st = statusByPath.get(path);
    files.push({
      path,
      old_path: st?.oldPath ?? oldPath,
      additions: binary ? 0 : Number(add),
      deletions: binary ? 0 : Number(del),
      status: binary ? 'binary' : (st?.status ?? 'modified'),
    });
  }
  return { files, patch: patch.stdout };
}

export async function hasChanges(
  worktreePath: string,
  baseCommit: string,
  opts: DiffOptions = {},
): Promise<boolean> {
  await stageAll(worktreePath, opts.exclude);
  const r = await git(worktreePath, ['diff', '--cached', '--quiet', baseCommit, ...pathspec(opts.exclude)], {
    reject: false,
  });
  return r.exitCode !== 0;
}

/** Stage and commit everything not yet committed. Returns the new commit sha, or null if nothing to commit. */
export async function commitAll(
  worktreePath: string,
  message: string,
  opts: DiffOptions = {},
): Promise<string | null> {
  await stageAll(worktreePath, opts.exclude);
  const staged = await git(worktreePath, ['diff', '--cached', '--quiet'], { reject: false });
  if (staged.exitCode === 0) return null;
  const args = ['commit', '-q', '-m', message];
  const name = await git(worktreePath, ['config', 'user.name'], { reject: false });
  const email = await git(worktreePath, ['config', 'user.email'], { reject: false });
  if (!name.stdout.trim() || !email.stdout.trim()) {
    args.unshift('-c', 'user.name=agent-kanban', '-c', 'user.email=agent-kanban@localhost');
  }
  await git(worktreePath, args);
  return (await git(worktreePath, ['rev-parse', 'HEAD'])).stdout.trim();
}

export async function push(worktreePath: string, branch: string): Promise<{ ok: boolean; message?: string }> {
  if (!(await hasRemote(worktreePath))) return { ok: false, message: 'no origin remote' };
  const r = await git(worktreePath, ['push', '-u', 'origin', branch], { reject: false, timeout: 120_000 });
  return r.exitCode === 0 ? { ok: true } : { ok: false, message: r.stderr.trim() || r.stdout.trim() };
}

export interface MergeResult {
  mergeCommit: string;
  via: 'main-worktree' | 'temp-worktree';
}

/**
 * Merge `branch` into `baseBranch` with --no-ff. If the main working tree has
 * baseBranch checked out it must be clean; otherwise a temporary worktree is used
 * so the user's checkout is never touched. Conflicts abort the merge and throw.
 */
export async function mergeBranch(
  repoPath: string,
  baseBranch: string,
  branch: string,
  message: string,
  tmpRoot: string,
): Promise<MergeResult> {
  const head = await currentBranch(repoPath);
  if (head === baseBranch) {
    if (!(await isClean(repoPath))) {
      throw new CoreError(
        'CONFLICT',
        `main working tree at ${repoPath} has uncommitted changes; commit or stash them before merging`,
      );
    }
    await runMerge(repoPath, branch, message);
    return { mergeCommit: (await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim(), via: 'main-worktree' };
  }
  // base branch is not checked out in the main tree → merge in a temporary worktree
  const tmp = join(tmpRoot, `merge-${Date.now()}`);
  await mkdir(dirname(tmp), { recursive: true });
  await git(repoPath, ['worktree', 'add', tmp, baseBranch]);
  try {
    await runMerge(tmp, branch, message);
    return { mergeCommit: (await git(tmp, ['rev-parse', 'HEAD'])).stdout.trim(), via: 'temp-worktree' };
  } finally {
    await git(repoPath, ['worktree', 'remove', '--force', tmp], { reject: false });
    await rm(tmp, { recursive: true, force: true });
  }
}

async function runMerge(cwd: string, branch: string, message: string) {
  const args = ['merge', '--no-ff', '--no-edit', '-m', message, branch];
  const name = await git(cwd, ['config', 'user.name'], { reject: false });
  if (!name.stdout.trim())
    args.unshift('-c', 'user.name=agent-kanban', '-c', 'user.email=agent-kanban@localhost');
  const r = await git(cwd, args, { reject: false });
  if (r.exitCode !== 0) {
    await git(cwd, ['merge', '--abort'], { reject: false });
    throw new CoreError('CONFLICT', `merge of ${branch} failed: ${(r.stdout + r.stderr).trim()}`);
  }
}

export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
  branch: string,
  opts: { deleteBranch: boolean },
): Promise<void> {
  await git(repoPath, ['worktree', 'remove', '--force', worktreePath], { reject: false });
  await rm(worktreePath, { recursive: true, force: true });
  await git(repoPath, ['worktree', 'prune'], { reject: false });
  if (opts.deleteBranch) await git(repoPath, ['branch', '-D', branch], { reject: false });
}

export async function pruneWorktrees(repoPath: string): Promise<void> {
  await git(repoPath, ['worktree', 'prune'], { reject: false });
}

export async function listWorktrees(repoPath: string): Promise<string[]> {
  const r = await git(repoPath, ['worktree', 'list', '--porcelain'], { reject: false });
  return r.stdout
    .split('\n')
    .filter((l) => l.startsWith('worktree '))
    .map((l) => l.slice('worktree '.length).trim());
}

export interface RepoConfig {
  default_executor?: string;
  base_branch?: string;
  setup_script?: string | null;
  test_script?: string | null;
  refinement_enabled?: boolean;
}

/** Optional `<repo>/.agent-kanban.json` used as defaults when adding a project. */
export async function readRepoConfig(repoPath: string): Promise<RepoConfig | null> {
  try {
    const raw = await readFile(join(repoPath, '.agent-kanban.json'), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as RepoConfig;
  } catch {
    /* missing or invalid */
  }
  return null;
}
