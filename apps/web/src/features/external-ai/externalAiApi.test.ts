import { describe, expect, it, vi } from "vitest";
import { createExternalAiExport } from "./externalAiApi";

describe("external AI export client", () => {
  it("requests a no-store authenticated Markdown package without credentials", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          filename: "practice-plus-plus-context-2026-09-15.md",
          markdown: "# Context",
        }),
        { status: 200 },
      ),
    );
    await expect(
      createExternalAiExport(
        "https://api.example.com/",
        "token",
        { policy: { mode: "COACH", purpose: "PLANNING" } },
        fetcher,
      ),
    ).resolves.toMatchObject({ filename: "practice-plus-plus-context-2026-09-15.md" });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.com/ai/external-context",
      expect.objectContaining({
        cache: "no-store",
        body: JSON.stringify({ policy: { mode: "COACH", purpose: "PLANNING" } }),
      }),
    );
    expect(JSON.stringify(fetcher.mock.calls[0])).not.toContain("apiKey");
  });

  it("rejects current code for any mode except debugging", async () => {
    await expect(
      createExternalAiExport(
        "https://api.example.com",
        "token",
        { policy: { mode: "COACH", purpose: "GENERAL" }, currentCode: "private" } as never,
        vi.fn<typeof fetch>(),
      ),
    ).rejects.toThrow();
  });
});
