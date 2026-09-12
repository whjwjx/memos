import { useQuery } from "@tanstack/react-query";
import {
  BotIcon,
  BrainCircuitIcon,
  CheckIcon,
  ChevronDownIcon,
  MessageSquareTextIcon,
  SendIcon,
  UserIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import {
  type SendMessagePhase,
  useConversation,
  useConversations,
  useCreateConversation,
  useSendMessage,
  useUpdateConversationAgent,
  useUpdateConversationLLM,
} from "@/hooks/useAIChat";
import { useAIChatAgents } from "@/hooks/useAIChatAgents";
import { memoDetailQueryOptions } from "@/hooks/useMemoQueries";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/router/routes";
import { type ConversationMessage } from "@/types/proto/api/v1/ai_chat_service_pb";
import type { InstanceSetting_ChatAgentConfig, InstanceSetting_LLMConfig } from "@/types/proto/api/v1/instance_service_pb";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";

const AWAITING_PLACEHOLDER = "awaiting user confirmation";
const LEGACY_TOOL_APPROVAL_USER_MESSAGE = "[用户已批准上述待确认工具，请直接执行并继续]";
const MEMO_CONTEXT_MAX_CHARS = 3000;
const MEMO_CONTEXT_START = "[Selected memo context]";
const MEMO_CONTEXT_END = "[/Selected memo context]";
const MEMO_CONTEXT_QUESTION_PREFIX = "User question:";

const truncateText = (value: string, maxChars: number): string => {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars).trimEnd()}\n...[truncated]`;
};

const compactText = (value: string, maxChars: number): string => {
  const compacted = value.trim().replace(/\s+/g, " ");
  return compacted.length > maxChars ? `${compacted.slice(0, maxChars).trimEnd()}...` : compacted;
};

const buildMemoContextMessage = (memo: Memo, question: string): string => {
  return `${MEMO_CONTEXT_START}
Memo: ${memo.name}
Content excerpt:
${truncateText(memo.content.trim(), MEMO_CONTEXT_MAX_CHARS)}
${MEMO_CONTEXT_END}

