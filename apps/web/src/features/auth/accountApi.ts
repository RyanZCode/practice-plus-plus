import { deleteAccountSchema } from "@practice-plus-plus/contracts";

export async function deleteAccount(apiUrl: string, token: string, confirmation: string) {
  const body = deleteAccountSchema.parse({ confirmation });
  const response = await fetch(`${apiUrl.replace(/\/$/, "")}/account`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.status === 204) return;
  const messages: Record<number, string> = {
    401: "Your session expired. Sign in again before deleting your account.",
    403: "This account owns shared catalog records or has administrator access. Contact support to delete it.",
    502: "Your practice data was removed, but sign-in account deletion failed. Retry deleting your account.",
    503: "Account deletion is unavailable. Contact ryan.zhou2005@gmail.com for help.",
  };
  throw new Error(messages[response.status] ?? "Unable to delete your account. Please try again.");
}
