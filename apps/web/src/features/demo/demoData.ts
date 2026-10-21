import {
  attemptSchema,
  practiceSettingsSchema,
  type CatalogProblem,
  type DailyPlan,
  type LearningContextResponse,
  type Attempt,
} from "@practice-plus-plus/contracts";

export const demoUserId = "00000000-0000-4000-8000-000000000001";
export const sampleId = (value: number) =>
  `10000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

const entries = [
  [1, "Two Sum", "two-sum", "EASY", "Arrays & Hashing"],
  [20, "Valid Parentheses", "valid-parentheses", "EASY", "Stack"],
  [
    121,
    "Best Time to Buy and Sell Stock",
    "best-time-to-buy-and-sell-stock",
    "EASY",
    "Sliding Window",
  ],
  [125, "Valid Palindrome", "valid-palindrome", "EASY", "Two Pointers"],
  [206, "Reverse Linked List", "reverse-linked-list", "EASY", "Linked List"],
  [217, "Contains Duplicate", "contains-duplicate", "EASY", "Arrays & Hashing"],
  [242, "Valid Anagram", "valid-anagram", "EASY", "Arrays & Hashing"],
  [704, "Binary Search", "binary-search", "EASY", "Binary Search"],
  [49, "Group Anagrams", "group-anagrams", "MEDIUM", "Arrays & Hashing"],
  [155, "Min Stack", "min-stack", "MEDIUM", "Stack"],
  [
    3,
    "Longest Substring Without Repeating Characters",
    "longest-substring-without-repeating-characters",
    "MEDIUM",
    "Sliding Window",
  ],
  [11, "Container With Most Water", "container-with-most-water", "MEDIUM", "Two Pointers"],
  [
    19,
    "Remove Nth Node From End of List",
    "remove-nth-node-from-end-of-list",
    "MEDIUM",
    "Linked List",
  ],
  [
    33,
    "Search in Rotated Sorted Array",
    "search-in-rotated-sorted-array",
    "MEDIUM",
    "Binary Search",
  ],
  [200, "Number of Islands", "number-of-islands", "MEDIUM", "Graphs"],
  [70, "Climbing Stairs", "climbing-stairs", "EASY", "Dynamic Programming"],
] as const;

export const demoProblems: CatalogProblem[] = entries.map(
  ([leetcodeId, title, slug, difficulty], index) => ({
    id: sampleId(index + 1),
    leetcodeId,
    title,
    slug,
    difficulty,
    url: `https://leetcode.com/problems/${slug}/`,
    availability: "AVAILABLE",
  }),
);

export function problemPatterns(problemId: string): NonNullable<Attempt["patterns"]> {
  const index = demoProblems.findIndex(
    (problem) => problem.id === problemId || problem.slug === problemId,
  );
  return index < 0 ? [] : [entries[index]![4]];
}

export function shiftDate(date: string, days: number): string {
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

export function createDemoData(now = new Date()) {
  const boundary = new Date(now);
  boundary.setHours(boundary.getHours() - 4);
  const date = `${boundary.getFullYear()}-${String(boundary.getMonth() + 1).padStart(2, "0")}-${String(boundary.getDate()).padStart(2, "0")}`;
  const settings = practiceSettingsSchema.parse({
    defaultAiModel: "gpt-6-luna",
    attemptTimerMinutes: 30,
    allowPremiumProblems: false,
    difficultyPreference: "ANY",
    dailyTarget: 2,
    redoIntervals: { high: 1, medium: 3, low: 7 },
    resetTime: "04:00",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  const historyDates = [2, 3, 1, 0, 2, 4, 2, 2].flatMap((count, index) =>
    Array.from({ length: count }, () => shiftDate(date, index - 8)),
  );
  const attempts = historyDates.map((practiceDate, index) => {
    const problem = demoProblems[index % 8]!;
    const assisted = index % 4 === 1;
    const gaveUp = index === 6;
    return attemptSchema.parse({
      id: sampleId(100 + index),
      problem,
      patterns: problemPatterns(problem.id),
      type: index < 8 ? "FRESH" : "REDO",
      practiceDate,
      startedAt: `${practiceDate}T15:00:00.000Z`,
      confirmedAt: `${practiceDate}T15:25:00.000Z`,
      timerSkippedAt: null,
      solutionReviewedAt: gaveUp ? `${practiceDate}T15:20:00.000Z` : null,
      outcome: gaveUp ? "GAVE_UP" : assisted ? "ASSISTED" : "INDEPENDENT",
      confidence: assisted || gaveUp ? "SHAKY" : "CONFIDENT",
      optimality: gaveUp ? null : "OPTIMAL",
      timeSpentSeconds: 1500,
      approach: null,
      notes: null,
      reproducedFromMemory: gaveUp ? true : null,
      assistance: gaveUp
        ? [{ type: "SOLUTION_REVIEW", hintLevel: null }]
        : assisted
          ? [{ type: "CONCEPTUAL_HINT", hintLevel: 1 }]
          : [],
    });
  });
  attempts[9]!.review = { generatedDueDate: date, manualDueDate: null };
  const plan: DailyPlan = {
    practiceDate: date,
    target: 2,
    items: [
      {
        id: sampleId(200),
        problem: demoProblems[1]!,
        kind: "REDO",
        status: "PENDING",
        explanation: "An exact review is due today after an assisted solve.",
      },
      {
        id: sampleId(201),
        problem: demoProblems[8]!,
        kind: "DIAGNOSTIC",
        status: "PENDING",
        explanation: "A fresh problem to check independent problem solving.",
      },
    ],
  };
  const learning: LearningContextResponse = {
    userSupplied: {
      goals: [
        {
          id: sampleId(300),
          target: "Prepare for technical interviews with two focused problems a day.",
          priority: 0,
          state: "ACTIVE",
        },
      ],
      teachingPreferences: [
        { id: sampleId(301), preference: "Ask a guiding question before explaining an approach." },
      ],
    },
    observed: { attempts: [], summaries: [] },
    inferred: [],
    exportedAt: now.toISOString(),
  };
  return { date, settings, attempts, plan, learning };
}
