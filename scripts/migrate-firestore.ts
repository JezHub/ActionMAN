/**
 * One-shot migration: copies tasks + settings from the old Firestore database
 * (the AI Studio deployment) into this app's storage (Replit PostgreSQL when
 * DATABASE_URL is set, otherwise the local JSON file).
 *
 * Usage (Replit shell, after attaching the database):
 *   npx tsx scripts/migrate-firestore.ts
 *
 * Options via env:
 *   MIGRATE_TO_EMAIL  target user for the rows (default jez@smileathon.com)
 *   MIGRATE_FORCE=1   import tasks even if the target user already has some
 *
 * Reads Firestore through its public REST API — the old project's rules are
 * `allow read: if true`, so only the web apiKey is needed. Safe to re-run:
 * task import is skipped when the target already has tasks (unless forced),
 * and settings are only written when absent.
 */
import { createStorage } from "../server/storage";
import type { Task } from "../src/types";

// Defaults come from the old committed firebase-applet-config.json. NOTE:
// probing (2026-07-23) showed project gen-lang-client-0748201330 has NO
// Firestore database — the deployed AI Studio applet likely injected a
// different config at build time. If this script reports NOT_FOUND, either:
//  (a) recover the real values from the running AI Studio app (View Source /
//      devtools → search the JS bundle for "projectId" and
//      "firestoreDatabaseId") and pass them via the env vars below, or
//  (b) skip Firestore entirely and use the localStorage hand-off described
//      in replit.md ("Carrying data over from the old app") — if Firestore
//      never worked, the browser copy IS the authoritative data.
const FIRESTORE_PROJECT_ID = process.env.FIRESTORE_PROJECT_ID || "gen-lang-client-0748201330";
const FIRESTORE_DB_ID = process.env.FIRESTORE_DB_ID || "(default)";
const FIRESTORE_API_KEY = process.env.FIRESTORE_API_KEY || "AIzaSyDwDknwlV8Q2okSc4NrtuGxRJMjxKoB1Ig";
const BASE_URL = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/${FIRESTORE_DB_ID}/documents`;

// Firestore REST returns typed values ({stringValue: "x"} etc.) — unwrap them.
function fromFirestoreValue(value: any): any {
  if (value === null || typeof value !== "object") return value;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("nullValue" in value) return null;
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(fromFirestoreValue);
  if ("mapValue" in value) return fromFirestoreFields(value.mapValue.fields || {});
  return null;
}

function fromFirestoreFields(fields: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(fields || {})) {
    out[key] = fromFirestoreValue(value);
  }
  return out;
}

async function fetchCollection(name: string): Promise<Array<{ id: string; data: Record<string, any> }>> {
  const docs: Array<{ id: string; data: Record<string, any> }> = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`${BASE_URL}/${name}`);
    url.searchParams.set("key", FIRESTORE_API_KEY);
    url.searchParams.set("pageSize", "300");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Firestore read of '${name}' failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { documents?: any[]; nextPageToken?: string };
    for (const doc of body.documents || []) {
      const id = String(doc.name).split("/").pop()!;
      docs.push({ id, data: fromFirestoreFields(doc.fields) });
    }
    pageToken = body.nextPageToken;
  } while (pageToken);
  return docs;
}

function toTask(id: string, data: Record<string, any>): Task {
  const task: Record<string, any> = {
    id,
    title: data.title || "",
    priority: data.priority || "medium",
    horizon: data.horizon || "today",
    category: data.category || "general",
    completed: !!data.completed,
    createdAt: data.createdAt || "",
    tags: Array.isArray(data.tags) ? data.tags : []
  };
  // Optional fields: include only when meaningfully set (Firestore stored
  // explicit nulls; the app treats absence as unset).
  for (const key of ["dropDeadDate", "reasoning", "completedAt", "isMustDo", "isNiceToDo", "isForceCritical"]) {
    if (data[key] !== null && data[key] !== undefined && data[key] !== "") {
      task[key] = data[key];
    }
  }
  return task as Task;
}

async function main() {
  const targetEmail = (process.env.MIGRATE_TO_EMAIL || "jez@smileathon.com").trim().toLowerCase();
  const force = process.env.MIGRATE_FORCE === "1";
  console.log(`Migrating Firestore project ${FIRESTORE_PROJECT_ID} -> storage rows for ${targetEmail}`);
  console.log(process.env.DATABASE_URL ? "Target: PostgreSQL (DATABASE_URL)" : "Target: local JSON file (no DATABASE_URL set)");

  const storage = createStorage();
  await storage.init();

  const taskDocs = await fetchCollection("tasks");
  console.log(`Fetched ${taskDocs.length} task docs from Firestore.`);
  const tasks = taskDocs.map((d) => toTask(d.id, d.data));
  const result = await storage.bulkUpsertTasks(targetEmail, tasks, !force);
  console.log(
    result.migrated
      ? `Imported ${result.count} tasks.`
      : `SKIPPED task import: target already has ${result.count} tasks (set MIGRATE_FORCE=1 to overwrite/merge).`
  );

  const settingsDocs = await fetchCollection("settings");
  for (const doc of settingsDocs) {
    if (doc.id === "north_star") {
      await storage.putSetting(targetEmail, "north_star", {
        title: doc.data.title || "",
        description: doc.data.description || "",
        history: Array.isArray(doc.data.history) ? doc.data.history : []
      }, !force);
      console.log(`North Star: "${doc.data.title || "(empty)"}" ${force ? "written" : "written if absent"}.`);
    } else if (doc.id === "email_filters") {
      const filters = {
        senders: Array.isArray(doc.data.ignoredSenders) ? doc.data.ignoredSenders : [],
        domains: Array.isArray(doc.data.ignoredDomains) ? doc.data.ignoredDomains : [],
        emails: Array.isArray(doc.data.ignoredEmails) ? doc.data.ignoredEmails : []
      };
      await storage.updateEmailFilters(targetEmail, filters, {});
      console.log(`Email filters: +${filters.senders.length} senders, +${filters.domains.length} domains, +${filters.emails.length} emails (union).`);
    } else if (doc.id === "briefing") {
      const patch: Record<string, any> = {};
      if (typeof doc.data.autoSend === "boolean") patch.autoSend = doc.data.autoSend;
      if (typeof doc.data.lastSentDate === "string") patch.lastSentDate = doc.data.lastSentDate;
      if (Object.keys(patch).length) {
        await storage.mergeSetting(targetEmail, "briefing", patch);
        console.log("Briefing settings merged.");
      }
    }
  }

  console.log("Migration complete. Open the app and verify your tasks, then this script is done for good.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
