import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Brain,
  Target,
  Wrench,
  TrendingUp,
  User,
  Calendar,
  Flame,
  Sparkles,
  Plus,
  Trash2,
  Edit2,
  CheckCircle2,
  Circle,
  Play,
  ArrowRight,
  X,
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  LogOut,
  SlidersHorizontal,
  RefreshCw,
  HelpCircle,
  ArrowLeft,
  CalendarDays,
  PlusCircle,
  Briefcase,
  Database,
  Cloud,
  CloudOff,
  ChevronLeft,
  ChevronRight,
  Mail,
  Inbox,
  Send,
  History,
  AlertTriangle,
  ArrowDownCircle,
  Layers
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Task, NorthStar, DailyCoachFeedback } from "./types";

const INITIAL_NORTH_STAR: NorthStar = {
  title: "",
  description: "",
  history: []
};

const INITIAL_TASKS: Task[] = [];

// Safe Local and Session Storage Helpers to prevent crashing in iframe-restrictive browsers like Safari
const safeLocalStorage = {
  getItem(key: string): string | null {
    try {
      return typeof window !== "undefined" ? localStorage.getItem(key) : null;
    } catch (e) {
      console.warn("localStorage.getItem failed (likely browser security/iframe settings):", e);
      return null;
    }
  },
  setItem(key: string, value: string): void {
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem(key, value);
      }
    } catch (e) {
      console.warn("localStorage.setItem failed (likely browser security/iframe settings):", e);
    }
  },
  removeItem(key: string): void {
    try {
      if (typeof window !== "undefined") {
        localStorage.removeItem(key);
      }
    } catch (e) {
      console.warn("localStorage.removeItem failed (likely browser security/iframe settings):", e);
    }
  }
};

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


// Helper to auto-tag keywords client-side on manual entry
const detectTags = (title: string): string[] => {
  const t = title.toLowerCase();
  const tags: string[] = [];
  if (t.includes("rain ventures") || t.includes("rainventures")) {
    tags.push("Rain Ventures");
  } else if (t.includes("rainshift") || t.includes("rain shift")) {
    tags.push("RainShift");
  } else if (t.includes("rain")) {
    tags.push("Rain Ventures");
  }
  if (t.includes("human connection") || t.includes("humanconnection")) {
    tags.push("Human Connection Co");
  }
  return tags;
};

