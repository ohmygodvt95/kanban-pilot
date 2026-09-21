/**
 * Once-a-day lookup of the newest published version on npm. Purely advisory:
 * failures (offline, unpublished package) are swallowed and `latest()` stays null.
 * The registry document must carry our `agentKanban` marker (set in the CLI's
 * package.json) — the bare name could belong to an unrelated package.
 */
const REGISTRY = 'https://registry.npmjs.org';
const DAY_MS = 24 * 3_600_000;

export class UpdateCheck {
  private latestVersion: string | null = null;
  private checkedAt = 0;
  private inflight: Promise<void> | null = null;

  readonly url: string;

  constructor(
    private readonly current: string,
    packageName = 'kanban-pilot',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.url = registryUrl(packageName);
  }

  /** Newest version when it is newer than the running one; triggers a refresh in the background. */
  latest(): string | null {
    if (Date.now() - this.checkedAt > DAY_MS && !this.inflight) {
      this.inflight = this.refresh().finally(() => {
        this.inflight = null;
      });
    }
    return this.latestVersion && isNewer(this.latestVersion, this.current) ? this.latestVersion : null;
  }

  async refresh(): Promise<void> {
    this.checkedAt = Date.now();
    try {
      const res = await this.fetchImpl(this.url, { signal: AbortSignal.timeout(5_000) });
      if (!res.ok) return;
      const data = (await res.json()) as { version?: string; agentKanban?: unknown };
      if (typeof data.version === 'string' && data.agentKanban === true) this.latestVersion = data.version;
    } catch {
      /* offline or not published: ignore */
    }
  }
}

/** `latest` dist-tag document; scoped names keep the `@` and encode the slash (`@scope%2Fname`). */
export function registryUrl(packageName: string): string {
  return `${REGISTRY}/${packageName.replace('/', '%2F')}/latest`;
}

/** semver-ish comparison on the numeric parts only ("1.2.3" > "1.2.0"); unknown formats are never newer. */
export function isNewer(candidate: string, current: string): boolean {
  const a = candidate.split('.').map((n) => Number.parseInt(n, 10));
  const b = current.split('.').map((n) => Number.parseInt(n, 10));
  if (a.some(Number.isNaN) || b.some(Number.isNaN)) return false;
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}
