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
