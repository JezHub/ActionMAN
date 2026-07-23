import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import fs from "fs";

// Initialize a log file to capture production/runtime output
const logFile = path.join(process.cwd(), "server.log");
const logStream = fs.createWriteStream(logFile, { flags: "a" });
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

console.log = (...args: any[]) => {
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
  logStream.write(`[LOG] ${new Date().toISOString()}: ${msg}\n`);
  originalLog(...args);
};

console.error = (...args: any[]) => {
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
  logStream.write(`[ERROR] ${new Date().toISOString()}: ${msg}\n`);
  originalError(...args);
};

console.warn = (...args: any[]) => {
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
  logStream.write(`[WARN] ${new Date().toISOString()}: ${msg}\n`);
  originalWarn(...args);
};

dotenv.config();

const PORT = 3000;
const app = express();

app.use(express.json());

// Lazy-initialize Gemini client
let aiClient: GoogleGenAI | null = null;
function getGeminiClient() {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is required but not set.");
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

// Utility to retry Gemini calls on 503/429
async function generateWithRetry(ai: GoogleGenAI, config: any, maxRetries = 3) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await ai.models.generateContent(config);
    } catch (err: any) {
      attempt++;
      const msg = err?.message || String(err);
      if (
        msg.includes("503") || 
        msg.includes("UNAVAILABLE") || 
        msg.includes("Too Many Requests") || 
        msg.includes("429") ||
        msg.includes("500") ||
        msg.includes("Internal error")
      ) {
        console.warn(`Gemini API Error (Attempt ${attempt}/${maxRetries}): ${msg}`);
        if (attempt >= maxRetries) {
          throw err;
        }
        await new Promise(r => setTimeout(r, 1500 * attempt));
      } else {
        throw err;
      }
    }
  }
}

