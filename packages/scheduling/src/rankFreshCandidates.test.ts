import { freshRankingReasonSchema } from "@practice-plus-plus/contracts";
import { describe, expect, it } from "vitest";
import { rankFreshCandidates, type FreshCandidate, type FreshRankingAttempt } from "./index.js";

const today = "2026-09-09";

function candidate(id: string, patternIds = [id], leetcodeId = 1): FreshCandidate {
  return {
    id,
    patternIds,
    leetcodeId,
    published: true,
    availability: "AVAILABLE",
    difficulty: "MEDIUM",
  };
}

function attempt(id: string, overrides: Partial<FreshRankingAttempt> = {}): FreshRankingAttempt {
  return {
    id,
    problemId: `attempted-${id}`,
    patternIds: ["pattern"],
    type: "FRESH",
    practiceDate: "2026-09-01",
    startedAt: "2026-09-01T12:00:00.000Z",
    confirmedAt: "2026-09-01T13:00:00.000Z",
    outcome: "INDEPENDENT",
    confidence: null,
    optimality: null,
    ...overrides,
  };
}

function samples(overrides: Partial<FreshRankingAttempt> = {}, count = 3) {
  return Array.from({ length: count }, (_, index) => attempt(String(index), overrides));
}

function reasons(history: FreshRankingAttempt[], date = today) {
  return rankFreshCandidates([candidate("new", ["pattern"])], history, date, false)[0]?.reasons.map(
    (reason) => reason.code,
  );
}

