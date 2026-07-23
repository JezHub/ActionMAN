import { initializeApp } from "firebase/app";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  setDoc,
  getDoc,
  deleteDoc,
  getDocs,
  onSnapshot,
  writeBatch,
  arrayUnion,
  arrayRemove,
  waitForPendingWrites
} from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";
import { Task, NorthStar } from "../types";

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firestore (handle custom database ID if present).
// Persistent local cache lets the SDK queue writes made while offline and
// replay them on reconnect, which is what keeps tasks from being lost.
const config = firebaseConfig as any;
const firestoreSettings = {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
};
export const db = config.firestoreDatabaseId
  ? initializeFirestore(app, firestoreSettings, config.firestoreDatabaseId)
  : initializeFirestore(app, firestoreSettings);

// Collection References
const TASKS_COLL = "tasks";
const SETTINGS_COLL = "settings";
const NORTH_STAR_DOC = "north_star";

/**
 * Syncs the tasks list in real-time from Firestore.
 * Fallback to local state if offline or during loading.
 */
export function subscribeTasks(
  onUpdate: (tasks: Task[], fromCache: boolean) => void,
  onError: (err: any) => void
) {
  // NOTE: no orderBy() here on purpose — Firestore silently excludes documents
  // that are missing the ordered field, which made legacy tasks without a
  // createdAt vanish from the app. We sort client-side instead.
  return onSnapshot(
    collection(db, TASKS_COLL),
    { includeMetadataChanges: true },
    (snapshot) => {
      const tasksList: Task[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        tasksList.push({
          id: docSnap.id,
          title: data.title || "",
          priority: data.priority || "medium",
          horizon: data.horizon || "today",
          category: data.category || "general",
          dropDeadDate: data.dropDeadDate || undefined,
          reasoning: data.reasoning || undefined,
          completed: !!data.completed,
          completedAt: data.completedAt || undefined,
          isMustDo: data.isMustDo !== undefined && data.isMustDo !== null ? data.isMustDo : undefined,
          isNiceToDo: data.isNiceToDo !== undefined && data.isNiceToDo !== null ? data.isNiceToDo : undefined,
          isForceCritical: data.isForceCritical !== undefined && data.isForceCritical !== null ? data.isForceCritical : undefined,
          createdAt: data.createdAt || "",
          tags: data.tags || []
        });
      });
      tasksList.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
      onUpdate(tasksList, snapshot.metadata.fromCache);
    },
    (err) => {
      console.error("Firestore tasks subscription error:", err);
      onError(err);
    }
  );
}

/**
 * Syncs the North Star in real-time from Firestore.
 */
export function subscribeNorthStar(onUpdate: (ns: NorthStar) => void, onError: (err: any) => void) {
  return onSnapshot(
    doc(db, SETTINGS_COLL, NORTH_STAR_DOC),
    (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        onUpdate({
          title: data.title || "",
          description: data.description || "",
          history: data.history || []
        });
      }
    },
    (err) => {
      console.error("Firestore North Star subscription error:", err);
      onError(err);
    }
  );
}

/**
 * Saves or updates a single task in Firestore.
 */
export async function saveTaskToDb(task: Task) {
  try {
    const taskDocRef = doc(db, TASKS_COLL, task.id);
    await setDoc(taskDocRef, {
      title: task.title,
      priority: task.priority,
      horizon: task.horizon,
      category: task.category,
      dropDeadDate: task.dropDeadDate || null,
      reasoning: task.reasoning || null,
      completed: task.completed,
      completedAt: task.completedAt || null,
      isMustDo: task.isMustDo !== undefined ? task.isMustDo : null,
      isNiceToDo: task.isNiceToDo !== undefined ? task.isNiceToDo : null,
      isForceCritical: task.isForceCritical !== undefined ? task.isForceCritical : null,
      createdAt: task.createdAt,
      tags: task.tags || []
    }, { merge: true });
  } catch (error) {
    console.error("Error saving task to Firestore:", error);
    throw error;
  }
}

/**
 * Deletes a task from Firestore.
 */
export async function deleteTaskFromDb(taskId: string) {
  try {
    const taskDocRef = doc(db, TASKS_COLL, taskId);
    await deleteDoc(taskDocRef);
  } catch (error) {
    console.error("Error deleting task from Firestore:", error);
    throw error;
  }
}

/**
 * Updates the North Star in Firestore.
 */
export async function saveNorthStarToDb(ns: NorthStar) {
  try {
    const nsDocRef = doc(db, SETTINGS_COLL, NORTH_STAR_DOC);
    await setDoc(nsDocRef, {
      title: ns.title,
      description: ns.description,
      history: ns.history || []
    });
  } catch (error) {
    console.error("Error saving North Star to Firestore:", error);
    throw error;
  }
}

