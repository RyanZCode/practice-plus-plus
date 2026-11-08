import { afterEach, expect, it, vi } from "vitest";
import { startWithProblemTab } from "./startWithProblemTab";

afterEach(() => vi.unstubAllGlobals());

const attempt = { problem: { url: "https://leetcode.com/problems/two-sum/" } };

it("reserves a tab before starting and opens the saved problem without an opener", async () => {
  const tab = { opener: {}, location: { replace: vi.fn() }, close: vi.fn() };
  const open = vi.fn().mockReturnValue(tab);
  vi.stubGlobal("window", { open });
  const start = vi.fn(async () => {
    expect(open).toHaveBeenCalledWith("about:blank", "_blank");
    expect(tab.opener).toBeNull();
    expect(tab.location.replace).not.toHaveBeenCalled();
    return attempt;
  });
  await expect(startWithProblemTab(true, start)).resolves.toBe(attempt);
  expect(tab.location.replace).toHaveBeenCalledWith(attempt.problem.url);
});

it("does not open a tab when disabled", async () => {
  const open = vi.fn();
  vi.stubGlobal("window", { open });
  await expect(startWithProblemTab(false, async () => attempt)).resolves.toBe(attempt);
  expect(open).not.toHaveBeenCalled();
});

it("keeps the attempt usable when the popup is blocked", async () => {
  vi.stubGlobal("window", { open: vi.fn().mockReturnValue(null) });
  await expect(startWithProblemTab(true, async () => attempt)).resolves.toBe(attempt);
});

it("closes the reserved tab when no extra problem is available", async () => {
  const tab = { opener: {}, close: vi.fn() };
  vi.stubGlobal("window", { open: vi.fn().mockReturnValue(tab) });
  await expect(startWithProblemTab(true, async () => null)).resolves.toBeNull();
  expect(tab.close).toHaveBeenCalledOnce();
});

it("closes the reserved tab when starting fails", async () => {
  const tab = { opener: {}, close: vi.fn() };
  vi.stubGlobal("window", { open: vi.fn().mockReturnValue(tab) });
  await expect(
    startWithProblemTab(true, async () => {
      throw new Error("Start failed");
    }),
  ).rejects.toThrow("Start failed");
  expect(tab.close).toHaveBeenCalledOnce();
});
