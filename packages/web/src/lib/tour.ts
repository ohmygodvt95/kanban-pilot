/**
 * Guided tours for first-time users. Steps anchor to elements carrying a
 * `data-tour` attribute; the first selector that resolves to a visible element
 * wins, so a step can point at the inline control on wide screens and at the
 * overflow menu on small ones. Completion is remembered per tour in localStorage.
 */

export interface TourStep {
  /** `data-tour` values to anchor to (first visible wins); none = centered card. */
  target?: string[];
  title: string;
  body: string;
}

const PREFIX = 'agent-kanban.tour.';

export function tourSeen(id: string): boolean {
  try {
    return localStorage.getItem(PREFIX + id) === '1';
  } catch {
    return true; // storage unavailable: never nag
  }
}

export function markTourSeen(id: string): void {
  try {
    localStorage.setItem(PREFIX + id, '1');
  } catch {
    /* ignore */
  }
}

/** Vietnamese when the browser prefers it, English otherwise. */
export function tourLanguage(): 'vi' | 'en' {
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('vi') ? 'vi' : 'en';
}

type Copy = Record<'en' | 'vi', TourStep[]>;

const BOARD: Copy = {
  en: [
    {
      title: 'Welcome to KanbanPilot',
      body: 'This board hands coding tasks to AI agents. Every task runs in its own git worktree, so your checkout is never touched. Let us walk through the five columns.',
    },
    {
      target: ['column-backlog'],
      title: 'Backlog — collect ideas',
      body: 'New tasks start here as drafts. With refinement on, the planner reads your description, asks clarifying questions and fills in the type and priority before any code is written.',
    },
    {
      target: ['column-todo'],
      title: 'To do — ready to run',
      body: 'Drag a task here (or answer the planner’s questions) to queue it. Turn on Auto-start in the project settings and everything landing here starts by itself, up to the concurrency limit.',
    },
    {
      target: ['column-doing'],
      title: 'Doing — the agent works',
      body: 'The agent runs in a fresh worktree. Open the task to follow the live log, see the cost, or chat to steer it. Kill or restart at any time.',
    },
    {
      target: ['column-review'],
      title: 'Review — check the result',
      body: 'Read the diff, run the tests, then either send feedback (the agent resumes its session) or merge / open a pull request.',
    },
    {
      target: ['column-done'],
      title: 'Done — merged and cleaned up',
      body: 'Finished tasks keep their history and cost; the worktree is removed. Clone a task to run it again.',
    },
    {
      target: ['new-task'],
      title: 'Create a task',
      body: 'Press n or click here. Give it a title and description, pick an executor, and optionally the type and priority — or leave those on auto for the planner.',
    },
    {
      target: ['search', 'filters'],
      title: 'Search and filters',
      body: 'Press / to search. The filter button reveals quick filters (needs me, running, bugs, urgent) and an executor filter. A dot on the button means the board is filtered.',
    },
    {
      target: ['menu'],
      title: 'More actions',
      body: 'Import issues from GitHub, GitLab or Jira, clear all tasks of the project, or replay this tour.',
    },
    {
      target: ['nav', 'menu'],
      title: 'Integration and settings',
      body: 'Link an issue tracker (plug icon) to import issues and sync statuses both ways, and tune the project (gear icon): auto-start, scripts, budget, prompts.',
    },
  ],
  vi: [
    {
      title: 'Chào mừng đến KanbanPilot',
      body: 'Bảng này giao task lập trình cho AI agent. Mỗi task chạy trong một git worktree riêng nên mã đang làm của bạn không bị đụng tới. Cùng đi qua năm cột nhé.',
    },
    {
      target: ['column-backlog'],
      title: 'Backlog — gom ý tưởng',
      body: 'Task mới nằm ở đây dưới dạng nháp. Khi bật refinement, planner sẽ đọc mô tả, hỏi lại chỗ chưa rõ và tự điền loại/độ ưu tiên trước khi viết code.',
    },
    {
      target: ['column-todo'],
      title: 'To do — sẵn sàng chạy',
      body: 'Kéo task vào đây (hoặc trả lời câu hỏi của planner) để xếp hàng. Bật Auto-start trong cài đặt project thì task vào cột này sẽ tự chạy, tối đa theo số song song đã cấu hình.',
    },
    {
      target: ['column-doing'],
      title: 'Doing — agent đang làm',
      body: 'Agent chạy trong worktree mới. Mở task để xem log trực tiếp, chi phí, hoặc chat để điều hướng thêm. Có thể dừng hay chạy lại bất cứ lúc nào.',
    },
    {
      target: ['column-review'],
      title: 'Review — kiểm tra kết quả',
      body: 'Xem diff, chạy test, rồi gửi feedback (agent tiếp tục đúng session cũ) hoặc merge / mở pull request.',
    },
    {
      target: ['column-done'],
      title: 'Done — đã merge, dọn dẹp xong',
      body: 'Task hoàn tất giữ lại lịch sử và chi phí; worktree được xóa. Bấm Clone để chạy lại một task.',
    },
    {
      target: ['new-task'],
      title: 'Tạo task',
      body: 'Nhấn n hoặc bấm vào đây. Nhập tiêu đề, mô tả, chọn executor và tùy chọn loại/độ ưu tiên — hoặc để auto cho planner điền.',
    },
    {
      target: ['search', 'filters'],
      title: 'Tìm kiếm và bộ lọc',
      body: 'Nhấn / để tìm. Nút bộ lọc mở hàng lọc nhanh (needs me, running, bugs, urgent) và lọc theo executor. Nút có chấm màu nghĩa là bảng đang bị lọc.',
    },
    {
      target: ['menu'],
      title: 'Thao tác khác',
      body: 'Import issue từ GitHub, GitLab hay Jira, xóa toàn bộ task của project, hoặc xem lại hướng dẫn này.',
    },
    {
      target: ['nav', 'menu'],
      title: 'Tích hợp và cài đặt',
      body: 'Liên kết issue tracker (icon phích cắm) để import issue và đồng bộ trạng thái hai chiều; chỉnh project (icon bánh răng): auto-start, script, ngân sách, prompt.',
    },
  ],
};