// Resolve a YYYY-MM-DD date string (or fall back to the server clock) into
// the pieces the prompts need. Never hardcode dates in prompts — relative
// deadline parsing ("by Friday") breaks permanently once the date goes stale.
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function resolveDateContext(currentDate?: string) {
  let ref = new Date();
  if (currentDate) {
    const parsed = Date.parse(currentDate);
    if (!isNaN(parsed)) ref = new Date(parsed);
  }
  const iso = ref.toISOString().split("T")[0];
  const dayName = DAY_NAMES[ref.getUTCDay()];
  const tomorrowIso = new Date(ref.getTime() + 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  return { iso, dayName, tomorrowIso };
}

// 1. API: Organize Brain Dump
app.post("/api/organize-dump", async (req, res) => {
  try {
    const { dumpText, currentDate, northStar } = req.body;
    if (!dumpText || !dumpText.trim()) {
      return res.status(400).json({ error: "No brain dump text provided." });
    }

    const dateCtx = resolveDateContext(currentDate);
    const ai = getGeminiClient();

    const systemInstruction = `You are an expert personal productivity assistant for "Action Man", a raw brain-dump planning app. Your job is to parse a raw "brain dump" text block into clean, actionable, individual items (ideas, tasks, or reminders).

CRITICAL EXTRACTION REQUIREMENTS:
1. You MUST extract and parse EVERY SINGLE distinct line, bullet point, task, idea, action item, plan, chore, or thought contained in the user's raw brain dump.
2. DO NOT summarize, merge, or group multiple distinct thoughts into a few high-level points. 
3. If the user lists 10, 13, 15, 20 or more distinct lines/thoughts, your output array MUST contain EXACTLY that many separate parsed items. 
4. Never truncate, ignore, or skip any of the items mentioned in the user's input. Parse every single item completely.

Identify date importance, priority level, target time horizon, categories, and tags based on the user's input:
1. Categories must be one of:
   - 'north_star': tasks or ideas that directly align with the user's core North Star: "${northStar || 'Not specified'}"
   - 'marketing': promotional, sales, content creation, social media, branding, or growth tasks.
   - 'maintenance': household chores, repairs, recurring admin tasks, or low-level housekeeping that is important but shouldn't clutter daily high-level work.
   - 'personal': health, fitness, self-care, family, or personal recreation tasks.
   - 'general': miscellaneous tasks or ideas that don't fit the above.
2. Target time horizons must be one of: 'today', 'tomorrow', 'this_week', 'this_month', 'this_year', or 'backlog'. 
   - CRITICAL HORIZON RULE: If no specific time frame is explicitly mentioned in the text line (e.g., "today", "tomorrow", "this week"), DEFAULT TO 'this_week' or 'backlog'. Do NOT default unscheduled brain-dump items to 'today'.
3. Priority level must be one of: 'high', 'medium', or 'low'.
   - 'high': Reserve this ONLY if the user explicitly mentions the task is "critical", "urgent", "must do", "high priority", "vital", "ASAP", or if it has an explicit immediate drop-dead deadline written in the text.
   - 'medium': This MUST BE THE DEFAULT for standard to-dos, payments, bookings, chores, or reminders that lack explicit "critical" or "urgent" keywords.
   - 'low': Use for nice-to-haves, reference ideas, books to read, or long-term backlog reminders.
4. Extract drop-dead dates: If the user explicitly mentions a specific due date, deadline, or clear drop-dead constraint (e.g. "by Friday", "tomorrow", "compliance taxes by Friday", "due July 20th"), calculate that date as an ISO string YYYY-MM-DD.
   Use the current date context: today is ${dateCtx.iso} (${dateCtx.dayName}).
   - "tomorrow" is ${dateCtx.tomorrowIso}
   - A weekday reference like "by Friday" means the NEXT occurrence of that weekday strictly after today (${dateCtx.iso}); compute the exact date from today's day of week.
   CRITICAL DROP-DEAD RULE: If the user line did NOT explicitly mention a day of the week, relative time (like "tomorrow" or "Friday"), or explicit deadline word in the text, you MUST leave the 'dropDeadDate' field as null. Do NOT invent, guess, estimate, or assume any default due date. For example, "Helens Capital gains payment", "Book my blood tests with the doc", "Sort the battery for the boat", or "Clean the boat" have NO mention of time, so their dropDeadDate MUST BE null.
5. Auto-tagging rules:
   - If the task relates to "Rain Ventures", add "Rain Ventures" to the tags.
   - If the task relates to "RainShift", add "RainShift" to the tags.
   - If the task relates to a "human connection company" or "human connection", add "Human Connection Co" to the tags.
6. Provide a very brief 1-sentence reasoning explaining why you categorized it and assigned the priority.`;

    const prompt = `Here is my complete, raw brain dump text:
"${dumpText}"

Please parse every single distinct line, item, or thought from the above text into a structured JSON list of individual items. Remember: do not omit, skip, summarize, or truncate any tasks! Output all parsed items.`;

    const response = await generateWithRetry(ai, {
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING, description: "Short, action-oriented title of the task or idea." },
              priority: { type: Type.STRING, description: "Priority level: high, medium, or low." },
              horizon: { type: Type.STRING, description: "Time horizon: today, tomorrow, this_week, this_month, this_year, or backlog." },
              category: { type: Type.STRING, description: "Category: north_star, marketing, maintenance, personal, or general." },
              dropDeadDate: { type: Type.STRING, description: "Strictly null unless an explicit deadline/due date was mentioned in the text. Do NOT guess or default." },
              reasoning: { type: Type.STRING, description: "A very brief 1-sentence reasoning explaining your decision." },
              tags: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Array of extracted tags if matching Rain Ventures, RainShift, or Human Connection Co rules."
              }
            },
            required: ["title", "priority", "horizon", "category", "reasoning"],
          },
        },
      },
    });

    const parsedData = JSON.parse(response.text || "[]");
    res.json({ items: parsedData });
  } catch (error: any) {
    console.error("Error organizing brain dump:", error);
    res.status(500).json({ error: error.message || "Failed to organize brain dump." });
  }
});

