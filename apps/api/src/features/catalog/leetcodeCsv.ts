import type { CatalogSourceManifest } from "./catalogOfflineImport.js";

const requiredColumns = [
  "ID",
  "Title",
  "Difficulty",
  "Link",
  "Topics",
  "Premium Only",
  "Category",
] as const;

export interface LeetcodeCsvSource {
  readonly name: string;
  readonly datasetVersion: string;
  readonly license: string;
  readonly url?: string;
}

export function parseLeetcodeCsv(input: string, source: LeetcodeCsvSource): CatalogSourceManifest {
  const records = parseCsvRecords(input);
  const headers = records.shift();

  if (headers === undefined) {
    throw new Error("LeetCode CSV is empty");
  }

  const columns = new Map(
    headers.map((header, index) => [header.replace(/^\uFEFF/, "").trim(), index]),
  );

  for (const column of requiredColumns) {
    if (!columns.has(column)) {
      throw new Error(`LeetCode CSV is missing the required column: ${column}`);
    }
  }

  const rows = records
    .filter((record) => record.some((value) => value.trim() !== ""))
    .map((record) => {
      const topics = splitTopics(getValue(record, columns, "Topics"));
      const category = getValue(record, columns, "Category").trim();
      const tags = [...topics];

      if (category !== "" && normalizeTag(category) !== "algorithms") {
        tags.push(category);
      }

      if (tags.length === 0) {
        tags.push("array");
      }

      const paidOnly = parseBoolean(getValue(record, columns, "Premium Only"));
      const paidField = paidOnly === undefined ? {} : { isPaidOnly: paidOnly };
      const link = getValue(record, columns, "Link").trim();

      return {
        leetcodeId: getValue(record, columns, "ID").trim(),
        slug: extractSlug(link),
        title: getValue(record, columns, "Title").trim(),
        difficulty: getValue(record, columns, "Difficulty").trim(),
        url: link,
        ...paidField,
        tags,
      };
    });

  return {
    version: 1,
    source: {
      kind: "CURATED",
      name: source.name,
      datasetVersion: source.datasetVersion,
      license: source.license,
      ...(source.url === undefined ? {} : { url: source.url }),
    },
    rows,
  };
}

function parseCsvRecords(input: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];

    if (quoted) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field === "") {
      quoted = true;
    } else if (character === ",") {
      record.push(field);
      field = "";
    } else if (character === "\r" || character === "\n") {
      record.push(field);
      field = "";
      records.push(record);
      record = [];
      if (character === "\r" && input[index + 1] === "\n") index += 1;
    } else {
      field += character;
    }
  }

  if (quoted) {
    throw new Error("LeetCode CSV contains an unterminated quoted field");
  }

  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  return records;
}

function getValue(
  record: readonly string[],
  columns: ReadonlyMap<string, number>,
  name: string,
): string {
  const index = columns.get(name);
  return index === undefined ? "" : (record[index] ?? "");
}

function splitTopics(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag !== "");
}

function parseBoolean(value: string): boolean | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return undefined;
}

function extractSlug(link: string): string {
  return /^https:\/\/leetcode\.com\/problems\/([^/]+)\/?$/u.exec(link)?.[1] ?? "";
}

function normalizeTag(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ");
}
