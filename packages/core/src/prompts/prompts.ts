/**
 * Prompt builders for every kind of run. All user-facing prompt text lives here,
 * in two languages, as templates with `{{placeholders}}`. Projects may override the
 * execute / followup / refine templates; unknown placeholders are left untouched.
 */
import type { Comment, PromptLanguage, Task } from '@agent-kanban/shared';

// ---------------------------------------------------------------------------
// Structured-output schemas
// ---------------------------------------------------------------------------

/** Schema the refinement run must answer with. */
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

/** Schema for planner chat runs. */
export const CHAT_SCHEMA = {
  type: 'object',
  required: ['reply', 'plan'],
  properties: {
    reply: { type: 'string', description: 'Answer to the user, markdown' },
    plan: { type: ['string', 'null'], description: 'Full updated plan if it changed, else null' },
  },
} as const;

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export interface PromptTemplates {
  /** Refinement (BACKLOG → TODO). Placeholders: title, description, qa */
  refine: string;
  /** Appended to `refine`/`chat` when the CLI cannot enforce a JSON schema. Placeholder: schema */
  jsonFallback: string;
  /** Execute run. Placeholders: title, description, plan_section, feedback_section, worktree_notice, constraints */
  execute: string;
  /** Constraints block reused by execute / retry. */
  constraints: string;
  /** Notice prepended when resuming a refinement session in a different cwd. Placeholders: title, worktree, repo */
  worktreeNotice: string;
  /** Followup run. Placeholder: feedback (numbered list) */
  followup: string;
  /** Followup without session resume. Placeholders: title, description, plan_section, diff, followup */
  followupNoResume: string;
  /** Retry after DOING(error). Placeholders: error, extra_feedback, constraints */
  retry: string;
  /** Planner chat. Placeholders: message, context */
  chat: string;
  /** Chat context when no session is resumed. Placeholders: title, description, plan_section, qa_section */
  chatContext: string;
  /** Merge-conflict resolution followup. Placeholders: base, files */
  resolveConflicts: string;
  /** Section headings */
  headings: { plan: string; feedback: string; qa: string; diff: string; none: string };
}

const VI: PromptTemplates = {
  refine: `Bạn đang đánh giá một task trước khi giao cho coding agent thực thi. KHÔNG sửa file.
Đọc codebase để hiểu bối cảnh, rồi trả lời theo JSON schema.

Task:
{{title}}
{{description}}

Câu hỏi đã được trả lời trước đó (nếu có):
{{qa}}

Yêu cầu:
- ready=true chỉ khi bạn tự tin thực hiện được mà không cần hỏi thêm.
- questions: tối đa 5 câu, chỉ hỏi điều thực sự ảnh hưởng tới cách làm. Không hỏi điều có thể tự tìm trong code.
- plan: các bước cụ thể, file sẽ đụng tới, rủi ro.`,
  jsonFallback: `

Trả lời DUY NHẤT một JSON object (không có text khác, không code fence) theo schema:
{{schema}}`,
  execute: `{{worktree_notice}}# {{title}}

{{description}}
{{plan_section}}{{feedback_section}}
{{constraints}}`,
  constraints: `## Ràng buộc
- Làm việc trong thư mục hiện tại, đây là một git worktree riêng, cứ sửa thoải mái.
- Không tự commit; hệ thống sẽ commit.
- Trước khi kết thúc: chạy test/lint liên quan nếu có và sửa lỗi bạn gây ra.
- Khi xong, tóm tắt ngắn: đã làm gì, chưa làm gì, điểm cần người review chú ý.`,
  worktreeNotice: `Hãy thực hiện plan đã thống nhất cho task "{{title}}".

QUAN TRỌNG: thư mục làm việc đã đổi sang worktree riêng: {{worktree}}
Chỉ sửa file bên trong thư mục đó. KHÔNG sửa gì trong {{repo}}.

`,
  followup: `Người review có feedback về thay đổi của bạn. Hãy xử lý từng điểm:

{{feedback}}

Chỉ sửa những gì cần thiết cho feedback. Không refactor ngoài phạm vi.`,
  followupNoResume: `# {{title}}

{{description}}
{{plan_section}}
## Thay đổi hiện tại trong worktree (git diff)
\`\`\`diff
{{diff}}
\`\`\`

{{followup}}`,
  retry: `Lần chạy trước kết thúc với lỗi:
{{error}}
{{extra_feedback}}
Hãy tiếp tục công việc từ chỗ đang dở, xử lý nguyên nhân lỗi nếu nó thuộc về bạn, rồi hoàn thành task.

{{constraints}}`,
  chat: `Người dùng nhắn (chat với planner, KHÔNG sửa file, chỉ đọc code nếu cần):
{{message}}{{context}}

Trả lời ngắn gọn trong "reply" (markdown). Nếu yêu cầu này làm thay đổi cách thực hiện, đưa TOÀN BỘ plan đã cập nhật vào "plan"; nếu không thì plan = null.`,
  chatContext: `

Bối cảnh task:
# {{title}}
{{description}}
{{plan_section}}{{qa_section}}`,
  resolveConflicts: `Nhánh này vừa được merge với "{{base}}" và có conflict ở các file sau:
{{files}}

Hãy mở từng file, giải quyết conflict (xoá hết marker <<<<<<< ======= >>>>>>>), giữ đúng ý đồ của cả hai phía, chạy test liên quan nếu có.
KHÔNG tự commit; hệ thống sẽ commit merge sau khi bạn xong.`,
  headings: {
    plan: '## Plan đã duyệt',
    feedback: '## Feedback từ các lần thử trước',
    qa: '## Q&A trước đó',
    diff: 'diff cắt bớt',
    none: '(không có mô tả)',
  },
};

