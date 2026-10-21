import {
  attemptSchema,
  confirmAttemptSchema,
  catalogListQuerySchema,
  catalogResponseSchema,
  practiceSettingsSchema,
  reportAttemptSchema,
  reviewOverrideSchema,
  suggestedOutcome,
  catalogPageSize,
  type Attempt,
  type CatalogListProblem,
  type CatalogProblem,
  learnerGoalInputSchema,
  teachingPreferenceInputSchema,
} from "@practice-plus-plus/contracts";
import { readApiUrl } from "../../shared/config";
import { browseCatalog } from "../practice/catalogBrowse";
import { createDemoData, demoProblems, problemPatterns, shiftDate } from "./demoData";
import { demoAnalytics, demoCalendar } from "./demoAnalytics";

let data = createDemoData();
let catalogPromise: Promise<CatalogListProblem[]> | null = null;

export function resetDemo(): void {
  data = createDemoData();
  catalogPromise = null;
}

function activeAttempt() {
  return data.attempts.find((item) => item.confirmedAt === null) ?? null;
}

function catalogProblem(problem: CatalogListProblem): CatalogProblem {
  return {
    id: problem.id,
    leetcodeId: problem.leetcodeId,
    slug: problem.slug,
    title: problem.title,
    difficulty: problem.difficulty,
    url: problem.url,
    availability: problem.availability,
  };
}

async function loadPublishedCatalog(): Promise<CatalogListProblem[]> {
  if (catalogPromise === null) {
    catalogPromise = (async () => {
      const problems: CatalogListProblem[] = [];
      let page = 0;

      while (true) {
        const params = new URLSearchParams({
          query: "",
          sort: "LEETCODE_ID",
          sortDirection: "ASC",
          page: String(page),
        });
        const response = await globalThis.fetch(
          `${readApiUrl().replace(/\/$/, "")}/catalog/public/problems?${params.toString()}`,
        );
        if (!response.ok) {
          throw new Error("Unable to load the problem catalog. Please try again.");
        }

        const result = catalogResponseSchema.parse(await response.json());
        problems.push(...result.problems);
        if (result.nextPage === null) return problems;
        page = result.nextPage;
      }
    })().catch((error: unknown) => {
      catalogPromise = null;
      throw error;
    });
  }

  return catalogPromise;
}

async function findProblem(problemId: string): Promise<CatalogProblem | null> {
  const sampleProblem = demoProblems.find((item) => item.id === problemId);
  if (sampleProblem) return sampleProblem;

  const publishedProblem = (await loadPublishedCatalog()).find((item) => item.id === problemId);
  return publishedProblem ? catalogProblem(publishedProblem) : null;
}

function sameProblem(left: CatalogProblem, right: CatalogProblem): boolean {
  return left.id === right.id || left.slug === right.slug;
}

function readCatalogFilter(params: URLSearchParams, key: string): string[] {
  return (params.get(key) ?? "").split(",").filter((value) => value !== "");
}

async function start(problemId: string): Promise<Attempt | null> {
  const active = activeAttempt();
  if (active) return active;
  const problem = await findProblem(problemId);
  if (!problem) return null;
  const now = new Date();
  const attempt = attemptSchema.parse({
    id: crypto.randomUUID(),
    problem,
    type: data.attempts.some((item) => sameProblem(item.problem, problem)) ? "REDO" : "FRESH",
    practiceDate: data.date,
    startedAt: now.toISOString(),
    timerEndsAt: new Date(now.getTime() + data.settings.attemptTimerMinutes * 60000).toISOString(),
    timerPausedAt: null,
    timerSkippedAt: null,
    confirmedAt: null,
    solutionReviewedAt: null,
    outcome: null,
    confidence: null,
    optimality: null,
    timeSpentSeconds: null,
    approach: null,
    notes: null,
    reproducedFromMemory: null,
    assistance: [],
  });
  data.attempts.push(attempt);
  const item = data.plan.items.find((item) => sameProblem(item.problem, problem));
  if (item) item.status = "ACTIVE";
  return attempt;
}