// 2. API: Daily Focus Coach Review
app.post("/api/coach-today", async (req, res) => {
  try {
    const { tasks, northStar } = req.body;
    if (!tasks || !Array.isArray(tasks)) {
      return res.status(400).json({ error: "Invalid tasks provided." });
    }

    const ai = getGeminiClient();

    const systemInstruction = `You are a supportive, high-performance daily coach. The user is planning their "Today's Focus Session".
They have given you a list of tasks they selected to get done today.
Your job is to look at their list of tasks, evaluate them against their current North Star: "${northStar || 'Not specified'}", and recommend which tasks should be categorized as "Must-dos" vs "Nice-to-dos" for today.

Guidelines:
1. "Must-dos": This should be limited to a highly focused, realistic set of 1-3 tasks. Select tasks that align directly with their North Star, have immediate drop-dead dates, or are high-priority marketing/compliance requirements.
2. "Nice-to-dos": Other tasks that are good to get done if time permits, but shouldn't distract from the primary must-dos.
3. House maintenance chores should NEVER clutter their day as a Must-Do unless they are extremely urgent. Mark them as Nice-to-dos or advise them to keep them separate.
4. "coachMessage": Write a supportive, highly direct coaching feedback paragraph (2-3 sentences max).
   For example, tell them: "If you get that contract done, you are crushing it. Don't let compliance details or household maintenance clutter your morning. Focus on the core contract, and treat the rest as nice-to-dos."
   Make the tone friendly, smart, objective, and action-oriented. No generic fluff. Ensure you refer specifically to the tasks they've input!
5. STRICT USER INTENT OVERRIDES:
   - If a task has "isMustDo" set to true, or the user has marked it as critical / very important, you MUST recommend it in "mustDoIds". Do not downgrade tasks that the user has explicitly flagged as a Must-do.
   - If a task is high priority (priority === 'high'), you should highly prioritize flowing it into "mustDoIds" as well unless there are too many (e.g. more than 4), in which case prioritize the ones with "isMustDo = true" or closest drop-dead dates.
   - If a task has "isNiceToDo" set to true, you should recommend it in "niceToDoIds" unless it is high priority or a critical North Star task, in which case you may suggest upgrading it in your coaching message, but still default to the user's manual preference if they are sure.`;

    const prompt = `Here are today's selected tasks:
${JSON.stringify(
  tasks.map((t) => ({
    id: t.id,
    title: t.title,
    priority: t.priority,
    category: t.category,
    dropDeadDate: t.dropDeadDate,
    isMustDo: t.isMustDo,
    isNiceToDo: t.isNiceToDo,
  }))
)}

Please recommend which of these should be "Must-dos" and "Nice-to-dos" for today, and write my daily coaching feedback message.`;

    const response = await generateWithRetry(ai, {
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            mustDoIds: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "List of task IDs that are recommended as critical Must-dos for today.",
            },
            niceToDoIds: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "List of task IDs that are recommended as Nice-to-dos.",
            },
            coachMessage: {
              type: Type.STRING,
              description: "A friendly, direct, 2-3 sentence coaching feedback text reviewing today's plan.",
            },
          },
          required: ["mustDoIds", "niceToDoIds", "coachMessage"],
        },
      },
    });

    const parsedData = JSON.parse(response.text || "{}");
    res.json(parsedData);
  } catch (error: any) {
    console.error("Error in daily coaching review:", error);
    res.status(500).json({ error: error.message || "Failed to generate coaching review." });
  }
});

// --- Fetch Timeout and Chunking Helpers for Non-blocking API calls ---
const fetchWithTimeout = async (url: string, options: any, timeoutMs = 2000): Promise<Response> => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
};

const chunkArray = <T>(arr: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
};

