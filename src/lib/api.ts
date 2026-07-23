import type { Task, NorthStar } from "../types";

// Client data layer for the Action Man server API (/api/data/*), replacing
// the old Firestore module. Exports keep the same names/signatures so App.tsx
// call sites stay unchanged wherever possible.
//
// Sync model: one shared polling loop (POLL_INTERVAL_MS while the tab is
// visible, immediate refresh on focus/visibilitychange and after every
// successful write). Server state REPLACES local state — never union-merge
// (that pattern resurrected deleted tasks; see replit.md).

// --- Safe sessionStorage (iframe-restrictive browsers) ---
const safeSessionStorage = {
  getItem(key: string): string | null {
    try {
      return typeof window !== "undefined" ? sessionStorage.getItem(key) : null;
    } catch (e) {
      console.warn("sessionStorage.getItem failed (likely browser security/iframe settings):", e);
      return null;
    }
  },
  setItem(key: string, value: string): void {
    try {
      if (typeof window !== "undefined") {
        sessionStorage.setItem(key, value);
      }
    } catch (e) {
      console.warn("sessionStorage.setItem failed (likely browser security/iframe settings):", e);
    }
  },
  removeItem(key: string): void {
    try {
      if (typeof window !== "undefined") {
        sessionStorage.removeItem(key);
      }
    } catch (e) {
      console.warn("sessionStorage.removeItem failed (likely browser security/iframe settings):", e);
    }
  }
};

// --- Google OAuth token cache (tokens live ~1h; never restore a stale one) ---
const TOKEN_TTL_MS = 55 * 60 * 1000;

export const storeGoogleToken = (key: string, token: string): void => {
  safeSessionStorage.setItem(key, token);
  safeSessionStorage.setItem(`${key}_expiry`, String(Date.now() + TOKEN_TTL_MS));
  if (key === "gis_access_token") {
    authExpiredFired = false;
    refreshNow();
  }
};

export const readStoredGoogleToken = (key: string): string | null => {
  const token = safeSessionStorage.getItem(key);
  if (!token) return null;
  const expiry = Number(safeSessionStorage.getItem(`${key}_expiry`) || 0);
  if (!expiry || Date.now() >= expiry) {
    safeSessionStorage.removeItem(key);
    safeSessionStorage.removeItem(`${key}_expiry`);
    return null;
  }
  return token;
};

const clearStoredAuth = () => {
  ["gis_access_token", "gis_access_token_expiry", "gis_user", "google_access_token", "google_access_token_expiry"].forEach(
    (k) => safeSessionStorage.removeItem(k)
  );
};

// --- Auth-expiry notifications (401 anywhere → back to the login screen) ---
type AuthExpiredCallback = () => void;
const authExpiredCallbacks = new Set<AuthExpiredCallback>();
let authExpiredFired = false;

export function onAuthExpired(cb: AuthExpiredCallback): () => void {
  authExpiredCallbacks.add(cb);
  return () => authExpiredCallbacks.delete(cb);
}

function fireAuthExpired() {
  if (authExpiredFired) return;
  authExpiredFired = true;
  clearStoredAuth();
  authExpiredCallbacks.forEach((cb) => {
    try {
      cb();
    } catch (e) {
      console.error("onAuthExpired callback failed:", e);
    }
  });
}

// --- Authenticated fetch ---
async function apiFetch(path: string, init: RequestInit = {}): Promise<any> {
  const token = readStoredGoogleToken("gis_access_token");
  if (!token) {
    fireAuthExpiredIfSessionLooksStale();
    throw new Error("Not signed in.");
  }
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.headers || {})
    }
  });
  if (response.status === 401) {
    fireAuthExpired();
    throw new Error("Your Google session has expired. Please sign in again.");
  }
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      const data = await response.json();
      if (data?.error) message = data.error;
    } catch {}
    throw new Error(message);
  }
  return response.json();
}

// A stored user without a valid token means the session aged out while idle.
function fireAuthExpiredIfSessionLooksStale() {
  if (safeSessionStorage.getItem("gis_user") && !readStoredGoogleToken("gis_access_token")) {
    fireAuthExpired();
  }
}

// --- Shared polling engine ---
const POLL_INTERVAL_MS = 20000;

type EmailFilters = { ignoredSenders: string[]; ignoredDomains: string[]; ignoredEmails: string[] };
type BriefingSettings = { autoSend?: boolean; lastSentDate?: string };
type AppState = {
  tasks: Task[];
  northStar: NorthStar | null;
  emailFilters: EmailFilters | null;
  briefing: BriefingSettings | null;
};

type Subscriber<T extends any[]> = { onUpdate: (...args: T) => void; onError: (err: any) => void };