export async function demoRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(path, "https://demo.invalid");
  const route = url.pathname;
  const method = init.method ?? "GET";
  const body: unknown = typeof init.body === "string" ? JSON.parse(init.body) : {};
  const json = (value: unknown, status = 200) => Response.json(value, { status });

  if (route === "/settings") {
    if (method === "PUT") data.settings = practiceSettingsSchema.parse(body);
    return json({ settings: data.settings });
  }
  if (route === "/daily-plan/saved") return json({ plan: data.plan });
  if (route === "/daily-plan") return json(data.plan);
  if (route === "/attempts/active") return json({ attempt: activeAttempt() });
  if (route === "/attempts/extra") {
    const next = demoProblems.find(
      (problem) => !data.attempts.some((item) => sameProblem(item.problem, problem)),
    );
    return json({ attempt: next ? await start(next.id) : null });
  }
  if (route === "/attempts") {
    if (method === "POST") {
      const { problemId } = body as { problemId: string };
      const attempt = await start(problemId);
      return json(attempt ?? { error: "Problem unavailable" }, attempt ? 200 : 404);
    }
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const query = url.searchParams.get("query")?.toLowerCase() ?? "";
    const problemId = url.searchParams.get("problemId");
    const selectedProblem = problemId ? await findProblem(problemId) : null;
    const attempts = data.attempts
      .filter(
        (item) =>
          item.confirmedAt &&
          (!problemId ||
            item.problem.id === problemId ||
            (selectedProblem !== null && sameProblem(item.problem, selectedProblem))) &&
          `${item.problem.leetcodeId} ${item.problem.title}`.toLowerCase().includes(query),
      )
      .toReversed();
    return json({
      attempts: attempts.slice((page - 1) * 20, page * 20),
      page,
      totalPages: Math.ceil(attempts.length / 20),
    });
  }
  if (route.startsWith("/attempts/")) {
    const [, , id, action] = route.split("/");
    const attempt = data.attempts.find((item) => item.id === id);
    if (!attempt) return json({ error: "Attempt unavailable" }, 404);
    const now = new Date().toISOString();
    if (action === "cancel") {
      data.attempts = data.attempts.filter((item) => item.id !== id);
      const item = data.plan.items.find((item) => sameProblem(item.problem, attempt.problem));
      if (item) item.status = "PENDING";
      return json({ attempt: null });
    }
    if (action === "skip-timer") {
      attempt.timerSkippedAt = now;
      attempt.timerPausedAt = null;
    }
    if (action === "pause-timer") attempt.timerPausedAt ??= now;
    if (action === "resume-timer" && attempt.timerPausedAt) {
      attempt.timerEndsAt = new Date(
        Date.parse(attempt.timerEndsAt!) + Date.parse(now) - Date.parse(attempt.timerPausedAt),
      ).toISOString();
      attempt.timerPausedAt = null;
    }
    if (action === "report-result" || action === "review-solution") {
      const outcome =
        action === "review-solution" ? "GAVE_UP" : reportAttemptSchema.parse(body).outcome;
      const required = suggestedOutcome(attempt.assistance);
      if (required && outcome !== required && outcome !== "GAVE_UP")
        return json({ error: "Outcome conflicts with assistance" }, 409);
      attempt.outcome = outcome;
      attempt.patterns = problemPatterns(attempt.problem.slug);
      if (action === "review-solution") {
        attempt.solutionReviewedAt = now;
        if (!attempt.assistance.some((event) => event.type === "SOLUTION_REVIEW"))
          attempt.assistance.push({ type: "SOLUTION_REVIEW", hintLevel: null });
      }
    }
    if (action === "confirm") {
      const input = confirmAttemptSchema.parse(body);
      const assistance = [...attempt.assistance, ...input.assistance].filter(
        (item, index, all) => all.findIndex((other) => other.type === item.type) === index,
      );
      const required = suggestedOutcome(assistance);
      if (
        input.outcome !== "INCOMPLETE" &&
        input.outcome !== "GAVE_UP" &&
        required &&
        input.outcome !== required
      )
        return json({ error: "Outcome conflicts with assistance" }, 409);
      Object.assign(attempt, input, { assistance, confirmedAt: now });
      if (input.outcome !== "INCOMPLETE") attempt.patterns = problemPatterns(attempt.problem.slug);
      for (const previous of data.attempts) {
        if (sameProblem(previous.problem, attempt.problem)) previous.review = null;
      }
      const repeat =
        input.nextAction?.type === "REPEAT" ||
        input.nextAction?.type === "CUSTOM_DATE" ||
        (!input.nextAction && input.outcome !== "INDEPENDENT");
      if (repeat) {
        const urgent =
          input.outcome === "GAVE_UP" ||
          input.outcome === "INCOMPLETE" ||
          input.confidence === "SHAKY" ||
          assistance.some((event) => event.type === "CONCEPTUAL_HINT");
        const interval = urgent
          ? data.settings.redoIntervals.high
          : data.settings.redoIntervals.medium;
        attempt.review = {
          generatedDueDate: shiftDate(data.date, interval),
          manualDueDate: input.nextAction?.type === "CUSTOM_DATE" ? input.nextAction.dueDate : null,
        };
      }
      const item = data.plan.items.find((item) => sameProblem(item.problem, attempt.problem));
      if (item) item.status = input.outcome === "INCOMPLETE" ? "INCOMPLETE" : "FINISHED";
    }
    if (action === "review" && attempt.review)
      attempt.review.manualDueDate = reviewOverrideSchema.parse(body).manualDueDate;
    return json(attempt);
  }
  if (route === "/catalog/problems") {
    const solved = new Set(
      data.attempts
        .filter(
          (item) =>
            item.confirmedAt && (item.outcome === "INDEPENDENT" || item.outcome === "ASSISTED"),
        )
        .map((item) => item.problem.slug),
    );
    const query = catalogListQuerySchema.parse({
      query: url.searchParams.get("query") ?? "",
      difficulty: readCatalogFilter(url.searchParams, "difficulty"),
      availability: readCatalogFilter(url.searchParams, "availability"),
      progress: readCatalogFilter(url.searchParams, "progress"),
      sort: url.searchParams.get("sort") ?? "LEETCODE_ID",
      sortDirection: url.searchParams.get("sortDirection") ?? "ASC",
      page: Number(url.searchParams.get("page") ?? 0),
    });
    const catalog = (await loadPublishedCatalog()).map((problem) => ({
      ...problem,
      solved: problem.solved || solved.has(problem.slug),
    }));
    const solvedById = new Map(catalog.map((problem) => [problem.id, problem.solved]));
    const problems = browseCatalog(catalog, query).map((problem) => ({
      ...problem,
      solved: solvedById.get(problem.id) ?? false,
    }));
    const start = query.page * catalogPageSize;
    return json({
      problems: problems.slice(start, start + catalogPageSize),
      total: problems.length,
      nextPage: start + catalogPageSize < problems.length ? query.page + 1 : null,
    });
  }
  if (route.startsWith("/catalog/problems/")) {
    const problem = await findProblem(route.split("/")[3] ?? "");
    if (!problem) return json({ error: "Problem unavailable" }, 404);
    const revealed = data.attempts.some(
      (item) => sameProblem(item.problem, problem) && item.outcome && item.outcome !== "INCOMPLETE",
    );
    return json({ problem, patterns: revealed ? problemPatterns(problem.slug) : [] });
  }
  if (route === "/analytics/patterns") return json(demoAnalytics(data.attempts, data.date));
  if (route === "/analytics/streak")
    return json(
      demoCalendar(
        data.attempts,
        data.date,
        data.plan.target,
        url.searchParams.get("month") ?? undefined,
      ),
    );
  if (route.startsWith("/ai/assessment-drafts/")) return json({ draft: null });
  if (route === "/ai/memory-suggestions") return json({ memorySuggestions: [] });
  if (route === "/learning-context") {
    data.learning.observed.attempts = data.attempts
      .filter((item) => item.confirmedAt !== null)
      .toReversed()
      .map((item) => ({
        id: item.id,
        problemTitle: item.problem.title,
        practiceDate: item.practiceDate,
        confirmedAt: item.confirmedAt!,
        outcome: item.outcome!,
        assistance: item.assistance.map((event) => event.type),
      }));
    return json(data.learning);
  }
  if (route.startsWith("/learning-context/")) {
    const [, , collection, id] = route.split("/");
    if (collection === "goals" || collection === "teaching-preferences") {
      const key = collection === "goals" ? "goals" : "teachingPreferences";
      const items = data.learning.userSupplied[key];
      if (method === "DELETE") {
        items.splice(
          items.findIndex((item) => item.id === id),
          1,
        );
        return json({});
      }
      const input =
        collection === "goals"
          ? learnerGoalInputSchema.parse(body)
          : teachingPreferenceInputSchema.parse(body);
      const value = { ...input, id: id ?? crypto.randomUUID() };
      if (id) Object.assign(items.find((item) => item.id === id) ?? {}, value);
      else if ("target" in value) data.learning.userSupplied.goals.push(value);
      else data.learning.userSupplied.teachingPreferences.push(value);
      return json(value);
    }
  }
  return json(
    { error: "This feature requires your own account. Demo changes stay in this tab." },
    400,
  );
}