// 3. API: Triage recent emails using Gmail API + Gemini
app.post("/api/triage-emails", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: "Missing authorization token." });
    }

    const { currentDate, ignoredSenders = [], ignoredDomains = [], ignoredEmails = [] } = req.body;

    // Use current date or default to calculate date 14 days ago (going back 15 days to handle any timezone margins)
    let targetDate = new Date();
    if (currentDate) {
      const parsed = Date.parse(currentDate);
      if (!isNaN(parsed)) {
        targetDate = new Date(parsed);
      }
    }
    // Go back 15 days to safely capture a full 14-day window across any timezone bounds
    const fourteenDaysAgo = new Date(targetDate.getTime() - 15 * 24 * 60 * 60 * 1000);
    const yyyy = fourteenDaysAgo.getFullYear();
    const mm = String(fourteenDaysAgo.getMonth() + 1).padStart(2, "0");
    const dd = String(fourteenDaysAgo.getDate()).padStart(2, "0");
    
    // Exclude only the noisy categories. Do NOT exclude noreply senders or
    // restrict to category:primary — bills, renewals, and hosting/domain
    // notices arrive from noreply@ addresses in the Updates category, which is
    // exactly the mail this triage is supposed to surface. Gemini handles the
    // noise filtering downstream.
    const query = `in:inbox after:${yyyy}-${mm}-${dd} -category:promotions -category:social -category:forums`;

    const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=500&q=${encodeURIComponent(query)}`;
    
    console.log(`Fetching messages from Gmail with query: ${query} (Targeting Date: ${currentDate})`);
    const listRes = await fetch(listUrl, {
      headers: {
        Authorization: authHeader,
      },
    });

    if (!listRes.ok) {
      const errorText = await listRes.text();
      console.error("Gmail list API error:", errorText);
      return res.status(listRes.status).json({ error: `Gmail API error: ${listRes.statusText}` });
    }

    const listData = (await listRes.json()) as { messages?: { id: string }[] };
    const messages = listData.messages || [];

    console.log(`Total messages returned matching query: ${messages.length}`);

    if (messages.length === 0) {
      return res.json({ importantEmails: [] });
    }

    // Drop specifically-ignored message IDs BEFORE capping, so muted mail
    // never consumes analysis slots, then fetch details for the newest batch.
    const DETAIL_FETCH_CAP = 150;
    const candidateMessages = messages
      .filter((msg) => !ignoredEmails.includes(msg.id))
      .slice(0, DETAIL_FETCH_CAP);
    if (messages.length > candidateMessages.length + ignoredEmails.length) {
      console.warn(`Triage window truncated: ${messages.length} matches, detail-fetching newest ${candidateMessages.length}.`);
    }
    console.log(`Fetching detailed headers for ${candidateMessages.length} messages in optimized batches...`);

    const fetchDetail = async (msg: { id: string }) => {
      // Two attempts with a generous timeout — a slow Gmail response must not
      // silently drop an email from the triage.
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const detailUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`;
          const detailRes = await fetchWithTimeout(detailUrl, {
            headers: {
              Authorization: authHeader,
            },
          }, 8000);

          if (!detailRes.ok) {
            if (detailRes.status === 429 || detailRes.status >= 500) continue;
            return null;
          }
          const detail = (await detailRes.json()) as any;

          const headers = detail.payload?.headers || [];
          const subject = headers.find((h: any) => h.name.toLowerCase() === "subject")?.value || "(No Subject)";
          const from = headers.find((h: any) => h.name.toLowerCase() === "from")?.value || "(Unknown)";
          const date = headers.find((h: any) => h.name.toLowerCase() === "date")?.value || "";

          return {
            id: msg.id,
            snippet: detail.snippet || "",
            subject,
            from,
            date,
          };
        } catch (err: any) {
          console.warn(`Attempt ${attempt} failed fetching email detail for ${msg.id}: ${err.message || err}`);
        }
      }
      console.warn(`Dropping email ${msg.id} from triage after repeated fetch failures.`);
      return null;
    };

    const detailedEmails: any[] = [];
    const messageChunks = chunkArray(candidateMessages, 20);
    for (const chunk of messageChunks) {
      const chunkResults = await Promise.all(chunk.map(fetchDetail));
      detailedEmails.push(...chunkResults.filter(Boolean));
    }

    if (detailedEmails.length === 0) {
      return res.json({ importantEmails: [] });
    }

    // Normalized filters for deterministic, fast pre-filtering
    const normalizedIgnoredSenders = ignoredSenders.map((s: string) => s.trim().toLowerCase());
    const normalizedIgnoredDomains = ignoredDomains.map((d: string) => d.trim().toLowerCase());

    const filteredEmails = detailedEmails.filter((email: any) => {
      // Check specific email ignore list
      if (ignoredEmails.includes(email.id)) {
        console.log(`Pre-filtered ignored specific email ID: ${email.id}`);
        return false;
      }

      const emailMatch = email.from.match(/<([^>]+)>/) || [null, email.from];
      const emailAddress = (emailMatch[1] || email.from).trim().toLowerCase();
      const domainParts = emailAddress.split("@");
      const domain = domainParts[domainParts.length - 1]?.trim() || "";

      // Check exact sender ignore list
      if (normalizedIgnoredSenders.includes(emailAddress)) {
        console.log(`Pre-filtered ignored sender: ${emailAddress}`);
        return false;
      }

      // Check domain ignore list
      if (normalizedIgnoredDomains.some((ignoredDomain: string) => domain === ignoredDomain || domain.endsWith("." + ignoredDomain))) {
        console.log(`Pre-filtered ignored domain: ${domain} (matches ${ignoredDomains})`);
        return false;
      }

      return true;
    });

    if (filteredEmails.length === 0) {
      return res.json({ importantEmails: [] });
    }

    // Use Gemini to analyze emails
    const ai = getGeminiClient();

     const systemInstruction = `You are an exceptionally elite, high-judgment personal productivity AI assistant. You have a masterful understanding of what is genuinely interesting and actionable, as opposed to standard automated digital noise.
Your sole goal is to review a user's recent email summaries and identify ONLY the emails that require active user intervention, decisions, direct answers, or immediate payments/renewals.

CRITICAL SELECTIVITY MANDATES:
1. STRICTLY IGNORE routine automated notifications, status digests, system logs, or alerts (e.g. "5 new updates", "GitHub comment/push notices", "Travis CI build succeeded", "LinkedIn notifications", "Twitter follow alerts", or simple success status updates). These are noise and MUST NEVER be surfaced.
2. STRICTLY IGNORE regular promotional campaigns, cold marketing pitches, newsletters, or informational announcements (even if they use catchy verbs like "Upgrade your account today" or "Discover our new app"). Unless they specifically notify the user of an active subscription billing failure or trial about to expire, do not surface them.
3. STRICTLY IGNORE friendly chit-chat or casual social conversations that do not request a concrete task, a calendar confirmation, or a response from the user.
4. ONLY SURFACE emails representing actual high-relevance actionable tasks, client contracts/proposals, critical upcoming subscription/hosting/domain renewals, trial expirations, payment bill reminders, or direct requests from human clients, team members, or partners requiring a reply or decision.
5. ALWAYS SURFACE any emails from accountants, tax advisors, or financial professionals (e.g., "Frankie", "Franky", "Accountant", "Tax office") chasing for information, approvals, or files. These are extremely critical and MUST always be surfaced as "high" priority.

For each email you decide is genuinely important/actionable, return:
1. 'index': the exact numeric 'index' value of that email as given in the input list. Never invent an index.
2. 'suggestedTitle': a crisp, action-oriented task title (e.g., "Pay credit card bill", "Renew website domain", "Approve Rain Ventures Agreement", "Respond to John's design request").
3. 'importanceReason': a clear, objective 1-sentence explanation of why this was flagged and any deadlines (e.g., "Hosting renews automatically on July 20th for $15.00").
4. 'suggestedCategory': must be one of: 'north_star', 'marketing', 'maintenance', 'personal', 'general'.
5. 'suggestedPriority': must be one of: 'high', 'medium', 'low'.
6. 'suggestedHorizon': must be one of: 'today', 'tomorrow', 'this_week', 'this_month', 'backlog'.
7. 'suggestedDate': YYYY-MM-DD due date if mentioned or strongly implied; otherwise leave null or omit.`;

    // Cap the Gemini payload, and identify emails by their position in the
    // list rather than the raw Gmail message ID — models reliably echo a small
    // integer, but mangle long opaque IDs, which broke ignore persistence.
    const GEMINI_EMAIL_CAP = 100;
    const emailsForAnalysis = filteredEmails.slice(0, GEMINI_EMAIL_CAP);
    if (filteredEmails.length > emailsForAnalysis.length) {
      console.warn(`Sending newest ${emailsForAnalysis.length} of ${filteredEmails.length} filtered emails to Gemini.`);
    }
    const dateCtx = resolveDateContext(currentDate);

    const prompt = `Here are the active, pre-filtered emails from the last 14 days:
${JSON.stringify(emailsForAnalysis.map((e: any, index: number) => ({
      index,
      from: e.from,
      subject: e.subject,
      date: e.date,
      snippet: e.snippet,
    })))}

Please triage these and return ONLY the genuinely important, highly actionable ones as a JSON array of objects, each referencing the email by its 'index'. Current date is: ${dateCtx.iso} (${dateCtx.dayName}).`;

    const response = await generateWithRetry(ai, {
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              index: { type: Type.INTEGER },
              suggestedTitle: { type: Type.STRING },
              importanceReason: { type: Type.STRING },
              suggestedCategory: { type: Type.STRING },
              suggestedPriority: { type: Type.STRING },
              suggestedHorizon: { type: Type.STRING },
              suggestedDate: { type: Type.STRING },
            },
            required: ["index", "suggestedTitle", "importanceReason", "suggestedCategory", "suggestedPriority", "suggestedHorizon"],
          },
        },
      },
    });

    const triageResults = JSON.parse(response.text || "[]");

    // Map indices back to the real Gmail messages; drop anything referencing
    // an index we never sent, and dedupe repeated picks of the same email.
    const seenIds = new Set<string>();
    const importantEmails = triageResults
      .map((item: any) => {
        const orig = Number.isInteger(item.index) ? emailsForAnalysis[item.index] : undefined;
        if (!orig || seenIds.has(orig.id)) {
          if (!orig) console.warn(`Dropping triage result with unknown index: ${item.index}`);
          return null;
        }
        seenIds.add(orig.id);
        const { index, ...rest } = item;
        return {
          ...rest,
          emailId: orig.id,
          subject: orig.subject,
          from: orig.from,
          date: orig.date,
          snippet: orig.snippet,
        };
      })
      .filter(Boolean);

    res.json({ importantEmails });
  } catch (error: any) {
    console.error("Error in email triage API:", error);
    res.status(500).json({ error: error.message || "Failed to triage emails." });
  }
});