const EN: PromptTemplates = {
  refine: `You are assessing a task before it is handed to a coding agent. Do NOT modify files.
Read the codebase for context, then answer according to the JSON schema.

Task:
{{title}}
{{description}}

Previously answered questions (if any):
{{qa}}

Requirements:
- ready=true only if you are confident you could implement it without asking anything else.
- questions: at most 5, only about things that really change the approach. Do not ask what you can find in the code.
- plan: concrete steps, files you will touch, risks.`,
  jsonFallback: `

Reply with ONLY one JSON object (no other text, no code fence) matching this schema:
{{schema}}`,
  execute: `{{worktree_notice}}# {{title}}

{{description}}
{{plan_section}}{{feedback_section}}
{{constraints}}`,
  constraints: `## Constraints
- Work in the current directory; it is a dedicated git worktree, edit freely.
- Do not commit; the system commits for you.
- Before finishing, run the relevant tests/linters if any and fix what you broke.
- End with a short summary: what you did, what you did not do, what a reviewer should look at.`,
  worktreeNotice: `Implement the plan we agreed on for task "{{title}}".

IMPORTANT: the working directory changed to a dedicated worktree: {{worktree}}
Only modify files inside it. Do NOT touch {{repo}}.

`,
  followup: `The reviewer left feedback on your changes. Address every point:

{{feedback}}

Change only what the feedback requires. No refactoring beyond scope.`,
  followupNoResume: `# {{title}}

{{description}}
{{plan_section}}
## Current changes in the worktree (git diff)
\`\`\`diff
{{diff}}
\`\`\`

{{followup}}`,
  retry: `The previous run ended with an error:
{{error}}
{{extra_feedback}}
Continue where you left off, fix the cause if it is yours, and complete the task.

{{constraints}}`,
  chat: `Message from the user (planner chat, do NOT modify files, read code only if needed):
{{message}}{{context}}

Answer briefly in "reply" (markdown). If this changes how the task should be done, put the FULL updated plan in "plan"; otherwise plan = null.`,
  chatContext: `

Task context:
# {{title}}
{{description}}
{{plan_section}}{{qa_section}}`,
  resolveConflicts: `This branch was just merged with "{{base}}" and has conflicts in:
{{files}}

Open each file, resolve the conflicts (remove every <<<<<<< ======= >>>>>>> marker), keep the intent of both sides, run related tests if any.
Do NOT commit; the system commits the merge when you are done.`,
  headings: {
    plan: '## Approved plan',
    feedback: '## Feedback from previous attempts',
    qa: '## Previous Q&A',
    diff: 'diff truncated',
    none: '(no description)',
  },
};

export const TEMPLATES: Record<PromptLanguage, PromptTemplates> = { vi: VI, en: EN };

/** Per-project prompt configuration. */
export interface PromptContext {
  lang: PromptLanguage;
  /** Optional project overrides (same placeholders as the built-ins). */
  overrides?: { execute?: string | null; followup?: string | null; refine?: string | null };
}