const PROJECTS: Copy = {
  en: [
    {
      title: 'Welcome to KanbanPilot',
      body: 'A local kanban board where AI coding agents (Claude Code, Codex, Copilot) pick up your tasks. Nothing leaves your machine except the agent’s own API calls.',
    },
    {
      target: ['add-project'],
      title: 'Add your first project',
      body: 'Point it at a local git repository. The base branch is detected; you can add a setup script (dependencies) and a test script that runs after every attempt. The board opens right after.',
    },
  ],
  vi: [
    {
      title: 'Chào mừng đến KanbanPilot',
      body: 'Bảng kanban chạy local, nơi các AI agent (Claude Code, Codex, Copilot) nhận task của bạn. Dữ liệu nằm trên máy bạn, chỉ agent gọi API của nó.',
    },
    {
      target: ['add-project'],
      title: 'Thêm project đầu tiên',
      body: 'Trỏ tới một git repository trên máy. Base branch được tự nhận; có thể thêm setup script (cài dependency) và test script chạy sau mỗi lần agent làm. Bảng sẽ mở ngay sau đó.',
    },
  ],
};

const TASK: Copy = {
  en: [
    {
      target: ['task-header'],
      title: 'The task at a glance',
      body: 'Column, state, executor and cost live here. Edit the title or description inline; edits on a linked issue are pushed to the tracker.',
    },
    {
      target: ['task-actions'],
      title: 'Actions follow the state',
      body: 'Start, kill or restart the agent, update the worktree from the base branch, run the tests, merge or open a pull request — only what makes sense right now is offered.',
    },
    {
      target: ['tab-chat'],
      title: 'Chat with the agent',
      body: 'Answer the planner’s questions, send feedback while the agent works or after a review (it resumes its session), paste screenshots. Comments from the tracker show up here too.',
    },
    {
      target: ['tab-diff'],
      title: 'Review the diff',
      body: 'Every change of the current attempt against the base branch, unified or split. Leave line comments that become feedback.',
    },
    {
      target: ['tab-activity'],
      title: 'Activity and logs',
      body: 'Every run with its live log, cost and session id. Tests has the output of the project test script for the attempt.',
    },
  ],
  vi: [
    {
      target: ['task-header'],
      title: 'Tổng quan task',
      body: 'Cột, trạng thái, executor và chi phí ở đây. Sửa tiêu đề hay mô tả ngay tại chỗ; task đã liên kết issue thì sửa sẽ đẩy lên tracker.',
    },
    {
      target: ['task-actions'],
      title: 'Hành động theo trạng thái',
      body: 'Chạy, dừng hay chạy lại agent, cập nhật worktree từ base branch, chạy test, merge hoặc mở pull request — chỉ hiện những gì hợp lý ở thời điểm này.',
    },
    {
      target: ['tab-chat'],
      title: 'Chat với agent',
      body: 'Trả lời câu hỏi của planner, gửi feedback khi agent đang làm hoặc sau review (agent tiếp tục đúng session), dán ảnh chụp màn hình. Comment từ tracker cũng hiện ở đây.',
    },
    {
      target: ['tab-diff'],
      title: 'Xem diff',
      body: 'Mọi thay đổi của attempt hiện tại so với base branch, dạng unified hoặc split. Comment theo dòng sẽ thành feedback.',
    },
    {
      target: ['tab-activity'],
      title: 'Hoạt động và log',
      body: 'Từng run với log trực tiếp, chi phí và session id. Tab Tests có kết quả test script của project cho attempt này.',
    },
  ],
};

export const TOURS = {
  board: BOARD,
  projects: PROJECTS,
  task: TASK,
} as const;

export type TourId = keyof typeof TOURS;

export function tourSteps(id: TourId, lang: 'vi' | 'en' = tourLanguage()): TourStep[] {
  return TOURS[id][lang];
}
