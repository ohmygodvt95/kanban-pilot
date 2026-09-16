import type { EventBus } from './events/bus.js';
import type { ExecutorRegistry } from './executors/registry.js';
import type { ProviderRegistry } from './providers/index.js';
import type { Store } from './store/store.js';
import type { Logger } from './util/logger.js';
import type { CorePaths } from './util/paths.js';

export interface CoreContext {
  store: Store;
  events: EventBus;
  executors: ExecutorRegistry;
  providers: ProviderRegistry;
  paths: CorePaths;
  /** Directories searched for instruction templates, first match wins. */
  templateDirs: string[];
  logger: Logger;
}
