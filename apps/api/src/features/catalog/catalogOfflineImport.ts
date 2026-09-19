import {
  catalogImportRowSchema,
  mvpPatternNames,
  type CatalogImportRow,
} from "@practice-plus-plus/contracts";
import { z } from "zod";

const difficultyValues = ["EASY", "MEDIUM", "HARD"] as const;
const availabilityValues = ["AVAILABLE", "PAID_ONLY", "UNAVAILABLE"] as const;
type CatalogAvailability = (typeof availabilityValues)[number];

const sourceManifestSchema = z.object({
  version: z.literal(1),
  source: z.object({
    kind: z.enum(["CURATED", "LLM_GENERATED"]),
    name: z.string().trim().min(1).max(200),
    datasetVersion: z.string().trim().min(1).max(100),
    license: z.string().trim().min(1).max(200),
    url: z.string().url().optional(),
  }),
  rows: z.array(z.unknown()).min(1),
});

const tagMappingSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  mapped: z.record(z.string().trim().min(1), z.array(z.enum(mvpPatternNames)).min(1).max(3)),
  ignored: z.array(z.string().trim().min(1)).default([]),
});

const rawRowSchema = z.object({
  leetcodeId: z.coerce.number().int().positive(),
  slug: z.string().trim().min(1),
  title: z.string().trim().min(1),
  difficulty: z.string().trim().min(1),
  url: z.string().trim().optional(),
  availability: z.unknown().optional(),
  isPaidOnly: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  topicTags: z.array(z.string()).optional(),
  patterns: z.array(z.string()).optional(),
});

export type CatalogSourceManifest = z.infer<typeof sourceManifestSchema>;
export type CatalogPatternName = (typeof mvpPatternNames)[number];

export interface CatalogTagMapping {
  readonly version: 1 | 2;
  readonly mapped: Readonly<Record<string, readonly CatalogPatternName[]>>;
  readonly ignored: readonly string[];
}

export interface IndexedCatalogRow {
  readonly row: number;
  readonly value: CatalogImportRow;
}

export type CatalogQuarantineCode =
  | "INVALID_ROW"
  | "UNKNOWN_DIFFICULTY"
  | "UNKNOWN_AVAILABILITY"
  | "CONFLICTING_AVAILABILITY"
  | "MISSING_PATTERN_DATA"
  | "UNKNOWN_PATTERN_TAG"
  | "TOO_MANY_PATTERNS"
  | "NON_CANONICAL_URL"
  | "DUPLICATE_LEETCODE_ID"
  | "DUPLICATE_SLUG";

export interface CatalogQuarantineRow {
  readonly row: number;
  readonly code: CatalogQuarantineCode;
  readonly message: string;
  readonly metadata: Record<string, unknown>;
}

export interface NormalizedCatalog {
  readonly manifest: CatalogSourceManifest;
  readonly rows: readonly IndexedCatalogRow[];
  readonly quarantine: readonly CatalogQuarantineRow[];
}

export function parseCatalogSourceManifest(input: unknown): CatalogSourceManifest {
  const parsed = sourceManifestSchema.safeParse(input);

  if (!parsed.success) {
    throw new Error(formatIssues("Invalid catalog source manifest", parsed.error));
  }

  return parsed.data;
}

export function parseCatalogTagMapping(input: unknown): CatalogTagMapping {
  const parsed = tagMappingSchema.safeParse(input);

  if (!parsed.success) {
    throw new Error(formatIssues("Invalid catalog tag mapping", parsed.error));
  }

  const seen = new Set<string>();

  for (const tag of [...Object.keys(parsed.data.mapped), ...parsed.data.ignored]) {
    const normalized = normalizeTag(tag);

    if (seen.has(normalized)) {
      throw new Error(`Catalog tag mapping contains duplicate normalized tag: ${tag}`);
    }

    seen.add(normalized);
  }

  return {
    ignored: parsed.data.ignored,
    mapped: parsed.data.mapped as Readonly<Record<string, readonly CatalogPatternName[]>>,
    version: parsed.data.version,
  };
}