${MEMO_CONTEXT_QUESTION_PREFIX}
${question}`;
};

const stripMemoContextEnvelope = (content: string): string => {
  if (!content.startsWith(MEMO_CONTEXT_START)) {
    return content;
  }
  const marker = `${MEMO_CONTEXT_END}\n\n${MEMO_CONTEXT_QUESTION_PREFIX}\n`;
  const markerIndex = content.indexOf(marker);
  if (markerIndex < 0) {
    return content;
  }
  return content.slice(markerIndex + marker.length).trimStart();
};

// stripFakeToolCalls hides pseudo tool-call XML that some models emit as plain
// text (e.g. <tool_calls><invoke name="...">...</invoke></tool_calls>) instead
// of a native function call. Real tool calls are surfaced via the confirmation
// cards and never reach the markdown renderer.
const stripFakeToolCalls = (content: string): string => {
  let cleaned = content.replace(/<tool_calls\b[^>]*>[\s\S]*?<\/tool_calls>/gi, "");
  cleaned = cleaned.replace(/<invoke\b[^>]*>[\s\S]*?<\/invoke>/gi, "");
  cleaned = cleaned.trim();
  return cleaned || "Done.";
};

type ToolActivityCall = {
  id: string;
  name: string;
  arguments: string;
  result: string;
  status: "pending" | "completed" | "error" | "skipped";
};

type ConversationTimelineItem =
  | { kind: "message"; message: ConversationMessage }
  | { kind: "toolActivity"; id: string; calls: ToolActivityCall[] }
  | { kind: "runtimeStatus"; id: string; label: string };

const SENSITIVE_KEY_RE = /api[_-]?key|authorization|bearer|password|secret|token/i;

const redactSensitiveValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(redactSensitiveValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        SENSITIVE_KEY_RE.test(key) ? "[redacted]" : redactSensitiveValue(nested),
      ]),
    );
  }
  if (typeof value === "string") {
    return value.replace(/(api[_-]?key|authorization|bearer|password|secret|token)(["'\s:=]+)([^"'\s,}]+)/gi, "$1$2[redacted]");
  }
  return value;
};

const parseToolPayload = (value: string): unknown => {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const firstObject = trimmed.indexOf("{");
  const firstArray = trimmed.indexOf("[");
  const firstJSONChar = firstObject < 0 ? firstArray : firstArray < 0 ? firstObject : Math.min(firstObject, firstArray);
  const payload = firstJSONChar > 0 ? trimmed.slice(firstJSONChar) : trimmed;
  try {
    return JSON.parse(payload);
  } catch {
    return undefined;
  }
};

const formatToolPayload = (value: string, maxChars = 2400): string => {
  const parsed = parseToolPayload(value);
  const formatted =
    parsed === undefined ? String(redactSensitiveValue(value.trim())) : JSON.stringify(redactSensitiveValue(parsed), undefined, 2);
  return truncateText(formatted, maxChars);
};

const getToolResultStatus = (content: string): ToolActivityCall["status"] => {
  const normalized = content.trim();
  if (normalized === AWAITING_PLACEHOLDER) {
    return "pending";
  }
  if (normalized.startsWith("error:")) {
    return "error";
  }
  if (normalized.includes("拒绝") || normalized.toLowerCase().includes("rejected") || normalized.toLowerCase().includes("skipped")) {
    return "skipped";
  }
  return "completed";
};

const getToolResultSummary = (content: string): string => {
  const parsed = parseToolPayload(content);
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.results)) {
      return `${obj.results.length} result${obj.results.length === 1 ? "" : "s"}`;
    }
    if (typeof obj.answer === "string" && obj.answer.trim()) {
      return compactText(obj.answer, 160);
    }
  }
  return compactText(content, 180);
};

const buildConversationTimeline = (messages: ConversationMessage[]): ConversationTimelineItem[] => {
  const toolResultByID = new Map<string, ConversationMessage>();
  for (const message of messages) {
    if (message.role === "tool" && message.toolCallId) {
      toolResultByID.set(message.toolCallId, message);
    }
  }

  const timeline: ConversationTimelineItem[] = [];
  for (const message of messages) {
    if (message.role === "user" && message.content.trim() === LEGACY_TOOL_APPROVAL_USER_MESSAGE) {
      continue;
    }
    if (message.role === "tool") {
      continue;
    }
    if (message.role === "assistant" && (message.toolCalls?.length ?? 0) > 0) {
      timeline.push({
        kind: "toolActivity",
        id: `tools-${message.id}`,
        calls: message.toolCalls.map((call) => {
          const result = toolResultByID.get(call.id)?.content ?? "";
          return {
            id: call.id,
            name: call.name,
            arguments: call.arguments,
            result,
            status: result ? getToolResultStatus(result) : "pending",
          };
        }),
      });
      continue;
    }
    if (message.role === "assistant" && !message.content.trim()) {
      continue;
    }
    timeline.push({ kind: "message", message });
  }
  return timeline;
};

const hasVisibleStreamingAssistantMessage = (timeline: ConversationTimelineItem[]): boolean =>
  timeline.some(
    (item) =>
      item.kind === "message" &&
      item.message.role === "assistant" &&
      item.message.id.startsWith("local-assistant-") &&
      item.message.content.trim().length > 0,
  );

const insertRuntimeStatus = (timeline: ConversationTimelineItem[], label: string): ConversationTimelineItem[] => {
  if (!label) {
    return timeline;
  }

  let lastUserMessageIndex = -1;
  for (let i = timeline.length - 1; i >= 0; i--) {
    const item = timeline[i];
    if (item.kind === "message" && item.message.role === "user") {
      lastUserMessageIndex = i;
      break;
    }
  }

  const statusItem: ConversationTimelineItem = { kind: "runtimeStatus", id: "runtime-status", label };
  if (lastUserMessageIndex < 0) {
    return [...timeline, statusItem];
  }
  return [...timeline.slice(0, lastUserMessageIndex + 1), statusItem, ...timeline.slice(lastUserMessageIndex + 1)];
};

const getRuntimeStatusLabel = (
  phase: SendMessagePhase,
  timeline: ConversationTimelineItem[],
  translate: ReturnType<typeof useTranslate>,
): string => {
  if (phase === "idle") {
    return "";
  }
  if (phase === "responding" && hasVisibleStreamingAssistantMessage(timeline)) {
    return "";
  }
  if (phase === "using_tools") {
    return translate("aiChat.status-using-tools");
  }
  if (phase === "responding") {
    return translate("aiChat.status-responding");
  }
  return translate("aiChat.status-thinking");
};

const AgentPill = ({
  agentLabel,
  agents,
  disabled,
  selectedAgentId,
  onSelect,
}: {
  agentLabel: string;
  agents: InstanceSetting_ChatAgentConfig[];
  disabled: boolean;
  selectedAgentId: string;
  onSelect: (agentId: string) => void;
}) => {
  const canSelect = agents.length > 1;
  const buttonClassName =
    "h-7 max-w-[12rem] justify-start gap-1.5 rounded-md bg-muted/70 px-2 text-xs font-medium text-muted-foreground hover:text-foreground";

  if (!canSelect) {
    return (
      <Button type="button" variant="ghost" size="sm" className={buttonClassName} aria-disabled="true">
        <BotIcon className="size-3.5" strokeWidth={1.8} />
        <span className="truncate">{agentLabel}</span>
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="sm" className={buttonClassName} disabled={disabled} />}>
        <BotIcon className="size-3.5" strokeWidth={1.8} />
        <span className="truncate">{agentLabel}</span>
        <ChevronDownIcon className="size-3.5 opacity-65" strokeWidth={1.8} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" sideOffset={6} className="w-48">
        {agents.map((agent) => {
          const active = agent.id === selectedAgentId;
          return (
            <DropdownMenuItem key={agent.id} onClick={() => onSelect(agent.id)}>
              <BotIcon className="size-4" strokeWidth={1.8} />
              <span className="min-w-0 flex-1 truncate">{agent.name}</span>
              {active && <CheckIcon className="size-4 text-primary" strokeWidth={1.8} />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const LLMPill = ({
  disabled,
  llmLabel,
  llms,
  selectedLLMId,
  onSelect,
}: {
  disabled: boolean;
  llmLabel: string;
  llms: InstanceSetting_LLMConfig[];
  selectedLLMId: string;
  onSelect: (llmId: string) => void;
}) => {
  const canSelect = llms.length > 1;
  const buttonClassName =
    "h-7 max-w-[12rem] justify-start gap-1.5 rounded-md bg-muted/70 px-2 text-xs font-medium text-muted-foreground hover:text-foreground";

  if (!canSelect) {
    return (
      <Button type="button" variant="ghost" size="sm" className={buttonClassName} aria-disabled="true">
        <BrainCircuitIcon className="size-3.5" strokeWidth={1.8} />
        <span className="truncate">{llmLabel}</span>
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="sm" className={buttonClassName} disabled={disabled} />}>
        <BrainCircuitIcon className="size-3.5" strokeWidth={1.8} />
        <span className="truncate">{llmLabel}</span>
        <ChevronDownIcon className="size-3.5 opacity-65" strokeWidth={1.8} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" sideOffset={6} className="w-56">
        {llms.map((llm) => {
          const active = llm.id === selectedLLMId;
          return (
            <DropdownMenuItem key={llm.id} onClick={() => onSelect(llm.id)}>
              <BrainCircuitIcon className="size-4" strokeWidth={1.8} />
              <span className="min-w-0 flex-1 truncate">{llm.title || llm.model}</span>
              {active && <CheckIcon className="size-4 text-primary" strokeWidth={1.8} />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const MessageBubble = ({ msg }: { msg: ConversationMessage }) => {
  if (msg.role === "tool") {
    return null;
  }

  const isUser = msg.role === "user";
  return (
    <div className={`flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}>
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        {isUser ? <UserIcon className="w-3 h-auto" /> : <BotIcon className="w-3 h-auto" />}
        <span>{msg.role}</span>
      </div>
      <div
        className={`max-w-[82%] rounded-2xl px-4 py-2.5 text-sm ${
          isUser ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-muted rounded-bl-sm"
        }`}
      >
        {isUser ? (
          <span className="whitespace-pre-wrap break-words">{stripMemoContextEnvelope(msg.content)}</span>
        ) : (
          <ChatMarkdown content={stripFakeToolCalls(msg.content)} />
        )}
      </div>
    </div>
  );
};

