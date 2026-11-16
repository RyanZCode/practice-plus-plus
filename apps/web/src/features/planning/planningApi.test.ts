import { afterEach, describe, expect, it, vi } from "vitest";
import { generateExtraPracticeWithAi, generateIntegratedPlan } from "./planningApi";

const selection = { providerId: "openai" as const, model: "gpt-5.4-mini" };

afterEach(() => vi.unstubAllGlobals());

describe.each([generateIntegratedPlan, generateExtraPracticeWithAi])(
  "AI planning client",
  (generate) => {
    it("requires a key before making a request", async () => {
      const fetcher = vi.fn<typeof fetch>();
      vi.stubGlobal("fetch", fetcher);
      for (const key of ["", " "]) {
        await expect(generate("https://api.example.com", "token", selection, key)).rejects.toThrow(
          "Add your API key in Settings before generating with AI.",
        );
      }
      expect(fetcher).not.toHaveBeenCalled();
    });

    it("shows key and model guidance when the provider rejects the request", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 400 })),
      );
      await expect(
        generate("https://api.example.com", "token", selection, "expired-key"),
      ).rejects.toThrow("Check your API key and model in Settings, then try again.");
    });
  },
);
