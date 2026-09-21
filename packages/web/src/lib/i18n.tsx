/**
 * Tiny UI translation layer: a flat dictionary per language, a React context
 * holding the active language (remembered per browser) and a `t()` lookup with
 * `{name}` placeholders. English is the fallback for any missing key.
 */
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

export type Lang = 'en' | 'vi';
const KEY = 'agent-kanban.lang';

export function detectLang(): Lang {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === 'en' || stored === 'vi') return stored;
  } catch {
    /* ignore */
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('vi') ? 'vi' : 'en';
}

export const DICT: Record<Lang, Record<string, string>> = {
  en: {
    // shell / menu
    'menu.more': 'More',
    'menu.notificationsOn': 'Notifications on',
    'menu.notificationsEnable': 'Enable notifications',
    'menu.integration': 'Issue tracker integration',
    'menu.settings': 'Project settings',
    'menu.backToBoard': 'Back to the board',
    'menu.language': 'Tiếng Việt',
    'menu.updateAvailable': 'Update available: v{version}',
    'menu.updateHint': 'Click to copy: {cmd}',
    'menu.versionHint': 'Running version (click to copy)',
    'menu.copied': 'Copied: {text}',
    'menu.palette': 'Command palette',
    'live.open': 'live',
    // board header / actions
    'board.search': 'Search tasks  ( / )',
    'board.filters': 'Filters',
    'board.hideFilters': 'Hide filters',
    'board.newTask': 'New task',
    'board.newTaskTitle': 'New task (n)',
    'board.import': 'Import issues',
    'board.importTitle': 'Import issues from {ref}',
    'board.pushUnlinked': 'Push tasks to {tracker}',
    'board.clear': 'Clear all tasks',
    'board.clearTitle': 'Delete every task of this project',
    'board.tour': 'Show the tour',
    'board.tourTitle': 'Replay the guided tour',
    'board.stats': '{running} running · {review} in review · {cost} USD spent',
    'board.running': '{n} running',
    'board.review': '{n} in review',
    'board.spent': '{n} USD spent',
    'board.anyExecutor': 'any executor',
    'board.filterActive': 'Filter active · {n} hidden',
    'board.noProject': 'Project not found.',
    'board.loading': 'Loading…',
    'quick.all': 'All',
    'quick.attention': 'Needs me',
    'quick.running': 'Running',
    'quick.bugs': 'Bugs',
    'quick.urgent': 'Urgent',
    'quick.all.title': 'Show every task',
    'quick.attention.title': 'Errors, open questions, ready to review',
    'quick.running.title': 'Agent currently working',
    'quick.bugs.title': 'Tasks classified as bugs',
    'quick.urgent.title': 'High and urgent priority',
    // empty board
    'empty.title': 'Nothing on the board yet',
    'empty.body': 'Create a task and drag it to To do — an agent picks it up in its own git worktree.',
    'empty.create': 'Create the first task',
    'empty.import': 'Import from {tracker}',
    'empty.tour': 'Take the tour',
    // clear / undo
    'clear.title': 'Delete all {n} tasks?',
    'clear.body':
      'Every task of this project is removed, whatever its origin (manual or imported), together with runs, comments and active worktrees. You can undo this for {minutes} minutes; linked issues on the tracker are not touched.',
    'clear.done': '{n} task(s) cleared',
    'clear.undo': 'Undo',
    'clear.restored': '{n} task(s) restored',
    // auto-push
    'push.failed': 'Auto-push to the tracker failed: {error}',
    'push.open': 'Open task',
    'push.created': 'Created {id} on {tracker}',
    // bulk push
    'bulk.title': 'Push tasks to {tracker}',
    'bulk.body':
      'Unlinked tasks selected below are created on the tracker with the push defaults. Fields the tracker still requires are asked once and applied to every task.',
    'bulk.none': 'Every task is already linked to the tracker.',
    'bulk.push': 'Push {n} task(s)',
    'bulk.result': 'Pushed {ok}, failed {failed}',
    'bulk.selectAll': 'Select all',
    // columns
    'column.backlog': 'Backlog',
    'column.todo': 'To do',
    'column.doing': 'Doing',
    'column.review': 'Review',
    'column.done': 'Done',
    // command palette
    'palette.placeholder': 'Type a task title, or > for actions…',
    'palette.tasks': 'Tasks',
    'palette.actions': 'Actions',
    'palette.projects': 'Projects',
    'palette.empty': 'No matches',
    'palette.hint': '↑↓ navigate · Enter open · Esc close',
    // token
    'token.title': 'Access token required',
    'token.body':
      'This server is protected. Paste the token printed by the CLI (or open the URL it printed, which contains it).',
    'token.save': 'Continue',
    // settings: budget / costs / disk / backup
    'settings.budget': 'Spending caps',
    'settings.budget.daily': 'Daily budget (USD)',
    'settings.budget.weekly': 'Weekly budget (USD)',
    'settings.budget.hint':
      'New runs are refused once the cap is reached; running agents finish. Leave empty for no cap.',
    'settings.costs': 'Cost, last 14 days',
    'settings.costs.today': 'today',
    'settings.costs.week': '7 days',
    'settings.costs.total': 'all time',
    'settings.disk': 'Disk usage',
    'settings.disk.worktrees': 'worktrees',
    'settings.disk.logs': 'agent logs',
    'settings.disk.reclaimable': 'reclaimable ({n} item(s) of finished work)',
    'settings.disk.clean': 'Clean now',
    'settings.disk.cleaned': 'Freed {size}',
    'backup.title': 'Backup',
    'backup.body':
      'Export every project, task, run and integration (including tracker credentials) as one JSON file, or merge such a file into this database. Attachments and worktrees are not included.',
    'backup.export': 'Export JSON',
    'backup.exportNoEvents': 'Export without run logs',
    'backup.import': 'Import…',
    'backup.imported': 'Imported: {summary}',
    // drawer tour
    'task.tour': 'Show the task tour',
  },
  vi: {
    'menu.more': 'Thêm',
    'menu.notificationsOn': 'Đang bật thông báo',
    'menu.notificationsEnable': 'Bật thông báo',
    'menu.integration': 'Tích hợp issue tracker',
    'menu.settings': 'Cài đặt project',
    'menu.backToBoard': 'Về bảng',
    'menu.language': 'English',
    'menu.updateAvailable': 'Có bản mới: v{version}',
    'menu.updateHint': 'Bấm để sao chép: {cmd}',
    'menu.versionHint': 'Phiên bản đang chạy (bấm để sao chép)',
    'menu.copied': 'Đã sao chép: {text}',
    'menu.palette': 'Bảng lệnh',
    'live.open': 'trực tiếp',
    'board.search': 'Tìm task  ( / )',
    'board.filters': 'Bộ lọc',
    'board.hideFilters': 'Ẩn bộ lọc',
    'board.newTask': 'Task mới',
    'board.newTaskTitle': 'Task mới (n)',
    'board.import': 'Import issue',
    'board.importTitle': 'Import issue từ {ref}',
    'board.pushUnlinked': 'Đẩy task lên {tracker}',
    'board.clear': 'Xóa toàn bộ task',
    'board.clearTitle': 'Xóa mọi task của project này',
    'board.tour': 'Xem hướng dẫn',
    'board.tourTitle': 'Xem lại hướng dẫn',
    'board.stats': '{running} đang chạy · {review} chờ review · {cost} USD đã dùng',
    'board.running': '{n} đang chạy',
    'board.review': '{n} chờ review',
    'board.spent': 'đã dùng {n} USD',
    'board.anyExecutor': 'mọi executor',
    'board.filterActive': 'Đang lọc · ẩn {n}',
    'board.noProject': 'Không tìm thấy project.',
    'board.loading': 'Đang tải…',
    'quick.all': 'Tất cả',
    'quick.attention': 'Cần tôi',
    'quick.running': 'Đang chạy',
    'quick.bugs': 'Bug',
    'quick.urgent': 'Gấp',
    'quick.all.title': 'Hiện mọi task',
    'quick.attention.title': 'Lỗi, câu hỏi chờ trả lời, chờ review',
    'quick.running.title': 'Agent đang làm',
    'quick.bugs.title': 'Task được phân loại là bug',
    'quick.urgent.title': 'Ưu tiên cao và gấp',
    'empty.title': 'Bảng chưa có task nào',
    'empty.body': 'Tạo một task rồi kéo sang To do — agent sẽ nhận và làm trong git worktree riêng.',
    'empty.create': 'Tạo task đầu tiên',
    'empty.import': 'Import từ {tracker}',
    'empty.tour': 'Xem hướng dẫn',
    'clear.title': 'Xóa toàn bộ {n} task?',
    'clear.body':
      'Mọi task của project (tự tạo hay import) sẽ bị xóa cùng run, comment và worktree đang hoạt động. Có thể hoàn tác trong {minutes} phút; issue trên tracker không bị ảnh hưởng.',
    'clear.done': 'Đã xóa {n} task',
    'clear.undo': 'Hoàn tác',
    'clear.restored': 'Đã khôi phục {n} task',
    'push.failed': 'Tự động đẩy lên tracker thất bại: {error}',
    'push.open': 'Mở task',
    'push.created': 'Đã tạo {id} trên {tracker}',
    'bulk.title': 'Đẩy task lên {tracker}',
    'bulk.body':
      'Các task chưa liên kết được chọn bên dưới sẽ được tạo trên tracker với giá trị mặc định. Trường tracker còn yêu cầu sẽ hỏi một lần và áp dụng cho mọi task.',
    'bulk.none': 'Mọi task đều đã liên kết với tracker.',
    'bulk.push': 'Đẩy {n} task',
    'bulk.result': 'Đã đẩy {ok}, lỗi {failed}',
    'bulk.selectAll': 'Chọn tất cả',
    'column.backlog': 'Backlog',
    'column.todo': 'To do',
    'column.doing': 'Doing',
    'column.review': 'Review',
    'column.done': 'Done',
    'palette.placeholder': 'Gõ tên task, hoặc > để chọn hành động…',
    'palette.tasks': 'Task',
    'palette.actions': 'Hành động',
    'palette.projects': 'Project',
    'palette.empty': 'Không có kết quả',
    'palette.hint': '↑↓ di chuyển · Enter mở · Esc đóng',
    'token.title': 'Cần access token',
    'token.body':
      'Server này được bảo vệ. Dán token mà CLI đã in ra (hoặc mở đúng URL CLI in, có sẵn token).',
    'token.save': 'Tiếp tục',
    'settings.budget': 'Trần chi phí',
    'settings.budget.daily': 'Ngân sách mỗi ngày (USD)',
    'settings.budget.weekly': 'Ngân sách mỗi tuần (USD)',
    'settings.budget.hint':
      'Đạt trần thì không chạy run mới; agent đang chạy vẫn làm xong. Bỏ trống nếu không giới hạn.',
    'settings.costs': 'Chi phí 14 ngày gần đây',
    'settings.costs.today': 'hôm nay',
    'settings.costs.week': '7 ngày',
    'settings.costs.total': 'tổng',
    'settings.disk': 'Dung lượng đĩa',
    'settings.disk.worktrees': 'worktree',
    'settings.disk.logs': 'log agent',
    'settings.disk.reclaimable': 'có thể dọn ({n} mục của việc đã xong)',
    'settings.disk.clean': 'Dọn ngay',
    'settings.disk.cleaned': 'Đã giải phóng {size}',
    'backup.title': 'Sao lưu',
    'backup.body':
      'Xuất toàn bộ project, task, run và tích hợp (gồm cả thông tin đăng nhập tracker) ra một file JSON, hoặc gộp file như vậy vào cơ sở dữ liệu này. Không gồm ảnh đính kèm và worktree.',
    'backup.export': 'Xuất JSON',
    'backup.exportNoEvents': 'Xuất không kèm log run',
    'backup.import': 'Nhập…',
    'backup.imported': 'Đã nhập: {summary}',
    'task.tour': 'Xem hướng dẫn màn hình task',
  },
};

export function translate(lang: Lang, key: string, params?: Record<string, string | number>): string {
  let text = DICT[lang][key] ?? DICT.en[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) text = text.replaceAll(`{${k}}`, String(v));
  return text;
}

interface I18n {
  lang: Lang;
  setLang(l: Lang): void;
  t(key: string, params?: Record<string, string | number>): string;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(KEY, l);
    } catch {
      /* ignore */
    }
  }, []);
  const value = useMemo<I18n>(() => ({ lang, setLang, t: (k, p) => translate(lang, k, p) }), [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('I18nProvider missing');
  return ctx;
}
