import { Router } from "express";

export interface ReadinessCheck {
  name: string;
  run: () => Promise<void> | void;
}

export function createHealthRouter(readinessChecks: readonly ReadinessCheck[] = []): Router {
  const router = Router();

  router.get("/live", (_request, response) => {
    response.json({ status: "ok" });
  });

  router.get("/ready", async (request, response) => {
    for (const readinessCheck of readinessChecks) {
      try {
        await readinessCheck.run();
      } catch {
        request.log.warn({ dependency: readinessCheck.name }, "Readiness check failed");
        response.status(503).json({ status: "unavailable" });
        return;
      }
    }

    response.json({ status: "ready" });
  });

  return router;
}
