// Project facts shown in the UI. Keeping them in one place means a change is one edit,
// and tests/projectConstants.test.ts fails if copy elsewhere drifts from them.

export const REPO_URL = "https://github.com/moltaphet/ArgusGov";
export const DOCS_URL = "https://docs.genlayer.com";

/** Passing test counts, from the last full verification run. */
export const TEST_COUNTS = { contract: 305, frontend: 284 } as const;
export const TEST_SUITE_LABEL = `Test Suite (${TEST_COUNTS.contract} Passed)`;
export const TEST_SUITE_DETAIL = `${TEST_COUNTS.contract} contract tests (pytest) and ${TEST_COUNTS.frontend} frontend tests (Vitest)`;