export const DEFAULT_PROMPT_CONTEXT: PromptContext = { lang: 'vi' };

/** Kept for backwards compatibility with the settings UI hint. */
export const DEFAULT_REFINE_TEMPLATE = VI.refine;

/** Replace `{{key}}` placeholders; unknown keys are left as-is so users see typos. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template
    .replace(/\{\{(\w+)\}\}/g, (m, key: string) => (key in vars ? vars[key]! : m))
    .replace(/\n{3,}/g, '\n\n');
}

function t(ctx: PromptContext): PromptTemplates {
  return TEMPLATES[ctx.lang] ?? VI;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

export interface QA {
  question: string;
  answer: string | null;
}

const formatQa = (qa: QA[]) =>
  qa
    .filter((q) => q.answer)
    .map((q, i) => `${i + 1}. Q: ${q.question}\n   A: ${q.answer}`)
    .join('\n');

export function renderRefinePrompt(
  ctx: PromptContext,
  task: Pick<Task, 'title' | 'description'>,
  qa: QA[],
  opts: { structuredOutputSupported: boolean },
): string {
  const tpl = t(ctx);
  const template = ctx.overrides?.refine?.trim() ? ctx.overrides.refine : tpl.refine;
  const body = renderTemplate(template, {
    title: task.title,
    description: task.description || tpl.headings.none,
    qa: formatQa(qa) || (ctx.lang === 'vi' ? '(chưa có)' : '(none)'),
  });
  return opts.structuredOutputSupported
    ? body
    : body + renderTemplate(tpl.jsonFallback, { schema: JSON.stringify(REFINE_SCHEMA) });
}

export interface ExecutePromptInput {
  task: Pick<Task, 'title' | 'description' | 'plan'>;
  worktreePath: string;
  repoPath: string;
  /** true when the run resumes the refinement session (cwd changed → notice). */
  resumingRefinement: boolean;
  /** Feedback from previous attempts (Restart flow). */
  previousFeedback?: Comment[];
  attachmentPath?: (a: Comment['attachments'][number]) => string;
}

export function buildExecutePrompt(ctx: PromptContext, input: ExecutePromptInput): string {
  const tpl = t(ctx);
  const template = ctx.overrides?.execute?.trim() ? ctx.overrides.execute : tpl.execute;
  return renderTemplate(template, {
    title: input.task.title,
    description: input.task.description || tpl.headings.none,
    plan_section: input.task.plan?.trim() ? `\n${tpl.headings.plan}\n${input.task.plan.trim()}\n` : '',
    feedback_section: input.previousFeedback?.length
      ? `\n${tpl.headings.feedback}\n${formatFeedbackList(input.previousFeedback)}\n`
      : '',
    worktree_notice: input.resumingRefinement
      ? renderTemplate(tpl.worktreeNotice, {
          title: input.task.title,
          worktree: input.worktreePath,
          repo: input.repoPath,
        })
      : '',
    constraints: tpl.constraints,
  });
}

/**
 * `1. [path:line] body` list used by followup / retry / restart prompts. Attached
 * images are listed by absolute path so the agent can open them with its Read tool.
 */
export function formatFeedbackList(
  comments: Comment[],
  attachmentPath: (a: Comment['attachments'][number]) => string = () => '',
): string {
  return comments
    .map((c, i) => {
      const loc = c.file_path ? `[${c.file_path}${c.line ? `:${c.line}` : ''}] ` : '';
      const images = c.attachments.map((a) => `\n   [image: ${attachmentPath(a)}]`).join('');
      return `${i + 1}. ${loc}${c.body.trim()}${images}`;
    })
    .join('\n');
}

/** Section listing attached images for prompts that are not comment lists (planner chat). */
export function formatAttachments(lang: PromptLanguage, paths: string[]): string {
  if (!paths.length) return '';
  const heading =
    lang === 'vi'
      ? 'Ảnh đính kèm (mở bằng tool Read để xem):'
      : 'Attached images (open them with the Read tool):';
  return `\n\n${heading}\n${paths.map((p) => `- ${p}`).join('\n')}`;
}

