import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createDatabase } from "../../shared/database.js";
import { createPrismaCatalogImportStore } from "./catalogImport.js";
import {
  formatCatalogSourceName,
  normalizeCatalog,
  parseCatalogSourceManifest,
  parseCatalogTagMapping,
  type CatalogQuarantineRow,
} from "./catalogOfflineImport.js";
import { parseLeetcodeCsv } from "./leetcodeCsv.js";

interface Options {
  readonly allowQuarantine: boolean;
  readonly adminProfileId?: string;
  readonly inputPath: string;
  readonly mappingPath: string;
  readonly quarantinePath: string;
  readonly skipExisting: boolean;
  readonly sourceName?: string;
  readonly datasetVersion?: string;
  readonly license?: string;
  readonly sourceUrl?: string;
}

async function main(): Promise<void> {
  const { command, options } = parseArguments(process.argv.slice(2));
  const inputBytes = await readFile(options.inputPath);
  const mappingBytes = await readFile(options.mappingPath);
  const manifest = parseInputManifest(options, inputBytes.toString("utf8"));
  const mapping = parseCatalogTagMapping(JSON.parse(mappingBytes.toString("utf8")));
  const normalized = normalizeCatalog(manifest, mapping);

  if (normalized.quarantine.length > 0) {
    await writeQuarantine(options.quarantinePath, normalized.quarantine);
  }

  console.log(
    JSON.stringify({
      command,
      input: options.inputPath,
      mappingVersion: mapping.version,
      quarantine: normalized.quarantine.length,
      quarantinePath: normalized.quarantine.length > 0 ? options.quarantinePath : null,
      rows: normalized.rows.length,
      snapshotHash: createHash("sha256").update(inputBytes).digest("hex"),
    }),
  );

  if (command === "validate") {
    if (normalized.quarantine.length > 0) process.exitCode = 2;
    return;
  }

  if (normalized.quarantine.length > 0 && !options.allowQuarantine) {
    throw new Error(
      `Refusing to import with ${normalized.quarantine.length} quarantined row(s). Review the quarantine file or pass --allow-quarantine.`,
    );
  }

  if (normalized.rows.length === 0) {
    throw new Error("No valid catalog rows remain after normalization");
  }

  const adminProfileId = options.adminProfileId;

  if (adminProfileId === undefined) {
    throw new Error("--admin-profile-id is required for import");
  }

  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl === undefined || databaseUrl.trim() === "") {
    throw new Error("DATABASE_URL is required for import");
  }

  const database = createDatabase(databaseUrl);

  try {
    const result = await createPrismaCatalogImportStore(database).importDrafts({
      createdByUserProfileId: adminProfileId,
      rows: normalized.rows,
      source: {
        kind: manifest.source.kind,
        name: formatCatalogSourceName(
          manifest.source,
          createHash("sha256").update(inputBytes).digest("hex"),
          mapping.version,
        ),
      },
      version: 1,
      skipExisting: options.skipExisting,
    });

    console.log(
      JSON.stringify({
        ...result,
        skippedExisting:
          result.errors.length === 0 ? normalized.rows.length - result.importedCount : 0,
      }),
    );

    if (result.errors.length > 0) process.exitCode = 1;
  } finally {
    await database.$disconnect();
  }
}

function parseArguments(arguments_: readonly string[]): {
  command: "validate" | "import";
  options: Options;
} {
  const command = arguments_[0];

  if (command !== "validate" && command !== "import") {
    throw new Error(usage());
  }

  const values = new Map<string, string>();
  let allowQuarantine = false;
  let skipExisting = false;

  for (let index = 1; index < arguments_.length; index += 1) {
    const argument = arguments_[index];

    if (argument === "--allow-quarantine") {
      allowQuarantine = true;
      continue;
    }

    if (argument === "--skip-existing") {
      skipExisting = true;
      continue;
    }

    if (argument === undefined || !argument.startsWith("--")) {
      throw new Error(usage());
    }

    const next = arguments_[index + 1];

    if (next === undefined || next.startsWith("--")) {
      throw new Error(`Missing value for ${argument}\n\n${usage()}`);
    }

    values.set(argument.slice(2), next);
    index += 1;
  }

  const input = values.get("input");
  const mapping = values.get("mapping");

  if (input === undefined || mapping === undefined) {
    throw new Error(usage());
  }

  const adminProfileId = values.get("admin-profile-id");
  const sourceName = values.get("source-name");
  const datasetVersion = values.get("dataset-version");
  const license = values.get("license");
  const sourceUrl = values.get("source-url");
  const invocationDirectory = process.env.INIT_CWD ?? process.cwd();

  return {
    command,
    options: {
      allowQuarantine,
      skipExisting,
      inputPath: resolve(invocationDirectory, input),
      mappingPath: resolve(invocationDirectory, mapping),
      quarantinePath: resolve(
        invocationDirectory,
        values.get("quarantine") ?? `${input}.quarantine.json`,
      ),
      ...(adminProfileId === undefined ? {} : { adminProfileId }),
      ...(sourceName === undefined ? {} : { sourceName }),
      ...(datasetVersion === undefined ? {} : { datasetVersion }),
      ...(license === undefined ? {} : { license }),
      ...(sourceUrl === undefined ? {} : { sourceUrl }),
    },
  };
}

function parseInputManifest(options: Options, input: string) {
  if (!options.inputPath.toLowerCase().endsWith(".csv")) {
    return parseCatalogSourceManifest(JSON.parse(input));
  }

  return parseLeetcodeCsv(input, {
    name: requireOption(options.sourceName, "--source-name"),
    datasetVersion: requireOption(options.datasetVersion, "--dataset-version"),
    license: requireOption(options.license, "--license"),
    ...(options.sourceUrl === undefined ? {} : { url: options.sourceUrl }),
  });
}

function requireOption(value: string | undefined, option: string): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(`${option} is required when --input points to a CSV file`);
  }

  return value;
}

async function writeQuarantine(path: string, rows: readonly CatalogQuarantineRow[]): Promise<void> {
  await writeFile(path, `${JSON.stringify({ version: 1, rows }, null, 2)}\n`, "utf8");
}

function usage(): string {
  return [
    "Usage:",
    "  catalog:validate --input <manifest.json> --mapping <tag-map.json> [--quarantine <path>]",
    "  catalog:import --input <manifest.json|csv> --mapping <tag-map.json> --admin-profile-id <uuid> [--skip-existing] [--allow-quarantine] [--quarantine <path>]",
    "  CSV inputs also require --source-name <name> --dataset-version <version> --license <license> [--source-url <url>]",
  ].join("\n");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Catalog import failed");
  process.exitCode = 1;
});
