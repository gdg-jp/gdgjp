/** The margin protects a request from provider-side token accounting variance. */
export const DEFAULT_TOKEN_SAFETY_MARGIN = 0.1;

export interface TokenBudget {
  /** Total context window exposed by the selected model. */
  contextWindowTokens: number;
  /** Tokens reserved for the model response. */
  outputReserveTokens: number;
  /** Additional fraction of the context window that must remain unused. */
  safetyMargin?: number;
}

export interface TokenBudgetSelection<T> {
  availableTokens: number;
  omitted: T[];
  selected: T[];
  usedTokens: number;
}

export class SourceContextTooLargeError extends Error {
  readonly code = "source_context_too_large";

  constructor(
    readonly inputTokens: number,
    readonly availableTokens: number,
  ) {
    super(
      `Source context uses ${inputTokens} tokens, exceeding the ${availableTokens}-token input budget`,
    );
    this.name = "SourceContextTooLargeError";
  }
}

export function getAvailableInputTokens(budget: TokenBudget): number {
  const safetyMargin = budget.safetyMargin ?? DEFAULT_TOKEN_SAFETY_MARGIN;
  if (!Number.isFinite(safetyMargin) || safetyMargin < 0 || safetyMargin >= 1) {
    throw new Error("Token budget safetyMargin must be greater than or equal to 0 and less than 1");
  }

  const available = Math.floor(
    budget.contextWindowTokens -
      budget.outputReserveTokens -
      budget.contextWindowTokens * safetyMargin,
  );
  if (available < 0) {
    throw new Error("Token budget reserves more tokens than the model context window allows");
  }
  return available;
}

/**
 * Keep ranked evidence in order until the measured prompt budget is exhausted.
 * `baseInputTokens` must include the system prompt and user-provided source material.
 */
export function selectWithinTokenBudget<T>(
  rankedItems: readonly T[],
  getTokenCount: (item: T) => number,
  baseInputTokens: number,
  budget: TokenBudget,
): TokenBudgetSelection<T> {
  const availableTokens = getAvailableInputTokens(budget);
  if (baseInputTokens > availableTokens) {
    throw new SourceContextTooLargeError(baseInputTokens, availableTokens);
  }

  const selected: T[] = [];
  const omitted: T[] = [];
  let usedTokens = baseInputTokens;

  for (const item of rankedItems) {
    const itemTokens = getTokenCount(item);
    if (!Number.isFinite(itemTokens) || itemTokens < 0) {
      throw new Error("Each context item's token count must be a non-negative finite number");
    }
    if (usedTokens + itemTokens <= availableTokens) {
      selected.push(item);
      usedTokens += itemTokens;
    } else {
      omitted.push(item);
    }
  }

  return { availableTokens, omitted, selected, usedTokens };
}
