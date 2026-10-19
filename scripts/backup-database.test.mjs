import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { URL } from "node:url";
import { promisify } from "node:util";
import {
  captureDatabase,
  pruneBackups,
  providerUrl,
  retentionPlan,
  sourceConnection,
  storageSession,
} from "./backup-database.mjs";

const execute = promisify(execFile);
const load = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { Client } = load("pg");

test("source guard rejects staging, unrelated hosts and transaction pooling", () => {
  for (const connection of [
    "postgresql://postgres.gwzxbvqttopjivjtcffn:synthetic@aws-0-us-east-2.pooler.supabase.com:5432/postgres",
    "postgresql://postgres:synthetic@unrelated.example/postgres",
    "postgresql://postgres.cmrdxyvkyaubhiqrxdoo:synthetic@aws-0-us-east-2.pooler.supabase.com:6543/postgres",
    "postgresql://postgres:synthetic@db.cmrdxyvkyaubhiqrxdoo.supabase.co/another_database",
    "postgresql://limited:synthetic@db.cmrdxyvkyaubhiqrxdoo.supabase.co/postgres",
  ])
    assert.throws(() => sourceConnection(connection));
  const result = new URL(
    sourceConnection(
      "postgresql://postgres.cmrdxyvkyaubhiqrxdoo:synthetic@aws-0-us-east-2.pooler.supabase.com:5432/postgres?sslmode=disable&host=unrelated.example&user=limited",
    ),
  );
  assert.equal(result.searchParams.get("sslmode"), "verify-full");
  assert.equal(result.searchParams.get("host"), null);
  assert.equal(result.searchParams.get("user"), null);
  assert.ok(result.searchParams.get("sslrootcert").endsWith("supabase-root-2021.crt"));
  assert.throws(() =>
    sourceConnection("postgresql://postgres:synthetic@remote.example/postgres", { local: true }),
  );
});

test("storage endpoints cannot redirect credentials to another provider", () => {
  for (const endpoint of [
    "http://api001.backblazeb2.com",
    "https://backblazeb2.com.evil.example",
    "https://user:password@api001.backblazeb2.com",
    "https://api001.backblazeb2.com:8443",
  ]) {
    assert.throws(() => providerUrl(endpoint));
  }
  assert.equal(
    providerUrl("https://pod-000-1000-01.backblaze.com/upload"),
    "https://pod-000-1000-01.backblaze.com/upload",
  );
});

test("storage preflight rejects master keys and public buckets before upload", async () => {
  const bucket = { id: "64d61463ef6a5415a31f091c", name: "practice-plus-plus-backups" };
  for (const [buckets, type, succeeds] of [
    [null, "allPrivate", false],
    [[bucket], "allPublic", false],
    [[bucket], "allPrivate", true],
  ]) {
    const calls = [];
    const transport = async (url, options) => {
      calls.push(url);
      assert.equal(options.redirect, "error");
      const value =
        calls.length === 1
          ? {
              accountId: "synthetic",
              authorizationToken: "synthetic",
              apiInfo: {
                storageApi: {
                  apiUrl: "https://api001.backblazeb2.com",
                  downloadUrl: "https://f001.backblazeb2.com",
                  allowed: {
                    buckets,
                    capabilities: ["listBuckets", "listFiles", "readFiles", "writeFiles"],
                  },
                },
              },
            }
          : { buckets: [{ bucketName: bucket.name, bucketType: type }] };
      return { ok: true, json: async () => value };
    };
    if (succeeds) await storageSession("synthetic", "synthetic", transport);
    else await assert.rejects(storageSession("synthetic", "synthetic", transport));
    assert.ok(calls.length <= 2);
  }
});

test("retention keeps fourteen daily and eight weekly recovery points without deleting other files", () => {
  const files = Array.from({ length: 100 }, (_, index) => {
    const timestamp = Date.UTC(2026, 9, 18 - index, 8, 17);
    return {
      fileId: String(index),
      fileName: `production/${new Date(timestamp).toISOString().replaceAll(":", "-").replace(".000Z", "Z")}-${randomUUID()}.tar.gz.age`,
      uploadTimestamp: timestamp,
      action: "upload",
    };
  });
  const result = retentionPlan([
    ...files,
    { ...files[0], fileId: "migration", fileName: "production/pre-migration/retained.age" },
  ]);
  assert.ok(files.slice(0, 14).every((file) => result.retained.includes(file.fileId)));
  assert.ok(result.retained.length >= 14 && result.retained.length <= 22);
  assert.ok(!result.expired.includes("migration"));
  assert.equal(result.retained.length + result.expired.length, 100);
  const weeks = new Set(
    result.retained.map((id) =>
      Math.floor((files[Number(id)].uploadTimestamp + 3 * 86400000) / (7 * 86400000)),
    ),
  );
  assert.equal(weeks.size, 8);
});

