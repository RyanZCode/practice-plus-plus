import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MarkdownMessage } from "./MarkdownMessage";

describe("MarkdownMessage", () => {
  it("renders common assistant formatting", () => {
    const html = renderToStaticMarkup(
      createElement(
        MarkdownMessage,
        null,
        "## Graphs\n\n- **BFS** for traversal\n- `Dijkstra` for paths",
      ),
    );

    expect(html).toContain("<h2>Graphs</h2>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<strong>BFS</strong>");
    expect(html).toContain("<code>Dijkstra</code>");
  });

  it("does not render raw HTML", () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownMessage, null, '<script>alert("unsafe")</script>\n\nSafe text'),
    );

    expect(html).not.toContain("<script");
    expect(html).toContain("Safe text");
  });
});
