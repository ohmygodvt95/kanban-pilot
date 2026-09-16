import type { ExecutorId, NormalizedEvent } from '@agent-kanban/shared';

export type { NormalizedEvent };

export interface ExecutorCheckResult {
  ok: boolean;
  version?: string;
  message?: string;
}

export interface ExecutorCommand {
  bin: string;
  args: string[];
  env?: Record<string, string>;
  /** Written to the process stdin then closed. Used for long prompts. */
  stdin?: string;
}

export interface ExecutorInput {
  cwd: string;
  prompt: string;
  /** refine = read-only planning, execute = full permissions */
  mode: 'refine' | 'execute';
  resumeSessionId?: string;
  /** JSON schema for structured output (refine mode). */
  outputSchema?: object;
  maxTurns?: number;
  systemPromptAppend?: string;
}

export interface ExecutorAdapter {
  readonly id: ExecutorId;
  readonly displayName: string;
  /** Whether the CLI binary exists and is logged in. */
  check(): Promise<ExecutorCheckResult>;
  /** Build the spawn command. Must NOT spawn. */
  buildCommand(input: ExecutorInput): ExecutorCommand;
  /**
   * Parse one stdout line into normalised event(s); null to ignore.
   * A single CLI line may carry several blocks (e.g. text + tool_use), hence the array form.
   */
  parseLine(line: string): NormalizedEvent | NormalizedEvent[] | null;
  /** Whether `resumeSessionId` is honoured by buildCommand. */
  readonly supportsResume: boolean;
  /** Whether the CLI enforces `outputSchema` natively. If false, core falls back to prompt-based JSON. */
  readonly supportsStructuredOutput: boolean;
  /** Instruction file names this tool reads from the repo root (e.g. CLAUDE.md). */
  readonly instructionFiles: string[];
}

/** Safely parse a JSON line; returns undefined for non-JSON. */
export function tryParseJsonLine(line: string): Record<string, unknown> | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return undefined;
  try {
    const value: unknown = JSON.parse(trimmed);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    /* not json */
  }
  return undefined;
}

/** Extract the final JSON object from free text (fallback for CLIs without --json-schema). */
export function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/g);
  const candidates: string[] = [];
  if (fenced) {
    for (const block of fenced) candidates.push(block.replace(/```(?:json)?/g, '').trim());
  }
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));
  for (const c of candidates.reverse()) {
    try {
      return JSON.parse(c);
    } catch {
      /* try next */
    }
  }
  return undefined;
}