// 4. API: Send Daily Morning Focus Briefing Email via Gmail API
app.post("/api/send-daily-summary", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: "Missing authorization token." });
    }

    const { tasks, northStar, triagedEmails, dashboardUrl, userEmail: bodyEmail } = req.body;

    let userEmail = bodyEmail;
    if (!userEmail) {
      try {
        console.log("Fetching Gmail user profile to resolve active email address...");
        const profileRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
          headers: { Authorization: authHeader },
        });
        if (profileRes.ok) {
          const profile = (await profileRes.json()) as { emailAddress?: string };
          userEmail = profile.emailAddress;
        }
      } catch (profileErr) {
        console.error("Failed to fetch Gmail profile:", profileErr);
      }
    }

    // Default fallback (using "me" if profile fetch is blocked, though with our token permissions it succeeds)
    if (!userEmail) {
      userEmail = "me";
    }
    console.log(`Resolved target user email for briefing: ${userEmail}`);

    const activeTasks = Array.isArray(tasks) ? tasks : [];
    const activeEmails = Array.isArray(triagedEmails) ? triagedEmails : [];
    const currentNorthStar = northStar || { title: "Not specified", description: "Not specified" };

    // Get today's still-open tasks specifically (completed ones must not be
    // re-listed as must-dos in the morning briefing)
    const todayTasks = activeTasks.filter((t: any) => t.horizon === "today" && !t.completed);
    const mustDos = todayTasks.filter((t: any) => t.isMustDo || t.priority === "high");
    const niceToDos = todayTasks.filter((t: any) => !t.isMustDo && t.priority !== "high");

    const ai = getGeminiClient();

    const systemInstruction = `You are an elite high-performance productivity coach and personal strategist. The user is receiving their early morning dashboard briefing email. 
Based on their active tasks, their North Star: "${currentNorthStar.title} - ${currentNorthStar.description}", and any urgent triaged email alerts, write a direct, inspiring, and sharp morning coaching focus paragraph (3-4 sentences maximum).
- Focus them on the absolute highest leverage actions for today.
- Highlight the single biggest win they can achieve today.
- Cut through the noise, telling them what to defer or ignore.
- Keep the tone warm, intellectual, and extremely direct. Do not use generic corporate filler or greeting fluff like "I hope you are well".`;

    const prompt = `Here are today's must-do tasks:
${JSON.stringify(mustDos.map((t: any) => t.title))}

Nice-to-do tasks:
${JSON.stringify(niceToDos.map((t: any) => t.title))}

Urgent Email Triage alerts:
${JSON.stringify(activeEmails.map((e: any) => ({ title: e.suggestedTitle, reason: e.importanceReason })))}

Please write my daily morning focus coaching summary.`;

    const aiResponse = await generateWithRetry(ai, {
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        systemInstruction,
      },
    });

    const coachCommentary = aiResponse.text || "Today is a new day to execute and win. Focus on your top priorities and ignore the low-value noise.";

    // Generate HTML Content
    const currentDateStr = new Date().toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });

    const mustDosHtml = mustDos.length > 0
      ? mustDos.map((t: any) => `
        <div style="border-bottom: 1px solid #f3f4f6; padding: 12px 0;">
          <span style="display: inline-block; font-size: 9px; font-weight: bold; background-color: #fef2f2; color: #ef4444; border: 1px solid #fee2e2; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; margin-right: 8px; font-family: monospace;">MUST DO</span>
          <span style="font-size: 14px; font-weight: 600; color: #111827;">${t.title}</span>
          ${t.reasoning ? `<div style="font-size: 11px; color: #6b7280; margin-top: 4px; padding-left: 4px; border-left: 2px solid #e5e7eb;">${t.reasoning}</div>` : ""}
        </div>
      `).join("")
      : `<div style="padding: 16px 0; text-align: center; color: #9ca3af; font-size: 13px;">No Must-Dos scheduled. Focus on defining your top priority!</div>`;

    const niceToDosHtml = niceToDos.length > 0
      ? niceToDos.map((t: any) => `
        <div style="border-bottom: 1px solid #f3f4f6; padding: 12px 0;">
          <span style="display: inline-block; font-size: 9px; font-weight: bold; background-color: #f0fdf4; color: #166534; border: 1px solid #dcfce7; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; margin-right: 8px; font-family: monospace;">NICE TO DO</span>
          <span style="font-size: 14px; font-weight: 500; color: #374151;">${t.title}</span>
          ${t.reasoning ? `<div style="font-size: 11px; color: #6b7280; margin-top: 4px; padding-left: 4px; border-left: 2px solid #e5e7eb;">${t.reasoning}</div>` : ""}
        </div>
      `).join("")
      : `<div style="padding: 16px 0; text-align: center; color: #9ca3af; font-size: 13px;">No secondary tasks for today. Keep it ultra-focused!</div>`;

    const emailsHtml = activeEmails.length > 0
      ? activeEmails.map((e: any) => `
        <div style="border-bottom: 1px solid #f3f4f6; padding: 12px 0;">
          <div style="font-size: 10px; font-weight: bold; color: #9ca3af; font-family: monospace; text-transform: uppercase; margin-bottom: 2px;">FROM: ${e.from}</div>
          <span style="display: inline-block; font-size: 9px; font-weight: bold; background-color: #fffbeb; color: #b45309; border: 1px solid #fef3c7; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; margin-right: 8px; font-family: monospace;">SURFACED ALERT</span>
          <span style="font-size: 13px; font-weight: 600; color: #1f2937;">${e.suggestedTitle}</span>
          <div style="font-size: 11px; color: #4b5563; margin-top: 4px; padding-left: 4px; border-left: 2px solid #fde68a;">${e.importanceReason}</div>
        </div>
      `).join("")
      : `<div style="padding: 16px 0; text-align: center; color: #9ca3af; font-size: 13px;">Inbox clear of urgent renewals, billing alerts, or critical tasks.</div>`;

    const currentDashboardUrl = dashboardUrl || "https://ai.studio/build";

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #fafafa; color: #111827; margin: 0; padding: 24px 16px;">
  <div style="background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 16px; max-width: 600px; margin: 0 auto; padding: 32px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.03);">
    
    <!-- Header -->
    <div style="border-bottom: 1px solid #f3f4f6; padding-bottom: 20px; margin-bottom: 24px;">
      <div style="font-size: 20px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.5px; color: #111827;">Action Man</div>
      <div style="font-size: 11px; font-family: monospace; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px;">Morning Briefing &bull; ${currentDateStr}</div>
    </div>

    <!-- North Star Alert -->
    ${currentNorthStar.title && currentNorthStar.title !== "Not specified" ? `
    <div style="background-color: #fafafa; border-radius: 8px; padding: 12px 16px; border: 1px solid #e5e7eb; margin-bottom: 24px;">
      <div style="font-size: 10px; font-weight: bold; font-family: monospace; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">CURRENT NORTH STAR</div>
      <div style="font-size: 13px; font-weight: 700; color: #111827; margin-top: 2px;">${currentNorthStar.title}</div>
      <div style="font-size: 11px; color: #4b5563; margin-top: 1px;">${currentNorthStar.description}</div>
    </div>
    ` : ""}

    <!-- Coach Box -->
    <div style="background-color: #111827; border-radius: 12px; padding: 20px; margin-bottom: 28px; color: #ffffff;">
      <div style="font-size: 10px; font-weight: bold; font-family: monospace; color: #9ca3af; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;">COACH COMMENTARY</div>
      <p style="font-size: 13px; line-height: 1.6; color: #f3f4f6; font-style: italic; margin: 0;">"${coachCommentary}"</p>
    </div>

    <!-- Must-Dos -->
    <div style="margin-bottom: 28px;">
      <div style="font-size: 10px; font-weight: bold; font-family: monospace; color: #9ca3af; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">1. TODAY'S MUST-DOS</div>
      ${mustDosHtml}
    </div>

    <!-- Nice-to-Dos -->
    <div style="margin-bottom: 28px;">
      <div style="font-size: 10px; font-weight: bold; font-family: monospace; color: #9ca3af; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">2. NICE-TO-DOS</div>
      ${niceToDosHtml}
    </div>

    <!-- Email alerts -->
    <div style="margin-bottom: 32px;">
      <div style="font-size: 10px; font-weight: bold; font-family: monospace; color: #9ca3af; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">3. UNRESOLVED GMAIL ACTIONS</div>
      ${emailsHtml}
    </div>

    <!-- Action Link -->
    <div style="text-align: center; margin-top: 36px; border-top: 1px solid #f3f4f6; padding-top: 24px;">
      <a href="${currentDashboardUrl}" style="background-color: #111827; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-size: 12px; font-weight: bold; letter-spacing: 0.5px; display: inline-block; text-transform: uppercase;">Open Focus Dashboard</a>
      <div style="font-size: 10px; color: #9ca3af; font-family: monospace; margin-top: 12px;">ACTION MAN &bull; PERSONAL COGNITIVE SPACE</div>
    </div>

  </div>