/**
 * Syncs the Email Filters (ignored senders, domains, and specific emails) in real-time from Firestore.
 */
export function subscribeEmailFilters(
  onUpdate: (
    filters: { ignoredSenders: string[]; ignoredDomains: string[]; ignoredEmails: string[] },
    exists: boolean
  ) => void,
  onError: (err: any) => void
) {
  return onSnapshot(
    doc(db, SETTINGS_COLL, "email_filters"),
    (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        onUpdate({
          ignoredSenders: data.ignoredSenders || [],
          ignoredDomains: data.ignoredDomains || [],
          ignoredEmails: data.ignoredEmails || []
        }, true);
      } else {
        // Doc missing: report it without pretending the lists are empty, so the
        // caller can migrate any locally-stored filters up instead of wiping them.
        onUpdate({ ignoredSenders: [], ignoredDomains: [], ignoredEmails: [] }, false);
      }
    },
    (err) => {
      console.error("Firestore Email Filters subscription error:", err);
      onError(err);
    }
  );
}

/**
 * Full replacement of the Email Filters doc. Only for one-time migration of
 * locally-stored filters; interactive mutations must use the atomic
 * add/remove helpers below so concurrent devices never clobber each other.
 */
export async function saveEmailFiltersToDb(filters: { ignoredSenders: string[]; ignoredDomains: string[]; ignoredEmails: string[] }) {
  try {
    const payload: Record<string, any> = {};
    if (filters.ignoredSenders.length) payload.ignoredSenders = arrayUnion(...filters.ignoredSenders);
    if (filters.ignoredDomains.length) payload.ignoredDomains = arrayUnion(...filters.ignoredDomains);
    if (filters.ignoredEmails.length) payload.ignoredEmails = arrayUnion(...filters.ignoredEmails);
    if (Object.keys(payload).length === 0) return;
    await setDoc(doc(db, SETTINGS_COLL, "email_filters"), payload, { merge: true });
  } catch (error) {
    console.error("Error saving Email Filters to Firestore:", error);
    throw error;
  }
}

/**
 * Atomically adds ignore-filter entries (safe under concurrent writers).
 */
export async function addEmailFilterEntries(entries: { senders?: string[]; domains?: string[]; emails?: string[] }) {
  const payload: Record<string, any> = {};
  if (entries.senders && entries.senders.length) payload.ignoredSenders = arrayUnion(...entries.senders);
  if (entries.domains && entries.domains.length) payload.ignoredDomains = arrayUnion(...entries.domains);
  if (entries.emails && entries.emails.length) payload.ignoredEmails = arrayUnion(...entries.emails);
  if (Object.keys(payload).length === 0) return;
  await setDoc(doc(db, SETTINGS_COLL, "email_filters"), payload, { merge: true });
}

/**
 * Atomically removes ignore-filter entries (safe under concurrent writers).
 */
export async function removeEmailFilterEntries(entries: { senders?: string[]; domains?: string[]; emails?: string[] }) {
  const payload: Record<string, any> = {};
  if (entries.senders && entries.senders.length) payload.ignoredSenders = arrayRemove(...entries.senders);
  if (entries.domains && entries.domains.length) payload.ignoredDomains = arrayRemove(...entries.domains);
  if (entries.emails && entries.emails.length) payload.ignoredEmails = arrayRemove(...entries.emails);
  if (Object.keys(payload).length === 0) return;
  await setDoc(doc(db, SETTINGS_COLL, "email_filters"), payload, { merge: true });
}

/**
 * Syncs Morning Briefing settings (auto-send toggle + last-sent date) so a
 * briefing sent from one device is not re-sent by another the same day.
 */
export function subscribeBriefingSettings(
  onUpdate: (settings: { autoSend?: boolean; lastSentDate?: string }) => void,
  onError: (err: any) => void
) {
  return onSnapshot(
    doc(db, SETTINGS_COLL, "briefing"),
    (docSnap) => {
      if (docSnap.exists()) {
        onUpdate(docSnap.data() as { autoSend?: boolean; lastSentDate?: string });
      }
    },
    (err) => {
      console.error("Firestore Briefing settings subscription error:", err);
      onError(err);
    }
  );
}

export async function saveBriefingSettingsToDb(settings: { autoSend?: boolean; lastSentDate?: string }) {
  await setDoc(doc(db, SETTINGS_COLL, "briefing"), settings, { merge: true });
}

/**
 * Resolves once every locally-queued write has been acknowledged by the
 * server. Used by the manual "Re-Sync" button to CONFIRM sync state — it must
 * never re-upload local/backup task copies (that resurrected deleted tasks).
 */
