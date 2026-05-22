export type UserRole = "admin" | "editor";

export type NetworkKey = "instagram" | "facebook" | "youtube" | "tiktok";

export type MediaStatus = "active" | "review" | "archived";

export type NetworkStat = {
  views: number;
  engagement: number;
  score: number;
};

export type MediaItem = {
  id: string;
  title: string;
  type: "video" | "image";
  format: string;
  duration: string;
  status: MediaStatus;
  category: string;
  fileName: string;
  url?: string | null;
  createdAt: string;
  stats: Record<NetworkKey, NetworkStat>;
};

export type ScheduleItem = {
  id: string;
  title: string;
  mediaId: string | null;
  networks: NetworkKey[];
  scheduledFor: string;
  caption: string;
  status: "scheduled";
  repostRuleId: string | null;
  bundlePostId?: string | null;
  bundleStatus?: "SCHEDULED" | "DRAFT" | "error" | null;
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

export type SocialConnection = {
  id: string;
  network: NetworkKey;
  status: "connected" | "pending" | "disconnected";
  accountName: string;
  accountId: string;
  pageId: string;
  redirectUri: string;
  scopes: string;
  webhookUrl: string;
  lastSync: string | null;
};

export type SecureConnectionFieldStatus = {
  name: string;
  label: string;
  envName: string;
  required: boolean;
  configured: boolean;
  maskedValue: string | null;
  help: string;
};

export type SecureConnectionSummary = {
  network: NetworkKey;
  ready: boolean;
  fields: SecureConnectionFieldStatus[];
};

export type AuditEntry = {
  id: string;
  type: string;
  message: string;
  createdAt: string;
};

export type PersistedState = {
  users: AppUser[];
  mediaLibrary: MediaItem[];
  schedules: ScheduleItem[];
  repostRules: RepostRule[];
  connections: SocialConnection[];
  audit: AuditEntry[];
};

export type FlashState = {
  message: string;
  kind: "success" | "error";
} | null;

export type ViewKey = "library" | "scheduler" | "reposts" | "users" | "config";