export function normalizeCatalog(
  manifest: CatalogSourceManifest,
  mapping: CatalogTagMapping,
): NormalizedCatalog {
  const mappedTags = new Map(
    Object.entries(mapping.mapped).map(([tag, patterns]) => [normalizeTag(tag), patterns]),
  );
  const ignoredTags = new Set(mapping.ignored.map(normalizeTag));
  const canonicalTags = new Map(
    mvpPatternNames.map((pattern) => [normalizeTag(pattern), pattern] as const),
  );
  const rows: IndexedCatalogRow[] = [];
  const quarantine: CatalogQuarantineRow[] = [];
  const seenIds = new Map<number, number>();
  const seenSlugs = new Map<string, number>();

  manifest.rows.forEach((rawRow, index) => {
    const rowNumber = index + 1;
    const metadata = safeMetadata(rawRow);
    const parsed = rawRowSchema.safeParse(rawRow);

    if (!parsed.success) {
      quarantine.push({
        row: rowNumber,
        code: "INVALID_ROW",
        message: formatIssues("The row does not contain supported metadata fields", parsed.error),
        metadata,
      });
      return;
    }

    const difficulty = normalizeDifficulty(parsed.data.difficulty);

    if (difficulty === undefined) {
      quarantine.push({
        row: rowNumber,
        code: "UNKNOWN_DIFFICULTY",
        message: `Difficulty ${parsed.data.difficulty} is not Easy, Medium, or Hard`,
        metadata,
      });
      return;
    }

    const availability = normalizeAvailability(parsed.data.availability, parsed.data.isPaidOnly);

    if (availability.code !== undefined) {
      quarantine.push({
        row: rowNumber,
        code: availability.code,
        message: availability.message,
        metadata,
      });
      return;
    }

    const patternResult = resolvePatterns(parsed.data, mappedTags, ignoredTags, canonicalTags);

    if (patternResult.code !== undefined) {
      quarantine.push({
        row: rowNumber,
        code: patternResult.code,
        message: patternResult.message,
        metadata,
      });
      return;
    }

    const url = `https://leetcode.com/problems/${parsed.data.slug}/`;

    if (parsed.data.url !== undefined && parsed.data.url !== url) {
      quarantine.push({
        row: rowNumber,
        code: "NON_CANONICAL_URL",
        message: `URL must be ${url}`,
        metadata,
      });
      return;
    }

    const catalogRow = catalogImportRowSchema.safeParse({
      availability: availability.value,
      difficulty,
      leetcodeId: parsed.data.leetcodeId,
      patterns: patternResult.patterns,
      slug: parsed.data.slug,
      title: parsed.data.title,
      url,
    });

    if (!catalogRow.success) {
      quarantine.push({
        row: rowNumber,
        code: "INVALID_ROW",
        message: formatIssues("The normalized row failed catalog validation", catalogRow.error),
        metadata,
      });
      return;
    }

    const previousIdRow = seenIds.get(catalogRow.data.leetcodeId);

    if (previousIdRow !== undefined) {
      quarantine.push({
        row: rowNumber,
        code: "DUPLICATE_LEETCODE_ID",
        message: `LeetCode ID ${catalogRow.data.leetcodeId} also appears on row ${previousIdRow}`,
        metadata,
      });
      return;
    }

    const previousSlugRow = seenSlugs.get(catalogRow.data.slug);

    if (previousSlugRow !== undefined) {
      quarantine.push({
        row: rowNumber,
        code: "DUPLICATE_SLUG",
        message: `Slug ${catalogRow.data.slug} also appears on row ${previousSlugRow}`,
        metadata,
      });
      return;
    }

    seenIds.set(catalogRow.data.leetcodeId, rowNumber);
    seenSlugs.set(catalogRow.data.slug, rowNumber);
    rows.push({ row: rowNumber, value: catalogRow.data });
  });

  return { manifest, quarantine, rows };
}

export function formatCatalogSourceName(
  source: CatalogSourceManifest["source"],
  snapshotHash: string,
  mappingVersion: number,
): string {
  const sourceName = `${source.name} ${source.datasetVersion} (${source.license}) [sha256:${snapshotHash.slice(0, 16)}; mapping:v${mappingVersion}]`;
  return sourceName.slice(0, 255);
}

