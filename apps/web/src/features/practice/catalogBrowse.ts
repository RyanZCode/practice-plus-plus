import type { CatalogProblem } from "@practice-plus-plus/contracts";

export type CatalogAvailability = CatalogProblem["availability"];
export type CatalogDifficulty = CatalogProblem["difficulty"];
export type CatalogSort = "DIFFICULTY" | "LEETCODE_ID" | "TITLE";
export type CatalogSortDirection = "ASC" | "DESC";

export interface CatalogBrowseOptions {
  readonly availability: readonly CatalogAvailability[];
  readonly difficulty: readonly CatalogDifficulty[];
  readonly hideSolved: boolean;
  readonly query: string;
  readonly sort: CatalogSort;
  readonly sortDirection: CatalogSortDirection;
}

const difficultyOrder: Readonly<Record<CatalogProblem["difficulty"], number>> = {
  EASY: 0,
  MEDIUM: 1,
  HARD: 2,
};

export function browseCatalog(
  problems: readonly (CatalogProblem & { readonly solved?: boolean })[],
  options: CatalogBrowseOptions,
): CatalogProblem[] {
  const query = options.query.trim().toLocaleLowerCase();
  const numberQuery = /^\d+$/.test(query) ? Number(query) : null;

  return problems
    .filter((problem) => {
      const matchesQuery =
        query.length === 0 ||
        (numberQuery === null
          ? problem.title.toLocaleLowerCase().includes(query)
          : problem.leetcodeId === numberQuery);

      return (
        matchesQuery &&
        (options.difficulty.length === 0 || options.difficulty.includes(problem.difficulty)) &&
        (options.availability.length === 0 ||
          options.availability.includes(problem.availability)) &&
        (!options.hideSolved || problem.solved !== true)
      );
    })
    .sort((left, right) => {
      const comparison = compareProblems(left, right, options.sort);
      return options.sortDirection === "ASC" ? comparison : -comparison;
    });
}

function compareProblems(left: CatalogProblem, right: CatalogProblem, sort: CatalogSort): number {
  if (sort === "TITLE") {
    return left.title.localeCompare(right.title) || left.leetcodeId - right.leetcodeId;
  }

  if (sort === "DIFFICULTY") {
    return (
      difficultyOrder[left.difficulty] - difficultyOrder[right.difficulty] ||
      left.leetcodeId - right.leetcodeId
    );
  }

  return left.leetcodeId - right.leetcodeId;
}