export async function flushPendingWrites() {
  await waitForPendingWrites(db);
}

/**
 * Initial bulk seeding function. Only run if remote tasks are completely empty.
 */
export async function seedInitialTasksIfEmpty(initialTasks: Task[], initialNorthStar: NorthStar) {
  try {
    const querySnapshot = await getDocs(collection(db, TASKS_COLL));
    if (querySnapshot.empty) {
      console.log("Firestore is empty. Seeding initial tasks...");
      const batch = writeBatch(db);
      initialTasks.forEach((task) => {
        const docRef = doc(db, TASKS_COLL, task.id);
        batch.set(docRef, {
          title: task.title,
          priority: task.priority,
          horizon: task.horizon,
          category: task.category,
          dropDeadDate: task.dropDeadDate || null,
          reasoning: task.reasoning || null,
          completed: task.completed,
          createdAt: task.createdAt,
          tags: task.tags || []
        });
      });
      await batch.commit();
    }

    // Only seed the North Star when the doc does not exist yet — this used to
    // run unconditionally and blanked the user's North Star on every app load.
    const nsRef = doc(db, SETTINGS_COLL, NORTH_STAR_DOC);
    const nsSnap = await getDoc(nsRef);
    if (!nsSnap.exists()) {
      await setDoc(nsRef, {
        title: initialNorthStar.title,
        description: initialNorthStar.description
      }, { merge: true });
    }

  } catch (error) {
    console.error("Error seeding initial data to Firestore:", error);
  }
}

/**
 * Deletes all tasks and resets the North Star in Firestore.
 */
export async function clearAllDataFromDb() {
  try {
    const querySnapshot = await getDocs(collection(db, TASKS_COLL));
    const batch = writeBatch(db);
    querySnapshot.forEach((docSnap) => {
      batch.delete(docSnap.ref);
    });
    
    const nsSnap = doc(db, SETTINGS_COLL, NORTH_STAR_DOC);
    batch.set(nsSnap, {
      title: "",
      description: ""
    });
    
    await batch.commit();
  } catch (error) {
    console.error("Error clearing all data from Firestore:", error);
    throw error;
  }
}

// --- Authentication helpers for Google Workspace ---
import {
  getAuth,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
  signOut,
  signInWithCredential
} from "firebase/auth";

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

export const auth = getAuth(app);
const provider = new GoogleAuthProvider();
provider.addScope("https://www.googleapis.com/auth/gmail.readonly");
provider.addScope("https://www.googleapis.com/auth/gmail.send");

// Google OAuth access tokens live ~1 hour. Store an expiry alongside each
// cached token so a stale token is never restored as a "valid" session.
const TOKEN_TTL_MS = 55 * 60 * 1000;

export const storeGoogleToken = (key: string, token: string): void => {
  safeSessionStorage.setItem(key, token);
  safeSessionStorage.setItem(`${key}_expiry`, String(Date.now() + TOKEN_TTL_MS));
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

let isSigningIn = false;
let cachedAccessToken: string | null = readStoredGoogleToken("google_access_token");

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error("Failed to get access token from Firebase Auth");
    }

    cachedAccessToken = credential.accessToken;
    storeGoogleToken("google_access_token", cachedAccessToken);
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error("Sign in error:", error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const googleSignInRedirect = async (): Promise<void> => {
  isSigningIn = true;
  await signInWithRedirect(auth, provider);
};

export const checkRedirectResult = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    const result = await getRedirectResult(auth);
    if (result) {
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (!credential?.accessToken) {
        throw new Error("Failed to get access token from Google redirect result");
      }
      cachedAccessToken = credential.accessToken;
      storeGoogleToken("google_access_token", cachedAccessToken);
      return { user: result.user, accessToken: cachedAccessToken };
    }
    return null;
  } catch (error: any) {
    console.error("Redirect sign in error:", error);
    throw error;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const signInWithGoogleToken = async (accessToken: string): Promise<User> => {
  try {
    const credential = GoogleAuthProvider.credential(null, accessToken);
    const result = await signInWithCredential(auth, credential);
    cachedAccessToken = accessToken;
    storeGoogleToken("google_access_token", accessToken);
    return result.user;
  } catch (error) {
    console.error("signInWithGoogleToken failed:", error);
    throw error;
  }
};

export const logout = async () => {
  await signOut(auth);
  cachedAccessToken = null;
  safeSessionStorage.removeItem("google_access_token");
  safeSessionStorage.removeItem("google_access_token_expiry");
  safeSessionStorage.removeItem("gis_access_token");
  safeSessionStorage.removeItem("gis_access_token_expiry");
  safeSessionStorage.removeItem("gis_user");
};