</body>
</html>
`;

    const subjectDate = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const rawSubject = `🌅 Action Man Focus Briefing - ${subjectDate}`;
    const encodedSubject = `=?utf-8?B?${Buffer.from(rawSubject).toString("base64")}?=`;

    // Package the raw email
    const emailParts = [
      `From: ${userEmail}`,
      `To: ${userEmail}`,
      `Subject: ${encodedSubject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/html; charset=utf-8",
      "",
      htmlContent,
    ];
    const rawEmail = emailParts.join("\r\n");
    const encodedEmail = Buffer.from(rawEmail)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    console.log("Sending morning briefing email on behalf of user...");
    const sendRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        raw: encodedEmail,
      }),
    });

    if (!sendRes.ok) {
      const errorText = await sendRes.text();
      console.error("Gmail send API error:", errorText);
      
      const isScopeError = errorText.includes("insufficient authentication scopes") || errorText.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT");
      const friendlyError = isScopeError
        ? "Google Permission Denied: Your current login session does not have the 'Send email' permission enabled. Please click 'Disconnect' in the top right, then 'Sign In with Google' again and make sure to check/allow the box that permits sending messages on your behalf."
        : `Gmail Send API error: ${sendRes.statusText} - ${errorText}`;

      return res.status(200).json({ success: false, error: friendlyError, isScopeError });
    }

    const sendData = await sendRes.json();
    res.json({ success: true, messageId: sendData.id, coachCommentary });
  } catch (error: any) {
    console.error("Error in send daily summary API:", error);
    res.status(500).json({ error: error.message || "Failed to send daily summary." });
  }
});

// Setup Vite or production serving
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
