import { useQuery } from "@tanstack/react-query";
import { BotIcon, SendIcon, UserIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useConversation, useConversations, useCreateConversation, useSendMessage } from "@/hooks/useAIChat";
import { memoDetailQueryOptions } from "@/hooks/useMemoQueries";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/router/routes";
import { type ConversationMessage } from "@/types/proto/api/v1/ai_chat_service_pb";
import { useTranslate } from "@/utils/i18n";

const AWAITING_PLACEHOLDER = "awaiting user confirmation";

const MessageBubble = ({ msg }: { msg: ConversationMessage }) => {
  if (msg.role === "tool") {
    // Pending placeholders are surfaced via the confirmation card instead.
    if (msg.content === AWAITING_PLACEHOLDER) return null;
    return (
      <div className="flex flex-col gap-1 items-start">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <BotIcon className="w-3 h-auto" />
          <span>{msg.name || "tool"}</span>
        </div>
        <div className="max-w-[80%] rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">{msg.content}</div>
      </div>
    );
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
        {isUser ? <span className="whitespace-pre-wrap break-words">{msg.content}</span> : <ChatMarkdown content={msg.content} />}
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
    case "auto_tag":
      return `自动打标签：${String(args.memoUid ?? "")}`;
    case "agent_reply":
      return `回复用户：${preview(args.content)}`;
    case "get_comments":
      return `查看评论：${String(args.memoUid ?? "")}`;
    case "search_memos":
      return `搜索：${String(args.query ?? "")}`;
    case "query_db":
      return `数据库操作：${String(args.operation ?? "")} ${String(args.table ?? "")}${args.operation === "select" ? `，最多 ${String(args.limit ?? 10)} 行` : ""}`;
    case "get_logs":
      return `读取日志：最近 ${String(args.limit ?? 50)} 行`;
    default:
      return preview(argsJSON);
  }
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
  tc: { id: string; name: string; arguments: string; status: "pending" | "approved" | "rejected"; confirmKeyword?: string };
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

  const resolved = tc.status !== "pending";
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
      </div>
      <div className="mt-1 text-sm text-foreground">{summarizeToolCall(tc.name, tc.arguments)}</div>
      {["delete_memo", "auto_tag", "get_comments"].includes(tc.name) && memo && (
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
  toolCalls: { id: string; name: string; arguments: string; status: "pending" | "approved" | "rejected"; confirmKeyword?: string }[];
  onResolve: (id: string, status: "approved" | "rejected", confirmKeyword?: string) => void;
  disabled: boolean;
}) => {
  const pendingCount = toolCalls.filter((tc) => tc.status === "pending").length;
  const [collapsed, setCollapsed] = useState(false);
  // Collapse automatically once there are several cards so the list stays readable.
  const shouldAutoCollapse = toolCalls.length > 3;
  const isCollapsed = collapsed || shouldAutoCollapse;

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
  const [searchParams] = useSearchParams();
  const conversationId = searchParams.get("conversation") ?? undefined;

  const { data: conversationData } = useConversation(conversationId);
  const { data: conversations = [] } = useConversations();
  const createConversation = useCreateConversation();
  const { requiresConfirmation, toolCalls, send, resolveToolCall, isPending, error } = useSendMessage(conversationId);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const history = conversationData?.messages ?? [];

  // When no conversation is selected (e.g. first open), automatically open the
  // most recent one instead of showing the empty hint. Only when there are no
  // conversations at all do we fall back to the "start a conversation" screen.
  useEffect(() => {
    if (!conversationId && conversations.length > 0) {
      navigate(`${ROUTES.AI_CHAT}?conversation=${conversations[0].id}`, { replace: true });
    }
  }, [conversationId, conversations, navigate]);

  // Smoothly scroll to the newest message when content changes.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [history.length, requiresConfirmation, isPending]);

  // Jump (not smooth) to the bottom when the composer is focused, so the input
  // is never hidden behind the mobile keyboard and the latest message stays in view.
  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
  }, []);

  const handleCreate = useCallback(async () => {
    const res = await createConversation.mutateAsync({});
    navigate(`${ROUTES.AI_CHAT}?conversation=${res.id}`);
  }, [createConversation, navigate]);

  const handleSend = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !conversationId) return;
      send({ content: trimmed });
    },
    [send, conversationId],
  );

  // Approve a single tool call: execute just that one (dangerous writes run
  // one-at-a-time) and mark the card as approved. The card stays visible.
  // confirmKeyword carries the keyword typed on a second-factor confirmation
  // card (e.g. "yes" for query_db writes) and is sent to the backend.
  const handleResolve = useCallback(
    (id: string, status: "approved" | "rejected", confirmKeyword?: string) => {
      if (!conversationId) return;
      resolveToolCall(id, status, confirmKeyword);
      if (status === "approved") {
        // Send a fixed approval instruction (NOT a free-text user message) so the
        // model treats it as "the pending tool was approved" rather than a new
        // task, keeping behavior consistent across turns.
        send({
          content: "[用户已批准上述待确认工具，请直接执行并继续]",
          approvedToolCallIds: [id],
          toolApprovals: confirmKeyword ? [{ toolCallId: id, confirmKeyword }] : [],
        });
      }
      // Reject: just record the decision; the user can send a follow-up message
      // (or the assistant continues) without executing the tool.
    },
    [send, resolveToolCall, conversationId],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend(textareaRef.current?.value ?? "");
        if (textareaRef.current) textareaRef.current.value = "";
      }
    },
    [handleSend],
  );

  if (!conversationId) {
    // No conversation selected yet. If there are existing conversations, the
    // effect above will navigate to the first one; while that settles we show
    // nothing. Only when there are truly no conversations do we show the hint.
    if (conversations.length === 0) {
      return (
        <section className="mx-auto flex h-[calc(100dvh-3rem)] w-full max-w-3xl min-h-full flex-col justify-center items-center gap-4 md:h-[100dvh]">
          <BotIcon className="h-12 w-auto text-muted-foreground" />
          <h1 className="text-2xl font-semibold">{t("aiChat.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("aiChat.empty-hint")}</p>
          <Button onClick={handleCreate} disabled={createConversation.isPending}>
            {t("aiChat.new-conversation")}
          </Button>
        </section>
      );
    }
    return null;
  }

  return (
    <section className="mx-auto flex h-[calc(100dvh-3rem)] w-full max-w-3xl flex-col md:h-[100dvh]">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-4 overscroll-contain">
        {history.length === 0 && (
          <div className="flex flex-1 items-center justify-center text-center text-sm text-muted-foreground">{t("aiChat.start-hint")}</div>
        )}
        {history.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}

        {isPending && history.length > 0 && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <BotIcon className="h-4 w-auto animate-pulse" />
            <span>正在思考…</span>
          </div>
        )}

        {requiresConfirmation && toolCalls.length > 0 && (
          <ConfirmationCard toolCalls={toolCalls} onResolve={handleResolve} disabled={isPending} />
        )}
      </div>

      {/* Composer */}
      <form
        className="border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          handleSend(textareaRef.current?.value ?? "");
          if (textareaRef.current) textareaRef.current.value = "";
        }}
      >
        <div className="flex items-end gap-2 rounded-2xl border border-border bg-background p-2 focus-within:ring-2 focus-within:ring-ring/40">
          <Textarea
            ref={textareaRef}
            rows={1}
            placeholder={t("aiChat.input-placeholder")}
            disabled={isPending}
            onKeyDown={handleKeyDown}
            onFocus={scrollToBottom}
            className="max-h-40 min-h-[2.5rem] flex-1 resize-none border-0 bg-transparent px-2 py-1.5 text-sm shadow-none focus-visible:ring-0"
          />
          <Button type="submit" size="icon" disabled={isPending} className="shrink-0 rounded-xl">
            <SendIcon className="h-4 w-auto" />
          </Button>
        </div>
      </form>

      {error && <div className="px-4 pb-2 text-xs text-destructive">{String(error)}</div>}
    </section>
  );
};

export default AIChat;
