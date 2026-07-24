import fs from "fs";
import path from "path";
import { Pool } from "pg";
import crypto from "crypto";
import type { Task, NorthStar, AgentReport } from "../src/types";

export type EmailFilters = {
  ignoredSenders: string[];
  ignoredDomains: string[];
  ignoredEmails: string[];
};

export type FilterEntries = {
  senders?: string[];
  domains?: string[];
  emails?: string[];
};

export type BriefingSettings = {
  autoSend?: boolean;
  lastSentDate?: string;
};

export type SettingsKey = "north_star" | "email_filters" | "briefing";

export interface AppState {
  tasks: Task[];
  northStar: NorthStar | null;       // null = never written
  emailFilters: EmailFilters | null; // null = never written (client `exists` flag)
  briefing: BriefingSettings | null;
  latestReports: AgentReport[];      // newest report per agent kind
}

export type NewAgentReport = {
  kind: string;
  title: string;
  content: string;
  reportDate?: string;
  data?: Record<string, any>;
};

// Keep this many reports per kind per user; older ones are pruned on insert.
export const REPORTS_KEPT_PER_KIND = 30;

export interface Storage {
  init(): Promise<void>;
  getState(user: string): Promise<AppState>;
  upsertTask(user: string, task: Task): Promise<void>;
  bulkUpsertTasks(user: string, tasks: Task[], onlyIfEmpty: boolean): Promise<{ migrated: boolean; count: number }>;
  deleteTask(user: string, id: string): Promise<void>;
  putSetting(user: string, key: SettingsKey, data: any, ifAbsent?: boolean): Promise<void>;
  mergeSetting(user: string, key: SettingsKey, patch: any): Promise<void>;
  updateEmailFilters(user: string, add: FilterEntries, remove: FilterEntries): Promise<EmailFilters>;
  insertAgentReport(user: string, report: NewAgentReport): Promise<AgentReport>;
  listAgentReports(user: string, kind: string | undefined, limit: number): Promise<AgentReport[]>;
  markAgentReportRead(user: string, id: string): Promise<void>;
  clearAll(user: string): Promise<void>;
}

