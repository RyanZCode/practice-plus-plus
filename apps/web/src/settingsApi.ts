import {
  practiceSettingsResponseSchema,
  type PracticeSettings,
} from "@practice-plus-plus/contracts";

export async function loadPracticeSettings(
  apiUrl: string,
  accessToken: string,
): Promise<PracticeSettings | null> {
  const response = await fetch(settingsUrl(apiUrl), {
    headers: { authorization: `Bearer ${accessToken}` },
  });

  return readSettingsResponse(response, "load");
}

export async function savePracticeSettings(
  apiUrl: string,
  accessToken: string,
  settings: PracticeSettings,
): Promise<PracticeSettings> {
  const response = await fetch(settingsUrl(apiUrl), {
    body: JSON.stringify(settings),
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    method: "PUT",
  });
  const saved = await readSettingsResponse(response, "save");

  if (saved === null) {
    throw new Error("The API did not return saved practice settings.");
  }

  return saved;
}

async function readSettingsResponse(
  response: Response,
  action: "load" | "save",
): Promise<PracticeSettings | null> {
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Your session expired. Sign in again.");
    }

    throw new Error(`Unable to ${action} practice settings.`);
  }

  const result = practiceSettingsResponseSchema.safeParse(await response.json());

  if (!result.success) {
    throw new Error("The API returned invalid practice settings.");
  }

  return result.data.settings;
}

function settingsUrl(apiUrl: string): string {
  return `${apiUrl.replace(/\/$/, "")}/settings`;
}
