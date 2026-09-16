import type { Comment, Task } from '@agent-kanban/shared';

export const REFINE_SCHEMA = {
  type: 'object',
  required: ['ready', 'questions', 'plan', 'affected_files'],
  properties: {
    ready: { type: 'boolean' },
    questions: { type: 'array', items: { type: 'string' }, maxItems: 5 },
    plan: { type: 'string' },
    affected_files: { type: 'array', items: { type: 'string' } },
  },
} as const;

export const DEFAULT_REFINE_TEMPLATE = `Bạn đang đánh giá một task trước khi giao cho coding agent thực thi. KHÔNG sửa file.
Đọc codebase để hiểu bối cảnh, rồi trả lời theo JSON schema.

Task:
{{title}}
{{description}}

Câu hỏi đã được trả lời trước đó (nếu có):
{{qa}}

Yêu cầu:
- ready=true chỉ khi bạn tự tin thực hiện được mà không cần hỏi thêm.
- questions: tối đa 5 câu, chỉ hỏi điều thực sự ảnh hưởng tới cách làm. Không hỏi điều có thể tự tìm trong code.
- plan: các bước cụ thể, file sẽ đụng tới, rủi ro.`;

export const REFINE_JSON_FALLBACK = `

Trả lời DUY NHẤT một JSON object (không có text khác, không code fence) theo schema:
${JSON.stringify(REFINE_SCHEMA)}`;

export interface QA {
  question: string;
  answer: string | null;
}

export function renderRefinePrompt(
  template: string | null | undefined,
  task: Pick<Task, 'title' | 'description'>,
  qa: QA[],
  opts: { structuredOutputSupported: boolean },
): string {
  const answered = qa.filter((q) => q.answer);
  const qaText = answered.length
    ? answered.map((q, i) => `${i + 1}. Q: ${q.question}\n   A: ${q.answer}`).join('\n')
    : '(chưa có)';
  const body = (template?.trim() ? template : DEFAULT_REFINE_TEMPLATE)
    .replaceAll('{{title}}', task.title)
    .replaceAll('{{description}}', task.description || '(không có mô tả)')
    .replaceAll('{{qa}}', qaText);
  return opts.structuredOutputSupported ? body : body + REFINE_JSON_FALLBACK;
}

const EXECUTE_CONSTRAINTS = `## Ràng buộc
- Làm việc trong thư mục hiện tại, đây là một git worktree riêng, cứ sửa thoải mái.
- Không tự commit; hệ thống sẽ commit.
- Trước khi kết thúc: chạy test/lint liên quan nếu có và sửa lỗi bạn gây ra.
- Khi xong, tóm tắt ngắn: đã làm gì, chưa làm gì, điểm cần người review chú ý.`;

export interface ExecutePromptInput {
  task: Pick<Task, 'title' | 'description' | 'plan'>;
  worktreePath: string;
  repoPath: string;
  /** true when the run resumes the refinement session (context already known). */
  resumingRefinement: boolean;
  /** Feedback from previous attempts (Restart flow). */
  previousFeedback?: Comment[];
}

export function buildExecutePrompt(input: ExecutePromptInput): string {
  const parts: string[] = [];
  if (input.resumingRefinement) {
    parts.push(
      `Hãy thực hiện plan đã thống nhất cho task "${input.task.title}".`,
      `QUAN TRỌNG: thư mục làm việc đã đổi sang worktree riêng: ${input.worktreePath}\nChỉ sửa file bên trong thư mục đó. KHÔNG sửa gì trong ${input.repoPath}.`,
    );
  }
  parts.push(`# ${input.task.title}\n\n${input.task.description || '(không có mô tả)'}`);
  if (input.task.plan?.trim()) parts.push(`## Plan đã duyệt\n${input.task.plan.trim()}`);
  if (input.previousFeedback?.length) {
    parts.push(`## Feedback từ các lần thử trước\n${formatFeedbackList(input.previousFeedback)}`);
  }
  parts.push(EXECUTE_CONSTRAINTS);
  return parts.join('\n\n');
}

export function formatFeedbackList(comments: Comment[]): string {
  return comments
    .map((c, i) => {
      const loc = c.file_path ? `[${c.file_path}${c.line ? `:${c.line}` : ''}] ` : '';
      return `${i + 1}. ${loc}${c.body.trim()}`;
    })
    .join('\n');
}

export function buildFollowupPrompt(comments: Comment[]): string {
  return `Người review có feedback về thay đổi của bạn. Hãy xử lý từng điểm:

${formatFeedbackList(comments)}

Chỉ sửa những gì cần thiết cho feedback. Không refactor ngoài phạm vi.`;
}

export const MAX_DIFF_CHARS = 20_000;

/** Followup prompt for executors that cannot resume a session. */
export function buildFollowupPromptWithoutResume(
  task: Pick<Task, 'title' | 'description' | 'plan'>,
  diff: string,
  comments: Comment[],
): string {
  const truncated =
    diff.length > MAX_DIFF_CHARS
      ? `${diff.slice(0, MAX_DIFF_CHARS)}\n... (diff cắt bớt, ${diff.length} ký tự)`
      : diff;
  return `# ${task.title}

${task.description}
${task.plan ? `\n## Plan đã duyệt\n${task.plan}\n` : ''}
## Thay đổi hiện tại trong worktree (git diff)
\`\`\`diff
${truncated}
\`\`\`

${buildFollowupPrompt(comments)}`;
}

export function buildRetryPrompt(errorMessage: string | null): string {
  return `Lần chạy trước kết thúc với lỗi:
${errorMessage ?? '(không rõ)'}

Hãy tiếp tục công việc từ chỗ đang dở, xử lý nguyên nhân lỗi nếu nó thuộc về bạn, rồi hoàn thành task.

${EXECUTE_CONSTRAINTS}`;
}

export function appendQaToDescription(description: string, qa: QA[]): string {
  const answered = qa.filter((q) => q.answer);
  if (!answered.length) return description;
  const block = answered.map((q) => `- **Q:** ${q.question}\n  **A:** ${q.answer}`).join('\n');
  return `${description.trimEnd()}\n\n## Q&A (refinement)\n${block}\n`;
}

export function appendOpenQuestionsToDescription(description: string, questions: string[]): string {
  const q = questions.length
    ? `\n\n## Câu hỏi còn mở (refinement chưa hoàn tất)\n${questions.map((x) => `- ${x}`).join('\n')}`
    : '';
  return `${description.trimEnd()}${q}\n`;
}

export function commitMessage(task: Pick<Task, 'id' | 'title'>, attemptId: string): string {
  return `${task.title}\n\nTask: ${task.id}\nAttempt: ${attemptId}`;
}