// summarizeToolCall turns a tool's raw JSON arguments into a one-line, human
// readable summary so the user can tell what an action will do before approving
// (e.g. which memo a delete targets). Raw JSON stays available behind a toggle.
const summarizeToolCall = (name: string, argsJSON: string): string => {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(argsJSON || "{}");
  } catch {
    args = {};
  }
  const preview = (v: unknown, n = 120) => {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return s.length > n ? s.slice(0, n) + "…" : s;
  };
  switch (name) {
    case "delete_memo":
      return `删除 memo：${String(args.memoUid ?? "")}`;
    case "manage_settings":
      return `修改设置：${String(args.key ?? "")} = ${preview(args.value)}`;
    case "create_memo":
      return `新建 memo：${preview(args.content)}`;
    case "get_comments":
      return `查看评论：${String(args.memoUid ?? "")}`;
    case "search_memos":
      return `搜索：${String(args.query ?? "")}`;
    case "web_search":
      return `联网搜索：${String(args.query ?? "")}`;
    case "query_db":
      return `数据库操作：${String(args.operation ?? "")} ${String(args.table ?? "")}${args.operation === "select" ? `，最多 ${String(args.limit ?? 10)} 行` : ""}`;
    case "get_logs":
      return `读取日志：最近 ${String(args.limit ?? 50)} 行`;
    default:
      return preview(argsJSON);
  }
};

