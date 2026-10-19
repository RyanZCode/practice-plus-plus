import { Buffer } from "node:buffer";
import console from "node:console";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { URL, fileURLToPath, pathToFileURL } from "node:url";

const execute = promisify(execFile);
const load = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { Client } = load("pg");
const productionProject = "cmrdxyvkyaubhiqrxdoo";
const bucketId = "64d61463ef6a5415a31f091c";
const bucketName = "practice-plus-plus-backups";
const userColumns = [
  "id",
  "instance_id",
  "aud",
  "role",
  "email",
  "email_confirmed_at",
  "invited_at",
  "last_sign_in_at",
  "raw_app_meta_data",
  "raw_user_meta_data",
  "is_super_admin",
  "created_at",
  "updated_at",
  "phone",
  "phone_confirmed_at",
  "banned_until",
  "deleted_at",
  "is_sso_user",
  "is_anonymous",
];
const identityColumns = [
  "id",
  "user_id",
  "provider_id",
  "provider",
  "identity_data",
  "last_sign_in_at",
  "created_at",
  "updated_at",
];

async function runDump(command, args, options) {
  if (!process.env.BACKUP_PG_DUMP_IMAGE) return execute(command, args, options);
  const variables = [
    "PGHOST",
    "PGPORT",
    "PGUSER",
    "PGPASSWORD",
    "PGDATABASE",
    "PGSSLMODE",
    "PGSSLROOTCERT",
    "PGOPTIONS",
  ];
  const certificate = options.env.PGSSLROOTCERT;
  return execute(
    "docker",
    [
      "run",
      "--rm",
      ...variables.flatMap((name) => ["--env", name]),
      "--mount",
      `type=bind,source=${certificate},target=/backup/supabase.crt,readonly`,
      process.env.BACKUP_PG_DUMP_IMAGE,
      command,
      ...args,
    ],
    { ...options, env: { ...options.env, PGSSLROOTCERT: "/backup/supabase.crt" } },
  );
}

function hash(bytes, algorithm = "sha256") {
  return createHash(algorithm).update(bytes).digest("hex");
}

function identifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

export function sourceConnection(value, { local = false } = {}) {
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("Invalid source");
  if (local) {
    if (!["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Invalid local source");
    return url.toString();
  }
  const pooled = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname);
  const direct =
    url.hostname === `db.${productionProject}.supabase.co` &&
    decodeURIComponent(url.username) === "postgres";
  if (
    !(direct || (pooled && decodeURIComponent(url.username) === `postgres.${productionProject}`)) ||
    url.pathname !== "/postgres" ||
    (url.port && url.port !== "5432")
  )
    throw new Error("Invalid production source");
  url.search = "";
  url.searchParams.set("sslmode", "verify-full");
  url.searchParams.set(
    "sslrootcert",
    fileURLToPath(new URL("../certificates/supabase-root-2021.crt", import.meta.url)),
  );
  return url.toString();
}

export function retentionPlan(files) {
  const snapshots = files
    .filter(
      (file) =>
        /^production\/\d{4}-\d{2}-\d{2}T[\d-]+Z-[a-f0-9-]+\.tar\.gz\.age$/.test(file.fileName) &&
        file.action === "upload",
    )
    .sort((a, b) => b.uploadTimestamp - a.uploadTimestamp);
  const daily = new Set();
  const weekly = new Set();
  const keep = new Set();
  for (const file of snapshots) {
    const date = new Date(file.uploadTimestamp);
    const day = date.toISOString().slice(0, 10);
    const week = Math.floor(
      (Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) + 3 * 86400000) /
        (7 * 86400000),
    );
    if ((!daily.has(day) && daily.size < 14) || (!weekly.has(week) && weekly.size < 8))
      keep.add(file.fileId);
    daily.add(day);
    weekly.add(week);
  }
  return {
    retained: [...keep],
    expired: snapshots.filter((file) => !keep.has(file.fileId)).map((file) => file.fileId),
  };
}