const calculateStringSimilarity = (s1: string, s2: string): number => {
  const clean1 = s1.trim().toLowerCase();
  const clean2 = s2.trim().toLowerCase();
  if (clean1 === clean2) return 1.0;
  if (!clean1 || !clean2) return 0.0;

  const m = clean1.length;
  const n = clean2.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (clean1[i - 1] === clean2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]) + 1;
      }
    }
  }

  const distance = dp[m][n];
  const maxLength = Math.max(m, n);
  const editDistanceSim = 1.0 - distance / maxLength;

  // Word set Jaccard similarity for order-independent check
  const words1 = clean1.split(/\s+/).filter((w) => w.length > 2);
  const words2 = clean2.split(/\s+/).filter((w) => w.length > 2);
  if (words1.length === 0 || words2.length === 0) {
    return editDistanceSim;
  }
  const set1 = new Set(words1);
  const set2 = new Set(words2);
  const intersection = new Set([...set1].filter((x) => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  const jaccardSim = intersection.size / union.size;

  return Math.max(editDistanceSim, jaccardSim);
};

export default function App() {
  // --- Google Authentication and Triage States (Declared at top to avoid hoisting issues) ---
  const [googleUser, setGoogleUser] = useState<any>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [isTriageLoading, setIsTriageLoading] = useState(false);
  const [triagedEmails, setTriagedEmails] = useState<any[]>([]);
  const [triageError, setTriageError] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginErrorDetails, setLoginErrorDetails] = useState<any>(null);
  const [showDebugDetails, setShowDebugDetails] = useState(false);
  const [copiedOrigin, setCopiedOrigin] = useState(false);

  const handleCopyOrigin = () => {
    if (typeof window !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(window.location.origin);
      setCopiedOrigin(true);
      setTimeout(() => setCopiedOrigin(false), 2500);
    }
  };

  // --- Email Ignore/Mute filters ---
  const [ignoredSenders, setIgnoredSenders] = useState<string[]>(() => {
    const saved = safeLocalStorage.getItem("ignored_senders");
    return saved ? JSON.parse(saved) : [];
  });
  const [ignoredDomains, setIgnoredDomains] = useState<string[]>(() => {
    const saved = safeLocalStorage.getItem("ignored_domains");
    return saved ? JSON.parse(saved) : [];
  });
  const [ignoredEmails, setIgnoredEmails] = useState<string[]>(() => {
    const saved = safeLocalStorage.getItem("ignored_emails");
    return saved ? JSON.parse(saved) : [];
  });
  const [showMutedSettings, setShowMutedSettings] = useState(false);

  // --- Persistent State ---
  const [tasks, setTasks] = useState<Task[]>(() => {
    const saved = safeLocalStorage.getItem("brain_dump_tasks");
    const backup = safeLocalStorage.getItem("brain_dump_tasks_backup");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (e) {}
    }
    if (backup) {
      try {
        const parsed = JSON.parse(backup);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (e) {}
    }
    return INITIAL_TASKS;
  });

  const [isReSyncing, setIsReSyncing] = useState(false);
  const [reSyncToast, setReSyncToast] = useState<string | null>(null);

  const [northStar, setNorthStar] = useState<NorthStar>(() => {
    const saved = safeLocalStorage.getItem("brain_dump_north_star");
    return saved ? JSON.parse(saved) : INITIAL_NORTH_STAR;
  });

  const [dbStatus, setDbStatus] = useState<"connecting" | "synced" | "offline" | "error">("connecting");
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const handleResetAllData = async () => {
    try {
      setTasks([]);
      setNorthStar({ title: "", description: "" });
      safeLocalStorage.removeItem("brain_dump_tasks");
      safeLocalStorage.removeItem("brain_dump_tasks_backup");
      safeLocalStorage.removeItem("brain_dump_north_star");
      
      if (dbStatus === "synced" || dbStatus === "connecting") {
        const { clearAllDataFromDb } = await import("./lib/firebase");
        await clearAllDataFromDb();
      }
      setShowResetConfirm(false);
    } catch (e) {
      console.error("Error resetting all data:", e);
    }
  };

  const handleReSyncAllData = async () => {
    setIsReSyncing(true);
    try {
      const { fetchAndSyncAllData } = await import("./lib/firebase");
      let currentLocal = tasks;
      if (currentLocal.length === 0) {
        const backup = safeLocalStorage.getItem("brain_dump_tasks_backup");
        if (backup) {
          try {
            const parsed = JSON.parse(backup);
            if (Array.isArray(parsed) && parsed.length > 0) {
              currentLocal = parsed;
            }
          } catch (e) {}
        }
      }
      const { tasks: syncedTasks, northStar: syncedNS } = await fetchAndSyncAllData(currentLocal, northStar);
      
      setTasks(syncedTasks);
      safeLocalStorage.setItem("brain_dump_tasks", JSON.stringify(syncedTasks));
      if (syncedTasks.length > 0) {
        safeLocalStorage.setItem("brain_dump_tasks_backup", JSON.stringify(syncedTasks));
      }

      if (syncedNS && (syncedNS.title || syncedNS.description)) {
        setNorthStar(syncedNS);
        safeLocalStorage.setItem("brain_dump_north_star", JSON.stringify(syncedNS));
      }

      setDbStatus("synced");
      setReSyncToast(`Data re-synced! ${syncedTasks.length} task${syncedTasks.length === 1 ? "" : "s"} active & restored.`);
      setTimeout(() => setReSyncToast(null), 4500);
    } catch (err: any) {
      console.error("Re-sync error:", err);
      setReSyncToast("Sync completed with local state.");
      setTimeout(() => setReSyncToast(null), 3000);
    } finally {
      setIsReSyncing(false);
    }
  };

  // Graceful connection status fallback if stuck in "connecting"
  useEffect(() => {
    if (dbStatus === "connecting") {
      const timer = setTimeout(() => {
        console.warn("Firestore connection check timed out. Defaulting connection indicator to offline/local.");
        setDbStatus("offline");
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [dbStatus]);

  useEffect(() => {
    let unsubscribeTasks: (() => void) | null = null;
    let unsubscribeNorthStar: (() => void) | null = null;
    let unsubscribeEmailFilters: (() => void) | null = null;

    async function initFirebase() {
      try {
        const { seedInitialTasksIfEmpty, subscribeTasks, subscribeNorthStar, subscribeEmailFilters } = await import("./lib/firebase");

        // Seed initial tasks if empty on firestore in background (non-blocking)
        seedInitialTasksIfEmpty(INITIAL_TASKS, INITIAL_NORTH_STAR).catch((err) => {
          console.error("Firebase subscription seeding error:", err);
        });

        // Subscribe to remote tasks
        unsubscribeTasks = subscribeTasks(
          (remoteTasks) => {
            if (remoteTasks && remoteTasks.length > 0) {
              setTasks((prev) => {
                const remoteIds = new Set(remoteTasks.map((rt) => rt.id));
                const localOnly = prev.filter((lt) => !remoteIds.has(lt.id));
                // Automatically upload any unsynced local tasks to Firestore
                if (localOnly.length > 0) {
                  import("./lib/firebase").then(({ saveTaskToDb }) => {
                    localOnly.forEach((lt) => saveTaskToDb(lt));
                  });
                }
                return [...remoteTasks, ...localOnly];
              });
            } else if (remoteTasks && remoteTasks.length === 0) {
              setTasks((prev) => {
                let tasksToUse = prev;
                if (tasksToUse.length === 0) {
                  const backup = safeLocalStorage.getItem("brain_dump_tasks_backup");
                  if (backup) {
                    try {
                      const parsed = JSON.parse(backup);
                      if (Array.isArray(parsed) && parsed.length > 0) {
                        tasksToUse = parsed;
                      }
                    } catch (e) {}
                  }
                }
                if (tasksToUse.length > 0) {
                  import("./lib/firebase").then(({ saveTaskToDb }) => {
                    tasksToUse.forEach((t) => saveTaskToDb(t));
                  });
                }
                return tasksToUse;
              });
            }
            setDbStatus("synced");
          },
          (err) => {
            console.error("Firebase subscription tasks error:", err);
            setDbStatus("offline");
          }
        );

        // Subscribe to remote North Star
        unsubscribeNorthStar = subscribeNorthStar(
          (remoteNorthStar) => {
            if (remoteNorthStar) {
              setNorthStar(remoteNorthStar);
            }
          },
          (err) => {
            console.error("Firebase subscription North Star error:", err);
          }
        );

        // Subscribe to remote Email Filters (ignored senders, domains & specific emails)
        if (typeof subscribeEmailFilters === "function") {
          unsubscribeEmailFilters = subscribeEmailFilters(
            (filters) => {
              if (filters) {
                setIgnoredSenders(filters.ignoredSenders || []);
                setIgnoredDomains(filters.ignoredDomains || []);
                setIgnoredEmails(filters.ignoredEmails || []);
                safeLocalStorage.setItem("ignored_senders", JSON.stringify(filters.ignoredSenders || []));
                safeLocalStorage.setItem("ignored_domains", JSON.stringify(filters.ignoredDomains || []));
                safeLocalStorage.setItem("ignored_emails", JSON.stringify(filters.ignoredEmails || []));
              }
            },
            (err) => {
              console.error("Firebase subscription Email Filters error:", err);
            }
          );
        }
      } catch (err) {
        console.error("Failed to load Firebase, falling back to local state.", err);
        setDbStatus("offline");
      }
    }

    initFirebase();

    return () => {
      if (unsubscribeTasks) unsubscribeTasks();
      if (unsubscribeNorthStar) unsubscribeNorthStar();
      if (unsubscribeEmailFilters) unsubscribeEmailFilters();
    };
  }, []);

  // --- Google Authentication and Triage Integration ---
  useEffect(() => {
    let unsubscribeAuth: (() => void) | null = null;
    
    async function setupAuth() {
      // 1. Try Direct Google Identity Services (GIS) first if stored in session
      const storedGisToken = safeSessionStorage.getItem("gis_access_token");
      const storedGisUser = safeSessionStorage.getItem("gis_user");
      if (storedGisToken && storedGisUser) {
        try {
          const parsedUser = JSON.parse(storedGisUser);
          setGoogleUser(parsedUser);
          setAccessToken(storedGisToken);
          setNeedsAuth(false);
          setIsAuthChecking(false);
          if (typeof fetchTriagedEmails === "function") {
            fetchTriagedEmails(storedGisToken);
          }

          // Link Firebase Auth in background to authenticate Firestore
          import("./lib/firebase")
            .then(({ signInWithGoogleToken }) => {
              signInWithGoogleToken(storedGisToken).catch((err) => {
                console.warn("Failed to background sign-in Firebase Auth with GIS token on restore:", err);
              });
            })
            .catch((err) => {
              console.error("Failed to load Firebase auth helper for background sign-in on restore:", err);
            });

          return;
        } catch (e) {
          console.error("Failed to restore stored GIS user:", e);
        }
      }

      try {
        const { initAuth, checkRedirectResult } = await import("./lib/firebase");
        
        // Check if there is a redirect result first
        try {
          const redirectData = await checkRedirectResult();
          if (redirectData) {
            setGoogleUser(redirectData.user);
            setAccessToken(redirectData.accessToken);
            setNeedsAuth(false);
            setIsAuthChecking(false);
            if (typeof fetchTriagedEmails === "function") {
              fetchTriagedEmails(redirectData.accessToken);
            }
          }
        } catch (redirectErr: any) {
          console.error("Redirect sign-in check failed:", redirectErr);
          setLoginErrorDetails({
            message: redirectErr?.message,
            code: redirectErr?.code,
            customData: redirectErr?.customData,
            name: redirectErr?.name,
            stack: redirectErr?.stack,
          });
          const errMsg = redirectErr?.message || String(redirectErr);
          if (
            redirectErr?.code === "auth/unauthorized-domain" ||
            errMsg.toLowerCase().includes("unauthorized-domain") ||
            errMsg.toLowerCase().includes("unauthorized_domain") ||
            errMsg.toLowerCase().includes("unauthorized domain")
          ) {
            setLoginError("unauthorized-domain");
          } else {
            setLoginError(errMsg);
          }
        }

        unsubscribeAuth = initAuth(
          (user, token) => {
            setGoogleUser(user);
            setAccessToken(token);
            setNeedsAuth(false);
            setIsAuthChecking(false);
          },
          () => {
            // Only set to false/null if there's no GIS token already active
            if (!safeSessionStorage.getItem("gis_access_token")) {
              setGoogleUser(null);
              setAccessToken(null);
              setNeedsAuth(true);
            }
            setIsAuthChecking(false);
          }
        );
      } catch (err) {
        console.error("Failed to initialize Auth listener:", err);
        setIsAuthChecking(false);
      }
    }
    
    setupAuth();
    
    return () => {
      if (unsubscribeAuth) unsubscribeAuth();
    };
  }, []);

  const handleGISLogin = async () => {
    setLoginError(null);
    setLoginErrorDetails(null);
    try {
      const google = (window as any).google;
      if (!google || !google.accounts || !google.accounts.oauth2) {
        throw new Error("Google Identity Services script is not fully loaded. Please wait 2 seconds and try again.");
      }

      const client = google.accounts.oauth2.initTokenClient({
        client_id: "480947374422-9o5dbhhucjcveperht5jhsqelbg8inul.apps.googleusercontent.com",
        scope: "openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send",
        callback: async (response: any) => {
          if (response.error) {
            console.error("GIS token client error callback:", response);
            setLoginError(response.error_description || response.error);
            setLoginErrorDetails(response);
            return;
          }

          const token = response.access_token;
          if (!token) {
            setLoginError("Failed to retrieve Google Workspace access token.");
            return;
          }

          try {
            // Fetch user info using the access token
            const userinfoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (!userinfoRes.ok) {
              throw new Error(`Failed to fetch user profile: ${userinfoRes.statusText}`);
            }
            const userData = await userinfoRes.json();
            
            const constructedUser = {
              email: userData.email,
              displayName: userData.name,
              photoURL: userData.picture,
              uid: userData.sub
            };

            setGoogleUser(constructedUser);
            setAccessToken(token);
            setNeedsAuth(false);
            
            // Persist session locally to avoid re-prompting on simple refreshes
            safeSessionStorage.setItem("gis_access_token", token);
            safeSessionStorage.setItem("gis_user", JSON.stringify(constructedUser));

            // Fetch triaged emails
            fetchTriagedEmails(token);

            // Link Firebase Auth in background to authenticate Firestore
            import("./lib/firebase")
              .then(({ signInWithGoogleToken }) => {
                signInWithGoogleToken(token).catch((err) => {
                  console.warn("Failed to background sign-in Firebase Auth with GIS token:", err);
                });
              })
              .catch((err) => {
                console.error("Failed to load Firebase auth helper for background sign-in:", err);
              });
          } catch (profileErr: any) {
            console.error("Failed to fetch user profile:", profileErr);
            setLoginError(`Profile error: ${profileErr.message || String(profileErr)}`);
          }
        },
      });

      client.requestAccessToken();
    } catch (err: any) {
      console.error("GIS Login initialization failed:", err);
      setLoginError(err.message || String(err));
    }
  };

  const handleLogin = async () => {
    setLoginError(null);
    setLoginErrorDetails(null);
    try {
      const { googleSignIn } = await import("./lib/firebase");
      const result = await googleSignIn();
      if (result) {
        setGoogleUser(result.user);
        setAccessToken(result.accessToken);
        setNeedsAuth(false);
        // Automatically load emails after successful sign in
        fetchTriagedEmails(result.accessToken);
      }
    } catch (err: any) {
      console.error("Login failed:", err);
      setLoginErrorDetails({
        message: err?.message,
        code: err?.code,
        customData: err?.customData,
        name: err?.name,
        stack: err?.stack,
      });
      const errMsg = err?.message || String(err);
      if (
        err?.code === "auth/unauthorized-domain" ||
        errMsg.toLowerCase().includes("unauthorized-domain") ||
        errMsg.toLowerCase().includes("unauthorized_domain") ||
        errMsg.toLowerCase().includes("unauthorized domain")
      ) {
        setLoginError("unauthorized-domain");
      } else {
        setLoginError(err?.code ? `${err.code}: ${errMsg}` : errMsg);
      }
    }
  };

  const handleRedirectLogin = async () => {
    setLoginError(null);
    setLoginErrorDetails(null);
    try {
      const { googleSignInRedirect } = await import("./lib/firebase");
      await googleSignInRedirect();
    } catch (err: any) {
      console.error("Redirect login failed:", err);
      setLoginErrorDetails({
        message: err?.message,
        code: err?.code,
        customData: err?.customData,
        name: err?.name,
        stack: err?.stack,
      });
      const errMsg = err?.message || String(err);
      if (
        err?.code === "auth/unauthorized-domain" ||
        errMsg.toLowerCase().includes("unauthorized-domain") ||
        errMsg.toLowerCase().includes("unauthorized_domain") ||
        errMsg.toLowerCase().includes("unauthorized domain")
      ) {
        setLoginError("unauthorized-domain");
      } else {
        setLoginError(err?.code ? `${err.code}: ${errMsg}` : errMsg);
      }
    }
  };

  const handleLogout = async () => {
    try {
      const { logout } = await import("./lib/firebase");
      await logout();
      setGoogleUser(null);
      setAccessToken(null);
      setNeedsAuth(true);
      setTriagedEmails([]);
    } catch (err) {
      console.error("Logout failed:", err);
    }
  };

  const [convertedEmailIds, setConvertedEmailIds] = useState<string[]>([]);
  const [triageSubView, setTriageSubView] = useState<"inbox" | "briefing">("inbox");

  // Morning Focus Briefing states
  const [isBriefingSending, setIsBriefingSending] = useState(false);
  const [briefingSentSuccess, setBriefingSentSuccess] = useState(false);
  const [briefingError, setBriefingError] = useState<string | null>(null);
  const [briefingCoachCommentary, setBriefingCoachCommentary] = useState<string | null>(null);
  const [autoSendDailySummary, setAutoSendDailySummary] = useState<boolean>(() => {
    const saved = safeLocalStorage.getItem("auto_send_daily_summary");
    return saved === "true";
  });
  const [lastSentDailySummaryDate, setLastSentDailySummaryDate] = useState<string | null>(() => {
    return safeLocalStorage.getItem("last_sent_daily_summary_date");
  });

  const handleSendDailyBriefing = async () => {
    if (!accessToken) return;
    setIsBriefingSending(true);
    setBriefingError(null);
    setBriefingSentSuccess(false);

    try {
      const response = await fetch("/api/send-daily-summary", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          tasks,
          northStar,
          triagedEmails,
          dashboardUrl: window.location.href,
          userEmail: googleUser?.email
        })
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        let errorMsg = "Failed to send focus briefing email";
        try {
          const errData = JSON.parse(text);
          errorMsg = errData.error || errorMsg;
        } catch (_) {
          errorMsg = text || errorMsg;
        }

        // Handle expired token / unauthorized errors gracefully
        if (response.status === 401 || errorMsg.toLowerCase().includes("unauthorized") || errorMsg.toLowerCase().includes("invalid credentials")) {
          setAccessToken(null);
          safeSessionStorage.removeItem("google_access_token");
          safeSessionStorage.removeItem("gis_access_token");
          safeSessionStorage.removeItem("gis_user");
          setNeedsAuth(true);
          throw new Error("Your Gmail session has expired. Please disconnect and sign in again.");
        }

        throw new Error(errorMsg);
      }

      const text = await response.text();
      if (!text || text.trim() === "") {
        throw new Error("Server returned an empty response. Please try again.");
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch (_) {
        if (text.trim().startsWith("<") || text.toLowerCase().includes("gateway") || text.toLowerCase().includes("upstream") || text.toLowerCase().includes("please wait while")) {
          throw new Error("The server is temporarily starting up or finishing an update. Please wait 5 seconds and try again.");
        }
        throw new Error("Received an invalid response format from the server.");
      }

      if (data.success === false) {
        throw new Error(data.error || "Failed to send focus briefing email.");
      }

      setBriefingSentSuccess(true);
      setBriefingCoachCommentary(data.coachCommentary || "");
      
      const todayStr = new Date().toISOString().split("T")[0];
      setLastSentDailySummaryDate(todayStr);
      safeLocalStorage.setItem("last_sent_daily_summary_date", todayStr);
    } catch (err: any) {
      console.error("Error sending Focus Briefing:", err);
      let errMsg = err.message || "Something went wrong while sending your focus briefing.";
      try {
        const parsed = JSON.parse(errMsg);
        if (parsed.error && parsed.error.message) {
          errMsg = parsed.error.message;
        } else if (parsed.message) {
          errMsg = parsed.message;
        }
      } catch (e) {}
      setBriefingError(errMsg);
    } finally {
      setIsBriefingSending(false);
    }
  };

  // Auto-send daily summary email on first login/load of the day
  useEffect(() => {
    if (googleUser && accessToken && autoSendDailySummary) {
      const todayStr = new Date().toISOString().split("T")[0];
      if (lastSentDailySummaryDate !== todayStr && !isBriefingSending && !briefingSentSuccess) {
        console.log("Detecting new day. Auto-sending Morning Focus Briefing...");
        handleSendDailyBriefing();
      }
    }
  }, [googleUser, accessToken, autoSendDailySummary, lastSentDailySummaryDate]);

  const fetchTriagedEmails = async (tokenStr = accessToken) => {
    const currentToken = tokenStr || accessToken;
    if (!currentToken) {
      setNeedsAuth(true);
      return;
    }

    setIsTriageLoading(true);
    setTriageError(null);

    try {
      const response = await fetch("/api/triage-emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${currentToken}`
        },
        body: JSON.stringify({
          currentDate: new Date().toLocaleDateString("en-CA"), // Dynamically calculate current local date (YYYY-MM-DD)
          ignoredSenders,
          ignoredDomains,
          ignoredEmails
        })
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        let errorMsg = "Failed to fetch and triage emails";
        try {
          const errData = JSON.parse(text);
          errorMsg = errData.error || errorMsg;
        } catch (_) {
          errorMsg = text || errorMsg;
        }

        // Handle expired token / unauthorized errors gracefully
        if (response.status === 401 || errorMsg.toLowerCase().includes("unauthorized") || errorMsg.toLowerCase().includes("invalid credentials")) {
          setAccessToken(null);
          safeSessionStorage.removeItem("google_access_token");
          safeSessionStorage.removeItem("gis_access_token");
          safeSessionStorage.removeItem("gis_user");
          setNeedsAuth(true);
          throw new Error("Your Gmail session has expired. Please disconnect and sign in again.");
        }

        throw new Error(errorMsg);
      }

      const text = await response.text();
      if (!text || text.trim() === "") {
        throw new Error("Server returned an empty response. Please try again.");
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch (_) {
        if (text.trim().startsWith("<") || text.toLowerCase().includes("gateway") || text.toLowerCase().includes("upstream") || text.toLowerCase().includes("please wait while")) {
          throw new Error("The server is temporarily starting up or finishing an update. Please wait 5 seconds and try again.");
        }
        throw new Error("Received an invalid response format from the server.");
      }
      setTriagedEmails(data.importantEmails || []);
    } catch (err: any) {
      console.error("Error triaging emails:", err);
      let errMsg = err.message || "Something went wrong while triaging your emails.";
      try {
        const parsed = JSON.parse(errMsg);
        if (parsed.error && parsed.error.message) {
          errMsg = parsed.error.message;
        } else if (parsed.message) {
          errMsg = parsed.message;
        }
      } catch (e) {
        // Not JSON
      }
      setTriageError(errMsg);
    } finally {
      setIsTriageLoading(false);
    }
  };

  const handleIgnoreSpecificEmail = async (emailId: string) => {
    if (!emailId) return;
    const updatedEmails = [...ignoredEmails];
    if (!updatedEmails.includes(emailId)) {
      updatedEmails.push(emailId);
    }

    setIgnoredEmails(updatedEmails);
    safeLocalStorage.setItem("ignored_emails", JSON.stringify(updatedEmails));

    try {
      const { saveEmailFiltersToDb } = await import("./lib/firebase");
      await saveEmailFiltersToDb({
        ignoredSenders,
        ignoredDomains,
        ignoredEmails: updatedEmails
      });
    } catch (err) {
      console.error("Failed to save email filters to remote DB:", err);
    }

    // Immediately filter the active triagedEmails state
    setTriagedEmails((prev) => prev.filter((item: any) => item.id !== emailId && item.emailId !== emailId));
  };

  const handleRemoveIgnoreSpecificEmail = async (emailId: string) => {
    const updatedEmails = ignoredEmails.filter((id) => id !== emailId);
    setIgnoredEmails(updatedEmails);
    safeLocalStorage.setItem("ignored_emails", JSON.stringify(updatedEmails));

    try {
      const { saveEmailFiltersToDb } = await import("./lib/firebase");
      await saveEmailFiltersToDb({
        ignoredSenders,
        ignoredDomains,
        ignoredEmails: updatedEmails
      });
    } catch (err) {
      console.error("Failed to save email filters to remote DB:", err);
    }
  };

  const handleIgnoreEmailSource = async (email: any, ignoreType: "sender" | "domain") => {
    const fromStr = email.from || "";
    const emailMatch = fromStr.match(/<([^>]+)>/) || [null, fromStr];
    const emailAddress = (emailMatch[1] || fromStr).trim().toLowerCase();
    const domainParts = emailAddress.split("@");
    const domain = domainParts[domainParts.length - 1]?.trim().toLowerCase() || "";

    let updatedSenders = [...ignoredSenders];
    let updatedDomains = [...ignoredDomains];

    if (ignoreType === "sender" && emailAddress) {
      if (!updatedSenders.includes(emailAddress)) {
        updatedSenders.push(emailAddress);
      }
    } else if (ignoreType === "domain" && domain) {
      if (!updatedDomains.includes(domain)) {
        updatedDomains.push(domain);
      }
    }

    setIgnoredSenders(updatedSenders);
    setIgnoredDomains(updatedDomains);
    safeLocalStorage.setItem("ignored_senders", JSON.stringify(updatedSenders));
    safeLocalStorage.setItem("ignored_domains", JSON.stringify(updatedDomains));

    try {
      const { saveEmailFiltersToDb } = await import("./lib/firebase");
      await saveEmailFiltersToDb({
        ignoredSenders: updatedSenders,
        ignoredDomains: updatedDomains,
        ignoredEmails
      });
    } catch (err) {
      console.error("Failed to save email filters to remote DB:", err);
    }

    // Immediately filter the active triagedEmails state
    setTriagedEmails((prev) => prev.filter((item: any) => {
      const itemMatch = item.from.match(/<([^>]+)>/) || [null, item.from];
      const itemAddress = (itemMatch[1] || item.from).trim().toLowerCase();
      const itemDomainParts = itemAddress.split("@");
      const itemDomain = itemDomainParts[itemDomainParts.length - 1]?.trim().toLowerCase() || "";

      if (updatedSenders.includes(itemAddress)) return false;
      if (updatedDomains.some((d: string) => itemDomain === d || itemDomain.endsWith("." + d))) return false;
      return true;
    }));
  };

  const handleRemoveIgnoreRule = async (value: string, ignoreType: "sender" | "domain") => {
    let updatedSenders = [...ignoredSenders];
    let updatedDomains = [...ignoredDomains];

    if (ignoreType === "sender") {
      updatedSenders = updatedSenders.filter((s) => s !== value);
    } else if (ignoreType === "domain") {
      updatedDomains = updatedDomains.filter((d) => d !== value);
    }

    setIgnoredSenders(updatedSenders);
    setIgnoredDomains(updatedDomains);
    safeLocalStorage.setItem("ignored_senders", JSON.stringify(updatedSenders));
    safeLocalStorage.setItem("ignored_domains", JSON.stringify(updatedDomains));

    try {
      const { saveEmailFiltersToDb } = await import("./lib/firebase");
      await saveEmailFiltersToDb({
        ignoredSenders: updatedSenders,
        ignoredDomains: updatedDomains,
        ignoredEmails
      });
    } catch (err) {
      console.error("Failed to save email filters to remote DB:", err);
    }
  };

  const handleConvertEmailToTask = async (email: any) => {
    const taskId = `task-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const newTask: Task = {
      id: taskId,
      title: email.suggestedTitle,
      priority: email.suggestedPriority || "medium",
      horizon: email.suggestedHorizon || "today",
      category: email.suggestedCategory || "general",
      dropDeadDate: email.suggestedDate || undefined,
      reasoning: email.importanceReason,
      completed: false,
      createdAt: new Date().toISOString(),
      tags: ["Email Triage", ...detectTags(email.suggestedTitle)]
    };

    setTasks((prev) => [newTask, ...prev]);
    setConvertedEmailIds((prev) => [...prev, email.emailId]);

    try {
      const { saveTaskToDb } = await import("./lib/firebase");
      await saveTaskToDb(newTask);
    } catch (err) {
      console.error("Failed to save converted task to remote DB:", err);
    }
  };

  const getHeaderDateString = (date: Date) => {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dayName = dayNames[date.getDay()];
    return `${yyyy}-${mm}-${dd} (${dayName})`;
  };

  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (year: number, month: number) => {
    return new Date(year, month, 1).getDay();
  };

  const renderCalendarGrid = () => {
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    
    const daysInMonth = getDaysInMonth(year, month);
    const firstDayIndex = getFirstDayOfMonth(year, month);
    
    const blanks = Array(firstDayIndex).fill(null);
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
    const totalSlots = [...blanks, ...days];
    
    const monthNames = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];
    
    const today = new Date();
    const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

    return (
      <div className="w-full font-sans text-neutral-800" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3 border-b border-neutral-100 pb-2">
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setCalendarDate(new Date(year, month - 1, 1)); }}
            className="p-1 hover:bg-neutral-100 rounded text-neutral-500 hover:text-neutral-900 transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="font-bold text-xs uppercase tracking-wider text-neutral-700">
            {monthNames[month]} {year}
          </span>
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setCalendarDate(new Date(year, month + 1, 1)); }}
            className="p-1 hover:bg-neutral-100 rounded text-neutral-500 hover:text-neutral-900 transition-colors cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-neutral-400 mb-1.5 uppercase font-mono">
          <span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span>
        </div>

        <div className="grid grid-cols-7 gap-1">
          {totalSlots.map((day, idx) => {
            if (day === null) {
              return <div key={`blank-${idx}`} className="h-7 w-7" />;
            }
            
            const isToday = isCurrentMonth && today.getDate() === day;
            return (
              <button
                key={`day-${day}`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowCalendarDropdown(false);
                }}
                className={`h-7 w-7 text-xs flex items-center justify-center rounded-lg transition-all font-semibold cursor-pointer ${
                  isToday
                    ? "bg-neutral-900 text-white font-bold shadow-sm ring-1 ring-neutral-900"
                    : "hover:bg-neutral-100 text-neutral-700"
                }`}
              >
                {day}
              </button>
            );
          })}
        </div>
        
        <div className="mt-3 border-t border-neutral-100 pt-2 text-center">
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setCalendarDate(new Date());
              setShowCalendarDropdown(false);
            }}
            className="text-[10px] text-neutral-500 hover:text-neutral-900 font-bold uppercase tracking-wider font-mono hover:underline"
          >
            Jump to Today
          </button>
        </div>
      </div>
    );
  };

  // Save/Delete Wrapper Helpers
  const saveTask = async (task: Task) => {
    setTasks((prev) => {
      const idx = prev.findIndex((t) => t.id === task.id);
      if (idx > -1) {
        const copy = [...prev];
        copy[idx] = task;
        return copy;
      } else {
        return [task, ...prev];
      }
    });

    import("./lib/firebase")
      .then(({ saveTaskToDb }) => {
        saveTaskToDb(task).catch((e) => {
          console.error("Error saving task to Firestore in background:", e);
        });
      })
      .catch((e) => {
        console.error("Failed to load Firebase save helper:", e);
      });
  };

  const handleToggleFocusType = async (taskId: string, currentIsMust?: boolean, currentIsNice?: boolean) => {
    let nextIsMust = false;
    let nextIsNice = false;

    if (!currentIsMust && !currentIsNice) {
      nextIsMust = true;
    } else if (currentIsMust) {
      nextIsNice = true;
    }

    const updatedTasks = tasks.map((t) => {
      if (t.id === taskId) {
        return {
          ...t,
          isMustDo: nextIsMust,
          isNiceToDo: nextIsNice
        };
      }
      return t;
    });

    setTasks(updatedTasks);
    
    const updatedTask = updatedTasks.find(t => t.id === taskId);
    if (updatedTask) {
      await saveTask(updatedTask);
    }
  };

  const handleToggleForceCritical = async (taskId: string, currentIsForceCritical?: boolean) => {
    const targetTask = tasks.find((t) => t.id === taskId);
    const isCurrentlyCritical =
      !!currentIsForceCritical ||
      !!targetTask?.isForceCritical ||
      (!!targetTask?.dropDeadDate && targetTask.dropDeadDate.trim() !== "" && getCriticalStatus(targetTask) !== null);

    const updatedTasks = tasks.map((t) => {
      if (t.id === taskId) {
        if (isCurrentlyCritical) {
          // Unflag critical: remove force critical AND clear drop-dead date so it instantly leaves Critical Items
          return {
            ...t,
            isForceCritical: false,
            dropDeadDate: undefined
          };
        } else {
          // Flag as critical item
          return {
            ...t,
            isForceCritical: true
          };
        }
      }
      return t;
    });

    setTasks(updatedTasks);

    const updatedTask = updatedTasks.find((t) => t.id === taskId);
    if (updatedTask) {
      await saveTask(updatedTask);
    }
  };

  const handleQuickUpdateDate = async (taskId: string, newDateStr: string) => {
    const updatedTasks = tasks.map((t) => {
      if (t.id === taskId) {
        return {
          ...t,
          dropDeadDate: newDateStr.trim() ? newDateStr.trim() : undefined
        };
      }
      return t;
    });

    setTasks(updatedTasks);

    const updatedTask = updatedTasks.find((t) => t.id === taskId);
    if (updatedTask) {
      await saveTask(updatedTask);
    }
  };

  const handleSetFocusTypeInReview = async (taskId: string, isMust: boolean) => {
    const updatedTasks = tasks.map((t) => {
      if (t.id === taskId) {
        return {
          ...t,
          isMustDo: isMust,
          isNiceToDo: !isMust
        };
      }
      return t;
    });

    setTasks(updatedTasks);

    const updatedTask = updatedTasks.find((t) => t.id === taskId);
    if (updatedTask) {
      await saveTask(updatedTask);
    }
  };

  const deleteTask = async (taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));

    import("./lib/firebase")
      .then(({ deleteTaskFromDb }) => {
        deleteTaskFromDb(taskId).catch((e) => {
          console.error("Error deleting task from Firestore in background:", e);
        });
      })
      .catch((e) => {
        console.error("Failed to load Firebase delete helper:", e);
      });
  };

  const saveNorthStar = async (ns: NorthStar) => {
    setNorthStar(ns);

    import("./lib/firebase")
      .then(({ saveNorthStarToDb }) => {
        saveNorthStarToDb(ns).catch((e) => {
          console.error("Error saving North Star to Firestore in background:", e);
        });
      })
      .catch((e) => {
        console.error("Failed to load Firebase save North Star helper:", e);
      });
  };

  useEffect(() => {
    safeLocalStorage.setItem("brain_dump_tasks", JSON.stringify(tasks));
    if (tasks.length > 0) {
      safeLocalStorage.setItem("brain_dump_tasks_backup", JSON.stringify(tasks));
    }
  }, [tasks]);

  useEffect(() => {
    safeLocalStorage.setItem("brain_dump_north_star", JSON.stringify(northStar));
  }, [northStar]);

  // --- UI Layout State ---
  const [activeHorizon, setActiveHorizon] = useState<Task["horizon"]>("today");
  const [brainDumpText, setBrainDumpText] = useState("");
  const [isEditingNorthStar, setIsEditingNorthStar] = useState(false);
  const [isViewingNorthStarHistory, setIsViewingNorthStarHistory] = useState(false);
  const [nsTitleInput, setNsTitleInput] = useState(northStar.title);
  const [nsDescInput, setNsDescInput] = useState(northStar.description);

  useEffect(() => {
    if (!isEditingNorthStar) {
      setNsTitleInput(northStar.title);
      setNsDescInput(northStar.description);
    }
  }, [northStar, isEditingNorthStar]);

  // Maintenance display toggle
  const [hideMaintenanceInList, setHideMaintenanceInList] = useState(true);

  // Manual task addition
  const [showManualAdd, setShowManualAdd] = useState(false);
  const [manualTitle, setManualTitle] = useState("");
  const [manualPriority, setManualPriority] = useState<Task["priority"]>("medium");
  const [manualHorizon, setManualHorizon] = useState<Task["horizon"]>("today");
  const [manualCategory, setManualCategory] = useState<Task["category"]>("general");
  const [manualDate, setManualDate] = useState("");
  const [manualFocusType, setManualFocusType] = useState<string>("none");

  // --- Duplicate Detection & UI States ---
  const [duplicateQueue, setDuplicateQueue] = useState<any[]>([]);
  const [manualAddFeedback, setManualAddFeedback] = useState<string | null>(null);
  const [isManualAdding, setIsManualAdding] = useState(false);

  // --- Email Triage & Calendar States ---
  const [activeView, setActiveView] = useState<"planner" | "triage">("planner");

  const [showCalendarDropdown, setShowCalendarDropdown] = useState(false);
  const [calendarDate, setCalendarDate] = useState(new Date());

  // Loading / Interaction State
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Preparation / Review Today state
  const [isReviewingToday, setIsReviewingToday] = useState(false);
  const [isCoaching, setIsCoaching] = useState(false);
  const [coachFeedback, setCoachFeedback] = useState<DailyCoachFeedback | null>(null);

  // Focus Mode State
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [focusTasks, setFocusTasks] = useState<Task[]>([]);
  const [focusIndex, setFocusIndex] = useState(0);
  const [focusDumpText, setFocusDumpText] = useState("");
  const [focusSuccessMessage, setFocusSuccessMessage] = useState<string | null>(null);

  // Drag / move UI helpers
  const [activeEditingTaskId, setActiveEditingTaskId] = useState<string | null>(null);
  const [editTitleInput, setEditTitleInput] = useState("");
  const [editDateInput, setEditDateInput] = useState("");
  const [editCategoryInput, setEditCategoryInput] = useState<Task["category"]>("general");
  const [editPriorityInput, setEditPriorityInput] = useState<Task["priority"]>("medium");

  // --- Helper Date Calculations ---
  const todayStr = new Date().toISOString().split("T")[0] || "2026-07-23";
  const todayDateObj = new Date(todayStr);

  const getValidDateString = (dateStr?: string): string => {
    if (!dateStr || typeof dateStr !== "string") return "";
    const clean = dateStr.split("T")[0].trim();
    if (clean === "null" || clean === "undefined" || clean === "tags" || clean === "due date") return "";
    const parts = clean.split("-").map(Number);
    if (
      parts.length === 3 &&
      !isNaN(parts[0]) &&
      !isNaN(parts[1]) &&
      !isNaN(parts[2]) &&
      parts[0] > 1900 &&
      parts[1] >= 1 &&
      parts[1] <= 12 &&
      parts[2] >= 1 &&
      parts[2] <= 31
    ) {
      return clean;
    }
    return "";
  };

  const getCriticalStatus = (task: Task) => {
    if (task.isForceCritical) {
      return {
        isCritical: true,
        level: "red" as const,
        daysLeft: 0,
        colorClass: "bg-red-50 border-red-200 text-red-700 hover:bg-red-100/70",
        badgeClass: "bg-red-600 text-white",
        textColor: "text-red-900",
        isForced: true
      };
    }
    const cleanDate = getValidDateString(task.dropDeadDate);
    if (!cleanDate) return null;
    const dateParts = cleanDate.split("-").map(Number);
    const taskMidnight = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
    const currentMidnight = new Date(todayDateObj.getFullYear(), todayDateObj.getMonth(), todayDateObj.getDate());
    const diffTime = taskMidnight.getTime() - currentMidnight.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays <= 5) {
      return {
        isCritical: true,
        level: "red" as const,
        daysLeft: diffDays,
        colorClass: "bg-red-50 border-red-200 text-red-700 hover:bg-red-100/70",
        badgeClass: "bg-red-600 text-white",
        textColor: "text-red-900"
      };
    } else if (diffDays <= 14) {
      return {
        isCritical: true,
        level: "orange" as const,
        daysLeft: diffDays,
        colorClass: "bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100/70",
        badgeClass: "bg-amber-500 text-white",
        textColor: "text-amber-900"
      };
    }
    return null;
  };

  const getDeadlineBadgeStyle = (rawDateStr?: string) => {
    const cleanDate = getValidDateString(rawDateStr);
    if (!cleanDate) return null;
    const dateParts = cleanDate.split("-").map(Number);
    const taskMidnight = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
    const currentMidnight = new Date(todayDateObj.getFullYear(), todayDateObj.getMonth(), todayDateObj.getDate());
    const diffTime = taskMidnight.getTime() - currentMidnight.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return { text: `Overdue by ${Math.abs(diffDays)}d`, color: "bg-red-100 text-red-800 border-red-300 font-semibold" };
    } else if (diffDays === 0) {
      return { text: "Drop-dead Today!", color: "bg-red-500 text-white border-red-600 font-semibold animate-pulse" };
    } else if (diffDays <= 5) {
      return { text: `Drop-dead in ${diffDays}d`, color: "bg-red-50 text-red-700 border-red-200" };
    } else if (diffDays <= 14) {
      return { text: `Drop-dead in ${diffDays}d`, color: "bg-amber-50 text-amber-800 border-amber-200" };
    } else {
      return { text: `Due ${cleanDate}`, color: "bg-neutral-50 text-neutral-600 border-neutral-200" };
    }
  };

  // --- API Calls ---

  // Submit Brain Dump to Gemini
  const handleAnalyzeBrainDump = async (textToAnalyze: string) => {
    if (!textToAnalyze.trim()) return;
    setIsAnalyzing(true);
    setAnalysisError(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000); // 12-second max timeout

    try {
      let data: any = null;
      try {
        const response = await fetch("/api/organize-dump", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dumpText: textToAnalyze,
            currentDate: todayStr,
            northStar: `${northStar.title}: ${northStar.description}`
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const text = await response.text();
          if (text && text.trim() !== "") {
            data = JSON.parse(text);
          }
        }
      } catch (fetchErr) {
        console.warn("API organize-dump call timed out or failed, utilizing fast fallback parser.", fetchErr);
      }

      clearTimeout(timeoutId);

      // Fallback if API response wasn't received or parsed
      if (!data || !data.items || !Array.isArray(data.items)) {
        const lines = textToAnalyze.split(/\n+/).map((l) => l.replace(/^[-*•\d.\s]+/, "").trim()).filter((l) => l.length > 0);
        data = {
          items: lines.map((line) => ({
            title: line,
            priority: "medium",
            horizon: "this_week",
            category: "general",
            dropDeadDate: null,
            reasoning: "Extracted directly from brain dump."
          }))
        };
      }

      if (data.items && Array.isArray(data.items)) {
        const generatedTasks: Task[] = data.items.map((item: any, idx: number) => {
          const rawDateStr = (item.dropDeadDate && typeof item.dropDeadDate === "string" && item.dropDeadDate !== "null" && item.dropDeadDate !== "undefined" && item.dropDeadDate.trim() !== "") ? item.dropDeadDate.trim() : undefined;
          const cleanDate = rawDateStr ? rawDateStr.split("T")[0] : undefined;
          return {
            id: `task-gemini-${Date.now()}-${idx}`,
            title: item.title || textToAnalyze.trim(),
            priority: item.priority || "medium",
            horizon: item.horizon || "this_week",
            category: item.category || "general",
            dropDeadDate: cleanDate,
            reasoning: item.reasoning,
            completed: false,
            createdAt: new Date().toISOString(),
            tags: item.tags || detectTags(item.title || "")
          };
        });

        const toSaveImmediately: Task[] = [];
        const duplicatesFound: any[] = [];
        const existingTasksSnapshot = [...tasks];

        generatedTasks.forEach((newTask) => {
          const duplicate = findPotentialDuplicate(newTask.title, existingTasksSnapshot);
          if (duplicate) {
            duplicatesFound.push({
              id: `dup-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
              newTask,
              existingTask: duplicate.existingTask,
              similarity: duplicate.similarity,
              source: "braindump"
            });
          } else {
            toSaveImmediately.push(newTask);
          }
        });

        if (toSaveImmediately.length > 0) {
          for (const task of toSaveImmediately) {
            await saveTask(task);
          }
          setActiveHorizon(toSaveImmediately[0].horizon);
        }

        if (duplicatesFound.length > 0) {
          setDuplicateQueue((prev) => [...prev, ...duplicatesFound]);
        }

        setBrainDumpText("");
      }
    } catch (err: any) {
      console.error(err);
      let errMsg = err.message || "Something went wrong processing your brain dump.";
      setAnalysisError(errMsg);
    } finally {
      clearTimeout(timeoutId);
      setIsAnalyzing(false);
    }
  };

  // Submit Selected Today Tasks to Coach Review
  const handleRequestCoachReview = async () => {
    const todayTasks = tasks.filter((t) => t.horizon === "today" && !t.completed);
    if (todayTasks.length === 0) return;

    setIsCoaching(true);
    try {
      const response = await fetch("/api/coach-today", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tasks: todayTasks,
          northStar: `${northStar.title}: ${northStar.description}`
        })
      });

      if (!response.ok) {
        throw new Error("Coach failed to respond. Proceeding with manual layout.");
      }

      const data: DailyCoachFeedback = await response.json();
      setCoachFeedback(data);

      // Update the local tasks today status based on coach recommendation
      const updatedTasks = tasks.map((t) => {
        if (t.horizon === "today") {
          const isMust = data.mustDoIds.includes(t.id);
          const isNice = data.niceToDoIds.includes(t.id);
          return {
            ...t,
            isMustDo: isMust,
            isNiceToDo: isNice || !isMust // default remaining to nice to do
          };
        }
        return t;
      });

      setTasks(updatedTasks);
      for (const t of updatedTasks) {
        if (t.horizon === "today") {
          await saveTask(t);
        }
      }
    } catch (err) {
      console.error(err);
      // Fallback: manually divide them based on priority
      const fallbackTasks = tasks.map((t) => {
        if (t.horizon === "today") {
          const isMust = t.priority === "high" || t.category === "north_star";
          return {
            ...t,
            isMustDo: isMust,
            isNiceToDo: !isMust
          };
        }
        return t;
      });

      setTasks(fallbackTasks);
      for (const t of fallbackTasks) {
        if (t.horizon === "today") {
          await saveTask(t);
        }
      }

      setCoachFeedback({
        mustDoIds: todayTasks.filter((t) => t.priority === "high" || t.category === "north_star").map((t) => t.id),
        niceToDoIds: todayTasks.filter((t) => t.priority !== "high" && t.category !== "north_star").map((t) => t.id),
        coachMessage: "Here is a clean layout of your day based on high-priority and North Star items. Let's tackle them step-by-step!"
      });
    } finally {
      setIsCoaching(false);
    }
  };

  // --- Task Operations & Duplicate Checks ---
  const findPotentialDuplicate = (newTaskTitle: string, customTaskList?: Task[]) => {
    const activeTasks = (customTaskList || tasks).filter((t) => !t.completed);
    let bestMatch: Task | null = null;
    let highestSim = 0;

    for (const task of activeTasks) {
      const sim = calculateStringSimilarity(newTaskTitle, task.title);
      if (sim > highestSim) {
        highestSim = sim;
        bestMatch = task;
      }
    }

    if (highestSim >= 0.90) {
      return { existingTask: bestMatch!, similarity: highestSim };
    }
    return null;
  };

  const resetManualForm = () => {
    setManualTitle("");
    setManualDate("");
    setManualFocusType("none");
    setManualHorizon("today");
    setManualPriority("medium");
    setManualCategory("general");
  };

  const handleResolveDuplicate = async (resolutionId: string, choice: "add" | "keep_existing" | "supersede" | "archive_and_add") => {
    const item = duplicateQueue.find((d) => d.id === resolutionId);
    if (!item) return;

    const { newTask, existingTask } = item;

    if (choice === "add") {
      await saveTask(newTask);
      setActiveHorizon(newTask.horizon);
    } else if (choice === "keep_existing") {
      // Do nothing, keep existing task unchanged
    } else if (choice === "supersede") {
      const updatedExisting = {
        ...existingTask,
        title: newTask.title,
        priority: newTask.priority,
        horizon: newTask.horizon,
        category: newTask.category,
        dropDeadDate: newTask.dropDeadDate,
        isMustDo: newTask.isMustDo,
        isNiceToDo: newTask.isNiceToDo,
        isForceCritical: newTask.isForceCritical,
        reasoning: newTask.reasoning || existingTask.reasoning,
        tags: newTask.tags || existingTask.tags
      };
      await saveTask(updatedExisting);
      setActiveHorizon(updatedExisting.horizon);
    } else if (choice === "archive_and_add") {
      const completedExisting = {
        ...existingTask,
        completed: true,
        completedAt: new Date().toISOString()
      };
      await saveTask(completedExisting);
      await saveTask(newTask);
      setActiveHorizon(newTask.horizon);
    }

    setDuplicateQueue((prev) => prev.filter((d) => d.id !== resolutionId));
  };

  const handleAddTaskManually = async () => {
    if (!manualTitle.trim() || isManualAdding) return;
    setIsManualAdding(true);
    setManualAddFeedback(null);

    const newTask: Task = {
      id: `task-manual-${Date.now()}`,
      title: manualTitle.trim(),
      priority: manualPriority,
      horizon: manualHorizon,
      category: manualCategory,
      dropDeadDate: manualDate ? manualDate : undefined,
      isMustDo: manualFocusType === "must",
      isNiceToDo: manualFocusType === "nice",
      isForceCritical: manualFocusType === "must",
      completed: false,
      createdAt: new Date().toISOString(),
      tags: detectTags(manualTitle)
    };

    const duplicate = findPotentialDuplicate(newTask.title);
    if (duplicate) {
      setDuplicateQueue((prev) => [
        ...prev,
        {
          id: `dup-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          newTask,
          existingTask: duplicate.existingTask,
          similarity: duplicate.similarity,
          source: "manual"
        }
      ]);
      resetManualForm();
      setIsManualAdding(false);
      return;
    }

    await saveTask(newTask);
    setActiveHorizon(manualHorizon);
    resetManualForm();
    setIsManualAdding(false);
    setManualAddFeedback("✓ Task successfully added!");
    setTimeout(() => {
      setManualAddFeedback(null);
    }, 3000);
  };

  const handleToggleComplete = async (id: string) => {
    const taskToToggle = tasks.find((t) => t.id === id);
    if (!taskToToggle) return;
    const updated = {
      ...taskToToggle,
      completed: !taskToToggle.completed,
      completedAt: !taskToToggle.completed ? new Date().toISOString() : undefined
    };
    await saveTask(updated);
  };

  const handleDeleteTask = async (id: string) => {
    await deleteTask(id);
  };

  const handleMoveHorizon = async (id: string, nextHorizon: Task["horizon"]) => {
    const taskToMove = tasks.find((t) => t.id === id);
    if (!taskToMove) return;
    const updated = { ...taskToMove, horizon: nextHorizon };
    await saveTask(updated);
  };

  const handleUpdateTask = async (id: string) => {
    const taskToUpdate = tasks.find((t) => t.id === id);
    if (!taskToUpdate) return;
    const updated = {
      ...taskToUpdate,
      title: editTitleInput.trim(),
      dropDeadDate: editDateInput ? editDateInput : undefined,
      category: editCategoryInput,
      priority: editPriorityInput,
      tags: detectTags(editTitleInput)
    };
    await saveTask(updated);
    setActiveEditingTaskId(null);
  };

  const handleSaveNorthStar = async () => {
    const trimmedTitle = nsTitleInput.trim();
    const trimmedDesc = nsDescInput.trim();
    if (!trimmedTitle) return;

    const existingHistory = northStar.history || [];
    const isDuplicate = existingHistory.some(
      (item) => item.title.trim().toLowerCase() === trimmedTitle.toLowerCase() &&
                 item.description.trim().toLowerCase() === trimmedDesc.toLowerCase()
    );

    let updatedHistory = [...existingHistory];
    if (!isDuplicate) {
      updatedHistory.push({
        id: Math.random().toString(36).substring(2, 11),
        title: trimmedTitle,
        description: trimmedDesc,
        createdAt: new Date().toISOString()
      });
    }

    await saveNorthStar({
      title: trimmedTitle,
      description: trimmedDesc,
      history: updatedHistory
    });
    setIsEditingNorthStar(false);
  };

  const handleReappointNorthStar = async (item: { title: string; description: string }) => {
    await saveNorthStar({
      title: item.title,
      description: item.description,
      history: northStar.history || []
    });
    setNsTitleInput(item.title);
    setNsDescInput(item.description);
  };

  const handleDeleteHistoryItem = async (itemId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updatedHistory = (northStar.history || []).filter((item) => item.id !== itemId);
    await saveNorthStar({
      title: northStar.title,
      description: northStar.description,
      history: updatedHistory
    });
  };

  // --- Preparation Mode Trigger ---
  const triggerReviewMode = () => {
    setIsReviewingToday(true);
    handleRequestCoachReview();
  };

  // --- Focus Mode Core Engine ---
  const handleLaunchFocus = () => {
    const todayActive = tasks.filter((t) => t.horizon === "today" && !t.completed);

    // Group with Forced Critical first, then Must-dos, then Nice-to-dos
    const forcedCritical = todayActive.filter((t) => t.isForceCritical);
    const mustDos = todayActive.filter((t) => t.isMustDo && !t.isForceCritical);
    const niceToDos = todayActive.filter((t) => !t.isForceCritical && (t.isNiceToDo || (!t.isMustDo && !t.isNiceToDo)));

    const sortedFocusTasks = [...forcedCritical, ...mustDos, ...niceToDos];

    if (sortedFocusTasks.length === 0) {
      alert("No active tasks in Today to focus on!");
      return;
    }

    setFocusTasks(sortedFocusTasks);
    setFocusIndex(0);
    setIsFocusMode(true);
  };

  const handleCompleteActiveFocusTask = () => {
    const activeTask = focusTasks[focusIndex];
    if (activeTask) {
      handleToggleComplete(activeTask.id);
    }

    if (focusIndex < focusTasks.length - 1) {
      setFocusIndex((prev) => prev + 1);
    } else {
      // Completed last task!
      setFocusSuccessMessage("Spectacular! You have completed all focus items for today!");
    }
  };

  const handleSkipFocusTask = () => {
    if (focusIndex < focusTasks.length - 1) {
      setFocusIndex((prev) => prev + 1);
    } else {
      setFocusSuccessMessage("You've reached the end of your list. Great job staying focused today!");
    }
  };

  const handleDumpThoughtInFocus = async () => {
    if (!focusDumpText.trim()) return;

    const newTask: Task = {
      id: `task-focus-${Date.now()}`,
      title: focusDumpText.trim(),
      priority: "medium",
      horizon: "backlog",
      category: "general",
      completed: false,
      createdAt: new Date().toISOString(),
      reasoning: "Captured quickly during a Focus Session."
    };

    await saveTask(newTask);
    setFocusDumpText("");
    // show transient success toast
    setFocusSuccessMessage("Idea saved securely to Backlog! Mind cleared.");
    setTimeout(() => {
      setFocusSuccessMessage(null);
    }, 2500);
  };

  // --- Filtering & Sorting ---
  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      // match horizon
      if (t.horizon !== activeHorizon) return false;
      // if hide maintenance is true, omit maintenance tasks
      if (hideMaintenanceInList && t.category === "maintenance" && !t.completed) return false;
      return true;
    });
  }, [tasks, activeHorizon, hideMaintenanceInList]);

  // Separate list for hidden maintenance chores so they are easily viewable in a drawer/collapsible section
  const maintenanceTasksForActiveHorizon = useMemo(() => {
    return tasks.filter((t) => t.horizon === activeHorizon && t.category === "maintenance" && !t.completed);
  }, [tasks, activeHorizon]);

  const completedTasksForActiveHorizon = useMemo(() => {
    return tasks.filter((t) => t.horizon === activeHorizon && t.completed);
  }, [tasks, activeHorizon]);

  const criticalTasks = useMemo(() => {
    return tasks
      .filter((t) => !t.completed && (t.dropDeadDate || t.isForceCritical))
      .map((t) => {
        const status = getCriticalStatus(t);
        return { ...t, criticalStatus: status };
      })
      .filter((t) => t.criticalStatus !== null)
      .sort((a, b) => {
        if (a.isForceCritical && !b.isForceCritical) return -1;
        if (!a.isForceCritical && b.isForceCritical) return 1;
        const diffA = a.criticalStatus?.daysLeft ?? 999;
        const diffB = b.criticalStatus?.daysLeft ?? 999;
        return diffA - diffB;
      });
  }, [tasks]);

  // Authorized email list (matching requested email 'jazz@smallathon.com' and the dev/workspace email 'jez@smileathon.com')
  const allowedEmails = ["jazz@smallathon.com", "jez@smileathon.com"];
  const isAuthorized = useMemo(() => {
    return !!(googleUser && googleUser.email && allowedEmails.includes(googleUser.email.toLowerCase()));
  }, [googleUser]);

  if (isAuthChecking) {
    return (
      <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center text-white p-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <RefreshCw className="w-8 h-8 text-amber-500 animate-spin" />
          <p className="text-xs font-mono text-neutral-400 tracking-widest">SECURE AUTHORIZATION BOOTING...</p>
        </div>
      </div>
    );
  }

  if (!googleUser || !isAuthorized) {
    return (
      <div className="min-h-screen bg-neutral-950 flex flex-col justify-center items-center p-6 selection:bg-amber-500 selection:text-neutral-950">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="max-w-md w-full bg-neutral-900 border border-neutral-800 rounded-3xl p-8 sm:p-10 shadow-2xl text-center relative overflow-hidden"
        >
          {/* Accent light/glow */}
          <div className="absolute -top-24 -left-24 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

          {/* Icon */}
          <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center text-neutral-950 shadow-xl shadow-amber-500/10 mb-6 font-bold">
            <Flame className="w-8 h-8" />
          </div>

          <h1 className="text-3xl font-display font-bold tracking-tight text-white mb-2">
            Action Man
          </h1>
          <p className="text-xs font-mono text-neutral-400 tracking-wider uppercase mb-8">
            Personal Cognitive Space
          </p>

          {!googleUser ? (
            <>
              <div className="space-y-4 mb-8 text-neutral-300 text-sm leading-relaxed text-left bg-neutral-950/50 border border-neutral-800/60 p-4 rounded-xl">
                <p className="font-semibold text-neutral-200">🔒 Secure Verification Required</p>
                <p className="text-xs text-neutral-400 leading-relaxed">
                  Welcome back. Please verify your Google identity to unlock your high-velocity planning workspace, automatic email briefing system, and active North Star tracker.
                </p>
              </div>

              <div className="space-y-4">
                {/* Primary Recommended Sign-In Button (Firebase Popup - Works on all deployed domains) */}
                <button
                  onClick={handleLogin}
                  className="w-full bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold py-3.5 px-6 rounded-xl transition-all shadow-lg flex items-center justify-center gap-3 cursor-pointer group hover:scale-[1.01]"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path
                      fill="#0a0a0a"
                      d="M12.24 10.285V14.4h6.887c-.648 2.41-2.519 4.2-5.136 4.2A5.76 5.76 0 0 1 8.24 12.8a5.76 5.76 0 0 1 5.751-5.8c1.556 0 2.956.6 4.024 1.57l3.056-3.055A9.95 9.95 0 0 0 14 2 10 10 0 0 0 4 12a10 10 0 0 0 10 10c5.3 0 9.85-3.834 9.85-10 0-.6-.08-1.215-.224-1.715H12.24z"
                    />
                  </svg>
                  <div className="text-left leading-tight">
                    <span className="text-sm font-semibold block">Sign in with Google (Firebase Popup)</span>
                    <span className="text-[10px] font-mono opacity-80 font-normal">Recommended for Deployed & Shared Apps</span>
                  </div>
                </button>

                <div className="flex items-center gap-2 my-2">
                  <div className="h-px bg-neutral-800 flex-1" />
                  <span className="text-[9px] font-mono text-neutral-500 uppercase tracking-widest shrink-0">or alternative login options</span>
                  <div className="h-px bg-neutral-800 flex-1" />
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    onClick={handleGISLogin}
                    className="bg-neutral-800 hover:bg-neutral-750 border border-neutral-700 text-white font-medium py-2.5 px-3 rounded-xl transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer group hover:scale-[1.01] text-[11px]"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                      <path
                        fill="#ffffff"
                        d="M12.24 10.285V14.4h6.887c-.648 2.41-2.519 4.2-5.136 4.2A5.76 5.76 0 0 1 8.24 12.8a5.76 5.76 0 0 1 5.751-5.8c1.556 0 2.956.6 4.024 1.57l3.056-3.055A9.95 9.95 0 0 0 14 2 10 10 0 0 0 4 12a10 10 0 0 0 10 10c5.3 0 9.85-3.834 9.85-10 0-.6-.08-1.215-.224-1.715H12.24z"
                      />
                    </svg>
                    <span>Direct GIS Mode</span>
                  </button>

                  <button
                    onClick={handleRedirectLogin}
                    className="bg-neutral-800 hover:bg-neutral-750 border border-neutral-700 text-white font-medium py-2.5 px-3 rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer group hover:scale-[1.01] text-[11px] font-mono tracking-wider uppercase"
                  >
                    <RefreshCw className="w-3 h-3 text-amber-500 group-hover:rotate-180 transition-transform duration-500" />
                    <span>Firebase Redirect</span>
                  </button>
                </div>

                {/* Helper Card explaining Current Domain / Direct Mode origin setup */}
                <div className="p-3 bg-neutral-950/60 rounded-xl border border-neutral-800 text-left space-y-2 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] text-neutral-400 uppercase tracking-wider font-bold">Current App Origin:</span>
                    <button
                      type="button"
                      onClick={handleCopyOrigin}
                      className="text-[10px] font-mono bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded transition-all cursor-pointer font-semibold flex items-center gap-1"
                    >
                      {copiedOrigin ? "✓ Copied!" : "📋 Copy Origin"}
                    </button>
                  </div>
                  <div className="font-mono text-[10px] text-amber-300 bg-neutral-900 px-2 py-1 rounded border border-neutral-800 break-all select-all">
                    {typeof window !== "undefined" ? window.location.origin : "https://..."}
                  </div>
                  <p className="text-[10px] text-neutral-400 leading-normal">
                    <strong className="text-neutral-200">Why Direct Mode shows "Error 400: origin_mismatch"?</strong> Google OAuth requires registering your exact origin URL in{" "}
                    <a
                      href="https://console.cloud.google.com/apis/credentials"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-amber-400 hover:underline font-semibold"
                    >
                      Google Cloud Console Credentials ↗
                    </a>{" "}
                    under <em>Authorized JavaScript origins</em> for Client ID <code className="text-neutral-300">48094737...</code>.
                  </p>
                </div>
              </div>

              {loginError && (
                <div className="mt-6 p-4 rounded-xl border border-red-500/20 bg-red-950/20 text-left space-y-3">
                  <div className="flex gap-2 text-red-400 items-start">
                    <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-xs font-bold font-mono uppercase tracking-wider text-red-300">Authentication Alert</h4>
                      <p className="text-xs text-neutral-300 mt-1 leading-relaxed">
                        {loginError === "unauthorized-domain"
                          ? "This domain is not yet authorized in your Firebase Project settings."
                          : `Error: ${loginError}`}
                      </p>
                    </div>
                  </div>

                  <div className="p-3 bg-neutral-950/40 rounded-lg border border-neutral-800 space-y-2 text-[11px] leading-relaxed text-neutral-400">
                    <p className="font-semibold text-neutral-300">💡 Dynamic Workarounds:</p>
                    <ul className="list-disc pl-4 space-y-1">
                      <li>
                        <span className="text-amber-400 font-semibold">Option A (Recommended)</span>: Use the primary <strong className="text-neutral-200">"Sign in with Google (Firebase Popup)"</strong> button above.
                      </li>
                      <li>
                        <span className="text-amber-400 font-semibold">Option B</span>: Use <strong className="text-neutral-200">"Firebase Redirect"</strong> to bypass popup blocker / mobile browser security restrictions.
                      </li>
                      <li>
                        <span className="text-amber-400 font-semibold">Option C</span>: To authorize this origin for Direct Mode or Firebase, copy the origin above and add it to your GCP credentials or Firebase Authorized Domains.
                      </li>
                    </ul>

                    {loginErrorDetails && (
                      <div className="mt-3 pt-2.5 border-t border-neutral-800/60 text-[10px]">
                        <button
                          type="button"
                          onClick={() => setShowDebugDetails(!showDebugDetails)}
                          className="text-amber-500 hover:text-amber-400 underline flex items-center gap-1 font-mono uppercase tracking-wider text-[9px] cursor-pointer font-bold"
                        >
                          {showDebugDetails ? "▼ Hide" : "▶ Show"} Technical Error Details
                        </button>
                        {showDebugDetails && (
                          <pre className="mt-2 p-2 bg-neutral-950/80 rounded border border-neutral-800 text-neutral-400 overflow-x-auto whitespace-pre-wrap font-mono leading-normal text-[9px] max-h-40 overflow-y-auto select-all">
                            {JSON.stringify(loginErrorDetails, null, 2)}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              {/* Access Denied State */}
              <div className="space-y-4 mb-8 text-center bg-red-950/30 border border-red-500/20 p-5 rounded-2xl">
                <div className="w-12 h-12 rounded-full bg-red-500/10 text-red-400 flex items-center justify-center mx-auto mb-2">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold text-red-400">
                  This is an action man only zone.
                </h3>
                <p className="text-sm text-neutral-300 font-medium leading-relaxed">
                  No soup for you.
                </p>
                <div className="text-[10px] font-mono text-neutral-500 bg-neutral-950/80 p-2.5 rounded border border-neutral-800 mt-2 break-all">
                  Logged in as: <span className="text-neutral-300 font-semibold">{googleUser.email}</span>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handleLogout}
                  className="flex-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 hover:text-white font-semibold py-3 px-6 rounded-xl transition-all cursor-pointer text-sm"
                >
                  Disconnect Account
                </button>
              </div>
            </>
          )}

          {/* Footer branding */}
          <div className="mt-8 text-[10px] font-mono text-neutral-600">
            ACTION MAN EXECUTIVE COMMAND &bull; REF NO. 8892
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50 selection:bg-neutral-950 selection:text-white flex flex-col">
      <AnimatePresence mode="wait">
        {/* --- FOCUS MODE VIEW --- */}
        {isFocusMode ? (
          <motion.div
            key="focus-mode-view"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            className="fixed inset-0 z-50 bg-neutral-900 text-white flex flex-col justify-between p-6 sm:p-12 overflow-y-auto"
          >
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-neutral-800 pb-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-lg">
                  <Flame className="w-6 h-6 animate-pulse" />
                </div>
                <div>
                  <h2 className="text-xl font-display font-semibold tracking-tight">Focus Session</h2>
                  <p className="text-xs font-mono text-neutral-400 mt-0.5">
                    Currently tackling Today's priority roadmap
                  </p>
                </div>
              </div>

              <button
                onClick={() => {
                  setIsFocusMode(false);
                  setIsReviewingToday(true);
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 transition-colors text-sm font-medium border border-neutral-700"
              >
                <ArrowLeft className="w-4 h-4" />
                Return to Planner
              </button>
            </div>

            {/* Main Content Area */}
            <div className="max-w-2xl w-full mx-auto my-auto py-12 flex flex-col items-center text-center">
              {focusSuccessMessage ? (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-neutral-800 border border-neutral-700 rounded-2xl p-8 max-w-md flex flex-col items-center focus-glow"
                >
                  <div className="w-16 h-16 bg-emerald-500/10 text-emerald-400 rounded-full flex items-center justify-center mb-4">
                    <Check className="w-8 h-8" />
                  </div>
                  <h3 className="text-2xl font-display font-medium tracking-tight mb-2">Great job!</h3>
                  <p className="text-neutral-300 text-sm mb-6 leading-relaxed">{focusSuccessMessage}</p>
                  <button
                    onClick={() => {
                      setFocusSuccessMessage(null);
                      setIsFocusMode(false);
                      setIsReviewingToday(false);
                      setActiveHorizon("today");
                    }}
                    className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-medium py-3 px-6 rounded-xl transition-colors shadow-lg shadow-emerald-500/10"
                  >
                    Finish Session
                  </button>
                </motion.div>
              ) : focusTasks.length > 0 && focusIndex < focusTasks.length ? (
                <div className="w-full">
                  {/* Progress Indicators */}
                  <div className="flex justify-center items-center gap-2 mb-6 text-xs font-mono text-neutral-400 tracking-wider uppercase">
                    <span>Task {focusIndex + 1} of {focusTasks.length}</span>
                    <span>•</span>
                    <span className={focusTasks[focusIndex].isForceCritical ? "text-red-400 font-bold animate-pulse" : focusTasks[focusIndex].isMustDo ? "text-amber-400" : "text-emerald-400"}>
                      {focusTasks[focusIndex].isForceCritical ? "🔥 Critical Priority" : focusTasks[focusIndex].isMustDo ? "Must-Do Priority" : "Nice-To-Do Option"}
                    </span>
                  </div>

                  {/* Category & Deadlines */}
                  <div className="flex justify-center gap-2 mb-8">
                    {focusTasks[focusIndex].category === "north_star" && (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-300 border border-amber-500/20">
                        <Target className="w-3.5 h-3.5" />
                        North Star
                      </span>
                    )}
                    {focusTasks[focusIndex].category === "marketing" && (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-purple-500/10 text-purple-300 border border-purple-500/20">
                        <TrendingUp className="w-3.5 h-3.5" />
                        Marketing Priority
                      </span>
                    )}
                    {focusTasks[focusIndex].category === "maintenance" && (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-zinc-500/20 text-zinc-300 border border-zinc-500/30">
                        <Wrench className="w-3.5 h-3.5" />
                        Maintenance
                      </span>
                    )}
                    {focusTasks[focusIndex].dropDeadDate && (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-red-500/10 text-red-300 border border-red-500/20">
                        <AlertCircle className="w-3.5 h-3.5" />
                        Dead-line: {focusTasks[focusIndex].dropDeadDate}
                      </span>
                    )}
                  </div>

                  {/* Active Task Card */}
                  <motion.div
                    key={focusIndex}
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -15 }}
                    className="bg-neutral-800/50 border border-neutral-700/60 rounded-3xl p-10 mb-10 text-center shadow-xl shadow-black/10 backdrop-blur-sm"
                  >
                    <h1 className="text-3xl sm:text-4xl font-display font-medium tracking-tight text-white mb-6 leading-tight">
                      {focusTasks[focusIndex].title}
                    </h1>

                    {focusTasks[focusIndex].reasoning && (
                      <div className="max-w-md mx-auto pt-4 border-t border-neutral-700/50">
                        <p className="text-xs font-mono text-neutral-400 italic leading-relaxed">
                          " {focusTasks[focusIndex].reasoning} "
                        </p>
                      </div>
                    )}
                  </motion.div>

                  {/* Actions */}
                  <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                    <button
                      onClick={handleCompleteActiveFocusTask}
                      className="w-full sm:w-auto px-8 py-4 bg-emerald-500 hover:bg-emerald-600 text-neutral-900 hover:text-white font-medium rounded-xl text-lg transition-all shadow-lg hover:shadow-emerald-500/20 flex items-center justify-center gap-2 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                    >
                      <Check className="w-5 h-5" />
                      Mark Done, Next!
                    </button>

                    <button
                      onClick={handleSkipFocusTask}
                      className="w-full sm:w-auto px-6 py-4 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-xl font-medium transition-colors border border-neutral-700/60 flex items-center justify-center gap-1 text-sm"
                    >
                      Skip For Now
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12">
                  <CheckCircle2 className="w-16 h-16 text-emerald-400 mx-auto mb-4" />
                  <p className="text-lg font-medium">All caught up! No active focus items today.</p>
                </div>
              )}
            </div>

            {/* Bottom: Fast Distraction Brain Dump */}
            <div className="border-t border-neutral-800 pt-6">
              <div className="max-w-lg mx-auto">
                <p className="text-xs text-neutral-400 text-center mb-3">
                  Have a distracting thought, chore, or task pop up? Dump it here to keep your mind clear:
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={focusDumpText}
                    onChange={(e) => setFocusDumpText(e.target.value)}
                    placeholder="E.g. Remember to buy garbage bags tomorrow..."
                    onKeyDown={(e) => e.key === "Enter" && handleDumpThoughtInFocus()}
                    className="flex-1 bg-neutral-800/80 border border-neutral-700 rounded-lg px-4 py-2 text-sm text-white placeholder-neutral-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <button
                    onClick={handleDumpThoughtInFocus}
                    className="bg-neutral-700 hover:bg-neutral-600 border border-neutral-600 text-neutral-200 px-4 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition-colors"
                  >
                    Clear Mind
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        ) : (
          /* --- MAIN APPLICATION PLANNER VIEW --- */
          <div className="flex-1 flex flex-col">
            {/* Header */}
            <header className="bg-white border-b border-neutral-150 py-5 px-4 sm:px-8">
              <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                {/* Logo & Slogan */}
                <div className="flex items-center">
                  <div>
                    <h1 className="text-xl font-display font-bold tracking-tight text-neutral-900">
                      Action Man
                    </h1>
                    <p className="text-xs text-neutral-500 mt-0.5 font-mono">
                      High-Velocity Action Planner & Deadline Watchdog
                    </p>
                  </div>
                </div>

                {/* Date & State */}
                <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
                  {/* Database Sync Status & Re-Sync Control */}
                  <div className="flex items-center gap-2">
                    {dbStatus === "connecting" && (
                      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 text-xs font-mono">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-500" />
                        <span>Connecting...</span>
                      </div>
                    )}
                    {dbStatus === "synced" && (
                      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-mono">
                        <Cloud className="w-3.5 h-3.5 text-emerald-500" />
                        <span>Cloud Live Sync</span>
                      </div>
                    )}
                    {dbStatus === "offline" && (
                      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-100 text-neutral-600 border border-neutral-200 text-xs font-mono">
                        <CloudOff className="w-3.5 h-3.5 text-neutral-400" />
                        <span>Local Only</span>
                      </div>
                    )}
                    {dbStatus === "error" && (
                      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 text-red-700 border border-red-200 text-xs font-mono">
                        <AlertCircle className="w-3.5 h-3.5 text-red-500" />
                        <span>DB Offline</span>
                      </div>
                    )}

                    {/* Dedicated Dev Re-Sync Button */}
                    <button
                      onClick={handleReSyncAllData}
                      disabled={isReSyncing}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-mono font-bold transition-all cursor-pointer shadow-md active:scale-95 disabled:opacity-50 border border-emerald-500"
                      title="Re-sync and restore all tasks and goals from Cloud and local storage"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isReSyncing ? "animate-spin text-amber-300" : "text-white"}`} />
                      <span>{isReSyncing ? "Syncing..." : "🔄 Re-Sync Data"}</span>
                    </button>
                  </div>

                  {/* Navigation View Switcher */}
                  <div className="flex bg-neutral-100 p-1 rounded-xl border border-neutral-200">
                    <button
                      onClick={() => setActiveView("planner")}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                        activeView === "planner"
                          ? "bg-neutral-900 text-white shadow-sm"
                          : "text-neutral-500 hover:text-neutral-900"
                      }`}
                    >
                      <CalendarDays className="w-3.5 h-3.5" />
                      <span>Planner</span>
                    </button>
                    <button
                      onClick={() => {
                        setActiveView("triage");
                        if (accessToken && triagedEmails.length === 0) {
                          fetchTriagedEmails(accessToken);
                        }
                      }}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 relative ${
                        activeView === "triage"
                          ? "bg-neutral-900 text-white shadow-sm"
                          : "text-neutral-500 hover:text-neutral-900"
                      }`}
                    >
                      <Mail className="w-3.5 h-3.5" />
                      <span>Email Triage</span>
                      {triagedEmails.length > 0 && (
                        <span className="absolute -top-1.5 -right-1.5 px-1.5 py-0.25 bg-amber-500 text-neutral-950 font-black rounded-full text-[8px] font-mono shadow border border-white">
                          {triagedEmails.length}
                        </span>
                      )}
                    </button>
                  </div>

                  <div className="relative">
                    <button
                      onClick={() => setShowCalendarDropdown(!showCalendarDropdown)}
                      className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-neutral-100 hover:bg-neutral-200 text-neutral-700 border border-neutral-200 text-xs font-mono transition-all cursor-pointer select-none"
                    >
                      <Clock className="w-3.5 h-3.5 text-neutral-400" />
                      <span>{getHeaderDateString(new Date())}</span>
                      <ChevronDown className="w-3 h-3 text-neutral-400" />
                    </button>

                    <AnimatePresence>
                      {showCalendarDropdown && (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 10 }}
                          className="absolute right-0 mt-2 p-4 bg-white border border-neutral-200 rounded-xl shadow-xl z-50 w-72"
                        >
                          {renderCalendarGrid()}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {isReviewingToday && (
                    <button
                      onClick={() => setIsReviewingToday(false)}
                      className="text-xs font-medium text-neutral-600 hover:text-neutral-900 px-3 py-1.5 rounded-lg bg-neutral-100 hover:bg-neutral-200 transition-colors"
                    >
                      Exit Review
                    </button>
                  )}
                </div>
              </div>
            </header>

            {/* Main Layout Container */}
            <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-8 flex flex-col gap-8">
              {reSyncToast && (
                <div className="bg-neutral-900 text-white px-4 py-2.5 rounded-xl border border-neutral-700 shadow-md text-xs font-mono font-bold flex items-center justify-between animate-fade-in shrink-0">
                  <div className="flex items-center gap-2">
                    <Cloud className="w-4 h-4 text-emerald-400 animate-pulse" />
                    <span>{reSyncToast}</span>
                  </div>
                  <button onClick={() => setReSyncToast(null)} className="text-neutral-400 hover:text-white font-bold cursor-pointer text-sm">
                    ×
                  </button>
                </div>
              )}
              {activeView === "triage" && (
                <div className="flex flex-col gap-6">
                  {/* Header info */}
                  <div className="bg-white rounded-2xl border border-neutral-200 p-6 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4 animate-fade-in">
                    <div className="flex items-center gap-3">
                      <div className="p-3 bg-neutral-950 text-white rounded-xl">
                        <Mail className="w-6 h-6" />
                      </div>
                      <div>
                        <h2 className="text-lg font-bold text-neutral-900 font-display">Email Triage Control Room</h2>
                        <p className="text-xs text-neutral-500 mt-1">
                          AI-powered real-time parsing of your Gmail inbox (last 7 days) for high-velocity action conversion.
                        </p>
                      </div>
                    </div>

                    {googleUser && (
                      <div className="flex items-center gap-3 bg-neutral-50 px-4 py-2 rounded-xl border border-neutral-200 text-xs font-medium">
                        {googleUser.photoURL ? (
                          <img referrerPolicy="no-referrer" src={googleUser.photoURL} alt="Avatar" className="w-6 h-6 rounded-full" />
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-neutral-200 text-neutral-700 flex items-center justify-center font-bold">
                            {googleUser.email?.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <span className="text-neutral-700">{googleUser.email}</span>
                        <button
                          onClick={handleLogout}
                          className="text-red-600 hover:text-red-700 font-bold ml-2 transition-colors cursor-pointer"
                        >
                          Disconnect
                        </button>
                      </div>
                    )}
                  </div>

                  {needsAuth || !googleUser ? (
                    <div className="bg-white rounded-2xl border border-neutral-200 p-12 text-center shadow-sm max-w-xl mx-auto w-full my-6 flex flex-col items-center gap-6 animate-fade-in">
                      <div className="w-16 h-16 bg-neutral-100 rounded-2xl flex items-center justify-center text-neutral-400">
                        <Mail className="w-8 h-8" />
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-neutral-900 font-display">Connect your Gmail Inbox</h3>
                        <p className="text-xs text-neutral-500 mt-2 max-w-md mx-auto leading-relaxed">
                          We scan the last 7 days of your inbox using secure Google OAuth and Gemini to automatically filter out spam/newsletters and isolate renewals, bill reminders, and high-importance client requests.
                        </p>
                      </div>

                      <button
                        onClick={handleLogin}
                        className="px-6 py-3 bg-neutral-900 hover:bg-neutral-800 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2.5 shadow-md cursor-pointer"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24">
                          <path
                            fill="#EA4335"
                            d="M12.24 10.285V14.4h6.887c-.648 2.41-2.519 4.2-5.136 4.2A5.76 5.76 0 0 1 8.24 12.8a5.76 5.76 0 0 1 5.751-5.8c1.556 0 2.956.6 4.024 1.57l3.056-3.055A9.95 9.95 0 0 0 14 2 10 10 0 0 0 4 12a10 10 0 0 0 10 10c5.3 0 9.85-3.834 9.85-10 0-.6-.08-1.215-.224-1.715H12.24z"
                          />
                        </svg>
                        Sign In with Google
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-6 animate-fade-in">
                      {/* Triage Sub-Navigation Tabs */}
                      <div className="flex border-b border-neutral-200">
                        <button
                          onClick={() => setTriageSubView("inbox")}
                          className={`px-5 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
                            triageSubView === "inbox"
                              ? "border-neutral-900 border-b-neutral-900 text-neutral-900"
                              : "border-transparent text-neutral-400 hover:text-neutral-600 font-medium"
                          }`}
                        >
                          <Inbox className="w-3.5 h-3.5" />
                          <span>Actionable Inbox Emails</span>
                        </button>
                        <button
                          onClick={() => setTriageSubView("briefing")}
                          className={`px-5 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
                            triageSubView === "briefing"
                              ? "border-neutral-900 border-b-neutral-900 text-neutral-900"
                              : "border-transparent text-neutral-400 hover:text-neutral-600 font-medium"
                          }`}
                        >
                          <span>🌅 Morning Focus Briefing</span>
                          <span className="px-1.5 py-0.5 bg-neutral-950 text-white rounded text-[8px] font-mono uppercase">
                            Pro
                          </span>
                        </button>
                      </div>

                      {triageSubView === "inbox" ? (
                        <div className="flex flex-col gap-6">
                          {/* Actions and sync panel */}
                          <div className="flex justify-between items-center bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
                            <div className="text-xs text-neutral-500 font-semibold uppercase tracking-wider font-mono">
                              {triagedEmails.length > 0 ? `${triagedEmails.length} Actionable Items Surfaced` : "Ready to Triage"}
                            </div>
                            <button
                              onClick={() => fetchTriagedEmails()}
                              disabled={isTriageLoading}
                              className="px-4 py-2 bg-neutral-900 hover:bg-neutral-800 disabled:bg-neutral-200 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 cursor-pointer"
                            >
                              {isTriageLoading ? (
                                <>
                                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                  Triaging Inbox...
                                </>
                              ) : (
                                <>
                                  <RefreshCw className="w-3.5 h-3.5" />
                                  Sync & Refine Inbox
                                </>
                              )}
                            </button>
                          </div>

                          {/* Collapsible Ignored Rules Settings */}
                          {(ignoredSenders.length > 0 || ignoredDomains.length > 0 || ignoredEmails.length > 0) && (
                            <div className="bg-neutral-50 rounded-2xl border border-neutral-200 p-4 shadow-sm animate-fade-in text-left">
                              <button
                                onClick={() => setShowMutedSettings(!showMutedSettings)}
                                className="w-full flex justify-between items-center text-xs font-bold font-mono tracking-wider text-neutral-600 uppercase hover:text-neutral-900 transition-colors"
                              >
                                <span className="flex items-center gap-2">🔇 Muted Senders, Domains & Emails ({ignoredSenders.length + ignoredDomains.length + ignoredEmails.length})</span>
                                <span className="text-neutral-400 text-[10px]">{showMutedSettings ? "Collapse ▲" : "Expand ▼"}</span>
                              </button>

                              {showMutedSettings && (
                                <div className="mt-4 pt-4 border-t border-neutral-200 space-y-4">
                                  {ignoredEmails.length > 0 && (
                                    <div>
                                      <div className="text-[9px] font-bold font-mono text-neutral-400 uppercase tracking-wider mb-2">Muted Specific Emails</div>
                                      <div className="flex flex-wrap gap-2">
                                        {ignoredEmails.map((emailId) => (
                                          <span key={emailId} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-neutral-200 rounded-lg text-[11px] font-medium text-neutral-700 shadow-sm">
                                            <span className="font-mono text-neutral-600">ID: {emailId}</span>
                                            <button
                                              onClick={() => handleRemoveIgnoreSpecificEmail(emailId)}
                                              className="w-4 h-4 rounded-full flex items-center justify-center hover:bg-neutral-100 text-neutral-400 hover:text-red-500 transition-colors text-xs font-bold cursor-pointer"
                                              title="Unmute this specific email"
                                            >
                                              ×
                                            </button>
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {ignoredSenders.length > 0 && (
                                    <div>
                                      <div className="text-[9px] font-bold font-mono text-neutral-400 uppercase tracking-wider mb-2">Muted Sender Emails</div>
                                      <div className="flex flex-wrap gap-2">
                                        {ignoredSenders.map((sender) => (
                                          <span key={sender} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-neutral-200 rounded-lg text-[11px] font-medium text-neutral-700 shadow-sm">
                                            <span className="font-mono text-neutral-600">{sender}</span>
                                            <button
                                              onClick={() => handleRemoveIgnoreRule(sender, "sender")}
                                              className="w-4 h-4 rounded-full flex items-center justify-center hover:bg-neutral-100 text-neutral-400 hover:text-red-500 transition-colors text-xs font-bold cursor-pointer"
                                              title="Unmute sender"
                                            >
                                              ×
                                            </button>
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {ignoredDomains.length > 0 && (
                                    <div>
                                      <div className="text-[9px] font-bold font-mono text-neutral-400 uppercase tracking-wider mb-2">Muted Domains</div>
                                      <div className="flex flex-wrap gap-2">
                                        {ignoredDomains.map((domain) => (
                                          <span key={domain} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-neutral-200 rounded-lg text-[11px] font-medium text-neutral-700 shadow-sm">
                                            <span className="font-mono text-neutral-600">{domain}</span>
                                            <button
                                              onClick={() => handleRemoveIgnoreRule(domain, "domain")}
                                              className="w-4 h-4 rounded-full flex items-center justify-center hover:bg-neutral-100 text-neutral-400 hover:text-red-500 transition-colors text-xs font-bold cursor-pointer"
                                              title="Unmute domain"
                                            >
                                              ×
                                            </button>
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          {isTriageLoading && (
                            <div className="bg-white rounded-2xl border border-neutral-200 p-12 text-center shadow-sm flex flex-col items-center gap-4">
                              <RefreshCw className="w-8 h-8 text-neutral-900 animate-spin" />
                              <div>
                                <h4 className="text-sm font-bold text-neutral-800">Reading Recent Messages</h4>
                                <p className="text-xs text-neutral-400 mt-1.5 max-w-sm mx-auto">
                                  Gemini is scanning your inbox summaries from the last 14 days to flag bill deadlines, hosting renewals, and core action items.
                                </p>
                              </div>
                            </div>
                          )}

                          {triageError && (
                            <div className="bg-red-50 border border-red-200 text-red-800 rounded-2xl p-6 flex items-start gap-3 animate-fade-in">
                              <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                              <div>
                                <h4 className="font-bold text-xs uppercase tracking-wider">Sync Failure</h4>
                                <p className="text-xs mt-1 text-red-700 leading-relaxed">{triageError}</p>
                                <button
                                  onClick={() => fetchTriagedEmails()}
                                  className="mt-3 text-xs bg-red-100 hover:bg-red-200 text-red-800 font-bold px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                                >
                                  Retry Triage
                                </button>
                              </div>
                            </div>
                          )}

                          {!isTriageLoading && !triageError && triagedEmails.length === 0 && (
                            <div className="bg-white rounded-2xl border border-neutral-200 p-12 text-center shadow-sm flex flex-col items-center gap-4 max-w-xl mx-auto w-full my-6 animate-fade-in">
                              <div className="w-12 h-12 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600">
                                <CheckCircle2 className="w-6 h-6" />
                              </div>
                              <div>
                                <h4 className="text-sm font-bold text-neutral-900 font-display">Inbox Zero Actionable Items!</h4>
                                <p className="text-xs text-neutral-400 mt-2 leading-relaxed">
                                  No critical renewals, bills, or high-urgency client requests were detected in your inbox for the last 7 days. Your slate is clean!
                                </p>
                              </div>
                              <button
                                onClick={() => fetchTriagedEmails()}
                                className="mt-2 text-xs bg-neutral-100 hover:bg-neutral-200 text-neutral-800 font-bold px-4 py-2 rounded-xl transition-colors cursor-pointer"
                              >
                                Re-Scan Inbox
                              </button>
                            </div>
                          )}

                          {!isTriageLoading && !triageError && triagedEmails.length > 0 && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-fade-in">
                              {triagedEmails.map((email: any) => {
                                const isConverted = convertedEmailIds.includes(email.emailId);
                                return (
                                  <div
                                    key={email.emailId}
                                    className={`bg-white rounded-2xl border transition-all p-5 flex flex-col justify-between shadow-sm hover:shadow-md ${
                                      isConverted ? "border-emerald-200 bg-emerald-50/10" : "border-neutral-200"
                                    }`}
                                  >
                                    <div>
                                      {/* Header Details */}
                                      <div className="flex justify-between items-start gap-4 mb-3">
                                        <div className="min-w-0">
                                          <span className="text-[10px] font-bold font-mono tracking-wider text-neutral-400 uppercase">
                                            FROM: {email.from}
                                          </span>
                                          <h4 className="text-xs font-bold text-neutral-800 truncate mt-0.5" title={email.subject}>
                                            {email.subject}
                                          </h4>
                                        </div>
                                        <span className="text-[10px] font-mono text-neutral-400 shrink-0">
                                          {email.date ? new Date(email.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "Recent"}
                                        </span>
                                      </div>

                                      {/* Body Snippet */}
                                      <p className="text-[11px] text-neutral-500 bg-neutral-50 rounded-lg p-2.5 border border-neutral-100 line-clamp-2 leading-relaxed italic mb-4">
                                        "{email.snippet}"
                                      </p>

                                      {/* AI Recommendation Board */}
                                      <div className="border-t border-neutral-100 pt-4 mb-5">
                                        <div className="flex items-center gap-1.5 mb-2">
                                          <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                                          <span className="text-[10px] font-bold tracking-wider text-neutral-700 uppercase">
                                            AI Triage Recommendation
                                          </span>
                                        </div>

                                        <div className="space-y-2.5">
                                          <div>
                                            <span className="text-[9px] font-bold font-mono uppercase tracking-wider text-neutral-400">
                                              Suggested Task
                                            </span>
                                            <p className="text-xs font-bold text-neutral-900 leading-tight">
                                              {email.suggestedTitle}
                                            </p>
                                          </div>

                                          <div>
                                            <span className="text-[9px] font-bold font-mono uppercase tracking-wider text-neutral-400">
                                              Why it Matters
                                            </span>
                                            <p className="text-xs text-neutral-600 font-medium leading-relaxed">
                                              {email.importanceReason}
                                            </p>
                                          </div>

                                          <div className="flex gap-4">
                                            <div>
                                              <span className="text-[9px] font-bold font-mono uppercase tracking-wider text-neutral-400 block">
                                                Priority
                                              </span>
                                              <span className={`text-[10px] font-mono font-bold uppercase ${
                                                email.suggestedPriority === "high"
                                                  ? "text-red-600"
                                                  : email.suggestedPriority === "medium"
                                                  ? "text-amber-600"
                                                  : "text-neutral-600"
                                              }`}>
                                                ● {email.suggestedPriority}
                                              </span>
                                            </div>

                                            <div>
                                              <span className="text-[9px] font-bold font-mono uppercase tracking-wider text-neutral-400 block">
                                                Horizon
                                              </span>
                                              <span className="text-[10px] font-mono text-neutral-700 font-semibold uppercase">
                                                {email.suggestedHorizon?.replace("_", " ")}
                                              </span>
                                            </div>

                                            <div>
                                              <span className="text-[9px] font-bold font-mono uppercase tracking-wider text-neutral-400 block">
                                                Category
                                              </span>
                                              <span className="text-[10px] font-mono text-neutral-700 font-semibold uppercase">
                                                {email.suggestedCategory}
                                              </span>
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    </div>

                                    <div className="border-t border-neutral-100 pt-4 flex justify-between items-center gap-2">
                                      <div className="flex gap-1.5">
                                        <button
                                          onClick={() => handleIgnoreSpecificEmail(email.emailId || email.id)}
                                          className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 hover:text-red-600 hover:bg-red-50/60 border border-transparent hover:border-red-100 px-2 py-1 rounded-lg transition-all cursor-pointer"
                                          title="Ignore this specific email only from future scenes"
                                        >
                                          Ignore
                                        </button>
                                        <button
                                          onClick={() => handleIgnoreEmailSource(email, "sender")}
                                          className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 hover:text-red-600 hover:bg-red-50/60 border border-transparent hover:border-red-100 px-2 py-1 rounded-lg transition-all cursor-pointer"
                                          title="Ignore any future emails from this exact sender address"
                                        >
                                          Mute Sender
                                        </button>
                                        <button
                                          onClick={() => handleIgnoreEmailSource(email, "domain")}
                                          className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 hover:text-red-600 hover:bg-red-50/60 border border-transparent hover:border-red-100 px-2 py-1 rounded-lg transition-all cursor-pointer"
                                          title="Ignore any future emails from this entire domain"
                                        >
                                          Mute Domain
                                        </button>
                                      </div>

                                      {isConverted ? (
                                        <div className="flex items-center gap-1 px-4 py-2 bg-emerald-100 text-emerald-800 rounded-xl text-xs font-bold uppercase tracking-wider shadow-sm select-none border border-emerald-200">
                                          <Check className="w-3.5 h-3.5" />
                                          <span>Converted to Task</span>
                                        </div>
                                      ) : (
                                        <button
                                          onClick={() => handleConvertEmailToTask(email)}
                                          className="px-4 py-2 bg-neutral-900 hover:bg-neutral-800 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all shadow-sm cursor-pointer flex items-center gap-1.5 shrink-0"
                                        >
                                          <Plus className="w-3.5 h-3.5" />
                                          <span>Convert to Task</span>
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-col gap-8 animate-fade-in text-left">
                          {/* Top Card: Settings and Send trigger */}
                          <div className="bg-white rounded-2xl border border-neutral-200 p-6 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                            <div className="max-w-xl">
                              <h3 className="text-sm font-bold text-neutral-900 flex items-center gap-2">
                                <span>Morning Briefing Automation</span>
                                <span className="px-1.5 py-0.5 bg-neutral-900 text-white rounded text-[9px] font-mono font-bold uppercase tracking-wider">
                                  GMAIL.SEND
                                </span>
                              </h3>
                              <p className="text-xs text-neutral-500 mt-1 leading-relaxed">
                                Action Man can automatically generate and email you a high-performance morning strategy overview every single morning. The email comes directly from you, to you, avoiding third-party servers and ensuring total privacy.
                              </p>

                              {/* Toggle auto send */}
                              <label className="flex items-center gap-2.5 mt-4 cursor-pointer group">
                                <input
                                  type="checkbox"
                                  checked={autoSendDailySummary}
                                  onChange={(e) => {
                                    const val = e.target.checked;
                                    setAutoSendDailySummary(val);
                                    safeLocalStorage.setItem("auto_send_daily_summary", val ? "true" : "false");
                                  }}
                                  className="w-4 h-4 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900"
                                />
                                <span className="text-xs font-bold text-neutral-700 group-hover:text-neutral-950 transition-colors">
                                  Enable automatic morning email on first app load of the day
                                </span>
                              </label>
                            </div>

                            <div className="flex flex-col sm:flex-row md:flex-col gap-3 shrink-0 w-full md:w-auto">
                              <button
                                onClick={handleSendDailyBriefing}
                                disabled={isBriefingSending}
                                className="px-5 py-3 bg-neutral-900 hover:bg-neutral-800 disabled:bg-neutral-200 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2.5 shadow-md cursor-pointer"
                              >
                                {isBriefingSending ? (
                                  <>
                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                    <span>Sending Daily Briefing...</span>
                                  </>
                                ) : (
                                  <>
                                    <Send className="w-4 h-4" />
                                    <span>Send Morning Briefing Now</span>
                                  </>
                                )}
                              </button>

                              {lastSentDailySummaryDate && (
                                <div className="text-[10px] text-neutral-400 font-mono text-center">
                                  Last sent: {lastSentDailySummaryDate}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Success or Error states */}
                          {briefingSentSuccess && (
                            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 flex items-start gap-3.5 animate-fade-in shadow-sm">
                              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                              <div className="flex-1">
                                <h4 className="text-xs font-bold text-emerald-800 uppercase tracking-wider">
                                  Briefing Email Sent Successfully!
                                </h4>
                                <p className="text-xs text-emerald-700 mt-1 leading-relaxed">
                                  A beautiful custom-styled focus briefing has been successfully sent to your inbox ({googleUser.email}). Grab your coffee, check your mail app, and take charge of the day.
                                </p>
                                {briefingCoachCommentary && (
                                  <div className="mt-4 bg-white/80 border border-emerald-100/60 p-4 rounded-xl">
                                    <span className="text-[10px] font-bold font-mono tracking-wider text-neutral-400 uppercase">
                                      COACHING EXCERPT
                                    </span>
                                    <p className="text-xs italic text-neutral-800 mt-1.5 leading-relaxed">
                                      "{briefingCoachCommentary}"
                                    </p>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {briefingError && (
                            <div className="bg-red-50 border border-red-200 rounded-2xl p-6 flex items-start gap-3.5 animate-fade-in shadow-sm">
                              <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                              <div>
                                <h4 className="text-xs font-bold text-red-800 uppercase tracking-wider">
                                  Delivery Failure
                                </h4>
                                <p className="text-xs text-red-700 mt-1 leading-relaxed">
                                  {briefingError}
                                </p>
                              </div>
                            </div>
                          )}

                          {/* Email Simulator Grid */}
                          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                            {/* Controls / Info Left */}
                            <div className="lg:col-span-4 flex flex-col gap-6">
                              <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-sm">
                                <h4 className="text-xs font-bold text-neutral-900 uppercase tracking-wider font-mono mb-4">
                                  How It Works
                                </h4>
                                <ul className="flex flex-col gap-4 text-xs text-neutral-600">
                                  <li className="flex gap-2.5">
                                    <span className="font-bold text-neutral-900">1.</span>
                                    <span>
                                      <strong>Gathers priorities:</strong> Consolidates today's critical "Must-Dos", "Nice-to-Dos" and your active North Star.
                                    </span>
                                  </li>
                                  <li className="flex gap-2.5">
                                    <span className="font-bold text-neutral-900">2.</span>
                                    <span>
                                      <strong>Inbox Triage integration:</strong> Seamlessly appends unresolved critical email alerts from your inbox.
                                    </span>
                                  </li>
                                  <li className="flex gap-2.5">
                                    <span className="font-bold text-neutral-900">3.</span>
                                    <span>
                                      <strong>High-performance coaching:</strong> Feeds this context to Gemini to synthesize a personalized, direct daily strategy paragraph.
                                    </span>
                                  </li>
                                  <li className="flex gap-2.5">
                                    <span className="font-bold text-neutral-900">4.</span>
                                    <span>
                                      <strong>Responsive HTML Template:</strong> Packages it into a gorgeous newsletter format and transmits it through your personal Gmail API.
                                    </span>
                                  </li>
                                </ul>
                              </div>

                              <div className="bg-neutral-50 rounded-2xl border border-neutral-200/60 p-5">
                                <h4 className="text-xs font-bold text-neutral-800 uppercase tracking-wider font-mono mb-2">
                                  Current Inputs Ready
                                </h4>
                                <div className="flex flex-col gap-3 text-xs">
                                  <div className="flex justify-between items-center py-1.5 border-b border-neutral-200/50">
                                    <span className="text-neutral-500">North Star Goal:</span>
                                    <span className="font-semibold text-neutral-800 truncate max-w-[120px]">
                                      {northStar.title || "None specified"}
                                    </span>
                                  </div>
                                  <div className="flex justify-between items-center py-1.5 border-b border-neutral-200/50">
                                    <span className="text-neutral-500">Today's Must-Dos:</span>
                                    <span className="font-bold text-red-600 font-mono">
                                      {tasks.filter(t => t.horizon === "today" && (t.isMustDo || t.priority === "high")).length}
                                    </span>
                                  </div>
                                  <div className="flex justify-between items-center py-1.5 border-b border-neutral-200/50">
                                    <span className="text-neutral-500">Today's Nice-to-Dos:</span>
                                    <span className="font-bold text-emerald-600 font-mono">
                                      {tasks.filter(t => t.horizon === "today" && !t.isMustDo && t.priority !== "high").length}
                                    </span>
                                  </div>
                                  <div className="flex justify-between items-center py-1.5">
                                    <span className="text-neutral-500">Triaged Email Alerts:</span>
                                    <span className="font-bold text-amber-600 font-mono">
                                      {triagedEmails.length}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Live Interactive Simulation Preview Right */}
                            <div className="lg:col-span-8">
                              <div className="bg-neutral-100 rounded-2xl border border-neutral-200 p-4 sm:p-6 shadow-inner">
                                <div className="text-[10px] text-neutral-400 font-bold font-mono tracking-wider mb-3 flex items-center justify-between">
                                  <span>LIVE INTERACTIVE PREVIEW</span>
                                  <span>HTML FORMAT</span>
                                </div>

                                <div className="bg-white border border-neutral-200 rounded-xl p-6 sm:p-8 shadow-sm max-w-[600px] mx-auto text-left font-sans text-neutral-900 leading-normal">
                                  {/* Template Header */}
                                  <div className="border-b border-neutral-100 pb-4 mb-6">
                                    <div className="text-lg font-extrabold uppercase tracking-widest text-neutral-950 font-display">
                                      Action Man
                                    </div>
                                    <div className="text-[10px] font-mono text-neutral-400 uppercase tracking-wider mt-1">
                                      Morning Briefing &bull; {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                                    </div>
                                  </div>

                                  {/* Template Goal */}
                                  {northStar.title && (
                                    <div className="bg-neutral-50 rounded-lg p-3 border border-neutral-100 mb-6 text-xs">
                                      <div className="font-bold font-mono text-[9px] tracking-wider text-neutral-400 uppercase">
                                        CURRENT NORTH STAR
                                      </div>
                                      <div className="font-bold text-neutral-800 mt-0.5">{northStar.title}</div>
                                      <div className="text-neutral-500 mt-0.5">{northStar.description}</div>
                                    </div>
                                  )}

                                  {/* Template Commentary */}
                                  <div className="bg-neutral-950 text-white rounded-xl p-5 mb-6 text-xs">
                                    <div className="font-bold font-mono text-[9px] tracking-wider text-neutral-400 uppercase mb-1.5">
                                      COACH COMMENTARY (AUTO-GENERATED)
                                    </div>
                                    <p className="italic text-neutral-200 font-medium leading-relaxed font-sans">
                                      "{briefingCoachCommentary || "Generate or click Send above to stream Gemini coaching insights tailored specifically to today's workload."}"
                                    </p>
                                  </div>

                                  {/* Template Must-Dos */}
                                  <div className="mb-6">
                                    <div className="font-bold font-mono text-[9px] tracking-wider text-neutral-400 uppercase mb-2">
                                      1. TODAY'S MUST-DOS
                                    </div>
                                    {tasks.filter(t => t.horizon === "today" && (t.isMustDo || t.priority === "high")).length > 0 ? (
                                      tasks.filter(t => t.horizon === "today" && (t.isMustDo || t.priority === "high")).map((t, idx) => (
                                        <div key={idx} className="border-b border-neutral-50 py-2 text-xs flex items-center justify-between">
                                          <div className="flex items-center gap-2">
                                            <span className="text-[9px] font-bold font-mono bg-red-50 text-red-700 border border-red-100 px-1 py-0.25 rounded uppercase">
                                              Must Do
                                            </span>
                                            <span className="font-bold text-neutral-800">{t.title}</span>
                                          </div>
                                        </div>
                                      ))
                                    ) : (
                                      <div className="text-neutral-400 py-3 text-xs italic text-center">
                                        No critical Must-Do scheduled. Focus on defining your top priority!
                                      </div>
                                    )}
                                  </div>

                                  {/* Template Nice-to-Dos */}
                                  <div className="mb-6">
                                    <div className="font-bold font-mono text-[9px] tracking-wider text-neutral-400 uppercase mb-2">
                                      2. NICE-TO-DOS
                                    </div>
                                    {tasks.filter(t => t.horizon === "today" && !t.isMustDo && t.priority !== "high").length > 0 ? (
                                      tasks.filter(t => t.horizon === "today" && !t.isMustDo && t.priority !== "high").map((t, idx) => (
                                        <div key={idx} className="border-b border-neutral-50 py-2 text-xs flex items-center justify-between">
                                          <div className="flex items-center gap-2">
                                            <span className="text-[9px] font-bold font-mono bg-emerald-50 text-emerald-700 border border-emerald-100 px-1 py-0.25 rounded uppercase">
                                              Nice to Do
                                            </span>
                                            <span className="font-medium text-neutral-700">{t.title}</span>
                                          </div>
                                        </div>
                                      ))
                                    ) : (
                                      <div className="text-neutral-400 py-3 text-xs italic text-center">
                                        No secondary tasks for today. Keep it ultra-focused!
                                      </div>
                                    )}
                                  </div>

                                  {/* Template Emails */}
                                  <div className="mb-8">
                                    <div className="font-bold font-mono text-[9px] tracking-wider text-neutral-400 uppercase mb-2">
                                      3. UNRESOLVED GMAIL ACTIONS
                                    </div>
                                    {triagedEmails.length > 0 ? (
                                      triagedEmails.map((e, idx) => (
                                        <div key={idx} className="border-b border-neutral-50 py-2.5 text-xs">
                                          <div className="text-[9px] font-mono text-neutral-400 mb-0.5">FROM: {e.from}</div>
                                          <div className="flex items-center gap-1.5 flex-wrap">
                                            <span className="text-[9px] font-bold font-mono bg-amber-50 text-amber-700 border border-amber-100 px-1 py-0.25 rounded uppercase">
                                              Surfaced Alert
                                            </span>
                                            <span className="font-semibold text-neutral-800">{e.suggestedTitle}</span>
                                          </div>
                                        </div>
                                      ))
                                    ) : (
                                      <div className="text-neutral-400 py-3 text-xs italic text-center">
                                        Inbox clear of urgent renewals, billing alerts, or critical tasks.
                                      </div>
                                    )}
                                  </div>

                                  {/* Template Action Link */}
                                  <div className="text-center pt-5 border-t border-neutral-100 mt-6">
                                    <span className="bg-neutral-950 text-white font-bold text-xs uppercase tracking-wider py-2 px-6 rounded-lg inline-block shadow-sm">
                                      Open Focus Dashboard
                                    </span>
                                    <div className="text-[9px] font-mono text-neutral-400 mt-3 uppercase tracking-wider">
                                      ACTION MAN &bull; PERSONAL COGNITIVE SPACE
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {activeView === "planner" && (
                <>
                  {isViewingNorthStarHistory ? (
                    /* --- NORTH STAR HISTORY VIEW --- */
                    <div className="flex flex-col gap-6 text-left">
                      {/* Header with Back Button */}
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white rounded-2xl border border-neutral-200 p-5 sm:p-6 shadow-sm">
                        <div className="flex items-center gap-3.5">
                          <div className="p-2.5 bg-amber-500/10 text-amber-700 rounded-xl">
                            <Target className="w-5.5 h-5.5" />
                          </div>
                          <div>
                            <h2 className="text-lg font-bold text-neutral-900">North Star Audit Log</h2>
                            <p className="text-xs text-neutral-500 mt-0.5 leading-relaxed">
                              Track your core long-term objectives over time. Reappoint any past goal as active.
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => setIsViewingNorthStarHistory(false)}
                          className="text-xs font-medium text-neutral-700 bg-neutral-100 hover:bg-neutral-200 px-4 py-2 rounded-xl border border-neutral-200 hover:border-neutral-300 transition-all flex items-center gap-1.5 cursor-pointer shrink-0"
                        >
                          ← Back to Planner
                        </button>
                      </div>

                      {/* History List */}
                      <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden p-5 sm:p-6 space-y-4">
                        <h3 className="text-xs font-bold text-neutral-400 uppercase tracking-wider font-mono">
                          Previously Used Objectives ({northStar.history?.length || 0})
                        </h3>

                        {(!northStar.history || northStar.history.length === 0) ? (
                          <div className="text-center py-12 text-neutral-400 text-sm">
                            <p className="italic">No previously saved North Star objectives found.</p>
                            <p className="text-xs text-neutral-400 mt-1">Save a North Star goal on your main planner board to log it here.</p>
                          </div>
                        ) : (
                          <div className="divide-y divide-neutral-150">
                            {[...northStar.history]
                              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                              .map((item) => {
                                const isActive =
                                  northStar.title === item.title &&
                                  northStar.description === item.description;
                                return (
                                  <div
                                    key={item.id}
                                    onClick={() => handleReappointNorthStar(item)}
                                    className={`py-4 flex items-start gap-4 transition-all duration-200 rounded-xl px-4 -mx-4 cursor-pointer ${
                                      isActive
                                        ? "bg-amber-500/5 border border-amber-500/10"
                                        : "hover:bg-neutral-50 border border-transparent"
                                    }`}
                                  >
                                    <div className="pt-0.5">
                                      <input
                                        type="radio"
                                        name="active-north-star"
                                        checked={isActive}
                                        onChange={() => handleReappointNorthStar(item)}
                                        className="w-4 h-4 text-amber-600 focus:ring-amber-500 border-neutral-300 cursor-pointer"
                                      />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <h4 className="text-sm font-bold text-neutral-900 leading-tight">
                                          {item.title}
                                        </h4>
                                        {isActive && (
                                          <span className="text-[9px] font-bold font-mono tracking-wider text-amber-800 uppercase bg-amber-500/10 px-2 py-0.5 rounded">
                                            ACTIVE NORTH STAR
                                          </span>
                                        )}
                                      </div>
                                      <p className="text-xs text-neutral-600 mt-1 leading-relaxed">
                                        {item.description || "No further details specified."}
                                      </p>
                                      <div className="flex items-center justify-between mt-2">
                                        <span className="text-[10px] text-neutral-400 font-mono">
                                          Saved: {new Date(item.createdAt).toLocaleString()}
                                        </span>
                                        <button
                                          onClick={(e) => handleDeleteHistoryItem(item.id, e)}
                                          className="text-[10px] text-neutral-400 hover:text-red-600 font-medium hover:underline flex items-center gap-1 cursor-pointer"
                                          title="Delete from history"
                                        >
                                          <Trash2 className="w-3 h-3" />
                                          Delete
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* --- NORTH STAR CONFIGURATION --- */}
                      <section className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
                        <div className="p-5 sm:p-6 flex flex-col md:flex-row justify-between items-start gap-4">
                          <div className="flex gap-3.5 flex-1">
                            <div className="p-2.5 bg-amber-500/10 text-amber-700 rounded-xl h-fit">
                              <Target className="w-5.5 h-5.5" />
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold font-mono tracking-wider text-amber-800 uppercase bg-amber-500/10 px-2 py-0.5 rounded">
                                  Current North Star Goal
                                </span>
                              </div>
                              {isEditingNorthStar ? (
                                <div className="mt-3 flex flex-col gap-2.5">
                                  <input
                                    type="text"
                                    value={nsTitleInput}
                                    onChange={(e) => setNsTitleInput(e.target.value)}
                                    placeholder="State your single core North Star objective..."
                                    className="w-full bg-neutral-50 border border-neutral-300 rounded-lg px-3 py-1.5 text-sm text-neutral-900 font-medium focus:outline-none focus:ring-1 focus:ring-neutral-900"
                                  />
                                  <textarea
                                    value={nsDescInput}
                                    onChange={(e) => setNsDescInput(e.target.value)}
                                    placeholder="Add more context, details, or specific sub-metrics..."
                                    className="w-full bg-neutral-50 border border-neutral-300 rounded-lg px-3 py-1.5 text-xs text-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-900 h-16"
                                  />
                                  <div className="flex gap-2 justify-end">
                                    <button
                                      onClick={() => setIsEditingNorthStar(false)}
                                      className="text-xs font-medium px-3 py-1.5 rounded bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      onClick={handleSaveNorthStar}
                                      className="text-xs font-medium px-3 py-1.5 rounded bg-neutral-900 text-white hover:bg-neutral-800"
                                    >
                                      Save North Star
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="mt-1.5">
                                  <h3 className="text-base font-medium text-neutral-900">
                                    {northStar.title || "Define your long-term focus (e.g. Scale business to $20k/month)"}
                                  </h3>
                                  <p className="text-xs text-neutral-500 mt-0.5 leading-relaxed">
                                    {northStar.description || "Align your daily high-velocity actions directly with this overarching objective."}
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>

                          {!isEditingNorthStar && (
                            <div className="flex flex-wrap gap-2 shrink-0">
                              <button
                                onClick={() => {
                                  setNsTitleInput(northStar.title);
                                  setNsDescInput(northStar.description);
                                  setIsEditingNorthStar(true);
                                }}
                                className="text-xs font-medium text-neutral-600 hover:text-neutral-900 px-3 py-1.5 rounded-lg border border-neutral-200 hover:bg-neutral-50 transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                                Refine North Star
                              </button>
                              <button
                                onClick={() => setIsViewingNorthStarHistory(true)}
                                className="text-xs font-medium text-amber-700 hover:text-amber-800 bg-amber-505/10 bg-amber-500/10 hover:bg-amber-500/15 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer"
                              >
                                <History className="w-3.5 h-3.5" />
                                North Star History ({northStar.history?.length || 0})
                              </button>
                            </div>
                          )}
                        </div>
                      </section>



              {/* --- REVIEW MODE HEADER OR PLANNER BOARD --- */}
              {isReviewingToday ? (
                /* --- TODAY REVIEW & COACHING INTERFACE --- */
                <div className="flex flex-col gap-6">
                  {/* Coach Advice Banner */}
                  <div className="bg-neutral-900 text-white rounded-2xl border border-neutral-800 overflow-hidden shadow-md">
                    <div className="p-6 sm:p-8">
                      <div className="flex items-center gap-2 mb-4">
                        <div className="p-1.5 bg-emerald-500/10 text-emerald-400 rounded-md">
                          <Sparkles className="w-5 h-5" />
                        </div>
                        <span className="text-xs font-mono font-bold tracking-wider text-emerald-400 uppercase">
                          AI Coach Review
                        </span>
                      </div>

                      {isCoaching ? (
                        <div className="py-6 flex flex-col items-center gap-3">
                          <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin" />
                          <p className="text-sm font-mono text-neutral-400">
                            Analyzing tasks & North Star alignment...
                          </p>
                        </div>
                      ) : (
                        <div>
                          <p className="text-base sm:text-lg text-neutral-100 font-medium leading-relaxed italic">
                            "{coachFeedback?.coachMessage || "Let's review what's actually critical today. Make sure to prioritize drop-dead dates and North Star goals."}"
                          </p>
                          <div className="mt-4 flex flex-wrap gap-4 text-xs font-mono text-neutral-400">
                            <span>
                              🎯 North Star Tasks:{" "}
                              <strong className="text-neutral-200">
                                {tasks.filter((t) => t.horizon === "today" && t.category === "north_star" && !t.completed).length}
                              </strong>
                            </span>
                            <span>
                              🔧 Maintenance Chores:{" "}
                              <strong className="text-neutral-200">
                                {tasks.filter((t) => t.horizon === "today" && t.category === "maintenance" && !t.completed).length}
                              </strong>{" "}
                              (Automatically filtered)
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Division into Must-Dos and Nice-To-Dos */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Must-Dos */}
                    <div className="bg-white rounded-2xl border border-neutral-200 p-5 sm:p-6 shadow-sm">
                      <div className="flex justify-between items-center mb-4 border-b border-neutral-100 pb-3">
                        <h3 className="font-display font-semibold text-neutral-900 flex items-center gap-2 text-base">
                          <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse"></span>
                          Recommended Must-Dos
                        </h3>
                        <span className="text-xs font-mono bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 rounded-full">
                          Top Priority
                        </span>
                      </div>

                      <div className="flex flex-col gap-3 min-h-[150px]">
                        {tasks.filter((t) => t.horizon === "today" && t.isMustDo && !t.completed).length === 0 ? (
                          <div className="my-auto text-center py-8 text-neutral-400 text-xs">
                            No must-dos assigned. Click a task's banner to push it here.
                          </div>
                        ) : (
                          tasks
                            .filter((t) => t.horizon === "today" && t.isMustDo && !t.completed)
                            .map((task) => (
                              <div
                                key={task.id}
                                className="p-3.5 bg-amber-50/40 hover:bg-amber-50/70 border border-amber-200 rounded-xl transition-all flex items-start justify-between gap-3"
                              >
                                <div className="flex-1">
                                  <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                                    <span className="text-[10px] font-mono bg-amber-500/10 text-amber-800 px-1.5 py-0.25 rounded uppercase">
                                      {task.category}
                                    </span>
                                    {task.dropDeadDate && (
                                      <span className="text-[10px] font-mono bg-red-50 text-red-700 px-1.5 py-0.25 rounded">
                                        Drop-dead: {task.dropDeadDate}
                                      </span>
                                    )}
                                  </div>
                                  <h4 className="text-sm font-medium text-neutral-900">{task.title}</h4>
                                  {task.reasoning && (
                                    <p className="text-[11px] text-neutral-500 mt-1 leading-relaxed">
                                      {task.reasoning}
                                    </p>
                                  )}
                                </div>
                                <button
                                  onClick={() => handleSetFocusTypeInReview(task.id, false)}
                                  className="text-xs font-medium text-neutral-500 hover:text-neutral-800 px-2.5 py-1.5 rounded-lg border border-neutral-200 hover:bg-white"
                                >
                                  Make Nice-do
                                </button>
                              </div>
                            ))
                        )}
                      </div>
                    </div>

                    {/* Nice-To-Dos */}
                    <div className="bg-white rounded-2xl border border-neutral-200 p-5 sm:p-6 shadow-sm">
                      <div className="flex justify-between items-center mb-4 border-b border-neutral-100 pb-3">
                        <h3 className="font-display font-semibold text-neutral-900 flex items-center gap-2 text-base">
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                          Nice-to-Dos
                        </h3>
                        <span className="text-xs font-mono bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded-full">
                          Secondary
                        </span>
                      </div>

                      <div className="flex flex-col gap-3 min-h-[150px]">
                        {tasks.filter((t) => t.horizon === "today" && !t.isMustDo && !t.completed).length === 0 ? (
                          <div className="my-auto text-center py-8 text-neutral-400 text-xs">
                            No nice-to-dos assigned.
                          </div>
                        ) : (
                          tasks
                            .filter((t) => t.horizon === "today" && !t.isMustDo && !t.completed)
                            .map((task) => (
                              <div
                                key={task.id}
                                className="p-3.5 bg-neutral-50 hover:bg-neutral-100 border border-neutral-200 rounded-xl transition-all flex items-start justify-between gap-3"
                              >
                                <div className="flex-1">
                                  <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                                    <span className="text-[10px] font-mono bg-neutral-200 text-neutral-700 px-1.5 py-0.25 rounded uppercase">
                                      {task.category}
                                    </span>
                                  </div>
                                  <h4 className="text-sm font-medium text-neutral-800">{task.title}</h4>
                                </div>
                                <button
                                  onClick={() => handleSetFocusTypeInReview(task.id, true)}
                                  className="text-xs font-medium text-neutral-500 hover:text-neutral-800 px-2.5 py-1.5 rounded-lg border border-neutral-200 hover:bg-white shrink-0"
                                >
                                  Make Must-do
                                </button>
                              </div>
                            ))
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Action Launcher */}
                  <div className="flex flex-col sm:flex-row gap-4 justify-center items-center py-4 bg-neutral-100 rounded-2xl border border-neutral-200 p-6">
                    <div className="text-center sm:text-left">
                      <h4 className="text-sm font-semibold text-neutral-900">Ready to initiate your Focus Session?</h4>
                      <p className="text-xs text-neutral-500 mt-0.5">
                        Focus Mode closes all sidebar clutter and shows you one task at a time.
                      </p>
                    </div>

                    <button
                      onClick={handleLaunchFocus}
                      className="w-full sm:w-auto ml-auto px-8 py-3.5 bg-neutral-900 hover:bg-neutral-800 text-white hover:scale-102 font-medium rounded-xl shadow-lg shadow-neutral-900/10 flex items-center justify-center gap-2 transition-all cursor-pointer"
                    >
                      <Play className="w-4 h-4 fill-white" />
                      🚀 Start Focus Session Now
                    </button>
                  </div>
                </div>
              ) : (
                /* --- GENERAL TIME HORIZON BOARD --- */
                <div className="flex flex-col gap-8 w-full">
                  {/* Side-by-Side: Compact Critical Items and Mind Clutter Brain Dump */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch animate-fade-in">
                    {/* LEFT: Critical Items */}
                    <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm p-5 sm:p-6 flex flex-col h-[340px]">
                      <div className="flex justify-between items-center border-b border-neutral-100 pb-3 mb-3 shrink-0">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 bg-red-100 text-red-700 rounded-lg">
                            <AlertCircle className="w-4 h-4 animate-pulse" />
                          </div>
                          <h2 className="text-lg font-display font-bold tracking-tight text-neutral-900">
                            Critical Items
                          </h2>
                        </div>
                        <span className="text-[10px] font-mono font-bold bg-neutral-100 text-neutral-800 border px-2.5 py-0.5 rounded-full">
                          {criticalTasks.length} Active
                        </span>
                      </div>

                      {criticalTasks.length === 0 ? (
                        <div className="flex-1 flex flex-col items-center justify-center text-center p-6 bg-neutral-50/50 rounded-xl border border-dashed border-neutral-200">
                          <p className="text-xs text-neutral-500 font-medium">
                            🎉 Outstanding! No critical deadlines in 14 days.
                          </p>
                        </div>
                      ) : (
                        <div className="flex-1 overflow-y-auto pr-1 space-y-2.5 max-h-[240px] scrollbar-thin scrollbar-thumb-neutral-200 scrollbar-track-transparent">
                          {criticalTasks.map((task) => {
                            const status = task.criticalStatus!;
                            return (
                              <div
                                key={`critical-${task.id}`}
                                className={`p-3 rounded-xl border transition-all flex flex-col gap-2 ${status.colorClass}`}
                              >
                                <div className="flex justify-between items-center gap-2 flex-wrap">
                                  <span className={`text-[9px] font-bold font-mono tracking-wider uppercase px-2 py-0.5 rounded ${status.badgeClass}`}>
                                    {status.level === "red" ? "CRITICAL" : "WATCHLIST"}
                                  </span>

                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[9px] font-mono font-semibold text-neutral-500">
                                      {task.isForceCritical ? "Flagged Critical" : (status.daysLeft < 0 ? "Overdue!" : status.daysLeft === 0 ? "Due Today" : `${status.daysLeft}d left`)}
                                    </span>

                                    {/* Real-time Toggle Off Critical Status Button */}
                                    <button
                                      onClick={() => handleToggleForceCritical(task.id, task.isForceCritical)}
                                      className="text-[9px] font-mono font-bold text-red-700 bg-white hover:bg-red-100/80 border border-red-300 rounded px-1.5 py-0.5 flex items-center gap-1 cursor-pointer transition-all shadow-2xs"
                                      title="Click to mark as not critical (removes from Critical Items instantly)"
                                    >
                                      <Flame className="w-3 h-3 text-red-600 fill-red-600" />
                                      Unflag Critical
                                    </button>
                                  </div>
                                </div>

                                <h4 className={`text-xs font-semibold leading-tight ${status.textColor}`}>
                                  {task.title}
                                </h4>

                                {task.tags && task.tags.length > 0 && (
                                  <div className="flex flex-wrap gap-1">
                                    {task.tags.map((tag) => (
                                      <span key={tag} className="text-[8px] font-mono font-semibold bg-neutral-900/10 text-neutral-800 px-1.5 py-0.25 rounded">
                                        #{tag}
                                      </span>
                                    ))}
                                  </div>
                                )}

                                <div className="flex items-center justify-between gap-2 border-t border-neutral-200/40 pt-2 mt-0.5 flex-wrap">
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      onClick={() => handleToggleComplete(task.id)}
                                      className="text-[10px] font-semibold bg-white hover:bg-neutral-50 border border-neutral-200 rounded px-2 py-1 text-neutral-800 transition-colors flex items-center gap-1 cursor-pointer"
                                    >
                                      <Check className="w-3 h-3 text-emerald-600" />
                                      Done
                                    </button>

                                    {/* Inline Quick Due Date Editor for Critical Items */}
                                    <div className="flex items-center gap-1 bg-white border border-neutral-200 rounded px-1.5 py-0.5" title="Quickly edit due date">
                                      <Calendar className="w-3 h-3 text-neutral-500 shrink-0" />
                                      <span className="text-[9px] font-mono font-bold text-neutral-500 uppercase">Due:</span>
                                      <input
                                        type="date"
                                        value={task.dropDeadDate || ""}
                                        onChange={(e) => handleQuickUpdateDate(task.id, e.target.value)}
                                        className="text-[10px] font-mono font-semibold text-neutral-900 bg-white border border-neutral-300 rounded px-1 py-0.5 cursor-pointer focus:outline-none focus:ring-1 focus:ring-neutral-900 w-[110px]"
                                      />
                                      {task.dropDeadDate && (
                                        <button
                                          type="button"
                                          onClick={() => handleQuickUpdateDate(task.id, "")}
                                          className="text-neutral-400 hover:text-red-600 font-bold text-xs px-1 hover:bg-red-50 rounded transition-colors cursor-pointer"
                                          title="Clear due date"
                                        >
                                          &times;
                                        </button>
                                      )}
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-1">
                                    <span className="text-[9px] font-mono text-neutral-500">Move:</span>
                                    <select
                                      value={task.horizon}
                                      onChange={(e) => handleMoveHorizon(task.id, e.target.value as Task["horizon"])}
                                      className="text-[10px] bg-white border border-neutral-200 rounded px-1.5 py-0.5 text-neutral-700 font-medium cursor-pointer"
                                    >
                                      <option value="today">Today</option>
                                      <option value="tomorrow">Tomorrow</option>
                                      <option value="this_week">This Week</option>
                                      <option value="this_month">This Month</option>
                                      <option value="this_year">This Year</option>
                                      <option value="backlog">Backlog</option>
                                    </select>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* RIGHT: Mind Clutter Brain Dump */}
                    <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm p-5 sm:p-6 flex flex-col h-[340px]">
                      <div className="flex items-center gap-2 border-b border-neutral-100 pb-3 mb-3 shrink-0">
                        <div className="p-1.5 bg-neutral-900 text-white rounded-lg">
                          <Brain className="w-4 h-4" />
                        </div>
                        <h2 className="text-lg font-display font-bold tracking-tight text-neutral-900">
                          Mind Clutter Brain Dump
                        </h2>
                      </div>

                      <textarea
                        value={brainDumpText}
                        onChange={(e) => setBrainDumpText(e.target.value)}
                        placeholder="Dump tasks, ideas, drop-dead compliance dates, or repairs here. E.g. Submit compliance taxes by Friday. Draft pitch deck today. Clean gutters this week. Gemini will organize all relative dates."
                        className="flex-1 w-full bg-neutral-50 border border-neutral-200 rounded-xl p-3 text-xs text-neutral-800 placeholder-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-900 focus:bg-white resize-none mb-2"
                      />

                      {analysisError && (
                        <div className="mb-2 p-2 bg-red-50 border border-red-100 rounded-lg text-[10px] text-red-700 flex items-start gap-1.5 shrink-0">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span className="line-clamp-2">{analysisError}</span>
                        </div>
                      )}

                      <div className="flex gap-2 shrink-0">
                        <button
                          onClick={() => handleAnalyzeBrainDump(brainDumpText)}
                          disabled={isAnalyzing || !brainDumpText.trim()}
                          className="flex-1 bg-neutral-900 hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-400 text-white py-2 px-4 rounded-xl text-xs font-semibold uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer h-9 shrink-0"
                        >
                          {isAnalyzing ? (
                            <>
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              Organizing...
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-3.5 h-3.5" />
                              Organize with Gemini
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Horizon Navigation & Filter Area Bar */}
                  <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4">
                    {/* Left Part: Horizon Switcher (Today, Tomorrow, and Dropdown) */}
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex bg-neutral-100 p-1 rounded-xl">
                        {(["today", "tomorrow"] as const).map((horizon) => {
                          const count = tasks.filter((t) => t.horizon === horizon && !t.completed).length;
                          const isActive = activeHorizon === horizon;
                          return (
                            <button
                              key={horizon}
                              onClick={() => setActiveHorizon(horizon)}
                              className={`px-4 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer ${
                                isActive
                                  ? "bg-white text-neutral-900 shadow-sm"
                                  : "text-neutral-500 hover:text-neutral-900 hover:bg-neutral-200/40"
                              }`}
                            >
                              {horizon}
                              {count > 0 && (
                                <span className="ml-1.5 px-1.5 py-0.25 bg-neutral-900 text-white rounded-full text-[10px] font-mono">
                                  {count}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>

                      {/* Dropdown for More Horizons */}
                      <div className="relative">
                        <select
                          value={["today", "tomorrow"].includes(activeHorizon) ? "more" : activeHorizon}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val !== "more") {
                              setActiveHorizon(val as Task["horizon"]);
                            }
                          }}
                          className={`px-3 py-1.5 rounded-xl text-xs font-semibold uppercase tracking-wider border transition-all cursor-pointer bg-neutral-50 hover:bg-neutral-100 ${
                            !["today", "tomorrow"].includes(activeHorizon)
                              ? "border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-800"
                              : "border-neutral-200 text-neutral-600"
                          }`}
                        >
                          <option value="more" disabled={!["today", "tomorrow"].includes(activeHorizon)}>
                            {!["today", "tomorrow"].includes(activeHorizon)
                              ? `Horizon: ${activeHorizon.replace("_", " ")}`
                              : "More horizons..."}
                          </option>
                          <option value="this_week">This Week ({tasks.filter((t) => t.horizon === "this_week" && !t.completed).length})</option>
                          <option value="this_month">This Month ({tasks.filter((t) => t.horizon === "this_month" && !t.completed).length})</option>
                          <option value="this_year">This Year ({tasks.filter((t) => t.horizon === "this_year" && !t.completed).length})</option>
                          <option value="backlog">Backlog ({tasks.filter((t) => t.horizon === "backlog" && !t.completed).length})</option>
                        </select>
                      </div>
                    </div>

                    {/* Middle/Right Part: Actions */}
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
                      {activeHorizon === "today" && tasks.filter((t) => t.horizon === "today" && !t.completed).length > 0 && (
                        <button
                          onClick={triggerReviewMode}
                          className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-neutral-950 font-bold rounded-xl text-xs uppercase tracking-wider shadow-md hover:shadow-emerald-500/10 flex items-center justify-center gap-1.5 transition-all cursor-pointer shrink-0"
                        >
                          <Play className="w-3.5 h-3.5 fill-neutral-950" />
                          <span>Plan & Focus Today</span>
                        </button>
                      )}

                      {/* Hide Maintenance Checkbox */}
                      <div className="flex items-center gap-2 justify-end">
                        <label className="flex items-center gap-2 cursor-pointer text-xs text-neutral-600 font-medium select-none">
                          <input
                            type="checkbox"
                            checked={hideMaintenanceInList}
                            onChange={(e) => setHideMaintenanceInList(e.target.checked)}
                            className="rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900 w-4 h-4"
                          />
                          <span className="hidden sm:inline">Hide Maintenance Chores</span>
                          <span className="sm:hidden">Hide Maintenance</span>
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* Task List Workspace */}
                  <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden min-h-[350px] flex flex-col justify-between">
                      {/* Section Title & Add Action */}
                      <div className="p-5 border-b border-neutral-150 flex justify-between items-center">
                        <div>
                          <h3 className="font-display font-semibold text-neutral-900 text-sm uppercase tracking-wider">
                            {activeHorizon.replace("_", " ")} Tasks
                          </h3>
                          <p className="text-xs text-neutral-400 mt-0.5">
                            Showing actionable tasks assigned for this time bucket
                          </p>
                        </div>

                        <button
                          onClick={() => setShowManualAdd(!showManualAdd)}
                          className="text-xs font-semibold bg-neutral-100 hover:bg-neutral-200 text-neutral-800 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
                        >
                          {showManualAdd ? (
                            <>
                              <X className="w-4 h-4" />
                              Cancel
                            </>
                          ) : (
                            <>
                              <Plus className="w-4 h-4" />
                              Add Manual
                            </>
                          )}
                        </button>
                      </div>

                      {/* Manual Add Form Block */}
                      {showManualAdd && (
                        <div className="bg-neutral-50 p-5 border-b border-neutral-150 flex flex-col gap-4">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="flex flex-col gap-1.5">
                              <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider">
                                Task Title
                              </label>
                              <input
                                type="text"
                                placeholder="What needs to be done?"
                                value={manualTitle}
                                onChange={(e) => setManualTitle(e.target.value)}
                                className="bg-white border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900"
                              />
                            </div>

                            <div className="flex flex-col gap-1.5">
                              <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider">
                                Due Date / Deadline (Optional)
                              </label>
                              <input
                                type="date"
                                value={manualDate}
                                onChange={(e) => setManualDate(e.target.value)}
                                className="bg-white border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-900"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                            {/* Horizon Selector */}
                            <div className="flex flex-col gap-1.5">
                              <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider">
                                Horizon
                              </label>
                              <select
                                value={manualHorizon}
                                onChange={(e) => setManualHorizon(e.target.value as Task["horizon"])}
                                className="bg-white border border-neutral-200 rounded-lg px-3 py-2 text-xs text-neutral-700 focus:outline-none focus:ring-1 focus:ring-neutral-900"
                              >
                                <option value="today">Today</option>
                                <option value="tomorrow">Tomorrow</option>
                                <option value="this_week">This Week</option>
                                <option value="this_month">This Month</option>
                                <option value="this_year">This Year</option>
                                <option value="backlog">Backlog</option>
                              </select>
                            </div>

                            {/* Priority Selector */}
                            <div className="flex flex-col gap-1.5">
                              <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider">
                                Priority
                              </label>
                              <select
                                value={manualPriority}
                                onChange={(e) => setManualPriority(e.target.value as Task["priority"])}
                                className="bg-white border border-neutral-200 rounded-lg px-3 py-2 text-xs text-neutral-700 focus:outline-none focus:ring-1 focus:ring-neutral-900"
                              >
                                <option value="high">High Priority</option>
                                <option value="medium">Medium Priority</option>
                                <option value="low">Low Priority</option>
                              </select>
                            </div>

                            {/* Category Selector */}
                            <div className="flex flex-col gap-1.5">
                              <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider">
                                Category
                              </label>
                              <select
                                value={manualCategory}
                                onChange={(e) => setManualCategory(e.target.value as Task["category"])}
                                className="bg-white border border-neutral-200 rounded-lg px-3 py-2 text-xs text-neutral-700 focus:outline-none focus:ring-1 focus:ring-neutral-900"
                              >
                                <option value="general">General</option>
                                <option value="north_star">North Star Goal</option>
                                <option value="marketing">Marketing priority</option>
                                <option value="maintenance">Maintenance</option>
                                <option value="personal">Personal</option>
                              </select>
                            </div>

                            {/* Focus Type Selector */}
                            <div className="flex flex-col gap-1.5">
                              <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider">
                                Focus Rank Style
                              </label>
                              <select
                                value={manualFocusType}
                                onChange={(e) => setManualFocusType(e.target.value)}
                                className="bg-white border border-neutral-200 rounded-lg px-3 py-2 text-xs text-neutral-700 focus:outline-none focus:ring-1 focus:ring-neutral-900 font-medium"
                              >
                                <option value="none">Auto Focus Rank (AI)</option>
                                <option value="must">⚠️ Critical Must-Do</option>
                                <option value="nice">✨ Nice-To-Do</option>
                              </select>
                            </div>
                          </div>

                          <div className="flex justify-between items-center mt-2 border-t border-neutral-100 pt-3">
                            <div>
                              {manualAddFeedback && (
                                <span className="text-xs font-semibold text-emerald-600 flex items-center gap-1 animate-pulse">
                                  {manualAddFeedback}
                                </span>
                              )}
                            </div>
                            <button
                              onClick={handleAddTaskManually}
                              disabled={isManualAdding || !manualTitle.trim()}
                              className="bg-neutral-900 hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-400 text-white text-xs font-semibold py-2 px-4 rounded-lg uppercase tracking-wider transition-all cursor-pointer self-end"
                            >
                              {isManualAdding ? "Saving..." : "Save Task"}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Actual List Area */}
                      <div className="flex-1 p-5 flex flex-col gap-3">
                        {filteredTasks.length === 0 ? (
                          <div className="py-12 text-center text-neutral-400 text-xs my-auto">
                            No actionable items in this bucket right now.
                            {hideMaintenanceInList && maintenanceTasksForActiveHorizon.length > 0 && (
                              <p className="mt-2 text-neutral-500 font-medium">
                                ({maintenanceTasksForActiveHorizon.length} maintenance chores are hidden. Turn off "Hide Maintenance" to reveal.)
                              </p>
                            )}
                          </div>
                        ) : (
                          <div className="flex flex-col gap-2.5">
                            {filteredTasks.map((task) => {
                              const deadline = getDeadlineBadgeStyle(task.dropDeadDate);
                              const isEditing = activeEditingTaskId === task.id;
                              const isTaskCritical = task.isForceCritical || (!!task.dropDeadDate && task.dropDeadDate.trim() !== "" && getCriticalStatus(task) !== null);

                              return (
                                <motion.div
                                  layoutId={`task-${task.id}`}
                                  key={task.id}
                                  className={`p-3.5 rounded-xl border transition-all flex items-start gap-3.5 ${
                                    task.completed
                                      ? "bg-neutral-50/70 border-neutral-200 opacity-60"
                                      : task.category === "north_star"
                                      ? "bg-amber-50/20 border-amber-200/80 hover:border-amber-300"
                                      : task.category === "marketing"
                                      ? "bg-purple-50/10 border-purple-200/80 hover:border-purple-300"
                                      : "bg-white border-neutral-200 hover:border-neutral-300"
                                  }`}
                                >
                                  {/* Checkbox */}
                                  <button
                                    onClick={() => handleToggleComplete(task.id)}
                                    className="mt-0.5 focus:outline-none cursor-pointer text-neutral-400 hover:text-neutral-900"
                                  >
                                    {task.completed ? (
                                      <CheckCircle2 className="w-5 h-5 text-neutral-900 fill-neutral-50" />
                                    ) : (
                                      <Circle className="w-5 h-5 text-neutral-300 hover:text-neutral-600" />
                                    )}
                                  </button>

                                  {/* Body */}
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5 flex-wrap mb-1">
                                      {/* Category */}
                                      <span
                                        className={`text-[9px] font-mono uppercase font-bold tracking-wider px-1.5 py-0.25 rounded-md ${
                                          task.category === "north_star"
                                            ? "bg-amber-500/15 text-amber-800"
                                            : task.category === "marketing"
                                            ? "bg-purple-500/15 text-purple-800"
                                            : task.category === "maintenance"
                                            ? "bg-zinc-100 text-zinc-700"
                                            : task.category === "personal"
                                            ? "bg-emerald-50 text-emerald-800"
                                            : "bg-neutral-100 text-neutral-700"
                                        }`}
                                      >
                                        {task.category.replace("_", " ")}
                                      </span>

                                      {/* Priority */}
                                      <span
                                        className={`text-[9px] font-mono px-1.5 py-0.25 rounded-md ${
                                          task.priority === "high"
                                            ? "bg-red-50 text-red-700 border border-red-100"
                                            : task.priority === "medium"
                                            ? "bg-amber-50 text-amber-700"
                                            : "bg-neutral-100 text-neutral-600"
                                        }`}
                                      >
                                        {task.priority} priority
                                      </span>

                                      {/* Drop-dead Countdown */}
                                      {deadline && (
                                        <span
                                          className={`text-[9px] font-mono border px-1.5 py-0.25 rounded-md ${deadline.color}`}
                                        >
                                          {deadline.text}
                                        </span>
                                      )}

                                      {/* Tags */}
                                      {task.tags && task.tags.map((tag) => (
                                        <span
                                          key={tag}
                                          className="text-[9px] font-mono font-bold px-1.5 py-0.25 rounded bg-neutral-900 text-white"
                                        >
                                          #{tag}
                                        </span>
                                      ))}

                                      {/* Inline Quick Due Date Selector */}
                                      <div
                                        className="inline-flex items-center gap-1.5 bg-neutral-100 border border-neutral-200/90 rounded-lg px-2 py-1 text-[10px] font-mono transition-all shadow-2xs flex-wrap sm:flex-nowrap"
                                        title="Click to edit due date directly"
                                      >
                                        <Calendar className="w-3.5 h-3.5 text-neutral-600 shrink-0" />
                                        <span className="text-neutral-700 font-bold uppercase tracking-wider text-[10px]">Due:</span>
                                        <input
                                          type="date"
                                          value={getValidDateString(task.dropDeadDate)}
                                          onChange={(e) => handleQuickUpdateDate(task.id, e.target.value)}
                                          className="bg-white border border-neutral-300 rounded px-1.5 py-0.5 text-neutral-900 font-mono text-xs font-bold cursor-pointer focus:outline-none focus:ring-1 focus:ring-neutral-900 w-[120px]"
                                        />
                                        <button
                                          type="button"
                                          onClick={() => handleQuickUpdateDate(task.id, todayStr)}
                                          className="text-[9px] font-mono font-bold bg-white border border-neutral-200 hover:bg-neutral-50 text-neutral-700 px-1.5 py-0.5 rounded cursor-pointer"
                                          title="Set due date to Today"
                                        >
                                          Today
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const tmrw = new Date();
                                            tmrw.setDate(tmrw.getDate() + 1);
                                            handleQuickUpdateDate(task.id, tmrw.toISOString().split("T")[0]);
                                          }}
                                          className="text-[9px] font-mono font-bold bg-white border border-neutral-200 hover:bg-neutral-50 text-neutral-700 px-1.5 py-0.5 rounded cursor-pointer"
                                          title="Set due date to Tomorrow"
                                        >
                                          Tmrw
                                        </button>
                                        {getValidDateString(task.dropDeadDate) && (
                                          <button
                                            type="button"
                                            onClick={() => handleQuickUpdateDate(task.id, "")}
                                            className="text-neutral-500 hover:text-red-600 font-bold text-xs px-1.5 py-0.5 hover:bg-red-50 rounded transition-colors cursor-pointer"
                                            title="Clear due date"
                                          >
                                            Clear ×
                                          </button>
                                        )}
                                      </div>

                                      {/* Focus Type Cycle Control */}
                                      <button
                                        onClick={() => handleToggleFocusType(task.id, task.isMustDo, task.isNiceToDo)}
                                        className={`text-[9px] font-mono px-1.5 py-0.25 rounded-md font-semibold transition-all flex items-center gap-1 border cursor-pointer ${
                                          task.isMustDo
                                            ? "bg-amber-100 text-amber-900 border-amber-300 hover:bg-amber-200/80"
                                            : task.isNiceToDo
                                            ? "bg-emerald-100 text-emerald-900 border-emerald-300 hover:bg-emerald-200/80"
                                            : "bg-neutral-50 text-neutral-500 border-neutral-200 hover:bg-neutral-100"
                                        }`}
                                        title="Click to cycle focus: Auto -> Critical Must-Do -> Nice-To-Do"
                                      >
                                        {task.isMustDo ? (
                                          <>⚠️ Critical Must-Do</>
                                        ) : task.isNiceToDo ? (
                                          <>✨ Nice-To-Do</>
                                        ) : (
                                          <>🎯 Auto Focus Rank</>
                                        )}
                                      </button>

                                      {/* Force Critical Toggle Control */}
                                      <button
                                        onClick={() => handleToggleForceCritical(task.id, isTaskCritical)}
                                        className={`text-[10px] font-mono px-2.5 py-1 rounded-lg font-bold transition-all flex items-center gap-1.5 border cursor-pointer shadow-2xs ${
                                          isTaskCritical
                                            ? "bg-red-100 text-red-900 border-red-300 hover:bg-red-200"
                                            : "bg-neutral-100 text-neutral-600 border-neutral-200 hover:bg-neutral-200/80"
                                        }`}
                                        title={
                                          isTaskCritical
                                            ? "Click to UNFLAG critical (removes from Critical Items list instantly)"
                                            : "Click to FLAG as critical item"
                                        }
                                      >
                                        <Flame className={`w-3.5 h-3.5 ${isTaskCritical ? "text-red-600 fill-red-600" : "text-neutral-500"}`} />
                                        <span>{isTaskCritical ? "Unflag Critical" : "Flag Critical"}</span>
                                      </button>
                                    </div>

                                    {isEditing ? (
                                      <div className="flex flex-col gap-3 mt-2 bg-neutral-50 p-3 rounded-xl border border-neutral-200">
                                        <div className="flex flex-col gap-1.5">
                                          <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider">Task Title</label>
                                          <input
                                            type="text"
                                            value={editTitleInput}
                                            onChange={(e) => setEditTitleInput(e.target.value)}
                                            className="w-full bg-white border border-neutral-200 rounded px-2.5 py-1.5 text-xs text-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900"
                                            placeholder="What needs to be done?"
                                            onKeyDown={(e) =>
                                              e.key === "Enter" && handleUpdateTask(task.id)
                                            }
                                          />
                                        </div>

                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                          <div className="flex flex-col gap-1.5">
                                            <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider">Due Date / Deadline</label>
                                            <input
                                              type="date"
                                              value={editDateInput}
                                              onChange={(e) => setEditDateInput(e.target.value)}
                                              className="w-full bg-white border border-neutral-200 rounded px-2 py-1 text-xs text-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-900"
                                            />
                                          </div>

                                          <div className="flex flex-col gap-1.5">
                                            <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider">Category</label>
                                            <select
                                              value={editCategoryInput}
                                              onChange={(e) => setEditCategoryInput(e.target.value as Task["category"])}
                                              className="w-full bg-white border border-neutral-200 rounded px-2 py-1 text-xs text-neutral-700 focus:outline-none focus:ring-1 focus:ring-neutral-900"
                                            >
                                              <option value="general">General</option>
                                              <option value="north_star">North Star Goal</option>
                                              <option value="marketing">Marketing priority</option>
                                              <option value="maintenance">Maintenance</option>
                                              <option value="personal">Personal</option>
                                            </select>
                                          </div>

                                          <div className="flex flex-col gap-1.5">
                                            <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider">Priority</label>
                                            <select
                                              value={editPriorityInput}
                                              onChange={(e) => setEditPriorityInput(e.target.value as Task["priority"])}
                                              className="w-full bg-white border border-neutral-200 rounded px-2 py-1 text-xs text-neutral-700 focus:outline-none focus:ring-1 focus:ring-neutral-900"
                                            >
                                              <option value="high">High</option>
                                              <option value="medium">Medium</option>
                                              <option value="low">Low</option>
                                            </select>
                                          </div>
                                        </div>

                                        <div className="flex justify-end gap-2 mt-1 border-t border-neutral-100 pt-2">
                                          <button
                                            onClick={() => setActiveEditingTaskId(null)}
                                            className="text-[11px] bg-neutral-200 hover:bg-neutral-300 text-neutral-700 px-3 py-1.5 rounded font-semibold transition-colors"
                                          >
                                            Cancel
                                          </button>
                                          <button
                                            onClick={() => handleUpdateTask(task.id)}
                                            className="text-[11px] bg-neutral-900 hover:bg-neutral-800 text-white px-3 py-1.5 rounded font-semibold transition-colors"
                                          >
                                            Save Changes
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      <p
                                        className={`text-sm text-neutral-900 leading-relaxed font-medium ${
                                          task.completed ? "line-through text-neutral-400 font-normal" : ""
                                        }`}
                                      >
                                        {task.title}
                                      </p>
                                    )}

                                    {/* AI Assistant reasoning */}
                                    {task.reasoning && !task.completed && (
                                      <p className="text-[11px] text-neutral-500 mt-1 italic leading-relaxed">
                                        " {task.reasoning} "
                                      </p>
                                    )}
                                  </div>

                                  {/* Actions */}
                                  <div className="flex items-center gap-1 shrink-0">
                                    {/* Fast Quick-move Option */}
                                    <select
                                      value={task.horizon}
                                      onChange={(e) => handleMoveHorizon(task.id, e.target.value as Task["horizon"])}
                                      className="text-[11px] bg-neutral-50 border border-neutral-200 rounded px-1.5 py-0.75 text-neutral-600 cursor-pointer"
                                    >
                                      <option value="today">Today</option>
                                      <option value="tomorrow">Tomorrow</option>
                                      <option value="this_week">This Week</option>
                                      <option value="this_month">This Month</option>
                                      <option value="this_year">This Year</option>
                                      <option value="backlog">Backlog</option>
                                    </select>

                                    <button
                                      onClick={() => {
                                        setEditTitleInput(task.title);
                                        setEditDateInput(task.dropDeadDate || "");
                                        setEditCategoryInput(task.category);
                                        setEditPriorityInput(task.priority);
                                        setActiveEditingTaskId(isEditing ? null : task.id);
                                      }}
                                      className="text-neutral-400 hover:text-neutral-700 p-1 rounded hover:bg-neutral-50"
                                      title="Edit Task"
                                    >
                                      <Edit2 className="w-3.5 h-3.5" />
                                    </button>

                                    <button
                                      onClick={() => handleDeleteTask(task.id)}
                                      className="text-neutral-400 hover:text-red-600 p-1 rounded hover:bg-neutral-50"
                                      title="Delete"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </motion.div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* Collapsible / Drawer Area for Hidden Maintenance Chores */}
                      {maintenanceTasksForActiveHorizon.length > 0 && hideMaintenanceInList && (
                        <div className="bg-neutral-50 border-t border-neutral-150 p-4">
                          <details className="group">
                            <summary className="list-none flex items-center justify-between cursor-pointer select-none text-xs text-neutral-600 font-semibold uppercase tracking-wider">
                              <span className="flex items-center gap-2">
                                <Wrench className="w-4 h-4 text-neutral-400" />
                                Hidden Chores & Maintenance ({maintenanceTasksForActiveHorizon.length})
                              </span>
                              <ChevronDown className="w-4 h-4 text-neutral-400 group-open:rotate-180 transition-transform" />
                            </summary>

                            <div className="mt-3 flex flex-col gap-2">
                              {maintenanceTasksForActiveHorizon.map((task) => (
                                <div
                                  key={task.id}
                                  className="p-2.5 bg-white border border-neutral-200 rounded-lg flex items-center justify-between gap-3 text-xs"
                                >
                                  <div className="flex items-center gap-2.5">
                                    <button
                                      onClick={() => handleToggleComplete(task.id)}
                                      className="text-neutral-300 hover:text-neutral-800"
                                    >
                                      <Circle className="w-4 h-4" />
                                    </button>
                                    <span className="text-neutral-700 font-medium">{task.title}</span>
                                  </div>

                                  <div className="flex items-center gap-2">
                                    <button
                                      onClick={() => handleMoveHorizon(task.id, "today")}
                                      className="text-[10px] bg-neutral-100 hover:bg-neutral-200 text-neutral-600 px-2 py-1 rounded"
                                    >
                                      Pull to Today
                                    </button>
                                    <button
                                      onClick={() => handleDeleteTask(task.id)}
                                      className="text-neutral-400 hover:text-red-600 p-1"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </details>
                        </div>
                      )}

                      {/* Completed Archive for Active Horizon */}
                      {completedTasksForActiveHorizon.length > 0 && (
                        <div className="bg-neutral-50/50 border-t border-neutral-150 p-4">
                          <details className="group">
                            <summary className="list-none flex items-center justify-between cursor-pointer select-none text-xs text-neutral-500">
                              <span>Completed Items ({completedTasksForActiveHorizon.length})</span>
                              <ChevronDown className="w-4 h-4 text-neutral-400 group-open:rotate-180 transition-transform" />
                            </summary>

                            <div className="mt-3 flex flex-col gap-2">
                              {completedTasksForActiveHorizon.map((task) => (
                                <div
                                  key={task.id}
                                  className="p-2 bg-neutral-100/50 rounded-lg flex items-center justify-between text-xs text-neutral-500"
                                >
                                  <div className="flex items-center gap-2">
                                    <button onClick={() => handleToggleComplete(task.id)}>
                                      <CheckCircle2 className="w-4 h-4 text-neutral-400" />
                                    </button>
                                    <span className="line-through">{task.title}</span>
                                  </div>
                                  <button
                                    onClick={() => handleDeleteTask(task.id)}
                                    className="text-neutral-400 hover:text-red-600 p-1"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </details>
                        </div>
                      )}
                    </div>
                  </div>
              )}
                    </>
                  )}
                </>
              )}
            </main>
          </div>
        )}

        {/* --- DUPLICATE TASKS OVERLAY MODAL --- */}
        {duplicateQueue.length > 0 && (
          <motion.div
            key="duplicate-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-neutral-950/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4 font-sans"
          >
            <motion.div
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="bg-white border border-neutral-200 rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              {/* Header */}
              <div className="bg-amber-50 border-b border-amber-100 px-6 py-4 flex items-center gap-3 shrink-0">
                <div className="p-2 bg-amber-500/10 text-amber-600 rounded-lg shrink-0">
                  <AlertTriangle className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-amber-900">Potential Duplicate Detected</h3>
                  <p className="text-xs text-amber-700 mt-0.5">
                    We found an active task that might already cover this. How would you like to handle it?
                  </p>
                </div>
                <div className="ml-auto text-xs font-mono font-bold text-amber-800 bg-amber-500/15 px-2.5 py-1 rounded-full shrink-0">
                  {duplicateQueue.length} Pending
                </div>
              </div>

              {/* Body */}
              <div className="p-6 flex-1 overflow-y-auto flex flex-col gap-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Incoming Task Card */}
                  <div className="bg-neutral-50/70 border border-neutral-200/80 rounded-xl p-4 flex flex-col justify-between">
                    <div>
                      <div className="text-[10px] font-mono font-bold text-neutral-400 tracking-wider uppercase mb-1.5 flex items-center gap-1">
                        <ArrowDownCircle className="w-3.5 h-3.5 text-neutral-400" /> Incoming Task
                      </div>
                      <h4 className="text-sm font-bold text-neutral-900 leading-snug">
                        {duplicateQueue[0].newTask.title}
                      </h4>
                      {duplicateQueue[0].newTask.dropDeadDate && (
                        <p className="text-[10px] text-neutral-500 font-medium mt-1">
                          Deadline: {duplicateQueue[0].newTask.dropDeadDate}
                        </p>
                      )}
                    </div>
                    <div className="mt-4 flex gap-1.5 flex-wrap">
                      <span className="text-[9px] font-mono font-semibold px-2 py-0.5 rounded-full bg-neutral-155 text-neutral-700 capitalize">
                        {duplicateQueue[0].newTask.horizon.replace("_", " ")}
                      </span>
                      <span className="text-[9px] font-mono font-semibold px-2 py-0.5 rounded-full bg-neutral-155 text-neutral-700 capitalize">
                        {duplicateQueue[0].newTask.priority}
                      </span>
                      <span className="text-[9px] font-mono font-semibold px-2 py-0.5 rounded-full bg-neutral-155 text-neutral-700 capitalize">
                        {duplicateQueue[0].newTask.category}
                      </span>
                    </div>
                  </div>

                  {/* Existing Task Card */}
                  <div className="bg-amber-50/25 border border-amber-200/60 rounded-xl p-4 flex flex-col justify-between">
                    <div>
                      <div className="text-[10px] font-mono font-bold text-amber-700/80 tracking-wider uppercase mb-1.5 flex items-center gap-1">
                        <Layers className="w-3.5 h-3.5 text-amber-600/80" /> Existing Active Task
                      </div>
                      <h4 className="text-sm font-bold text-amber-950 leading-snug">
                        {duplicateQueue[0].existingTask.title}
                      </h4>
                      {duplicateQueue[0].existingTask.dropDeadDate && (
                        <p className="text-[10px] text-amber-700/70 font-medium mt-1">
                          Deadline: {duplicateQueue[0].existingTask.dropDeadDate}
                        </p>
                      )}
                    </div>
                    <div className="mt-4 flex gap-1.5 flex-wrap">
                      <span className="text-[9px] font-mono font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-800 capitalize">
                        {duplicateQueue[0].existingTask.horizon.replace("_", " ")}
                      </span>
                      <span className="text-[9px] font-mono font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-800 capitalize">
                        {duplicateQueue[0].existingTask.priority}
                      </span>
                      <span className="text-[9px] font-mono font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-800 capitalize">
                        {duplicateQueue[0].existingTask.category}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Similarity Meter */}
                <div className="bg-neutral-50 border border-neutral-200/60 rounded-xl p-3 flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="text-xs font-semibold text-neutral-800">Match Confidence</span>
                    <span className="text-[10px] text-neutral-500">Based on character similarity and word overlap</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-24 bg-neutral-200 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-amber-500 h-2 rounded-full"
                        style={{ width: `${Math.round(duplicateQueue[0].similarity * 100)}%` }}
                      />
                    </div>
                    <span className="text-xs font-mono font-bold text-neutral-800">
                      {Math.round(duplicateQueue[0].similarity * 100)}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Footer / Interactive Choice Buttons */}
              <div className="bg-neutral-50 border-t border-neutral-200 p-5 flex flex-col gap-2.5 shrink-0">
                {/* Option 3: Supersede */}
                <button
                  onClick={() => handleResolveDuplicate(duplicateQueue[0].id, "supersede")}
                  className="w-full bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-bold py-2.5 px-4 rounded-xl uppercase tracking-wider transition-colors flex flex-col items-center justify-center gap-0.5 group cursor-pointer"
                >
                  <span className="flex items-center gap-1.5 font-bold">⚡ Supersede Current Task</span>
                  <span className="text-[10px] font-normal text-neutral-400 capitalize tracking-normal group-hover:text-neutral-300">
                    Replace current details with the incoming task details
                  </span>
                </button>

                {/* Option 4: Archive and Add */}
                <button
                  onClick={() => handleResolveDuplicate(duplicateQueue[0].id, "archive_and_add")}
                  className="w-full bg-white hover:bg-neutral-100 text-neutral-900 border border-neutral-300 text-xs font-bold py-2.5 px-4 rounded-xl uppercase tracking-wider transition-colors flex flex-col items-center justify-center gap-0.5 group cursor-pointer"
                >
                  <span className="flex items-center gap-1.5 text-neutral-900 font-bold">📦 Archive Current & Add New</span>
                  <span className="text-[10px] font-normal text-neutral-500 capitalize tracking-normal group-hover:text-neutral-600">
                    Mark current task as completed and save the incoming task
                  </span>
                </button>

                <div className="grid grid-cols-2 gap-2.5">
                  {/* Option 1: Add New */}
                  <button
                    onClick={() => handleResolveDuplicate(duplicateQueue[0].id, "add")}
                    className="bg-white hover:bg-neutral-100 text-neutral-800 border border-neutral-200 text-[11px] font-bold py-2.5 px-3 rounded-xl uppercase tracking-wider transition-colors flex flex-col items-center justify-center gap-0.5 cursor-pointer"
                  >
                    <span>➕ Add New Task</span>
                    <span className="text-[9px] font-normal text-neutral-500">Keep both separately</span>
                  </button>

                  {/* Option 2: Keep Existing Only */}
                  <button
                    onClick={() => handleResolveDuplicate(duplicateQueue[0].id, "keep_existing")}
                    className="bg-white hover:bg-neutral-100 text-neutral-800 border border-neutral-200 text-[11px] font-bold py-2.5 px-3 rounded-xl uppercase tracking-wider transition-colors flex flex-col items-center justify-center gap-0.5 cursor-pointer"
                  >
                    <span>❌ Discard New</span>
                    <span className="text-[9px] font-normal text-neutral-500">Keep existing only</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
