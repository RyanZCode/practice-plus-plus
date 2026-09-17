import {
  externalAiExportRequestSchema,
  externalAiExportResponseSchema,
  type ExternalAiExportRequest,
  type ExternalAiExportResponse,
} from "@practice-plus-plus/contracts";

export async function createExternalAiExport(
  apiUrl: string,
  token: string,
  input: ExternalAiExportRequest,
  fetcher: typeof fetch = fetch,
): Promise<ExternalAiExportResponse> {
  const body = externalAiExportRequestSchema.parse(input);
  const response = await fetcher(`${apiUrl.replace(/\/$/, "")}/ai/external-context`, {
    method: "POST",
    cache: "no-store",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error("Your session expired. Sign in again.");
    if (response.status === 409)
      throw new Error("The attempt state changed. Reload this page and create a new export.");
    throw new Error("Unable to create the external AI context. Please try again.");
  }
  return externalAiExportResponseSchema.parse(await response.json());
}