const subscribers = {
  tasks: new Set<Subscriber<[Task[], boolean]>>(),
  northStar: new Set<Subscriber<[NorthStar]>>(),
  emailFilters: new Set<Subscriber<[EmailFilters, boolean]>>(),
  briefing: new Set<Subscriber<[BriefingSettings]>>()
};

let pollTimer: ReturnType<typeof setInterval> | null = null;
let listenersAttached = false;
let tickInFlight = false;

// Write/poll race guard (replaces Firestore's latency compensation): drop any
// poll response that started before our newest completed write, or that
// raced a write still in flight — the UI must never see a snapshot older
// than its own last mutation.
const inflightMutations = new Set<Promise<any>>();
let lastMutationCompletedAt = 0;

function subscriberCount(): number {
  return subscribers.tasks.size + subscribers.northStar.size + subscribers.emailFilters.size + subscribers.briefing.size;
}

function dispatchState(state: AppState) {
  const sortedTasks = [...(state.tasks || [])].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  subscribers.tasks.forEach((s) => s.onUpdate(sortedTasks, false));
  if (state.northStar) {
    const ns = state.northStar;
    subscribers.northStar.forEach((s) =>
      s.onUpdate({ title: ns.title || "", description: ns.description || "", history: ns.history || [] })
    );
  }
  const filters = state.emailFilters;
  subscribers.emailFilters.forEach((s) =>
    s.onUpdate(
      filters
        ? {
            ignoredSenders: filters.ignoredSenders || [],
            ignoredDomains: filters.ignoredDomains || [],
            ignoredEmails: filters.ignoredEmails || []
          }
        : { ignoredSenders: [], ignoredDomains: [], ignoredEmails: [] },
      filters !== null && filters !== undefined
    )
  );
  if (state.briefing) {
    const briefing = state.briefing;
    subscribers.briefing.forEach((s) => s.onUpdate(briefing));
  }
}

function dispatchError(err: any) {
  subscribers.tasks.forEach((s) => s.onError(err));
  subscribers.northStar.forEach((s) => s.onError(err));
  subscribers.emailFilters.forEach((s) => s.onError(err));
  subscribers.briefing.forEach((s) => s.onError(err));
}

async function tick(force = false): Promise<void> {
  if (subscriberCount() === 0 || tickInFlight) return;
  if (!force && typeof document !== "undefined" && document.visibilityState === "hidden") return;

  const token = readStoredGoogleToken("gis_access_token");
  if (!token) {
    fireAuthExpiredIfSessionLooksStale();
    return;
  }

  tickInFlight = true;
  const startedAt = Date.now();
  try {
    const state: AppState = await apiFetch("/api/data/state");
    if (inflightMutations.size > 0 || startedAt < lastMutationCompletedAt) {
      return; // stale relative to our own writes; the post-write refresh replaces it
    }
    dispatchState(state);
  } catch (err) {
    if (!(err instanceof Error && err.message === "Not signed in.")) {
      console.error("State poll failed:", err);
      dispatchError(err);
    }
  } finally {
    tickInFlight = false;
  }
}

export function refreshNow(): void {
  void tick(true);
}

const handleVisibilityOrFocus = () => {
  if (typeof document === "undefined" || document.visibilityState === "visible") {
    void tick();
  }
};

function startPollingIfNeeded() {
  if (pollTimer || subscriberCount() === 0) return;
  pollTimer = setInterval(() => void tick(), POLL_INTERVAL_MS);
  if (!listenersAttached && typeof window !== "undefined") {
    document.addEventListener("visibilitychange", handleVisibilityOrFocus);
    window.addEventListener("focus", handleVisibilityOrFocus);
    listenersAttached = true;
  }
  void tick();
}

