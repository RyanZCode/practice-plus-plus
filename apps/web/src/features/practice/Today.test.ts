import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { DailyProgress } from "./Today";

it("shows total confirmed completions and caps the daily progress bar at the target", () => {
  const html = renderToStaticMarkup(createElement(DailyProgress, { completed: 3, required: 2 }));
  expect(html).toContain('class="today-progress-value">3<span> / 2</span>');
  expect(html).toContain('<progress value="2" max="2"');
  expect(html).toContain('data-complete="true"');
  expect(html).toContain("Completed from today&#x27;s plan");
});

it("renders counts below the target", () => {
  const html = renderToStaticMarkup(createElement(DailyProgress, { completed: 1, required: 2 }));
  expect(html).toContain('<progress value="1" max="2"');
  expect(html).not.toContain('data-complete="true"');
});
