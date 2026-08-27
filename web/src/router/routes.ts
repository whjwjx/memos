export const ROUTES = {
  HOME: "/",
  ABOUT: "/about",
  ATTACHMENTS: "/attachments",
  CALENDAR: "/calendar",
  INBOX: "/inbox",
  REVIEW: "/review",
  TRANSLATE: "/translate",
  ARCHIVED: "/archived",
  VIEWS: "/views",
  SETTING: "/setting",
  AI_CHAT: "/ai-chat",
  EXPLORE: "/explore",
  AUTH: "/auth",
  AUTH_SIGNUP: "/auth/signup",
  AUTH_ADMIN: "/auth/admin",
  AUTH_CALLBACK: "/auth/callback",
  SHARED_MEMO: "/memos/shares",
} as const;

export type RouteKey = keyof typeof ROUTES;
export type RoutePath = (typeof ROUTES)[RouteKey];
