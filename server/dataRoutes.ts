import { Router } from "express";
import type { Response } from "express";
import type { Storage, FilterEntries, SettingsKey } from "./storage";
import type { AuthedRequest } from "./auth";
import type { Task } from "../src/types";

// JSON API backing src/lib/api.ts. Mounted at /api/data behind requireUser.
// Contract notes the client relies on:
// - GET /state returns emailFilters: null when never written (client `exists` flag)
// - PUT /tasks/:id is a whole-object replace, so every Task field round-trips
// - POST /email-filters is atomic under concurrent writers
export function createDataRouter(storage: Storage): Router {
  const router = Router();

  const fail = (res: Response, err: any, msg: string) => {
    console.error(msg, err);
    res.status(500).json({ error: msg });
  };

  router.get("/state", async (req: AuthedRequest, res) => {
    try {
      res.json(await storage.getState(req.userEmail!));
    } catch (err) {
      fail(res, err, "Failed to load state.");
    }
  });

  router.put("/tasks/:id", async (req: AuthedRequest, res) => {
    try {
      const task = req.body as Task;
      if (!task || typeof task !== "object" || !task.id || typeof task.title !== "string") {
        return res.status(400).json({ error: "Invalid task payload." });
      }
      if (task.id !== req.params.id) {
        return res.status(400).json({ error: "Task id does not match URL." });
      }
      await storage.upsertTask(req.userEmail!, task);
      res.json({ ok: true });
    } catch (err) {
      fail(res, err, "Failed to save task.");
    }
  });

  router.delete("/tasks/:id", async (req: AuthedRequest, res) => {
    try {
      await storage.deleteTask(req.userEmail!, req.params.id);
      res.json({ ok: true });
    } catch (err) {
      fail(res, err, "Failed to delete task.");
    }
  });

  router.post("/tasks/bulk", async (req: AuthedRequest, res) => {
    try {
      const { tasks, onlyIfEmpty } = req.body || {};
      if (!Array.isArray(tasks) || tasks.some((t: any) => !t || typeof t !== "object" || !t.id)) {
        return res.status(400).json({ error: "Invalid tasks payload." });
      }
      const result = await storage.bulkUpsertTasks(req.userEmail!, tasks as Task[], !!onlyIfEmpty);
      res.json(result);
    } catch (err) {
      fail(res, err, "Failed to bulk-save tasks.");
    }
  });

  router.put("/settings/north_star", async (req: AuthedRequest, res) => {
    try {
      const ns = req.body || {};
      if (typeof ns.title !== "string" || typeof ns.description !== "string") {
        return res.status(400).json({ error: "Invalid North Star payload." });
      }
      const ifAbsent = req.query.ifAbsent === "1";
      await storage.putSetting(req.userEmail!, "north_star", {
        title: ns.title,
        description: ns.description,
        history: Array.isArray(ns.history) ? ns.history : []
      }, ifAbsent);
      res.json({ ok: true });
    } catch (err) {
      fail(res, err, "Failed to save North Star.");
    }
  });

  router.patch("/settings/briefing", async (req: AuthedRequest, res) => {
    try {
      const patch: Record<string, any> = {};
      if (typeof req.body?.autoSend === "boolean") patch.autoSend = req.body.autoSend;
      if (typeof req.body?.lastSentDate === "string") patch.lastSentDate = req.body.lastSentDate;
      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: "No valid briefing fields provided." });
      }
      await storage.mergeSetting(req.userEmail!, "briefing" as SettingsKey, patch);
      res.json({ ok: true });
    } catch (err) {
      fail(res, err, "Failed to save briefing settings.");
    }
  });

  router.post("/email-filters", async (req: AuthedRequest, res) => {
    try {
      const sanitize = (e: any): FilterEntries => ({
        senders: Array.isArray(e?.senders) ? e.senders.filter((s: any) => typeof s === "string") : undefined,
        domains: Array.isArray(e?.domains) ? e.domains.filter((s: any) => typeof s === "string") : undefined,
        emails: Array.isArray(e?.emails) ? e.emails.filter((s: any) => typeof s === "string") : undefined
      });
      const filters = await storage.updateEmailFilters(
        req.userEmail!,
        sanitize(req.body?.add),
        sanitize(req.body?.remove)
      );
      res.json({ ok: true, filters });
    } catch (err) {
      fail(res, err, "Failed to update email filters.");
    }
  });

  // --- Agent reports (written by background agents via AGENT_API_TOKEN) ---

  router.post("/agent-reports", async (req: AuthedRequest, res) => {
    try {
      const { kind, title, content, reportDate, data } = req.body || {};
      if (typeof kind !== "string" || !kind.trim() || typeof title !== "string" || !title.trim() || typeof content !== "string" || !content.trim()) {
        return res.status(400).json({ error: "kind, title and content are required." });
      }
      const report = await storage.insertAgentReport(req.userEmail!, {
        kind: kind.trim(),
        title: title.trim(),
        content,
        reportDate: typeof reportDate === "string" ? reportDate : undefined,
        data: data && typeof data === "object" ? data : undefined
      });
      res.json({ ok: true, id: report.id });
    } catch (err) {
      fail(res, err, "Failed to save agent report.");
    }
  });

  router.get("/agent-reports", async (req: AuthedRequest, res) => {
    try {
      const kind = typeof req.query.kind === "string" && req.query.kind ? req.query.kind : undefined;
      const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
      res.json({ reports: await storage.listAgentReports(req.userEmail!, kind, limit) });
    } catch (err) {
      fail(res, err, "Failed to list agent reports.");
    }
  });

  router.post("/agent-reports/:id/read", async (req: AuthedRequest, res) => {
    try {
      await storage.markAgentReportRead(req.userEmail!, req.params.id);
      res.json({ ok: true });
    } catch (err) {
      fail(res, err, "Failed to mark report read.");
    }
  });

  router.post("/clear", async (req: AuthedRequest, res) => {
    try {
      await storage.clearAll(req.userEmail!);
      res.json({ ok: true });
    } catch (err) {
      fail(res, err, "Failed to clear data.");
    }
  });

  return router;
}