export function providerUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !["backblazeb2.com", "backblaze.com"].some((domain) => url.hostname.endsWith(`.${domain}`))
  ) {
    throw new Error("Invalid storage endpoint");
  }
  return url.toString();
}

export async function pruneBackups(files, verifiedFileId, call) {
  if (
    !files.some(
      (file) =>
        file.fileId === verifiedFileId &&
        file.action === "upload" &&
        file.fileName.startsWith("production/"),
    )
  ) {
    throw new Error("The verified recovery archive must still exist");
  }
  const expired = new Set(retentionPlan(files).expired);
  let deleted = 0;
  for (const file of files) {
    if (file.fileId !== verifiedFileId && expired.has(file.fileId)) {
      await call("b2_delete_file_version", { fileName: file.fileName, fileId: file.fileId });
      deleted += 1;
    }
  }
  return deleted;
}

async function request(url, options = {}, transport = globalThis.fetch) {
  const response = await transport(providerUrl(url), {
    ...options,
    redirect: "error",
    signal: globalThis.AbortSignal.timeout(300000),
  });
  if (!response.ok) throw new Error("Storage request failed");
  return response;
}

export async function storageSession(keyId, key, transport = globalThis.fetch) {
  const response = await request(
    "https://api.backblazeb2.com/b2api/v4/b2_authorize_account",
    {
      headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${key}`).toString("base64")}` },
    },
    transport,
  );
  const session = await response.json();
  const api = session.apiInfo?.storageApi;
  const allowed = api?.allowed;
  if (allowed?.buckets?.length !== 1 || allowed.buckets[0].id !== bucketId || allowed.namePrefix) {
    throw new Error("A key restricted to the backup bucket is required");
  }
  const required = ["listBuckets", "listFiles", "readFiles", "writeFiles"];
  if (!required.every((capability) => allowed.capabilities.includes(capability)))
    throw new Error("Missing storage permissions");
  providerUrl(api.apiUrl);
  providerUrl(api.downloadUrl);
  const call = async (method, body) => {
    const result = await request(
      `${api.apiUrl}/b2api/v4/${method}`,
      {
        method: "POST",
        headers: { Authorization: session.authorizationToken, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      transport,
    );
    return result.json();
  };
  const buckets = await call("b2_list_buckets", { accountId: session.accountId, bucketId });
  if (
    buckets.buckets?.length !== 1 ||
    buckets.buckets[0].bucketType !== "allPrivate" ||
    buckets.buckets[0].bucketName !== bucketName
  ) {
    throw new Error("Backup bucket must be private");
  }
  return { session, api, call };
}

async function versions(call) {
  const files = [];
  let next = {};
  do {
    const page = await call("b2_list_file_versions", { bucketId, maxFileCount: 1000, ...next });
    files.push(...page.files);
    next = { startFileName: page.nextFileName, startFileId: page.nextFileId };
  } while (next.startFileName);
  return files;
}

export async function captureDatabase(
  connection,
  directory,
  { local = false, run = runDump } = {},
) {
  const client = new Client({ connectionString: sourceConnection(connection, { local }) });
  await client.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    const {
      rows: [snapshot],
    } = await client.query(
      "SELECT pg_export_snapshot() AS id, transaction_timestamp() AS time, current_setting('server_version') AS version",
    );
    const {
      rows: [scope],
    } = await client.query(`SELECT
      (SELECT count(*)::int FROM auth.users WHERE coalesce(encrypted_password, '') <> '') AS passwords,
      (SELECT count(*)::int FROM storage.buckets) AS buckets,
      (SELECT count(*)::int FROM storage.objects) AS objects,
      (SELECT count(*)::int FROM vault.secrets) AS vault_secrets`);
    if (Object.values(scope).some((count) => count !== 0))
      throw new Error("Backup scope needs review");
    const manifest = {
      format: 1,
      project: local ? "local" : productionProject,
      snapshotTime: snapshot.time,
      postgres: snapshot.version,
      tables: [],
      exclusions: [
        "Auth sessions, tokens, password credentials and MFA enrollment",
        "OAuth provider secrets and hosted configuration",
        "Storage file bytes (empty)",
        "Vault secrets (empty)",
      ],
    };
    const { rows: tables } = await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    );
    for (const { tablename } of tables) {
      const {
        rows: [table],
      } = await client.query(
        `SELECT count(*)::text AS count, md5(coalesce(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text), '')) AS digest FROM public.${identifier(tablename)} t`,
      );
      manifest.tables.push({ name: tablename, ...table });
    }
    const accounts = {};
    for (const [table, columns] of [
      ["users", userColumns],
      ["identities", identityColumns],
    ]) {
      const { rows } = await client.query(
        `SELECT ${columns.map(identifier).join(",")} FROM auth.${table} ORDER BY id`,
      );
      accounts[table] = rows;
    }
    const {
      rows: [mfa],
    } = await client.query("SELECT count(*)::int AS count FROM auth.mfa_factors");
    if (mfa.count) throw new Error("MFA recovery needs review");
    const { rows: roles } = await client.query(
      "SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication, rolconnlimit, rolvaliduntil, rolbypassrls, rolconfig FROM pg_roles ORDER BY rolname",
    );
    const { rows: memberships } = await client.query(
      "SELECT granted.rolname AS role, member.rolname AS member, grantor.rolname AS grantor, m.admin_option FROM pg_auth_members m JOIN pg_roles granted ON granted.oid=m.roleid JOIN pg_roles member ON member.oid=m.member JOIN pg_roles grantor ON grantor.oid=m.grantor ORDER BY 1,2,3",
    );
    const { rows: constraints } = await client.query(
      "SELECT n.nspname AS schema, c.relname AS table, con.conname AS name, con.convalidated AS validated, pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY 2,3",
    );
    const { rows: policies } = await client.query(
      "SELECT * FROM pg_policies WHERE schemaname IN ('public','auth','storage') ORDER BY schemaname,tablename,policyname",
    );
    const { rows: extensions } = await client.query(
      "SELECT e.extname AS name, e.extversion AS version, n.nspname AS schema FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace ORDER BY e.extname",
    );
    const url = new URL(sourceConnection(connection, { local }));
    const env = {
      ...process.env,
      PGHOST: url.hostname,
      PGPORT: url.port || "5432",
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: url.pathname.slice(1),
      PGSSLMODE: local ? "disable" : "verify-full",
      PGSSLROOTCERT: url.searchParams.get("sslrootcert") ?? "",
      PGOPTIONS: "-c default_transaction_read_only=on -c timezone=UTC",
    };
    const dumpOptions = { env, maxBuffer: 500000000, encoding: "buffer" };
    const publicDump = await run(
      "pg_dump",
      ["--format=custom", "--schema=public", `--snapshot=${snapshot.id}`],
      dumpOptions,
    );
    await writeFile(path.join(directory, "public.dump"), publicDump.stdout, { mode: 0o600 });
    const managedSchema = await run(
      "pg_dump",
      ["--schema-only", "--schema=auth", "--schema=storage", `--snapshot=${snapshot.id}`],
      dumpOptions,
    );
    await writeFile(path.join(directory, "managed-schema.sql"), managedSchema.stdout, {
      mode: 0o600,
    });
    for (const [name, value] of [
      ["manifest.json", manifest],
      ["auth-accounts.json", accounts],
      ["access.json", { roles, memberships, constraints, policies, extensions }],
    ]) {
      await writeFile(path.join(directory, name), JSON.stringify(value), { mode: 0o600 });
    }
    await client.query("COMMIT");
    return manifest;
  } finally {
    await client.end();
  }
}

