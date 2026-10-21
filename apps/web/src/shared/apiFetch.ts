export const demoApiUrl = "demo:";

export const apiFetch: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith(`${demoApiUrl}/`)) {
    const { demoRequest } = await import("../features/demo/demoApi");
    return demoRequest(url.slice(demoApiUrl.length), init);
  }
  return globalThis.fetch(input, init);
};