export function buildFollowupPrompt(
  ctx: PromptContext,
  comments: Comment[],
  attachmentPath?: (a: Comment['attachments'][number]) => string,
): string {
  const template = ctx.overrides?.followup?.trim() ? ctx.overrides.followup : t(ctx).followup;
  return renderTemplate(template, { feedback: formatFeedbackList(comments, attachmentPath) });
}

export const MAX_DIFF_CHARS = 20_000;

/** Followup prompt for executors that cannot resume a session: description + diff + feedback. */
export function buildFollowupPromptWithoutResume(
  ctx: PromptContext,
  task: Pick<Task, 'title' | 'description' | 'plan'>,
  diff: string,
  comments: Comment[],
  attachmentPath?: (a: Comment['attachments'][number]) => string,
): string {
  const tpl = t(ctx);
  const truncated =
    diff.length > MAX_DIFF_CHARS
      ? `${diff.slice(0, MAX_DIFF_CHARS)}\n... (${tpl.headings.diff}, ${diff.length} chars)`
      : diff;
  return renderTemplate(tpl.followupNoResume, {
    title: task.title,
    description: task.description,
    plan_section: task.plan ? `\n${tpl.headings.plan}\n${task.plan}\n` : '',
    diff: truncated,
    followup: buildFollowupPrompt(ctx, comments, attachmentPath),
  });
}

export function buildRetryPrompt(
  ctx: PromptContext,
  errorMessage: string | null,
  extraFeedback: Comment[] = [],
  attachmentPath?: (a: Comment['attachments'][number]) => string,
): string {
  const tpl = t(ctx);
  const extraHeading = ctx.lang === 'vi' ? 'Người dùng bổ sung:' : 'Additional notes from the user:';
  return renderTemplate(tpl.retry, {
    error: errorMessage ?? (ctx.lang === 'vi' ? '(không rõ)' : '(unknown)'),
    extra_feedback: extraFeedback.length
      ? `\n${extraHeading}\n${formatFeedbackList(extraFeedback, attachmentPath)}\n`
      : '',
    constraints: tpl.constraints,
  });
}

/** Chat with the planner (read-only) before the task runs. */
export function buildPlannerChatPrompt(
  ctx: PromptContext,
  task: Pick<Task, 'title' | 'description' | 'plan'>,
  message: string,
  qa: QA[],
  opts: { structuredOutputSupported: boolean; resuming: boolean; attachments?: string[] },
): string {
  const tpl = t(ctx);
  const context = opts.resuming
    ? ''
    : renderTemplate(tpl.chatContext, {
        title: task.title,
        description: task.description || tpl.headings.none,
        plan_section: task.plan ? `\n${tpl.headings.plan}\n${task.plan}\n` : '',
        qa_section: formatQa(qa) ? `\n${tpl.headings.qa}\n${formatQa(qa)}\n` : '',
      });
  const body = renderTemplate(tpl.chat, {
    message: message + formatAttachments(ctx.lang, opts.attachments ?? []),
    context,
  });
  return opts.structuredOutputSupported
    ? body
    : body + renderTemplate(tpl.jsonFallback, { schema: JSON.stringify(CHAT_SCHEMA) });
}

/** Prompt for a followup that must resolve merge conflicts after "Update from base". */
export function buildResolveConflictsPrompt(ctx: PromptContext, baseBranch: string, files: string[]): string {
  return renderTemplate(t(ctx).resolveConflicts, {
    base: baseBranch,
    files: files.map((f) => `- ${f}`).join('\n'),
  });
}

/** Append answered refinement Q&A to the task description (spec §5). */
export function appendQaToDescription(description: string, qa: QA[]): string {
  const answered = qa.filter((q) => q.answer);
  if (!answered.length) return description;
  const block = answered.map((q) => `- **Q:** ${q.question}\n  **A:** ${q.answer}`).join('\n');
  return `${description.trimEnd()}\n\n## Q&A (refinement)\n${block}\n`;
}

/** Append still-open questions when refinement gives up after the maximum number of rounds. */
export function appendOpenQuestionsToDescription(description: string, questions: string[]): string {
  const q = questions.length
    ? `\n\n## Open questions (refinement incomplete)\n${questions.map((x) => `- ${x}`).join('\n')}`
    : '';
  return `${description.trimEnd()}${q}\n`;
}

export function commitMessage(task: Pick<Task, 'id' | 'title'>, attemptId: string): string {
  return `${task.title}\n\nTask: ${task.id}\nAttempt: ${attemptId}`;
}
