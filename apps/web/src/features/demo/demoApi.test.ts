import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch, demoApiUrl } from "../../shared/apiFetch";
import { loadAnalytics, loadStreakCalendar } from "../analytics/analyticsApi";
import {
  loadActiveAttempt,
  loadAttemptHistory,
  loadCatalogProblemDetails,
  loadProblems,
  loadSavedDailyPlan,
  startAttempt,
  skipTimer,
  pauseTimer,
  resumeTimer,
  reportAttempt,
  confirmAttempt,
  cancelAttempt,
  reviewSolution,
} from "../attempts/attemptsApi";
import { loadPracticeSettings, savePracticeSettings } from "../settings/settingsApi";
import { loadLearningContext, createGoal } from "../learning-context/learningContextApi";
import { demoProblems } from "./demoData";
import { loadRecentPractice } from "../practice/practiceHistory";
import { resetDemo } from "./demoApi";
import { demoTutorConversation } from "./demoConversations";

beforeEach(() => resetDemo());
afterEach(() => vi.restoreAllMocks());
const api = demoApiUrl;
const token = "demo";

describe("browser demo", () => {
  it("loads sample screens through the real contracts without network requests", async () => {
    const network = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Network unavailable"));
    const plan = await loadSavedDailyPlan(api, token);
    const analytics = await loadAnalytics(api, token);
    const history = await loadAttemptHistory(api, token, { page: 1 });
    const calendar = await loadStreakCalendar(api, token);
    const context = await loadLearningContext(api, token);
    expect(plan?.items).toHaveLength(2);
    expect(history.attempts).toHaveLength(16);
    expect(analytics.summary.freshOutcomes).toEqual({ independent: 5, assisted: 2, gaveUp: 1 });
    expect(calendar.currentStreak).toBe(4);
    expect(
      calendar.days
        .filter((day) => day.completedCount !== null && day.completedCount > day.requiredCount!)
        .map((day) => day.completedCount),
    ).toEqual([3, 4]);
    const recent = await loadRecentPractice(api, token);
    expect(recent.days.map((day) => day.completedCount)).toEqual([3, 1, 0, 2, 4, 2, 2]);
    expect(recent.days.map((day) => day.status)).toEqual([
      "COMPLETED",
      "PARTIAL",
      "MISSED",
      "COMPLETED",
      "COMPLETED",
      "COMPLETED",
      "COMPLETED",
    ]);
    expect(context.userSupplied.goals).toHaveLength(1);
    expect(context.observed.attempts).toHaveLength(16);
    expect(network).not.toHaveBeenCalled();
    expect((await apiFetch(`${api}/account`, { method: "DELETE" })).ok).toBe(false);
    expect(network).not.toHaveBeenCalled();
  });

  it("passes ordinary authenticated requests to the unchanged network implementation", async () => {
    const response = Response.json({ settings: null });
    const network = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
    expect(await loadPracticeSettings("https://api.example.test", "real-token")).toBeNull();
    expect(network).toHaveBeenCalledWith("https://api.example.test/settings", {
      headers: { authorization: "Bearer real-token" },
    });
  });

  it("keeps fresh tags hidden until a result, then updates plan, history, calendar, and evidence", async () => {
    const problem = demoProblems[8]!;
    expect((await loadCatalogProblemDetails(api, token, problem.id)).patterns).toEqual([]);
    const attempt = await startAttempt(api, token, problem.id);
    expect(attempt.patterns).toBeUndefined();
    await skipTimer(api, token, attempt.id);
    expect(demoTutorConversation(problem.slug)).toHaveLength(2);
    expect((await loadActiveAttempt(api, token))?.assistance).toEqual([]);
    expect((await reportAttempt(api, token, attempt.id, { outcome: "ASSISTED" })).patterns).toEqual(
      ["Arrays & Hashing"],
    );
    const saved = await confirmAttempt(api, token, attempt.id, {
      outcome: "ASSISTED",
      confidence: "SHAKY",
      optimality: "OPTIMAL",
      assistance: [{ type: "CONCEPTUAL_HINT", hintLevel: 1 }],
      timeSpentSeconds: 600,
      approach: null,
      notes: null,
      reproducedFromMemory: null,
    });
    expect(saved.review?.generatedDueDate).toBeTruthy();
    expect(saved.assistance).toEqual([{ type: "CONCEPTUAL_HINT", hintLevel: 1 }]);
    expect(await loadActiveAttempt(api, token)).toBeNull();
    expect((await loadSavedDailyPlan(api, token))?.items[1]?.status).toBe("FINISHED");
    expect((await loadAttemptHistory(api, token, { page: 1 })).attempts[0]?.id).toBe(attempt.id);
    expect((await loadAnalytics(api, token)).summary.freshOutcomes.assisted).toBe(3);
    const calendar = await loadStreakCalendar(api, token);
    expect(calendar.days.find((day) => day.isCurrent)?.completedCount).toBe(1);
  });

  it("supports pausing and cancelling without leaving sample history or progress behind", async () => {
    const attempt = await startAttempt(api, token, demoProblems[8]!.id);
    expect((await pauseTimer(api, token, attempt.id)).timerPausedAt).toBeTruthy();
    expect((await resumeTimer(api, token, attempt.id)).timerPausedAt).toBeNull();
    await cancelAttempt(api, token, attempt.id);
    expect(await loadActiveAttempt(api, token)).toBeNull();
    expect((await loadSavedDailyPlan(api, token))?.items[1]?.status).toBe("PENDING");
    expect((await loadAttemptHistory(api, token, { page: 1 })).attempts).toHaveLength(16);
  });

  it("records solution review when giving up without treating sample messages as help", async () => {
    const attempt = await startAttempt(api, token, demoProblems[8]!.id);
    await skipTimer(api, token, attempt.id);
    const reviewed = await reviewSolution(api, token, attempt.id);
    expect(reviewed.outcome).toBe("GAVE_UP");
    expect(reviewed.assistance.map((event) => event.type)).toEqual(["SOLUTION_REVIEW"]);
    const saved = await confirmAttempt(api, token, attempt.id, {
      outcome: "GAVE_UP",
      confidence: null,
      optimality: null,
      assistance: [],
      timeSpentSeconds: null,
      approach: null,
      notes: null,
      reproducedFromMemory: true,
    });
    expect(saved.outcome).toBe("GAVE_UP");
    expect(saved.review).not.toBeNull();
  });

  it("filters sample problems and resets local edits without retaining them", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        problems: demoProblems.map((problem) => ({ ...problem, solved: false })),
        total: demoProblems.length,
        nextPage: null,
      }),
    );
    const query = {
      query: "anagram",
      difficulty: [],
      availability: [],
      progress: [],
      sort: "TITLE",
      sortDirection: "ASC",
      page: 0,
    } as const;
    const catalog = await loadProblems(api, token, {
      ...query,
      difficulty: [],
      availability: [],
      progress: [],
    });
    expect(catalog.problems.map((problem) => problem.title)).toEqual([
      "Group Anagrams",
      "Valid Anagram",
    ]);
    const settings = (await loadPracticeSettings(api, token))!;
    await savePracticeSettings(api, token, { ...settings, dailyTarget: 5 });
    await createGoal(api, token, { target: "Practice graphs", priority: 1, state: "ACTIVE" });
    expect((await loadPracticeSettings(api, token))?.dailyTarget).toBe(5);
    expect((await loadLearningContext(api, token)).userSupplied.goals).toHaveLength(2);
    resetDemo();
    expect((await loadPracticeSettings(api, token))?.dailyTarget).toBe(2);
    expect((await loadLearningContext(api, token)).userSupplied.goals).toHaveLength(1);
  });
});
