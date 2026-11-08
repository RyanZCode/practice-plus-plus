export async function startWithProblemTab<T extends { problem: { url: string } } | null>(
  enabled: boolean,
  start: () => Promise<T>,
): Promise<T> {
  const tab = enabled ? window.open("about:blank", "_blank") : null;
  if (tab !== null) tab.opener = null;
  try {
    const attempt = await start();
    if (attempt === null) tab?.close();
    else if (tab !== null && !tab.closed) tab.location.replace(attempt.problem.url);
    return attempt;
  } catch (error) {
    tab?.close();
    throw error;
  }
}