function resolvePatterns(
  row: z.infer<typeof rawRowSchema>,
  mappedTags: ReadonlyMap<string, readonly CatalogPatternName[]>,
  ignoredTags: ReadonlySet<string>,
  canonicalTags: ReadonlyMap<string, CatalogPatternName>,
):
  | {
      readonly patterns: readonly CatalogPatternName[];
      readonly code?: never;
      readonly message?: never;
    }
  | {
      readonly code: "MISSING_PATTERN_DATA" | "UNKNOWN_PATTERN_TAG" | "TOO_MANY_PATTERNS";
      readonly message: string;
      readonly patterns?: never;
    } {
  const values = row.patterns ?? row.tags ?? row.topicTags;

  if (values === undefined || values.length === 0) {
    return { code: "MISSING_PATTERN_DATA", message: "The row has no patterns or source tags" };
  }

  const patterns = new Set<CatalogPatternName>();
  const unknownTags: string[] = [];

  for (const value of values) {
    const normalized = normalizeTag(value);
    const canonical = canonicalTags.get(normalized);
    const mapped = canonical === undefined ? mappedTags.get(normalized) : [canonical];

    if (mapped === undefined) {
      if (!ignoredTags.has(normalized)) unknownTags.push(value);
      continue;
    }

    mapped.forEach((pattern) => patterns.add(pattern));
  }

  if (unknownTags.length > 0) {
    return {
      code: "UNKNOWN_PATTERN_TAG",
      message: `No mapping exists for source tag(s): ${unknownTags.join(", ")}`,
    };
  }

  if (patterns.size === 0) {
    return {
      code: "MISSING_PATTERN_DATA",
      message: "The source tags did not map to a Practice++ pattern",
    };
  }

  return { patterns: [...patterns].slice(0, 3) };
}

function normalizeDifficulty(value: string): (typeof difficultyValues)[number] | undefined {
  const normalized = value.trim().toUpperCase();
  return difficultyValues.includes(normalized as (typeof difficultyValues)[number])
    ? (normalized as (typeof difficultyValues)[number])
    : undefined;
}

function normalizeAvailability(
  value: unknown,
  isPaidOnly: boolean | undefined,
):
  | {
      readonly value: CatalogAvailability;
      readonly code?: never;
      readonly message?: never;
    }
  | {
      readonly code: "UNKNOWN_AVAILABILITY" | "CONFLICTING_AVAILABILITY";
      readonly message: string;
      readonly value?: never;
    } {
  const explicit =
    typeof value === "string" ? value.trim().toUpperCase() : value === undefined ? undefined : null;
  const derived: CatalogAvailability | undefined =
    isPaidOnly === undefined ? undefined : isPaidOnly ? "PAID_ONLY" : "AVAILABLE";

  if (
    explicit === null ||
    (explicit !== undefined && !availabilityValues.includes(explicit as CatalogAvailability))
  ) {
    return {
      code: "UNKNOWN_AVAILABILITY",
      message: `Availability ${String(value)} is not AVAILABLE, PAID_ONLY, or UNAVAILABLE`,
    };
  }

  const resolvedExplicit = explicit as CatalogAvailability | undefined;

  if (resolvedExplicit !== undefined && derived !== undefined && resolvedExplicit !== derived) {
    return {
      code: "CONFLICTING_AVAILABILITY",
      message: `Availability ${resolvedExplicit} conflicts with isPaidOnly=${String(isPaidOnly)}`,
    };
  }

  const resolved = resolvedExplicit ?? derived;

  if (resolved === undefined) {
    return {
      code: "UNKNOWN_AVAILABILITY",
      message: "The source did not provide availability or isPaidOnly",
    };
  }

  return { value: resolved };
}

function normalizeTag(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ");
}

function safeMetadata(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};

  const row = value as Record<string, unknown>;
  const metadata: Record<string, unknown> = {};

  for (const key of [
    "leetcodeId",
    "slug",
    "title",
    "difficulty",
    "url",
    "availability",
    "isPaidOnly",
    "tags",
    "topicTags",
    "patterns",
  ]) {
    const item = row[key];

    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      metadata[key] = item;
    } else if (Array.isArray(item)) {
      metadata[key] = item.filter((entry): entry is string => typeof entry === "string");
    }
  }

  return metadata;
}

function formatIssues(prefix: string, error: z.ZodError): string {
  const details = error.issues
    .map((issue) => `${issue.path.join(".") || "row"}: ${issue.message}`)
    .join("; ");
  return `${prefix}: ${details}`;
}
