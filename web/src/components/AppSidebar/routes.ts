import { matchPath } from "react-router-dom";
import { isMemoScopeRoute, type MemoScope, resolveMemoScope } from "@/lib/memo-views";
import { ROUTES } from "@/router/routes";

export type SidebarRouteKind =
  | MemoScope
  | "profile"
  | "views"
  | "attachments"
  | "inbox"
  | "review"
  | "translate"
  | "settings"
  | "ai-chat"
  | "memo"
  | "empty";

export const getSidebarRouteKind = (path: string): SidebarRouteKind => {
  if (isMemoScopeRoute(path)) return resolveMemoScope(path);
  if (matchPath("/u/:username", path)) return "profile";
  if (path === ROUTES.VIEWS) return "views";
  if (path === ROUTES.ATTACHMENTS) return "attachments";
  if (path === ROUTES.INBOX) return "inbox";
  if (path === ROUTES.REVIEW) return "review";
  if (path === ROUTES.TRANSLATE) return "translate";
  if (path === ROUTES.SETTING) return "settings";
  if (path === ROUTES.AI_CHAT) return "ai-chat";
  if (matchPath("/memos/:uid", path) || matchPath(`${ROUTES.SHARED_MEMO}/token`, path)) return "memo";
  return "empty";
};