describe("rankFreshCandidates", () => {
  it("excludes every started problem and respects publication, availability, and paid preferences", () => {
    const candidates = [
      candidate("active"),
      candidate("unconfirmed"),
      candidate("incomplete"),
      candidate("solved"),
      { ...candidate("draft"), published: false },
      { ...candidate("unavailable"), availability: "UNAVAILABLE" as const },
      { ...candidate("paid"), availability: "PAID_ONLY" as const },
      candidate("free", ["free"], 2),
    ];
    const history = [
      attempt("a", { problemId: "active", confirmedAt: null, outcome: null }),
      attempt("b", { problemId: "unconfirmed", confirmedAt: null }),
      attempt("c", { problemId: "incomplete", outcome: "INCOMPLETE" }),
      attempt("d", { problemId: "solved" }),
    ];
    expect(
      rankFreshCandidates(candidates, history, today, false).map((item) => item.problemId),
    ).toEqual(["paid", "free"]);
    expect(
      rankFreshCandidates(candidates, history, today, true).map((item) => item.problemId),
    ).toEqual(["free"]);
  });

  it("uses only confirmed, non-incomplete fresh attempts for coverage", () => {
    expect(
      reasons([
        attempt("active", { confirmedAt: null }),
        attempt("incomplete", { outcome: "INCOMPLETE" }),
        attempt("redo", { type: "REDO" }),
      ]),
    ).toEqual(["UNTESTED_PATTERN"]);
    expect(reasons(samples({}, 1))).toEqual(["LIMITED_PATTERN_EVIDENCE"]);
    expect(reasons(samples({ outcome: "GAVE_UP" }, 2))).toEqual(["LIMITED_PATTERN_EVIDENCE"]);
    expect(reasons(samples())).toEqual(["FRESH_PRACTICE"]);
  });

  it.each([
    { outcome: "ASSISTED" as const },
    { outcome: "GAVE_UP" as const },
    { confidence: "SHAKY" as const },
    { optimality: "SUBOPTIMAL" as const },
  ])("recognizes weakness from %j without penalizing missing details", (signal) => {
    expect(reasons([...samples(signal, 2), attempt("good")])).toEqual(["WEAK_PATTERN"]);
    expect(reasons([...samples(signal, 1), ...samples({}, 2)])).toEqual(["FRESH_PRACTICE"]);
  });

  it("uses only the latest five fresh samples, with deterministic ties", () => {
    const history = [
      ...samples(
        { outcome: "GAVE_UP", startedAt: "2026-08-01T12:00:00.000Z", practiceDate: "2026-08-01" },
        8,
      ),
      ...samples({}, 5),
    ];
    expect(reasons(history)).toEqual(["FRESH_PRACTICE"]);
    expect(reasons(history.toReversed())).toEqual(reasons(history));
    const tied = samples({}, 6).map((item, index) => ({
      ...item,
      outcome: index < 3 ? ("ASSISTED" as const) : ("INDEPENDENT" as const),
    }));
    expect(reasons(tied)).toEqual(["WEAK_PATTERN"]);
    expect(reasons(tied.toReversed())).toEqual(reasons(tied));
  });

  it("splits weakness contributions equally across tags and requires a strict majority", () => {
    expect(
      reasons([
        ...samples({ outcome: "ASSISTED", patternIds: ["pattern", "other", "third"] }, 2),
        attempt("good"),
      ]),
    ).toEqual(["FRESH_PRACTICE"]);
    expect(reasons([...samples({ outcome: "ASSISTED" }, 2), ...samples({}, 2)])).toEqual([
      "FRESH_PRACTICE",
    ]);
  });

  it("becomes stale at 30 calendar days and lets qualifying redos refresh recency", () => {
    const history = samples({ practiceDate: "2026-08-10", startedAt: "2026-08-10T12:00:00.000Z" });
    expect(reasons(history, "2026-09-08")).toEqual(["FRESH_PRACTICE"]);
    expect(reasons(history)).toEqual(["STALE_PATTERN"]);
    expect(reasons([...history, attempt("redo", { type: "REDO" })])).toEqual(["FRESH_PRACTICE"]);
    expect(reasons([...history, attempt("redo", { type: "REDO", outcome: "INCOMPLETE" })])).toEqual(
      ["STALE_PATTERN"],
    );
    expect(reasons(samples({ outcome: "ASSISTED", practiceDate: "2026-08-10" }))).toEqual([
      "WEAK_PATTERN",
    ]);
  });

  it("requires four recent attempts and more than half of exposure for concentration", () => {
    const recent = { practiceDate: "2026-09-03", type: "REDO" as const };
    expect(reasons(samples(recent))).toEqual(["UNTESTED_PATTERN"]);
    expect(reasons(samples(recent, 4))).toContain("RECENT_PATTERN_CONCENTRATION");
    expect(reasons(samples({ ...recent, practiceDate: "2026-09-02" }, 4))).toEqual([
      "UNTESTED_PATTERN",
    ]);
    expect(reasons(samples({ ...recent, practiceDate: today }, 4))).toContain(
      "RECENT_PATTERN_CONCENTRATION",
    );
    expect(reasons(samples({ ...recent, patternIds: ["pattern", "other"] }, 4))).toEqual([
      "UNTESTED_PATTERN",
    ]);
    expect(
      reasons([...samples(recent), attempt("other", { ...recent, patternIds: ["other"] })]),
    ).toContain("RECENT_PATTERN_CONCENTRATION");
    expect(reasons(samples({ ...recent, practiceDate: "2026-09-10" }, 4))).toEqual([
      "UNTESTED_PATTERN",
    ]);
    expect(
      reasons([...samples(recent), attempt("incomplete", { ...recent, outcome: "INCOMPLETE" })]),
    ).toEqual(["UNTESTED_PATTERN"]);
  });

  it("orders breadth before weakness, staleness, and other practice", () => {
    const candidates = [
      candidate("other"),
      candidate("stale"),
      candidate("weak"),
      candidate("limited"),
      candidate("untested", ["untested"], 2),
    ];
    const history = [
      ...samples({ patternIds: ["other"] }),
      ...samples({ patternIds: ["stale"], practiceDate: "2026-08-01" }),
      ...samples({ patternIds: ["weak"], outcome: "ASSISTED" }),
      attempt("limited", { patternIds: ["limited"] }),
    ];
    expect(
      rankFreshCandidates(candidates, history, today, false).map((item) => item.problemId),
    ).toEqual(["limited", "untested", "weak", "stale", "other"]);
  });

  it("averages tag priorities and demotes concentration one tier without excluding candidates", () => {
    const candidates = [
      candidate("mixed", ["new", "strong"]),
      candidate("weak", ["weak"]),
      candidate("concentrated", ["concentrated"]),
      candidate("new", ["new"]),
    ];
    const history = [
      ...samples({ patternIds: ["strong"] }),
      ...samples({ patternIds: ["weak"], outcome: "ASSISTED" }),
      ...samples({ patternIds: ["concentrated"], type: "REDO", practiceDate: today }, 4),
    ];
    expect(
      rankFreshCandidates(candidates, history, today, false).map((item) => item.problemId),
    ).toEqual(["new", "weak", "concentrated", "mixed"]);
    expect(reasons(samples({ practiceDate: today }, 4))).toEqual([
      "FRESH_PRACTICE",
      "RECENT_PATTERN_CONCENTRATION",
    ]);
  });

  it("breaks ties by difficulty and ID, preserves inputs, and returns no hidden tags or scores", () => {
    const candidates = [
      { ...candidate("hard", ["secret"], 1), difficulty: "HARD" as const },
      candidate("medium", ["secret"], 2),
      { ...candidate("easy2", ["secret"], 4), difficulty: "EASY" as const },
      { ...candidate("easy1", ["secret"], 3), difficulty: "EASY" as const },
    ];
    const before = candidates.map((item) => ({ ...item, patternIds: [...item.patternIds] }));
    const result = rankFreshCandidates(candidates, [], today, false);
    expect(result.map((item) => item.problemId)).toEqual(["easy1", "easy2", "medium", "hard"]);
    expect(rankFreshCandidates(candidates.toReversed(), [], today, false)).toEqual(result);
    expect(candidates).toEqual(before);
    expect(JSON.stringify(result)).not.toContain("secret");
    for (const item of result) {
      expect(Object.keys(item)).toEqual(["problemId", "reasons"]);
      for (const reason of item.reasons)
        expect(freshRankingReasonSchema.parse(reason)).toEqual(reason);
    }
    expect(
      freshRankingReasonSchema.safeParse({ code: "WEAK_PATTERN", patternId: "secret" }).success,
    ).toBe(false);
    expect(rankFreshCandidates([], [], today, false)).toEqual([]);
  });

  it.each(["invalid", "2026-02-29", "2026-9-9"])("rejects invalid dates: %s", (date) => {
    expect(() => rankFreshCandidates([], [], date, false)).toThrow(RangeError);
    expect(() => reasons([attempt("bad", { practiceDate: date })])).toThrow(RangeError);
  });
});