async function main() {
  let stage = "configuration";
  let directory;
  try {
    const required = [
      "BACKUP_DATABASE_URL",
      "BACKUP_AGE_RECIPIENT",
      "B2_APPLICATION_KEY_ID",
      "B2_APPLICATION_KEY",
    ];
    if (required.some((name) => !process.env[name]))
      throw new Error("Missing backup configuration");
    if (!/^age1[a-z0-9]{58}$/.test(process.env.BACKUP_AGE_RECIPIENT))
      throw new Error("Invalid recipient");
    sourceConnection(process.env.BACKUP_DATABASE_URL);
    stage = "storage preflight";
    const { session, api, call } = await storageSession(
      process.env.B2_APPLICATION_KEY_ID,
      process.env.B2_APPLICATION_KEY,
    );
    const previous = await versions(call);
    const used = previous.reduce((sum, file) => sum + (file.contentLength ?? 0), 0);
    if (used >= 9000000000) throw new Error("Backup storage capacity exceeded");
    directory = await mkdtemp(path.join(tmpdir(), "practice-backup-"));
    stage = "database export";
    const manifest = await captureDatabase(process.env.BACKUP_DATABASE_URL, directory);
    stage = "archive encryption";
    const archive = path.join(directory, "snapshot.tar.gz");
    await execute("tar", [
      "-czf",
      archive,
      "-C",
      directory,
      "public.dump",
      "managed-schema.sql",
      "manifest.json",
      "auth-accounts.json",
      "access.json",
    ]);
    const encrypted = `${archive}.age`;
    await execute("age", [
      "--encrypt",
      "--recipient",
      process.env.BACKUP_AGE_RECIPIENT,
      "--output",
      encrypted,
      archive,
    ]);
    const bytes = await readFile(encrypted);
    if (bytes.length > 500000000 || used + bytes.length > 9000000000)
      throw new Error("Backup storage capacity exceeded");
    const purpose = process.env.BACKUP_PURPOSE ?? "daily";
    if (!["daily", "pre-migration"].includes(purpose)) throw new Error("Invalid backup purpose");
    const prefix = purpose === "pre-migration" ? "production/pre-migration/" : "production/";
    const name = `${prefix}${new Date(manifest.snapshotTime)
      .toISOString()
      .replaceAll(":", "-")
      .replace(/\.\d{3}Z$/, "Z")}-${randomUUID()}.tar.gz.age`;
    const sha256 = hash(bytes);
    stage = "archive upload";
    const upload = await call("b2_get_upload_url", { bucketId });
    const response = await request(upload.uploadUrl, {
      method: "POST",
      headers: {
        Authorization: upload.authorizationToken,
        "X-Bz-File-Name": encodeURIComponent(name),
        "Content-Type": "application/octet-stream",
        "Content-Length": String(bytes.length),
        "X-Bz-Content-Sha1": hash(bytes, "sha1"),
        "X-Bz-Info-sha256": sha256,
      },
      body: bytes,
    });
    const uploaded = await response.json();
    if (uploaded.contentLength !== bytes.length || uploaded.contentSha1 !== hash(bytes, "sha1"))
      throw new Error("Upload mismatch");
    stage = "retained archive download";
    const downloaded = await request(
      `${api.downloadUrl}/b2api/v4/b2_download_file_by_id?fileId=${encodeURIComponent(uploaded.fileId)}`,
      { headers: { Authorization: session.authorizationToken } },
    );
    if (hash(Buffer.from(await downloaded.arrayBuffer())) !== sha256)
      throw new Error("Download mismatch");
    const files = [...previous, uploaded];
    const plan = retentionPlan(files);
    let deleted = 0;
    if (process.env.BACKUP_RETENTION_ENABLED === "true") {
      stage = "retention";
      deleted = await pruneBackups(files, process.env.BACKUP_VERIFIED_FILE_ID, call);
    }
    console.log(
      JSON.stringify({
        fileName: name,
        fileId: uploaded.fileId,
        bytes: bytes.length,
        sha256,
        snapshotTime: manifest.snapshotTime,
        retentionCandidates: plan.expired.length,
        retentionApplied: process.env.BACKUP_RETENTION_ENABLED === "true",
        deleted,
      }),
    );
  } catch {
    console.error(`Backup failed during ${stage}.`);
    process.exitCode = 1;
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