function stopPollingIfIdle() {
  if (subscriberCount() > 0 || !pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = null;
  if (listenersAttached && typeof window !== "undefined") {
    document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
    window.removeEventListener("focus", handleVisibilityOrFocus);
    listenersAttached = false;
  }
}

function makeSubscribe<T extends any[]>(set: Set<Subscriber<T>>) {
  return (onUpdate: (...args: T) => void, onError: (err: any) => void): (() => void) => {
    const sub = { onUpdate, onError };
    set.add(sub);
    startPollingIfNeeded();
    return () => {
      set.delete(sub);
      stopPollingIfIdle();
    };
  };
}

export const subscribeTasks = makeSubscribe(subscribers.tasks);
export const subscribeNorthStar = makeSubscribe(subscribers.northStar);
export const subscribeEmailFilters = makeSubscribe(subscribers.emailFilters);
export const subscribeBriefingSettings = makeSubscribe(subscribers.briefing);

// --- Mutations (all rethrow on failure so callers can set dbStatus "error") ---
async function mutate<T>(fn: () => Promise<T>): Promise<T> {
  const promise = fn();
  inflightMutations.add(promise);
  try {
    return await promise;
  } finally {
    inflightMutations.delete(promise);
    lastMutationCompletedAt = Date.now();
    refreshNow();
  }
}

export async function saveTaskToDb(task: Task): Promise<void> {
  try {
    await mutate(() =>
      apiFetch(`/api/data/tasks/${encodeURIComponent(task.id)}`, { method: "PUT", body: JSON.stringify(task) })
    );
  } catch (error) {
    console.error("Error saving task:", error);
    throw error;
  }
}

export async function deleteTaskFromDb(taskId: string): Promise<void> {
  try {
    await mutate(() => apiFetch(`/api/data/tasks/${encodeURIComponent(taskId)}`, { method: "DELETE" }));
  } catch (error) {
    console.error("Error deleting task:", error);
    throw error;
  }
}

/**
 * One-shot upload used by the legacy-local-data migration. The server-side
 * onlyIfEmpty guard makes this race-safe when two devices migrate at once.
 */
export async function bulkUploadTasks(tasks: Task[]): Promise<{ migrated: boolean; count: number }> {
  return mutate(() =>
    apiFetch("/api/data/tasks/bulk", { method: "POST", body: JSON.stringify({ tasks, onlyIfEmpty: true }) })
  );
}

export async function saveNorthStarToDb(ns: NorthStar): Promise<void> {
  try {
    await mutate(() =>
      apiFetch("/api/data/settings/north_star", {
        method: "PUT",
        body: JSON.stringify({ title: ns.title, description: ns.description, history: ns.history || [] })
      })
    );
  } catch (error) {
    console.error("Error saving North Star:", error);
    throw error;
  }
}

export async function saveBriefingSettingsToDb(settings: BriefingSettings): Promise<void> {
  await mutate(() =>
    apiFetch("/api/data/settings/briefing", { method: "PATCH", body: JSON.stringify(settings) })
  );
}

export async function addEmailFilterEntries(entries: { senders?: string[]; domains?: string[]; emails?: string[] }): Promise<void> {
  await mutate(() => apiFetch("/api/data/email-filters", { method: "POST", body: JSON.stringify({ add: entries }) }));
}

export async function removeEmailFilterEntries(entries: { senders?: string[]; domains?: string[]; emails?: string[] }): Promise<void> {
  await mutate(() => apiFetch("/api/data/email-filters", { method: "POST", body: JSON.stringify({ remove: entries }) }));
}

/**
 * Union-writes all three lists (used for migrating locally-stored filters).
 * Interactive mutations use the add/remove helpers above.
 */
export async function saveEmailFiltersToDb(filters: EmailFilters): Promise<void> {
  try {
    await mutate(() =>
      apiFetch("/api/data/email-filters", {
        method: "POST",
        body: JSON.stringify({
          add: { senders: filters.ignoredSenders, domains: filters.ignoredDomains, emails: filters.ignoredEmails }
        })
      })
    );
  } catch (error) {
    console.error("Error saving Email Filters:", error);
    throw error;
  }
}

export async function seedInitialTasksIfEmpty(initialTasks: Task[], initialNorthStar: NorthStar): Promise<void> {
  try {
    if (initialTasks.length > 0) {
      await bulkUploadTasks(initialTasks);
    }
    if (initialNorthStar.title || initialNorthStar.description) {
      await mutate(() =>
        apiFetch("/api/data/settings/north_star?ifAbsent=1", {
          method: "PUT",
          body: JSON.stringify({
            title: initialNorthStar.title,
            description: initialNorthStar.description,
            history: initialNorthStar.history || []
          })
        })
      );
    }
  } catch (error) {
    console.error("Error seeding initial data:", error);
  }
}

/**
 * Resolves once every in-flight write has settled AND a fresh server state
 * has been fetched. Backs the manual "Re-Sync" button — it must only CONFIRM
 * sync state, never re-upload local task copies (that resurrected deletions).
 */
export async function flushPendingWrites(): Promise<void> {
  await Promise.allSettled([...inflightMutations]);
  const state: AppState = await apiFetch("/api/data/state");
  dispatchState(state);
}

export async function clearAllDataFromDb(): Promise<void> {
  try {
    await mutate(() => apiFetch("/api/data/clear", { method: "POST" }));
  } catch (error) {
    console.error("Error clearing all data:", error);
    throw error;
  }
}

export const logout = async () => {
  clearStoredAuth();
  authExpiredFired = false;
};
