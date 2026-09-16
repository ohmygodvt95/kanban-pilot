import type { Comment } from '@agent-kanban/shared';
import { describe, expect, it } from 'vitest';
import {
  appendQaToDescription,
  buildExecutePrompt,
  buildFollowupPrompt,
  buildFollowupPromptWithoutResume,
  MAX_DIFF_CHARS,
  renderRefinePrompt,
} from './prompts.js';

const comment = (over: Partial<Comment>): Comment => ({
  id: 'c',
  task_id: 't',
  attempt_id: null,
  kind: 'feedback',
  body: 'fix it',
  file_path: null,
  line: null,
  consumed_by_run_id: null,
  created_at: '',
  ...over,
});

describe('prompts', () => {
  it('renders refine prompt with Q&A and fallback json instructions', () => {
    const p = renderRefinePrompt(null, { title: 'T', description: 'D' }, [{ question: 'q1', answer: 'a1' }], {
      structuredOutputSupported: false,
    });
    expect(p).toContain('T\nD');
    expect(p).toContain('Q: q1');
    expect(p).toContain('A: a1');
    expect(p).toContain('JSON object');
    const custom = renderRefinePrompt('X {{title}} Y', { title: 'T', description: '' }, [], {
      structuredOutputSupported: true,
    });
    expect(custom).toBe('X T Y');
  });

  it('builds execute prompt with plan and constraints', () => {
    const p = buildExecutePrompt({
      task: { title: 'Add feature', description: 'desc', plan: 'step 1' },
      worktreePath: '/wt',
      repoPath: '/repo',
      resumingRefinement: true,
    });
    expect(p).toContain('# Add feature');
    expect(p).toContain('## Plan đã duyệt\nstep 1');
    expect(p).toContain('/wt');
    expect(p).toContain('Không tự commit');
  });

  it('numbers feedback with file:line prefixes', () => {
    const p = buildFollowupPrompt([
      comment({ file_path: 'src/a.ts', line: 12, body: 'rename' }),
      comment({ body: 'add tests' }),
    ]);
    expect(p).toContain('1. [src/a.ts:12] rename');
    expect(p).toContain('2. add tests');
  });

  it('truncates the diff for non-resumable executors', () => {
    const diff = 'x'.repeat(MAX_DIFF_CHARS + 500);
    const p = buildFollowupPromptWithoutResume({ title: 't', description: 'd', plan: null }, diff, [
      comment({}),
    ]);
    expect(p).toContain('diff cắt bớt');
    expect(p.length).toBeLessThan(MAX_DIFF_CHARS + 1000);
  });

  it('appends answered Q&A to description', () => {
    const d = appendQaToDescription('desc', [
      { question: 'q', answer: 'a' },
      { question: 'unanswered', answer: null },
    ]);
    expect(d).toContain('## Q&A (refinement)');
    expect(d).toContain('**Q:** q');
    expect(d).not.toContain('unanswered');
  });
});