function buildAgentReport(report: NewAgentReport): AgentReport {
  return {
    id: `report-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
    kind: report.kind,
    reportDate: report.reportDate || undefined,
    title: report.title,
    content: report.content,
    data: report.data || undefined,
    read: false,
    createdAt: new Date().toISOString()
  };
}

function latestPerKind(reports: AgentReport[]): AgentReport[] {
  const byKind = new Map<string, AgentReport>();
  for (const r of reports) {
    const existing = byKind.get(r.kind);
    if (!existing || (r.createdAt || "") > (existing.createdAt || "")) {
      byKind.set(r.kind, r);
    }
  }
  return Array.from(byKind.values()).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

const EMPTY_FILTERS: EmailFilters = { ignoredSenders: [], ignoredDomains: [], ignoredEmails: [] };

// Dedup-union `add` into `existing`, then drop `remove` — shared by both
// backends so the ignore-filter atomicity invariant behaves identically.
function applyFilterEntries(existing: EmailFilters | null, add: FilterEntries, remove: FilterEntries): EmailFilters {
  const merge = (current: string[] | undefined, plus?: string[], minus?: string[]) => {
    const set = new Set((current || []).filter((v) => typeof v === "string" && v !== ""));
    (plus || []).forEach((v) => { if (typeof v === "string" && v !== "") set.add(v); });
    (minus || []).forEach((v) => set.delete(v));
    return Array.from(set);
  };
  const base = existing || EMPTY_FILTERS;
  return {
    ignoredSenders: merge(base.ignoredSenders, add.senders, remove.senders),
    ignoredDomains: merge(base.ignoredDomains, add.domains, remove.domains),
    ignoredEmails: merge(base.ignoredEmails, add.emails, remove.emails)
  };
}

// ---------------------------------------------------------------------------
// PostgreSQL backend (Replit managed database / any DATABASE_URL)
// ---------------------------------------------------------------------------

class PgStorage implements Storage {
  private pool: Pool;

  constructor(databaseUrl: string) {
    const isLocal = /localhost|127\.0\.0\.1/.test(databaseUrl);
    this.pool = new Pool({
      connectionString: databaseUrl,
      // Replit's database (Neon) requires TLS; node-postgres does not fully
      // honor sslmode in the URL, so configure it explicitly.
      ssl: isLocal ? undefined : { rejectUnauthorized: false }
    });
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        user_email TEXT NOT NULL,
        id         TEXT NOT NULL,
        data       JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_email, id)
      );
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS settings (
        user_email TEXT NOT NULL,
        key        TEXT NOT NULL,
        data       JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_email, key)
      );
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS agent_reports (
        user_email TEXT NOT NULL,
        id         TEXT NOT NULL,
        data       JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_email, id)
      );
    `);
  }

  async getState(user: string): Promise<AppState> {
    // No ORDER BY on purpose: legacy tasks may lack createdAt and the client
    // sorts by createdAt desc itself.
    const [tasksRes, settingsRes, reportsRes] = await Promise.all([
      this.pool.query("SELECT data FROM tasks WHERE user_email = $1", [user]),
      this.pool.query("SELECT key, data FROM settings WHERE user_email = $1", [user]),
      this.pool.query("SELECT data FROM agent_reports WHERE user_email = $1", [user])
    ]);
    const settings = new Map<string, any>(settingsRes.rows.map((r) => [r.key, r.data]));
    return {
      tasks: tasksRes.rows.map((r) => r.data as Task),
      northStar: settings.get("north_star") ?? null,
      emailFilters: settings.get("email_filters") ?? null,
      briefing: settings.get("briefing") ?? null,
      latestReports: latestPerKind(reportsRes.rows.map((r) => r.data as AgentReport))
    };
  }

  async upsertTask(user: string, task: Task): Promise<void> {
    await this.pool.query(
      `INSERT INTO tasks (user_email, id, data) VALUES ($1, $2, $3)
       ON CONFLICT (user_email, id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [user, task.id, task]
    );
  }

  async bulkUpsertTasks(user: string, tasks: Task[], onlyIfEmpty: boolean): Promise<{ migrated: boolean; count: number }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (onlyIfEmpty) {
        const existing = await client.query("SELECT count(*)::int AS n FROM tasks WHERE user_email = $1", [user]);
        if (existing.rows[0].n > 0) {
          await client.query("ROLLBACK");
          return { migrated: false, count: existing.rows[0].n };
        }
      }
      for (const task of tasks) {
        await client.query(
          `INSERT INTO tasks (user_email, id, data) VALUES ($1, $2, $3)
           ON CONFLICT (user_email, id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
          [user, task.id, task]
        );
      }
      await client.query("COMMIT");
      return { migrated: true, count: tasks.length };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async deleteTask(user: string, id: string): Promise<void> {
    await this.pool.query("DELETE FROM tasks WHERE user_email = $1 AND id = $2", [user, id]);
  }

  async putSetting(user: string, key: SettingsKey, data: any, ifAbsent = false): Promise<void> {
    if (ifAbsent) {
      await this.pool.query(
        `INSERT INTO settings (user_email, key, data) VALUES ($1, $2, $3)
         ON CONFLICT (user_email, key) DO NOTHING`,
        [user, key, data]
      );
    } else {
      await this.pool.query(
        `INSERT INTO settings (user_email, key, data) VALUES ($1, $2, $3)
         ON CONFLICT (user_email, key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        [user, key, data]
      );
    }
  }

  async mergeSetting(user: string, key: SettingsKey, patch: any): Promise<void> {
    await this.pool.query(
      `INSERT INTO settings (user_email, key, data) VALUES ($1, $2, $3)
       ON CONFLICT (user_email, key) DO UPDATE SET data = settings.data || EXCLUDED.data, updated_at = now()`,
      [user, key, patch]
    );
  }

  async updateEmailFilters(user: string, add: FilterEntries, remove: FilterEntries): Promise<EmailFilters> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO settings (user_email, key, data) VALUES ($1, 'email_filters', $2)
         ON CONFLICT (user_email, key) DO NOTHING`,
        [user, EMPTY_FILTERS]
      );
      const current = await client.query(
        "SELECT data FROM settings WHERE user_email = $1 AND key = 'email_filters' FOR UPDATE",
        [user]
      );
      const next = applyFilterEntries(current.rows[0]?.data ?? null, add, remove);
      await client.query(
        "UPDATE settings SET data = $2, updated_at = now() WHERE user_email = $1 AND key = 'email_filters'",
        [user, next]
      );
      await client.query("COMMIT");
      return next;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async insertAgentReport(user: string, report: NewAgentReport): Promise<AgentReport> {
    const full = buildAgentReport(report);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO agent_reports (user_email, id, data) VALUES ($1, $2, $3)",
        [user, full.id, full]
      );
      // Prune: keep only the newest REPORTS_KEPT_PER_KIND per kind
      await client.query(
        `DELETE FROM agent_reports WHERE user_email = $1 AND id IN (
           SELECT id FROM agent_reports
           WHERE user_email = $1 AND data->>'kind' = $2
           ORDER BY created_at DESC OFFSET $3
         )`,
        [user, full.kind, REPORTS_KEPT_PER_KIND]
      );
      await client.query("COMMIT");
      return full;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async listAgentReports(user: string, kind: string | undefined, limit: number): Promise<AgentReport[]> {
    const res = kind
      ? await this.pool.query(
          "SELECT data FROM agent_reports WHERE user_email = $1 AND data->>'kind' = $2 ORDER BY created_at DESC LIMIT $3",
          [user, kind, limit]
        )
      : await this.pool.query(
          "SELECT data FROM agent_reports WHERE user_email = $1 ORDER BY created_at DESC LIMIT $2",
          [user, limit]
        );
    return res.rows.map((r) => r.data as AgentReport);
  }

  async markAgentReportRead(user: string, id: string): Promise<void> {
    await this.pool.query(
      `UPDATE agent_reports SET data = data || '{"read": true}'::jsonb WHERE user_email = $1 AND id = $2`,
      [user, id]
    );
  }

  async clearAll(user: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM tasks WHERE user_email = $1", [user]);
      await client.query(
        `INSERT INTO settings (user_email, key, data) VALUES ($1, 'north_star', $2)
         ON CONFLICT (user_email, key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        [user, { title: "", description: "" }]
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
}

// ---------------------------------------------------------------------------
// JSON-file backend (sandbox dev / Replit workspace before a DB is attached)
// ---------------------------------------------------------------------------

type FileShape = {
  users: {
    [email: string]: {
      tasks: { [id: string]: Task };
      settings: { [key: string]: any };
      agentReports?: { [id: string]: AgentReport };
    };
  };
};

class FileStorage implements Storage {
  private filePath: string;
  private state: FileShape = { users: {} };
  // All mutations run through this chain, giving the same serialized
  // atomicity the pg transactions provide (single process).
  private queue: Promise<any> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private enqueue<T>(fn: () => Promise<T> | T): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => {});
    return next;
  }

  private userState(user: string) {
    if (!this.state.users[user]) {
      this.state.users[user] = { tasks: {}, settings: {} };
    }
    return this.state.users[user];
  }

  private async persist(): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.promises.mkdir(dir, { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(this.state));
    await fs.promises.rename(tmp, this.filePath);
  }

  async init(): Promise<void> {
    try {
      const raw = await fs.promises.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed.users) {
        this.state = parsed;
      }
    } catch {
      // First run: no file yet.
    }
    console.log(`Storage: using JSON file backend at ${this.filePath} (set DATABASE_URL for PostgreSQL).`);
  }

  async getState(user: string): Promise<AppState> {
    return this.enqueue(() => {
      const u = this.userState(user);
      return {
        tasks: Object.values(u.tasks),
        northStar: u.settings.north_star ?? null,
        emailFilters: u.settings.email_filters ?? null,
        briefing: u.settings.briefing ?? null,
        latestReports: latestPerKind(Object.values(u.agentReports || {}))
      };
    });
  }

  async upsertTask(user: string, task: Task): Promise<void> {
    return this.enqueue(async () => {
      this.userState(user).tasks[task.id] = task;
      await this.persist();
    });
  }

  async bulkUpsertTasks(user: string, tasks: Task[], onlyIfEmpty: boolean): Promise<{ migrated: boolean; count: number }> {
    return this.enqueue(async () => {
      const u = this.userState(user);
      const existingCount = Object.keys(u.tasks).length;
      if (onlyIfEmpty && existingCount > 0) {
        return { migrated: false, count: existingCount };
      }
      for (const task of tasks) {
        u.tasks[task.id] = task;
      }
      await this.persist();
      return { migrated: true, count: tasks.length };
    });
  }

  async deleteTask(user: string, id: string): Promise<void> {
    return this.enqueue(async () => {
      delete this.userState(user).tasks[id];
      await this.persist();
    });
  }

  async putSetting(user: string, key: SettingsKey, data: any, ifAbsent = false): Promise<void> {
    return this.enqueue(async () => {
      const u = this.userState(user);
      if (ifAbsent && u.settings[key] !== undefined) return;
      u.settings[key] = data;
      await this.persist();
    });
  }

  async mergeSetting(user: string, key: SettingsKey, patch: any): Promise<void> {
    return this.enqueue(async () => {
      const u = this.userState(user);
      u.settings[key] = { ...(u.settings[key] || {}), ...patch };
      await this.persist();
    });
  }

  async updateEmailFilters(user: string, add: FilterEntries, remove: FilterEntries): Promise<EmailFilters> {
    return this.enqueue(async () => {
      const u = this.userState(user);
      const next = applyFilterEntries(u.settings.email_filters ?? null, add, remove);
      u.settings.email_filters = next;
      await this.persist();
      return next;
    });
  }

  async insertAgentReport(user: string, report: NewAgentReport): Promise<AgentReport> {
    return this.enqueue(async () => {
      const u = this.userState(user);
      if (!u.agentReports) u.agentReports = {};
      const full = buildAgentReport(report);
      u.agentReports[full.id] = full;
      // Prune per kind
      const sameKind = Object.values(u.agentReports)
        .filter((r) => r.kind === full.kind)
        .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
      for (const stale of sameKind.slice(REPORTS_KEPT_PER_KIND)) {
        delete u.agentReports[stale.id];
      }
      await this.persist();
      return full;
    });
  }

  async listAgentReports(user: string, kind: string | undefined, limit: number): Promise<AgentReport[]> {
    return this.enqueue(() => {
      const u = this.userState(user);
      return Object.values(u.agentReports || {})
        .filter((r) => !kind || r.kind === kind)
        .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
        .slice(0, limit);
    });
  }

  async markAgentReportRead(user: string, id: string): Promise<void> {
    return this.enqueue(async () => {
      const u = this.userState(user);
      const report = u.agentReports?.[id];
      if (report) {
        report.read = true;
        await this.persist();
      }
    });
  }

  async clearAll(user: string): Promise<void> {
    return this.enqueue(async () => {
      const u = this.userState(user);
      u.tasks = {};
      u.settings.north_star = { title: "", description: "" };
      await this.persist();
    });
  }
}

export function createStorage(): Storage {
  if (process.env.DATABASE_URL) {
    return new PgStorage(process.env.DATABASE_URL);
  }
  return new FileStorage(process.env.DATA_FILE || path.join(process.cwd(), ".data", "actionman-store.json"));
}
