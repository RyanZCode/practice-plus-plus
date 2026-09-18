import {
  practiceSettingsResponseSchema,
  practiceSettingsSchema,
  type PracticeSettings,
} from "@practice-plus-plus/contracts";
import { Router } from "express";

import { HttpError } from "../../shared/errors.js";
import { getApplicationProfile } from "./profile.js";

interface PracticeSettingsRecord {
  readonly defaultAiModel: string;
  readonly reasoningEffort: string | null;
  readonly attemptTimerMinutes: number;
  readonly dailyTarget: number;
  readonly highIntervalDays: number;
  readonly lowIntervalDays: number;
  readonly mediumIntervalDays: number;
  readonly resetMinutes: number;
  readonly timeZone: string;
}

interface SettingsClient {
  readonly practiceSettings: {
    findUnique(options: {
      where: { userProfileId: string };
    }): Promise<PracticeSettingsRecord | null>;
    upsert(options: {
      create: PracticeSettingsRecord & { userProfileId: string };
      update: PracticeSettingsRecord;
      where: { userProfileId: string };
    }): Promise<PracticeSettingsRecord>;
  };
}

export interface SettingsStore {
  findByUserProfileId(userProfileId: string): Promise<PracticeSettings | null>;
  save(userProfileId: string, settings: PracticeSettings): Promise<PracticeSettings>;
}

export function createPrismaSettingsStore(client: SettingsClient): SettingsStore {
  return {
    async findByUserProfileId(userProfileId) {
      const record = await client.practiceSettings.findUnique({ where: { userProfileId } });

      return record === null ? null : toPracticeSettings(record);
    },
    async save(userProfileId, settings) {
      const record = toPracticeSettingsRecord(settings);
      const saved = await client.practiceSettings.upsert({
        create: { ...record, userProfileId },
        update: record,
        where: { userProfileId },
      });

      return toPracticeSettings(saved);
    },
  };
}

export function createSettingsRouter(store: SettingsStore): Router {
  const router = Router();

  router.get("/", async (request, response) => {
    const profile = getApplicationProfile(request);
    const settings = await store.findByUserProfileId(profile.id);

    response.json(practiceSettingsResponseSchema.parse({ settings }));
  });

  router.put("/", async (request, response) => {
    const parsedSettings = practiceSettingsSchema.safeParse(request.body);

    if (!parsedSettings.success) {
      throw new HttpError(400, "Invalid practice settings");
    }

    const profile = getApplicationProfile(request);
    const settings = await store.save(profile.id, parsedSettings.data);

    response.json(practiceSettingsResponseSchema.parse({ settings }));
  });

  return router;
}

function toPracticeSettings(record: PracticeSettingsRecord): PracticeSettings {
  return practiceSettingsSchema.parse({
    defaultAiModel: record.defaultAiModel,
    reasoningEffort: record.reasoningEffort,
    attemptTimerMinutes: record.attemptTimerMinutes,
    dailyTarget: record.dailyTarget,
    redoIntervals: {
      high: record.highIntervalDays,
      low: record.lowIntervalDays,
      medium: record.mediumIntervalDays,
    },
    resetTime: formatResetTime(record.resetMinutes),
    timeZone: record.timeZone,
  });
}

function toPracticeSettingsRecord(settings: PracticeSettings): PracticeSettingsRecord {
  return {
    defaultAiModel: settings.defaultAiModel,
    reasoningEffort: settings.reasoningEffort,
    attemptTimerMinutes: settings.attemptTimerMinutes,
    dailyTarget: settings.dailyTarget,
    highIntervalDays: settings.redoIntervals.high,
    lowIntervalDays: settings.redoIntervals.low,
    mediumIntervalDays: settings.redoIntervals.medium,
    resetMinutes: Number(settings.resetTime.slice(0, 2)) * 60 + Number(settings.resetTime.slice(3)),
    timeZone: settings.timeZone,
  };
}

function formatResetTime(resetMinutes: number): string {
  const hours = Math.floor(resetMinutes / 60)
    .toString()
    .padStart(2, "0");
  const minutes = (resetMinutes % 60).toString().padStart(2, "0");

  return `${hours}:${minutes}`;
}
