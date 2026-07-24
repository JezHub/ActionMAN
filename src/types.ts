export interface Task {
  id: string;
  title: string;
  priority: "high" | "medium" | "low";
  horizon: "today" | "tomorrow" | "this_week" | "this_month" | "this_year" | "backlog";
  category: "north_star" | "marketing" | "maintenance" | "personal" | "general";
  dropDeadDate?: string;
  reasoning?: string;
  completed: boolean;
  completedAt?: string;
  isMustDo?: boolean;
  isNiceToDo?: boolean;
  isForceCritical?: boolean;
  createdAt: string;
  tags?: string[];
}

export interface NorthStarHistoryItem {
  id: string;
  title: string;
  description: string;
  createdAt: string;
}

export interface NorthStar {
  title: string;
  description: string;
  history?: NorthStarHistoryItem[];
}

export interface DailyCoachFeedback {
  mustDoIds: string[];
  niceToDoIds: string[];
  coachMessage: string;
}

// A report written into the app by a background agent (morning brief, weekly
// review, weekend scout, habit nudge). Agents authenticate to the data API
// with AGENT_API_TOKEN and POST these; the dashboard surfaces the latest one
// per kind.
export interface AgentReport {
  id: string;
  kind: "morning_brief" | "weekly_review" | "weekend_scout" | "habit_nudge" | string;
  reportDate?: string;
  title: string;
  content: string;
  data?: {
    suggestedTasks?: Array<{
      title: string;
      priority?: Task["priority"];
      horizon?: Task["horizon"];
      category?: Task["category"];
      dropDeadDate?: string;
      reasoning?: string;
    }>;
    [key: string]: any;
  };
  read: boolean;
  createdAt: string;
}
