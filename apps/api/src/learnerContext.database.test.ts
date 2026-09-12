import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const databaseUrl = process.env.LEARNER_CONTEXT_TEST_DATABASE_URL;
const schema = `learner_context_test_${randomUUID().replaceAll("-", "")}`;
const userId = randomUUID();
const otherUserId = randomUUID();
const memoryId = randomUUID();
const sourceTypes = [
  "learner_goal_id",
  "teaching_preference_id",
  "attempt_id",
  "assistance_event_id",
  "attempt_summary_id",
  "conversation_summary_id",
] as const;
type SourceType = (typeof sourceTypes)[number];
type Sources = Record<SourceType, string>;

describe.skipIf(databaseUrl === undefined)("learner context database", () => {
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  let sources: Sources;
  let otherSources: Sources;

  beforeAll(async () => {
    await client.connect();
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    const migrations = new URL("../prisma/migrations/", import.meta.url);
    for (const directory of (await readdir(migrations, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name))) {
      await client.query(
        await readFile(new URL(`${directory.name}/migration.sql`, migrations), "utf8"),
      );
    }
  }, 30000);

  afterAll(async () => {
    try {
      await client.query("ROLLBACK");
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await client.end();
    }
  });

  async function createSources(owner: string, problemId: string): Promise<Sources> {
    const ids = Object.fromEntries(sourceTypes.map((type) => [type, randomUUID()])) as Sources;
    ids.attempt_summary_id = ids.attempt_id;
    await client.query(
      "INSERT INTO learner_goals (id, user_profile_id, target, updated_at) VALUES ($1, $2, 'Prepare for interviews', now())",
      [ids.learner_goal_id, owner],
    );
    await client.query(
      "INSERT INTO teaching_preferences (id, user_profile_id, preference, updated_at) VALUES ($1, $2, 'Ask one question at a time', now())",
      [ids.teaching_preference_id, owner],
    );
    await client.query(
      `INSERT INTO attempts (id, user_profile_id, problem_id, type, practice_date, started_at, confirmed_at, outcome)
       VALUES ($1, $2, $3, 'FRESH', '2026-09-11', now(), now(), 'ASSISTED')`,
      [ids.attempt_id, owner, problemId],
    );
    await client.query(
      "INSERT INTO assistance_events (id, attempt_id, type, source) VALUES ($1, $2, 'DEBUGGING', 'SELF_REPORTED')",
      [ids.assistance_event_id, ids.attempt_id],
    );
    await client.query(
      "INSERT INTO attempt_summaries (attempt_id, user_profile_id, approach, updated_at) VALUES ($1, $2, 'Tracked visited nodes', now())",
      [ids.attempt_id, owner],
    );
    await client.query(
      `INSERT INTO conversation_summaries (id, user_profile_id, mode, attempt_id, topics, updated_at)
       VALUES ($1, $2, 'ATTEMPT_TUTOR', $3, 'Distinguishing cycles from shared descendants', now())`,
      [ids.conversation_summary_id, owner, ids.attempt_id],
    );
    return ids;
  }

  beforeEach(async () => {
    await client.query("BEGIN");
    for (const id of [userId, otherUserId]) {
      await client.query(
        "INSERT INTO user_profiles (id, auth_subject, updated_at) VALUES ($1, $1, now())",
        [id],
      );
    }
    const problemId = randomUUID();
    await client.query(
      `INSERT INTO problems (id, leetcode_id, slug, title, difficulty, url, updated_at)
       VALUES ($1, 1, 'two-sum', 'Two Sum', 'EASY', 'https://leetcode.com/problems/two-sum/', now())`,
      [problemId],
    );
    sources = await createSources(userId, problemId);
    otherSources = await createSources(otherUserId, problemId);
    await client.query(
      `INSERT INTO learner_memories (id, user_profile_id, category, content, confidence, last_observed_at, updated_at)
       VALUES ($1, $2, 'Misconception', 'Confuses visited nodes with nodes in the current path', 0.7, now(), now())`,
      [memoryId, userId],
    );
  });

  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  async function link(type: SourceType, source: Sources = sources, owner = userId) {
    const assistanceAttempt = type === "assistance_event_id" ? source.attempt_id : null;
    return client.query(
      `INSERT INTO learner_memory_evidence (id, user_profile_id, memory_id, "${type}", assistance_attempt_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), owner, memoryId, source[type], assistanceAttempt],
    );
  }

  async function approve() {
    await client.query(
      "UPDATE learner_memories SET approval_state = 'APPROVED', reviewed_at = now() WHERE id = $1",
      [memoryId],
    );
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  }

  it.each(sourceTypes)("rejects another user's %s evidence", async (type) => {
    await expect(link(type, otherSources)).rejects.toMatchObject({ code: "23503" });
  });

  it("rejects using another owner to attach evidence to a memory", async () => {
    await expect(link("learner_goal_id", otherSources, otherUserId)).rejects.toMatchObject({
      code: "23503",
    });
  });

  it("checks the assistance event belongs to the claimed attempt", async () => {
    await expect(
      link("assistance_event_id", {
        ...sources,
        assistance_event_id: otherSources.assistance_event_id,
      }),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it.each(sourceTypes)(
    "returns approved memory to pending when its %s source is deleted",
    async (type) => {
      const remainingGoalId = randomUUID();
      await client.query(
        "INSERT INTO learner_goals (id, user_profile_id, target, updated_at) VALUES ($1, $2, 'Practice graphs', now())",
        [remainingGoalId, userId],
      );
      await link("learner_goal_id", { ...sources, learner_goal_id: remainingGoalId });
      await link(type);
      await approve();
      const tables: Record<SourceType, [string, string]> = {
        learner_goal_id: ["learner_goals", "id"],
        teaching_preference_id: ["teaching_preferences", "id"],
        attempt_id: ["attempts", "id"],
        assistance_event_id: ["assistance_events", "id"],
        attempt_summary_id: ["attempt_summaries", "attempt_id"],
        conversation_summary_id: ["conversation_summaries", "id"],
      };
      const [table, column] = tables[type];
      await client.query(`DELETE FROM "${table}" WHERE "${column}" = $1`, [sources[type]]);
      expect(
        (
          await client.query(
            "SELECT approval_state, reviewed_at, lifecycle_state, confidence FROM learner_memories WHERE id = $1",
            [memoryId],
          )
        ).rows,
      ).toEqual([
        {
          approval_state: "PENDING",
          reviewed_at: null,
          lifecycle_state: "ACTIVE",
          confidence: 0.7,
        },
      ]);
      expect(
        (
          await client.query(
            "SELECT learner_goal_id FROM learner_memory_evidence WHERE memory_id = $1",
            [memoryId],
          )
        ).rows,
      ).toEqual([{ learner_goal_id: remainingGoalId }]);
      await approve();
    },
  );

  it("invalidates a memory linked indirectly through a deleted attempt's summary", async () => {
    await link("attempt_summary_id");
    await link("conversation_summary_id");
    await link("assistance_event_id");
    await approve();
    await client.query("DELETE FROM attempts WHERE id = $1", [sources.attempt_id]);
    expect(
      (await client.query("SELECT approval_state FROM learner_memories WHERE id = $1", [memoryId]))
        .rows[0],
    ).toEqual({ approval_state: "PENDING" });
    expect(
      (await client.query("SELECT * FROM learner_memory_evidence WHERE memory_id = $1", [memoryId]))
        .rowCount,
    ).toBe(0);
    await expect(approve()).rejects.toMatchObject({ code: "23514" });
  });

  it("keeps rejected suggestions rejected when evidence is removed", async () => {
    await link("learner_goal_id");
    await client.query(
      "UPDATE learner_memories SET approval_state = 'REJECTED', reviewed_at = now() WHERE id = $1",
      [memoryId],
    );
    await client.query("DELETE FROM learner_goals WHERE id = $1", [sources.learner_goal_id]);
    expect(
      (await client.query("SELECT approval_state FROM learner_memories WHERE id = $1", [memoryId]))
        .rows[0],
    ).toEqual({ approval_state: "REJECTED" });
  });

  it("removes a deleted user's context without touching another user's declarations", async () => {
    await link("learner_goal_id");
    await approve();
    await client.query("DELETE FROM user_profiles WHERE id = $1", [userId]);
    for (const table of [
      "learner_goals",
      "teaching_preferences",
      "attempt_summaries",
      "conversation_summaries",
      "learner_memories",
      "learner_memory_evidence",
    ]) {
      expect(
        (await client.query(`SELECT * FROM "${table}" WHERE user_profile_id = $1`, [userId]))
          .rowCount,
      ).toBe(0);
    }
    expect(
      (await client.query("SELECT id FROM learner_goals WHERE user_profile_id = $1", [otherUserId]))
        .rowCount,
    ).toBe(1);
  });

  it("rejects evidence with no source", async () => {
    await expect(
      client.query(
        "INSERT INTO learner_memory_evidence (id, user_profile_id, memory_id) VALUES ($1, $2, $3)",
        [randomUUID(), userId, memoryId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects evidence with two sources", async () => {
    await expect(
      client.query(
        "INSERT INTO learner_memory_evidence (id, user_profile_id, memory_id, learner_goal_id, attempt_id) VALUES ($1, $2, $3, $4, $5)",
        [randomUUID(), userId, memoryId, sources.learner_goal_id, sources.attempt_id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("requires review time for approved memories", async () => {
    await expect(
      client.query("UPDATE learner_memories SET approval_state = 'APPROVED' WHERE id = $1", [
        memoryId,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("requires evidence for approval", async () => {
    await expect(approve()).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects unbounded confidence", async () => {
    await expect(
      client.query("UPDATE learner_memories SET confidence = 1.1 WHERE id = $1", [memoryId]),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("requires a tutoring summary's attempt to belong to the same user", async () => {
    await expect(
      client.query("UPDATE conversation_summaries SET attempt_id = $1 WHERE id = $2", [
        otherSources.attempt_id,
        sources.conversation_summary_id,
      ]),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("requires the attempt summary to belong to the attempt's user", async () => {
    await expect(
      client.query("UPDATE attempt_summaries SET user_profile_id = $1 WHERE attempt_id = $2", [
        otherUserId,
        sources.attempt_id,
      ]),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("requires an attempt for tutoring and none for coaching", async () => {
    await client.query(
      "UPDATE conversation_summaries SET mode = 'COACH', attempt_id = NULL WHERE id = $1",
      [sources.conversation_summary_id],
    );
    await expect(
      client.query("UPDATE conversation_summaries SET mode = 'ATTEMPT_TUTOR' WHERE id = $1", [
        sources.conversation_summary_id,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("enables row-level security on every new table", async () => {
    const tables = await client.query(
      "SELECT relname, relrowsecurity FROM pg_class WHERE relnamespace = $1::regnamespace AND relkind = 'r' AND relname = ANY($2)",
      [
        schema,
        [
          "learner_goals",
          "teaching_preferences",
          "attempt_summaries",
          "conversation_summaries",
          "learner_memories",
          "learner_memory_evidence",
        ],
      ],
    );
    expect(tables.rowCount).toBe(6);
    expect(tables.rows.every((table) => table.relrowsecurity === true)).toBe(true);
  });
});
