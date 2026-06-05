export type UserRole = "admin" | "editor";

export type NetworkKey = "instagram" | "facebook" | "youtube" | "tiktok";

export type MediaStatus = "active" | "review" | "archived";

export type ContentType = "reel" | "story" | "ad" | "organic";

export type NetworkStat = {
  views: number;
  engagement: number;
  score: number;
};

export type MediaItem = {
  id: string;
  /** Sequential numeric ID visible in UI (e.g. #0001). */
  numericId?: number;
  title: string;
  type: "video" | "image";
  format: string;
  /** Primary content classification. */
  contentType?: ContentType;
  duration: string;
  status: MediaStatus;
  category: string;
  fileName: string;
  url?: string | null;
  thumbnailUrl?: string | null;
  createdAt: string;
  stats: Record<NetworkKey, NetworkStat>;
  /** Composite score (avg of all networks). */
  compositeScore?: number;
  /** Flag: separate viral content from organic in analytics. */
  isViral?: boolean;
  /** Flag: this is paid/ad content. */
  isAd?: boolean;
  /** Quantas vezes esta midia ja foi reaproveitada (repostada). */
  repostCount?: number;
  /** ISO da ultima vez que entrou no ar (novo post ou repost). */
  lastPostedAt?: string | null;
};

export type ScheduleItem = {
  id: string;
  title: string;
  mediaId: string | null;
  networks: NetworkKey[];
  scheduledFor: string;
  caption: string;
  contentType?: ContentType;
  status: "scheduled";
  repostRuleId: string | null;
  woopPostId?: string | null;
  woopStatus?: "SCHEDULED" | "DRAFT" | "PUBLISHED" | "error" | null;
  /** Story scheduling sends a notification instead of auto-publishing. */
  storyNotification?: boolean;
  notificationSentAt?: string | null;
};

export type RepostRule = {
  id: string;
  name: string;
  minScore: number;
  intervalDays: number;
  maxReposts: number;
  removeBelowScore: number;
  networks: NetworkKey[];
  active: boolean;
};

export type AppUser = {
  id: string;
  name: string;
  email: string;
  password: string;
  role: UserRole;
  createdAt: string;
};

export type AuditEntry = {
  id: string;
  type: string;
  message: string;
  createdAt: string;
};

// --- Scripts & Recording Queue ---

export type ScriptStatus = "draft" | "ready" | "recorded" | "archived";

export type Script = {
  id: string;
  numericId?: number;
  title: string;
  body: string;
  contentType: ContentType;
  status: ScriptStatus;
  mediaId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RecordingQueueItem = {
  id: string;
  scriptId: string;
  priority: number;
  scheduledRecordDate: string | null;
  notes: string;
  status: "queued" | "recording" | "done";
};

// --- Captions ---

export type CaptionDraft = {
  id: string;
  mediaId: string | null;
  scheduleId: string | null;
  text: string;
  network: NetworkKey | null;
  status: "draft" | "approved" | "published";
  createdAt: string;
};

// --- Competitors ---

export type Competitor = {
  id: string;
  name: string;
  handle: string;
  platform: NetworkKey;
  avatarUrl?: string;
  addedAt: string;
};

export type CompetitorSnapshot = {
  id: string;
  competitorId: string;
  date: string;
  followers: number;
  views: number;
  engagement: number;
  posts: number;
};

// --- Dashboard ---

export type DailySnapshot = {
  date: string;
  totalViews: number;
  totalEngagement: number;
  totalFollowers: number;
  byNetwork: Record<NetworkKey, { views: number; engagement: number; followers: number }>;
};

// --- Persisted State ---

export type PersistedState = {
  users: AppUser[];
  mediaLibrary: MediaItem[];
  schedules: ScheduleItem[];
  repostRules: RepostRule[];
  audit: AuditEntry[];
  scripts: Script[];
  recordingQueue: RecordingQueueItem[];
  captions: CaptionDraft[];
  competitors: Competitor[];
  competitorSnapshots: CompetitorSnapshot[];
  dailySnapshots: DailySnapshot[];
  nextMediaNumericId: number;
  nextScriptNumericId: number;
};

export type FlashState = {
  message: string;
  kind: "success" | "error";
} | null;

export type ViewKey =
  | "dashboard"
  | "library"
  | "calendar"
  | "scheduler"
  | "scripts"
  | "plan"
  | "insights"
  | "competitors"
  | "reposts"
  | "users"
  | "config"
  | "teleprompter";