test("retention requires and preserves the archive restored with the retained key", async () => {
  const files = Array.from({ length: 100 }, (_, index) => {
    const timestamp = Date.UTC(2026, 9, 18 - index, 8, 17);
    return {
      fileId: String(index),
      fileName: `production/${new Date(timestamp).toISOString().replaceAll(":", "-").replace(".000Z", "Z")}-${randomUUID()}.tar.gz.age`,
      uploadTimestamp: timestamp,
      action: "upload",
    };
  });
  const calls = [];
  const call = async (method, body) => calls.push({ method, ...body });
  await assert.rejects(pruneBackups(files, "missing", call));
  assert.equal(calls.length, 0);
  await pruneBackups(files, "99", call);
  assert.ok(calls.length > 0);
  assert.ok(
    calls.every((entry) => entry.method === "b2_delete_file_version" && entry.fileId !== "99"),
  );
});

test(
  "synthetic snapshot survives encryption and restore without live Auth tokens",
  {
    skip: !process.env.BACKUP_TEST_DATABASE_URL,
  },
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "practice-backup-test-"));
    const suffix = randomUUID().replaceAll("-", "");
    const sourceName = `backup_source_${suffix}`;
    const targetName = `backup_target_${suffix}`;
    const admin = new Client({ connectionString: process.env.BACKUP_TEST_DATABASE_URL });
    const connection = (database) => {
      const url = new URL(process.env.BACKUP_TEST_DATABASE_URL);
      url.pathname = `/${database}`;
      return url.toString();
    };
    const clients = [];
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE ${sourceName}`);
      await admin.query(`CREATE DATABASE ${targetName}`);
      const source = new Client({ connectionString: connection(sourceName) });
      const target = new Client({ connectionString: connection(targetName) });
      await source.connect();
      await target.connect();
      clients.push(source, target);
      const authSchema = `CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA vault;
      CREATE TABLE auth.users(id uuid PRIMARY KEY, instance_id uuid, aud text, role text, email text,
        email_confirmed_at timestamptz, invited_at timestamptz, last_sign_in_at timestamptz,
        raw_app_meta_data jsonb, raw_user_meta_data jsonb, is_super_admin boolean, created_at timestamptz,
        updated_at timestamptz, phone text, phone_confirmed_at timestamptz, banned_until timestamptz,
        deleted_at timestamptz, is_sso_user boolean, is_anonymous boolean, encrypted_password text,
        confirmation_token text, generated_email text GENERATED ALWAYS AS (id::text) STORED);
      CREATE TABLE auth.identities(id uuid PRIMARY KEY, user_id uuid REFERENCES auth.users(id),
        provider_id text, provider text, identity_data jsonb, last_sign_in_at timestamptz,
        created_at timestamptz, updated_at timestamptz);
      CREATE TABLE auth.mfa_factors(id uuid);
      CREATE TABLE storage.buckets(id text); CREATE TABLE storage.objects(id text);
      CREATE TABLE vault.secrets(id uuid);`;
      await source.query(authSchema);
      await target.query(authSchema);
      const user = randomUUID();
      await source.query(
        "INSERT INTO auth.users(id,email,confirmation_token) VALUES ($1,'synthetic@example.invalid','do-not-archive-token')",
        [user],
      );
      await source.query(
        "INSERT INTO auth.identities(id,user_id,provider) VALUES ($1,$2,'github')",
        [randomUUID(), user],
      );
      await source.query(`CREATE TABLE public.profiles(id uuid PRIMARY KEY REFERENCES auth.users(id), note text CHECK(length(note)>0));
      CREATE TABLE public._prisma_migrations(id text PRIMARY KEY, checksum text);
      INSERT INTO public._prisma_migrations VALUES ('synthetic-migration','synthetic-checksum');`);
      await source.query("INSERT INTO public.profiles VALUES ($1,'synthetic learner record')", [
        user,
      ]);
      const capture = path.join(directory, "capture");
      await mkdir(capture);
      const container = process.env.BACKUP_TEST_CONTAINER;
      const dump = async (command, args, options) => {
        if (!container) return execute(command, args, options);
        return execute(
          "docker",
          [
            "exec",
            "-e",
            `PGDATABASE=${options.env.PGDATABASE}`,
            "-e",
            "PGHOST=127.0.0.1",
            "-e",
            "PGPORT=5432",
            "-e",
            `PGUSER=${options.env.PGUSER}`,
            "-e",
            `PGPASSWORD=${options.env.PGPASSWORD}`,
            "-e",
            `PGOPTIONS=${options.env.PGOPTIONS}`,
            container,
            command,
            ...args,
          ],
          options,
        );
      };
      const manifest = await captureDatabase(connection(sourceName), capture, {
        local: true,
        run: dump,
      });
      assert.equal(manifest.tables.length, 2);
      const accounts = JSON.parse(await readFile(path.join(capture, "auth-accounts.json"), "utf8"));
      assert.equal(accounts.users[0].id, user);
      assert.ok(!JSON.stringify(accounts).includes("do-not-archive-token"));
      assert.ok(!("generated_email" in accounts.users[0]));
      const age = process.env.BACKUP_TEST_AGE;
      const keygen = process.env.BACKUP_TEST_AGE_KEYGEN;
      assert.ok(age && keygen, "age fixture tools are required");
      const identity = path.join(directory, "identity");
      const wrongIdentity = path.join(directory, "wrong-identity");
      await execute(keygen, ["-o", identity]);
      await execute(keygen, ["-o", wrongIdentity]);
      const { stdout: recipient } = await execute(keygen, ["-y", identity]);
      const archive = path.join(directory, "snapshot.tar.gz");
      const encrypted = `${archive}.age`;
      await execute("tar", ["-czf", archive, "-C", capture, "."]);
      await execute(age, ["-r", recipient.trim(), "-o", encrypted, archive]);
      await rm(capture, { recursive: true });
      await rm(archive);
      await assert.rejects(execute(age, ["-d", "-i", wrongIdentity, "-o", archive, encrypted]));
      await execute(age, ["-d", "-i", identity, "-o", archive, encrypted]);
      const corrupted = Buffer.from(await readFile(encrypted));
      corrupted[corrupted.length - 1] ^= 1;
      const corruptedPath = path.join(directory, "corrupt.age");
      await writeFile(corruptedPath, corrupted);
      await assert.rejects(
        execute(age, [
          "-d",
          "-i",
          identity,
          "-o",
          path.join(directory, "bad.tar.gz"),
          corruptedPath,
        ]),
      );
      await mkdir(capture);
      await execute("tar", ["-xzf", archive, "-C", capture]);
      for (const table of ["users", "identities"]) {
        for (const row of accounts[table]) {
          const fields = Object.keys(row);
          await target.query(
            `INSERT INTO auth.${table}(${fields.map((field) => `"${field}"`).join(",")}) VALUES (${fields.map((_, index) => `$${index + 1}`).join(",")})`,
            Object.values(row),
          );
        }
      }
      const args = [
        "--exit-on-error",
        "--single-transaction",
        `--dbname=${connection(targetName)}`,
      ];
      if (container) args[2] = `--dbname=${connection(targetName).replace(":54322/", ":5432/")}`;
      const command = container ? "docker" : "pg_restore";
      const commandArgs = container ? ["exec", "-i", container, "pg_restore", ...args] : args;
      const dumpBytes = await readFile(path.join(capture, "public.dump"));
      await target.query("DROP SCHEMA public");
      await new Promise((resolve, reject) => {
        const child = spawn(command, commandArgs, { stdio: ["pipe", "ignore", "ignore"] });
        child.on("error", reject);
        child.on("exit", (code) =>
          code === 0 ? resolve() : reject(new Error("Synthetic restore failed")),
        );
        child.stdin.end(dumpBytes);
      });
      const restored = path.join(directory, "restored");
      await mkdir(restored);
      const restoredManifest = await captureDatabase(connection(targetName), restored, {
        local: true,
        run: dump,
      });
      assert.deepEqual(restoredManifest.tables, manifest.tables);
      assert.equal(
        (await target.query("SELECT user_id FROM auth.identities")).rows[0].user_id,
        user,
      );
      await source.query("UPDATE auth.users SET encrypted_password='synthetic-hash'");
      await assert.rejects(
        captureDatabase(connection(sourceName), restored, { local: true, run: dump }),
        /scope needs review/,
      );
    } finally {
      await Promise.all(clients.map((client) => client.end()));
      await admin.query(`DROP DATABASE IF EXISTS ${sourceName}`);
      await admin.query(`DROP DATABASE IF EXISTS ${targetName}`);
      await admin.end();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
