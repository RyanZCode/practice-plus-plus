import { afterEach, expect, it, vi } from "vitest";
import { deleteAccount } from "./accountApi";

afterEach(() => vi.unstubAllGlobals());

it("sends only the explicit confirmation with the signed-in token", async () => {
  const request = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", request);
  await deleteAccount("https://api.example.com/", "session-token", "DELETE");
  expect(request).toHaveBeenCalledWith("https://api.example.com/account", {
    method: "DELETE",
    headers: { authorization: "Bearer session-token", "content-type": "application/json" },
    body: '{"confirmation":"DELETE"}',
  });
});

it("does not send a deletion request without confirmation", async () => {
  const request = vi.fn();
  vi.stubGlobal("fetch", request);
  await expect(deleteAccount("https://api.example.com", "token", "delete")).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});

it("explains a partial deletion without displaying upstream response contents", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("private upstream error", { status: 502 })),
  );
  await expect(deleteAccount("https://api.example.com", "token", "DELETE")).rejects.toThrow(
    "Your practice data was removed",
  );
});
