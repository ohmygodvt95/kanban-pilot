import type { Comment } from '@agent-kanban/shared';
import { describe, expect, it } from 'vitest';
import {
  appendQaToDescription,
  buildExecutePrompt,
  buildFollowupPrompt,
  buildFollowupPromptWithoutResume,
  buildRetryPrompt,
  MAX_DIFF_CHARS,
  type PromptContext,
  renderRefinePrompt,
  renderTemplate,
} from './prompts.js';

const vi: PromptContext = { lang: 'vi' };
const en: PromptContext = { lang: 'en' };

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
  attachments: [],
  ...over,
});

describe('prompts', () => {
  it('renders placeholders and leaves unknown ones visible', () => {
    expect(renderTemplate('a {{x}} {{nope}}', { x: '1' })).toBe('a 1 {{nope}}');
  });

  it('renders refine prompt with Q&A and fallback json instructions in both languages', () => {
    const p = renderRefinePrompt(vi, { title: 'T', description: 'D' }, [{ question: 'q1', answer: 'a1' }], {
      structuredOutputSupported: false,
    });
    expect(p).toContain('T\nD');
    expect(p).toContain('Q: q1');
    expect(p).toContain('JSON object');
    const e = renderRefinePrompt(en, { title: 'T', description: '' }, [], {
      structuredOutputSupported: true,
    });
    expect(e).toContain('You are assessing a task');
    expect(e).toContain('(no description)');
    const custom = renderRefinePrompt(
      { lang: 'en', overrides: { refine: 'X {{title}} Y' } },
      { title: 'T', description: '' },
      [],
      {
        structuredOutputSupported: true,
      },
    );
    expect(custom).toBe('X T Y');
  });

  it('builds execute prompt with plan, constraints and worktree notice; honours overrides', () => {
    const p = buildExecutePrompt(vi, {
      task: { title: 'Add feature', description: 'desc', plan: 'step 1' },
      worktreePath: '/wt',
      repoPath: '/repo',
      resumingRefinement: true,
    });
    expect(p).toContain('# Add feature');
    expect(p).toContain('## Plan đã duyệt\nstep 1');
    expect(p).toContain('/wt');
    expect(p).toContain('Không tự commit');
    const custom = buildExecutePrompt(
      { lang: 'en', overrides: { execute: 'DO {{title}}\n{{constraints}}' } },
      {
        task: { title: 'X', description: '', plan: null },
        worktreePath: '/w',
        repoPath: '/r',
        resumingRefinement: false,
      },
    );
    expect(custom.startsWith('DO X\n## Constraints')).toBe(true);
  });

  it('numbers feedback with file:line prefixes and appends extra feedback to retries', () => {
    const p = buildFollowupPrompt(en, [
      comment({ file_path: 'src/a.ts', line: 12, body: 'rename' }),
      comment({ body: 'add tests' }),
    ]);
    expect(p).toContain('1. [src/a.ts:12] rename');
    expect(p).toContain('2. add tests');
    const r = buildRetryPrompt(en, 'boom', [comment({ body: 'try harder' })]);
    expect(r).toContain('boom');
    expect(r).toContain('Additional notes from the user:\n1. try harder');
    // attached images are listed by absolute path under the comment
    const withImage = buildFollowupPrompt(
      en,
      [
        comment({
          body: 'see screenshot',
          attachments: [
            {
              id: 'a1',
              comment_id: 'c',
              task_id: 't',
              name: 'shot.png',
              mime: 'image/png',
              size: 1,
              created_at: '',
            },
          ],
        }),
      ],
      (a) => `/att/${a.comment_id}/${a.id}-${a.name}`,
    );
    expect(withImage).toContain('1. see screenshot\n   [image: /att/c/a1-shot.png]');
  });

  it('truncates the diff for non-resumable executors', () => {
    const diff = 'x'.repeat(MAX_DIFF_CHARS + 500);
    const p = buildFollowupPromptWithoutResume(vi, { title: 't', description: 'd', plan: null }, diff, [
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
    expect(d).not.toContain('unanswered');
  });
});
