import { homedir } from 'node:os';
import { join } from 'node:path';

export interface CorePaths {
  /** ~/.config/agent-kanban */
  configDir: string;
  /** ~/.config/agent-kanban/db.sqlite */
  dbPath: string;
  /** ~/.cache/agent-kanban/worktrees */
  worktreesRoot: string;
  /** ~/.config/agent-kanban/templates (user overrides for instruction files) */
  userTemplatesDir: string;
}

export function defaultPaths(env: NodeJS.ProcessEnv = process.env): CorePaths {
  const home = homedir();
  const configHome = env.XDG_CONFIG_HOME || join(home, '.config');
  const cacheHome = env.XDG_CACHE_HOME || join(home, '.cache');
  const configDir = join(configHome, 'agent-kanban');
  return {
    configDir,
    dbPath: join(configDir, 'db.sqlite'),
    worktreesRoot: join(cacheHome, 'agent-kanban', 'worktrees'),
    userTemplatesDir: join(configDir, 'templates'),
  };
}