const RuntimeStatusRow = ({ label }: { label: string }) => (
  <div className="flex items-center gap-2 text-sm text-muted-foreground">
    <BotIcon className="h-4 w-auto animate-pulse" />
    <span>{label}</span>
  </div>
);

const ToolActivity = ({ calls }: { calls: ToolActivityCall[] }) => {
  const t = useTranslate();
  const [expanded, setExpanded] = useState(false);
  const names = Array.from(new Set(calls.map((call) => call.name))).join(", ");
  const hasError = calls.some((call) => call.status === "error");
  const pendingCount = calls.filter((call) => call.status === "pending").length;
  const statusLabel = hasError
    ? t("aiChat.tool-activity-status-error")
    : pendingCount > 0
      ? t("aiChat.tool-activity-status-pending")
      : t("aiChat.tool-activity-status-completed");

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        className="group flex max-w-[82%] items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
      >
        <WrenchIcon className="size-3.5 shrink-0" strokeWidth={1.8} />
        <span className="min-w-0 flex-1 truncate">{t("aiChat.tool-activity-summary", { count: calls.length, names })}</span>
        <Badge variant={hasError ? "warning" : "secondary"} shape="pill" className="hidden text-[11px] sm:inline-flex">
          {statusLabel}
        </Badge>
        <ChevronDownIcon className={cn("size-3.5 shrink-0 transition-transform", expanded && "rotate-180")} strokeWidth={1.8} />
      </button>

      {expanded && (
        <div className="flex w-full max-w-[82%] flex-col gap-2 rounded-xl border border-border bg-background px-3 py-3 text-xs">
          {calls.map((call) => (
            <div key={call.id} className="flex flex-col gap-2 border-b border-border/70 pb-2 last:border-b-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-primary">{call.name}</code>
                <Badge variant={call.status === "error" ? "warning" : call.status === "pending" ? "outline" : "secondary"} shape="pill">
                  {t(`aiChat.tool-activity-status-${call.status}` as Parameters<typeof t>[0])}
                </Badge>
              </div>
              <div className="text-sm text-foreground">{summarizeToolCall(call.name, call.arguments)}</div>
              <div className="grid gap-2">
                <div>
                  <div className="mb-1 font-medium text-muted-foreground">{t("aiChat.tool-activity-arguments")}</div>
                  <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 font-mono text-[11px] leading-5 text-muted-foreground">
                    {formatToolPayload(call.arguments)}
                  </pre>
                </div>
                {call.result && call.result !== AWAITING_PLACEHOLDER && (
                  <div>
                    <div className="mb-1 font-medium text-muted-foreground">
                      {t("aiChat.tool-activity-result")} · {getToolResultSummary(call.result)}
                    </div>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 font-mono text-[11px] leading-5 text-muted-foreground">
                      {formatToolPayload(call.result)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// queryDBWriteOps are the query_db operations that mutate the database and are
// therefore gated behind a second confirmation keyword typed by the user.
const QUERY_DB_WRITE_OPS = ["insert", "update", "delete"];

// CONFIRM_KEYWORD is the exact keyword a user must type to approve a query_db
// write operation. It must match the backend's confirmKeyword constant.
const CONFIRM_KEYWORD = "yes";

// ToolCallCard renders one tool call together with a readable summary. For
// delete_memo it additionally fetches the target memo so the user sees the actual
// content being removed (not just its uid). query_db write operations require the
// user to type the confirmation keyword "yes" before the approve button enables.
// Once the user approves/rejects, the card is kept (with a status badge) as a
// record instead of vanishing.
const ToolCallCard = ({
  tc,
  onResolve,
  disabled,
}: {
  tc: { id: string; name: string; arguments: string; status: "pending" | "approved" | "rejected" | "submitting"; confirmKeyword?: string };
  onResolve: (status: "approved" | "rejected", confirmKeyword?: string) => void;
  disabled: boolean;
}) => {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(tc.arguments || "{}");
  } catch {
    args = {};
  }
  const memoUid = typeof args.memoUid === "string" ? args.memoUid : undefined;
  const isQueryDBWrite = tc.name === "query_db" && typeof args.operation === "string" && QUERY_DB_WRITE_OPS.includes(args.operation);

  const { data: memo } = useQuery({
    ...memoDetailQueryOptions(`memos/${memoUid}`),
    enabled: tc.name === "delete_memo" && Boolean(memoUid),
  });

  const resolved = tc.status === "approved" || tc.status === "rejected" || tc.status === "submitting";
  const [keyword, setKeyword] = useState("");
  const canApprove = !isQueryDBWrite || keyword.trim().toLowerCase() === CONFIRM_KEYWORD;

  return (
    <div className={cn("rounded-lg bg-background/70 p-2", resolved && "opacity-70")}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium">
          <code className="font-mono text-primary">{tc.name}</code>
        </div>
        {tc.status === "approved" && (
          <Badge variant="secondary" shape="pill" className="text-[11px]">
            {tc.confirmKeyword ? `已批准（${tc.confirmKeyword}）` : "已批准"}
          </Badge>
        )}
        {tc.status === "rejected" && (
          <Badge variant="outline" shape="pill" className="text-[11px]">
            已拒绝
          </Badge>
        )}
        {tc.status === "submitting" && (
          <Badge variant="warning" shape="pill" className="text-[11px]">
            正在执行
          </Badge>
        )}
      </div>
      <div className="mt-1 text-sm text-foreground">{summarizeToolCall(tc.name, tc.arguments)}</div>
      {["delete_memo", "get_comments"].includes(tc.name) && memo && (
        <div className="mt-2 rounded-md border border-border/60 bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
          <span className="mb-1 block font-medium text-foreground/70">目标 memo 内容：</span>
          <div className="max-h-32 overflow-auto whitespace-pre-wrap break-words">{memo.content}</div>
        </div>
      )}
      {!resolved && isQueryDBWrite && (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={`输入 ${CONFIRM_KEYWORD} 以确认写操作`}
            disabled={disabled}
            className="h-8 w-40 rounded-md border border-border bg-background px-2 text-xs"
          />
        </div>
      )}
      <div className="mt-2 flex items-center gap-2">
        {!resolved && (
          <>
            <Button size="sm" variant="default" onClick={() => onResolve("approved", keyword)} disabled={disabled || !canApprove}>
              批准
            </Button>
            <Button size="sm" variant="outline" onClick={() => onResolve("rejected")} disabled={disabled}>
              拒绝
            </Button>
          </>
        )}
      </div>
    </div>
  );
};

const ConfirmationCard = ({
  toolCalls,
  onResolve,
  disabled,
}: {
  toolCalls: {
    id: string;
    name: string;
    arguments: string;
    status: "pending" | "approved" | "rejected" | "submitting";
    confirmKeyword?: string;
  }[];
  onResolve: (id: string, status: "approved" | "rejected", confirmKeyword?: string) => void;
  disabled: boolean;
}) => {
  const pendingCount = toolCalls.filter((tc) => tc.status === "pending").length;
  // Default-collapse long approval batches once, but keep the user's explicit
  // expand/collapse choice working afterwards.
  const [collapsed, setCollapsed] = useState(() => toolCalls.length > 3);
  const isCollapsed = collapsed;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/40 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <span>以下操作需要你的确认</span>
          {pendingCount > 0 && (
            <Badge variant="warning" shape="pill" className="text-[11px]">
              {pendingCount} 项待处理
            </Badge>
          )}
        </div>
        {toolCalls.length > 1 && (
          <Button size="sm" variant="ghost" onClick={() => setCollapsed((v) => !v)} disabled={disabled}>
            {isCollapsed ? `展开全部（${toolCalls.length}）` : "收起"}
          </Button>
        )}
      </div>
      {isCollapsed ? (
        <Button size="sm" variant="outline" className="justify-start" onClick={() => setCollapsed(false)}>
          已折叠 {toolCalls.length} 个操作记录，点击展开查看详情
        </Button>
      ) : (
        toolCalls.map((tc) => (
          <ToolCallCard key={tc.id} tc={tc} onResolve={(status, keyword) => onResolve(tc.id, status, keyword)} disabled={disabled} />
        ))
      )}
    </div>
  );
};

const AIChat = () => {
  const t = useTranslate();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const conversationId = searchParams.get("conversation") ?? undefined;
  const memoName = searchParams.get("memo") ?? undefined;

  const { data: conversationData } = useConversation(conversationId);
  const { data: conversations = [] } = useConversations();
  const { data: contextMemo, isLoading: isMemoContextLoading } = useQuery({
    ...memoDetailQueryOptions(memoName ?? ""),
    enabled: Boolean(memoName),
  });
  const createConversation = useCreateConversation();
  const { agentNameById, defaultAgent, defaultLLM, enabledChatAgents, enabledLLMs, llmNameById } = useAIChatAgents();
  const updateConversationAgent = useUpdateConversationAgent(conversationId);
  const updateConversationLLM = useUpdateConversationLLM(conversationId);
  const { requiresConfirmation, toolCalls, send, resolveToolCall, isPending, phase, error } = useSendMessage(conversationId);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [selectedLLMId, setSelectedLLMId] = useState("");
  const [pendingInitialMessage, setPendingInitialMessage] = useState("");

  const history = conversationData?.messages ?? [];
  const conversationAgentId = conversationData?.conversation?.agentId ?? "";
  const conversationLLMId = conversationData?.conversation?.llmId ?? "";
  const selectedAgentValue = selectedAgentId || defaultAgent?.id || "";
  const selectedLLMValue = selectedLLMId || defaultLLM?.id || "";
  const activeAgentId = conversationId ? conversationAgentId || defaultAgent?.id || "" : selectedAgentValue;
  const activeLLMId = conversationId ? conversationLLMId || selectedLLMValue : selectedLLMValue;
  const activeAgentLabel = activeAgentId ? (agentNameById.get(activeAgentId) ?? activeAgentId) : t("aiChat.agent-fallback-label");
  const activeLLMLabel = activeLLMId ? (llmNameById.get(activeLLMId) ?? activeLLMId) : "LLM";
  const timeline = useMemo(() => buildConversationTimeline(history), [history]);
  const runtimeStatusLabel = useMemo(() => getRuntimeStatusLabel(phase, timeline, t), [phase, timeline, t]);
  const timelineWithRuntimeStatus = useMemo(() => insertRuntimeStatus(timeline, runtimeStatusLabel), [runtimeStatusLabel, timeline]);
  const historyRenderKey = useMemo(
    () => history.map((msg) => `${msg.id}:${msg.content?.length ?? 0}:${msg.toolCalls?.length ?? 0}`).join("|"),
    [history],
  );
  const composerDisabled =
    isPending ||
    createConversation.isPending ||
    updateConversationAgent.isPending ||
    updateConversationLLM.isPending ||
    (Boolean(memoName) && isMemoContextLoading);

  useEffect(() => {
    if (enabledChatAgents.length === 0) {
      if (selectedAgentId) {
        setSelectedAgentId("");
      }
      return;
    }
    if (!enabledChatAgents.some((agent) => agent.id === selectedAgentId)) {
      setSelectedAgentId(defaultAgent?.id ?? "");
    }
  }, [defaultAgent?.id, enabledChatAgents, selectedAgentId]);

  useEffect(() => {
    if (enabledLLMs.length === 0) {
      if (selectedLLMId) {
        setSelectedLLMId("");
      }
      return;
    }
    if (!enabledLLMs.some((llm) => llm.id === selectedLLMId)) {
      setSelectedLLMId(defaultLLM?.id ?? "");
    }
  }, [defaultLLM?.id, enabledLLMs, selectedLLMId]);

  useEffect(() => {
    if (!conversationId || !pendingInitialMessage) {
      return;
    }
    send({ content: pendingInitialMessage, llmId: activeLLMId });
    setPendingInitialMessage("");
  }, [activeLLMId, conversationId, pendingInitialMessage, send]);

  // When no conversation is selected (e.g. first open), automatically open the
  // most recent one instead of showing the empty hint. Only when there are no
  // conversations at all do we fall back to the "start a conversation" screen.
  useEffect(() => {
    if (!conversationId && conversations.length > 0) {
      const params = new URLSearchParams({ conversation: conversations[0].id });
      if (memoName) {
        params.set("memo", memoName);
      }
      navigate(`${ROUTES.AI_CHAT}?${params.toString()}`, { replace: true });
    }
  }, [conversationId, conversations, memoName, navigate]);

  // Smoothly scroll to the newest message when content changes.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [historyRenderKey, requiresConfirmation, isPending, phase]);

  // Jump (not smooth) to the bottom when the composer is focused, so the input
  // is never hidden behind the mobile keyboard and the latest message stays in view.
  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
  }, []);

  const handleSelectAgent = useCallback(
    async (agentId: string) => {
      setSelectedAgentId(agentId);
      if (!conversationId || agentId === activeAgentId) {
        return;
      }
      try {
        await updateConversationAgent.mutateAsync(agentId);
      } catch {
        // The mutation exposes the error below the composer.
      }
    },
    [activeAgentId, conversationId, updateConversationAgent],
  );

  const handleSelectLLM = useCallback(
    async (llmId: string) => {
      setSelectedLLMId(llmId);
      if (!conversationId || llmId === activeLLMId) {
        return;
      }
      try {
        await updateConversationLLM.mutateAsync(llmId);
      } catch {
        // The mutation exposes the error below the composer.
      }
    },
    [activeLLMId, conversationId, updateConversationLLM],
  );

  const handleSend = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || composerDisabled) return false;
      const content = contextMemo ? buildMemoContextMessage(contextMemo, trimmed) : trimmed;
      if (!conversationId) {
        const agentId = selectedAgentValue || undefined;
        const llmId = selectedLLMValue || undefined;
        try {
          const res = await createConversation.mutateAsync({ agentId, llmId });
          const params = new URLSearchParams({ conversation: res.id });
          if (memoName) {
            params.set("memo", memoName);
          }
          setPendingInitialMessage(content);
          navigate(`${ROUTES.AI_CHAT}?${params.toString()}`);
          return true;
        } catch {
          return false;
        }
      }
      send({ content, llmId: activeLLMId });
      return true;
    },
    [
      composerDisabled,
      contextMemo,
      conversationId,
      createConversation,
      memoName,
      navigate,
      activeLLMId,
      selectedAgentValue,
      selectedLLMValue,
      send,
    ],
  );

  const submitCurrentText = useCallback(async () => {
    const submitted = await handleSend(textareaRef.current?.value ?? "");
    if (submitted && textareaRef.current) {
      textareaRef.current.value = "";
    }
  }, [handleSend]);

  const handleCloseMemoContext = useCallback(() => {
    setSearchParams(
      (params) => {
        const next = new URLSearchParams(params);
        next.delete("memo");
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  // Decide a single tool call (approve/reject). Decisions accumulate in the
  // hook: nothing is submitted until every pending card in the current round
  // has been decided, then all decisions are sent in one batch. Cards stay
  // visible as a record of what the user decided.
  const handleResolve = useCallback(
    (id: string, status: "approved" | "rejected", confirmKeyword?: string) => {
      if (!conversationId) return;
      resolveToolCall(id, status, confirmKeyword);
    },
    [resolveToolCall, conversationId],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void submitCurrentText();
      }
    },
    [submitCurrentText],
  );

  const composer = (
    <form
      className="border-t border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submitCurrentText();
      }}
    >
      <div className="flex flex-col gap-2 rounded-2xl border border-border bg-background p-2 focus-within:ring-2 focus-within:ring-ring/40">
        <Textarea
          ref={textareaRef}
          rows={1}
          placeholder={t("aiChat.input-placeholder")}
          disabled={composerDisabled}
          onKeyDown={handleKeyDown}
          onFocus={scrollToBottom}
          className="max-h-40 min-h-12 w-full resize-none border-0 bg-transparent px-2 py-1.5 text-sm shadow-none focus-visible:ring-0"
        />
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {enabledChatAgents.length > 0 && (
              <AgentPill
                agentLabel={activeAgentLabel}
                agents={enabledChatAgents}
                disabled={composerDisabled}
                selectedAgentId={activeAgentId}
                onSelect={(agentId) => {
                  void handleSelectAgent(agentId);
                }}
              />
            )}
            {enabledLLMs.length > 0 && (
              <LLMPill
                llmLabel={activeLLMLabel}
                llms={enabledLLMs}
                disabled={composerDisabled}
                selectedLLMId={activeLLMId}
                onSelect={(llmId) => {
                  void handleSelectLLM(llmId);
                }}
              />
            )}
          </div>
          <Button type="submit" size="icon" disabled={composerDisabled} className="shrink-0 rounded-xl">
            <SendIcon className="h-4 w-auto" />
          </Button>
        </div>
      </div>
    </form>
  );

  if (!conversationId) {
    // No conversation selected yet. If there are existing conversations, the
    // effect above will navigate to the first one; while that settles we show
    // nothing. Only when there are truly no conversations do we show the hint.
    if (conversations.length === 0) {
      return (
        <section className="mx-auto flex h-[calc(100dvh-3rem)] w-full max-w-3xl min-h-full flex-col md:h-[100dvh]">
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
            <BotIcon className="h-12 w-auto text-muted-foreground" />
            <h1 className="text-2xl font-semibold">{t("aiChat.title")}</h1>
            <p className="text-sm text-muted-foreground">{t("aiChat.empty-hint")}</p>
          </div>
          {composer}
          {createConversation.error && <div className="px-4 pb-2 text-xs text-destructive">{String(createConversation.error)}</div>}
        </section>
      );
    }
    return null;
  }

  return (
    <section className="mx-auto flex h-[calc(100dvh-3rem)] w-full max-w-3xl flex-col md:h-[100dvh]">
      {memoName && (
        <div className="border-b border-border bg-muted/30 px-4 py-3">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <MessageSquareTextIcon className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-foreground">{t("aiChat.memo-context-label")}</div>
              <div className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
                {isMemoContextLoading
                  ? t("aiChat.memo-context-loading")
                  : contextMemo
                    ? compactText(contextMemo.content, 160) || contextMemo.name
                    : t("aiChat.memo-context-unavailable")}
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-7 shrink-0 rounded-md text-muted-foreground hover:text-foreground"
              onClick={handleCloseMemoContext}
              aria-label={t("aiChat.memo-context-close")}
            >
              <XIcon className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-4 overscroll-contain">
        {history.length === 0 && (
          <div className="flex flex-1 items-center justify-center text-center text-sm text-muted-foreground">{t("aiChat.start-hint")}</div>
        )}
        {timelineWithRuntimeStatus.map((item) =>
          item.kind === "message" ? (
            <MessageBubble key={item.message.id} msg={item.message} />
          ) : item.kind === "toolActivity" ? (
            <ToolActivity key={item.id} calls={item.calls} />
          ) : (
            <RuntimeStatusRow key={item.id} label={item.label} />
          ),
        )}

        {requiresConfirmation && toolCalls.length > 0 && (
          <ConfirmationCard toolCalls={toolCalls} onResolve={handleResolve} disabled={isPending} />
        )}
      </div>

      {/* Composer */}
      {composer}

      {(error || createConversation.error || updateConversationAgent.error || updateConversationLLM.error) && (
        <div className="px-4 pb-2 text-xs text-destructive">
          {String(error || createConversation.error || updateConversationAgent.error || updateConversationLLM.error)}
        </div>
      )}
    </section>
  );
};

export default AIChat;
