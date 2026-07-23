import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  onSnapshot,
  writeBatch,
  query,
  orderBy
} from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";
import { Task, NorthStar } from "../types";

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firestore (handle custom database ID if present)
const config = firebaseConfig as any;
export const db = config.firestoreDatabaseId
  ? getFirestore(app, config.firestoreDatabaseId)
  : getFirestore(app);

// Collection References
const TASKS_COLL = "tasks";
const SETTINGS_COLL = "settings";
const NORTH_STAR_DOC = "north_star";

/**
 * Syncs the tasks list in real-time from Firestore.
 * Fallback to local state if offline or during loading.
 */
export function subscribeTasks(onUpdate: (tasks: Task[]) => void, onError: (err: any) => void) {
  const q = query(collection(db, TASKS_COLL), orderBy("createdAt", "desc"));
  return onSnapshot(
    q,
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
          isMustDo: data.isMustDo !== undefined && data.isMustDo !== null ? data.isMustDo : undefined,
          isNiceToDo: data.isNiceToDo !== undefined && data.isNiceToDo !== null ? data.isNiceToDo : undefined,
          createdAt: data.createdAt || new Date().toISOString(),
          tags: data.tags || []
        });
      });
      onUpdate(tasksList);
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
      isMustDo: task.isMustDo !== undefined ? task.isMustDo : null,
      isNiceToDo: task.isNiceToDo !== undefined ? task.isNiceToDo : null,
      createdAt: task.createdAt,
      tags: task.tags || []
    }, { merge: true });
  } catch (error) {
    console.error("Error saving task to Firestore:", error);
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
  }
}

/**
 * Syncs the Email Filters (ignored senders, domains, and specific emails) in real-time from Firestore.
 */
export function subscribeEmailFilters(
  onUpdate: (filters: { ignoredSenders: string[]; ignoredDomains: string[]; ignoredEmails: string[] }) => void,
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
        });
      } else {
        onUpdate({ ignoredSenders: [], ignoredDomains: [], ignoredEmails: [] });
      }
    },
    (err) => {
      console.error("Firestore Email Filters subscription error:", err);
      onError(err);
    }
  );
}

/**
 * Saves or updates Email Filters in Firestore.
 */
export async function saveEmailFiltersToDb(filters: { ignoredSenders: string[]; ignoredDomains: string[]; ignoredEmails: string[] }) {
  try {
    const filtersDocRef = doc(db, SETTINGS_COLL, "email_filters");
    await setDoc(filtersDocRef, {
      ignoredSenders: filters.ignoredSenders,
      ignoredDomains: filters.ignoredDomains,
      ignoredEmails: filters.ignoredEmails
    });
  } catch (error) {
    console.error("Error saving Email Filters to Firestore:", error);
  }
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

    const nsSnap = await doc(db, SETTINGS_COLL, NORTH_STAR_DOC);
    const nsDoc = await setDoc(nsSnap, {
      title: initialNorthStar.title,
      description: initialNorthStar.description
    }, { merge: true });

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

let isSigningIn = false;
let cachedAccessToken: string | null = safeSessionStorage.getItem("google_access_token");

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
    safeSessionStorage.setItem("google_access_token", cachedAccessToken);
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
      safeSessionStorage.setItem("google_access_token", cachedAccessToken);
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
    safeSessionStorage.setItem("google_access_token", accessToken);
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
  safeSessionStorage.removeItem("gis_access_token");
  safeSessionStorage.removeItem("gis_user");
};
