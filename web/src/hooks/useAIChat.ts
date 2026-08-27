import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { aiChatServiceClient } from "@/connect";
import { type Conversation, type ConversationMessage } from "@/types/proto/api/v1/ai_chat_service_pb";

export const useConversations = () => {
  return useQuery({
    queryKey: ["ai-chat", "conversations"],
    queryFn: async () => {
      const response = await aiChatServiceClient.listConversations({});
      return response.conversations;
    },
  });
};

export const useCreateConversation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { agentId?: string; title?: string }) => {
      const response = await aiChatServiceClient.createConversation({
        agentId: input.agentId ?? "",
        title: input.title ?? "",
      });
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-chat", "conversations"] });
    },
  });
};

export const useConversation = (id: string | undefined) => {
  return useQuery({
    queryKey: ["ai-chat", "conversation", id],
    enabled: Boolean(id),
    queryFn: async () => {
      if (!id) return undefined;
      const response = await aiChatServiceClient.getConversation({ id });
      return response;
    },
  });
};

export const useDeleteConversation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await aiChatServiceClient.deleteConversation({ id });
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-chat", "conversations"] });
    },
  });
};

export const useUpdateConversationTitle = (conversationId: string | undefined) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (title: string) => {
      if (!conversationId) return undefined;
      return aiChatServiceClient.updateConversation({
        conversation: { id: conversationId, title },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-chat", "conversations"] });
    },
  });
};

interface ResolvedToolCall {
  id: string;
  name: string;
  arguments: string;
  requiresConfirmation: boolean;
  // "pending" 等待用户决定；"approved"/"rejected" 已处理（卡片保留作为记录，不消失）。
  status: "pending" | "approved" | "rejected";
  // 用户在二次确认卡片上输入的确认词（如 query_db 写操作的 "yes"）。
  confirmKeyword?: string;
}

interface SendMessageState {
  requiresConfirmation: boolean;
  // 累积所有轮次的工具调用卡片：待确认 + 已处理都保留在列表里。
  toolCalls: ResolvedToolCall[];
}

const emptyState: SendMessageState = {
  requiresConfirmation: false,
  toolCalls: [],
};

export const useSendMessage = (conversationId: string | undefined) => {
  const queryClient = useQueryClient();
  const [state, setState] = useState<SendMessageState>(emptyState);
  const updateTitle = useUpdateConversationTitle(conversationId);

  const mutation = useMutation({
    mutationFn: async (input: {
      content: string;
      approvedToolCallIds?: string[];
      rejectedToolCallIds?: string[];
      toolApprovals?: { toolCallId: string; confirmKeyword: string }[];
    }) => {
      if (!conversationId) {
        throw new Error("conversation not created yet");
      }
      const response = await aiChatServiceClient.sendMessage({
        conversationId,
        content: input.content,
        approvedToolCallIds: input.approvedToolCallIds ?? [],
        rejectedToolCallIds: input.rejectedToolCallIds ?? [],
        toolApprovals: input.toolApprovals ?? [],
      });
      return response;
    },
    // Optimistically show the user's message the instant it is sent, so the chat
    // renders user bubble → assistant thinking/reply in the correct order instead
    // of waiting for the round-trip. The server response later replaces it with
    // the canonical copy (real id). Approval continuations ("继续") do not insert
    // a new user bubble.
    onMutate: async (input) => {
      const hasDecisions =
        (input.approvedToolCallIds && input.approvedToolCallIds.length > 0) ||
        (input.rejectedToolCallIds && input.rejectedToolCallIds.length > 0) ||
        (input.toolApprovals && input.toolApprovals.length > 0);
      if (hasDecisions) {
        return;
      }
      await queryClient.cancelQueries({ queryKey: ["ai-chat", "conversation", conversationId] });
      const prev = queryClient.getQueryData<{ conversation?: Conversation; messages?: ConversationMessage[] }>([
        "ai-chat",
        "conversation",
        conversationId,
      ]);
      if (prev) {
        queryClient.setQueryData(["ai-chat", "conversation", conversationId], {
          ...prev,
          messages: [
            ...(prev.messages ?? []),
            {
              id: `local-${Date.now()}`,
              role: "user",
              content: input.content,
            } as ConversationMessage,
          ],
        });
      }
      return { prev };
    },
    onError: (_error, _input, ctx) => {
      if (ctx?.prev) {
        queryClient.setQueryData(["ai-chat", "conversation", conversationId], ctx.prev);
      }
      setState(emptyState);
      submittedIdsRef.current = new Set();
    },
    onSuccess: (response, variables) => {
      setState((prev) => ({
        requiresConfirmation: response.requiresConfirmation,
        // Append this turn's pending tool calls; already-resolved (approved/
        // rejected) cards from earlier turns stay in the list as a record.
        toolCalls: [
          ...prev.toolCalls,
          ...(response.toolCalls ?? []).map((tc) => ({
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
            requiresConfirmation: tc.requiresConfirmation,
            status: "pending" as const,
          })),
        ],
      }));

      // The conversation history is the single source of truth for rendered
      // messages, so just refresh it. We no longer accumulate local copies here,
      // which used to duplicate messages once the query cache was invalidated.
      queryClient.invalidateQueries({ queryKey: ["ai-chat", "conversation", conversationId] });

      // Auto-title: derive a short summary from the first user message.
      if (variables.content.trim()) {
        const cached = queryClient.getQueryData<{ conversation?: Conversation }>(["ai-chat", "conversation", conversationId]);
        if (cached?.conversation && cached.conversation.title === "") {
          const title = variables.content.trim().slice(0, 24).replace(/\s+/g, " ");
          updateTitle.mutate(title);
        }
      }
    },
  });

  // Reset transient confirmation state whenever the active conversation changes,
  // so a stale "pending tool" card from another chat never leaks across sessions.
  useEffect(() => {
    setState(emptyState);
    submittedIdsRef.current = new Set();
  }, [conversationId]);

  // Keep a mirror of the latest state so resolveToolCall can decide — outside a
  // state updater — whether every card has been decided and a single batch
  // submission should fire. React's updater runs at render time, not
  // synchronously, so reading state here directly would see stale data.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Ids already batched into a submitted decision, so cards carried over from
  // earlier rounds (kept in the list as a record) are never re-submitted.
  const submittedIdsRef = useRef<Set<string>>(new Set());

  // Mark a single tool call as approved/rejected. Decisions are accumulated: the
  // card updates immediately but is NOT submitted yet. Only when every pending
  // card in the current round has been decided do we submit all decisions at
  // once (approved ids + rejected ids + keywords), so nothing is executed until
  // the user has confirmed/rejected everything. Cards stay visible as a record
  // of what the user decided.
  const resolveToolCall = useCallback(
    (id: string, status: "approved" | "rejected", confirmKeyword?: string) => {
      const toolCalls = stateRef.current.toolCalls.map((tc) => (tc.id === id ? { ...tc, status, confirmKeyword } : tc));
      const pendingCount = toolCalls.filter((tc) => tc.status === "pending").length;
      setState((prev) => ({ ...prev, toolCalls }));

      // Nothing left pending → submit this round's new decisions exactly once.
      const fresh = toolCalls.filter((tc) => tc.status !== "pending" && !submittedIdsRef.current.has(tc.id));
      if (pendingCount === 0 && fresh.length > 0) {
        const approvedIds = fresh.filter((tc) => tc.status === "approved").map((tc) => tc.id);
        const rejectedIds = fresh.filter((tc) => tc.status === "rejected").map((tc) => tc.id);
        const toolApprovals = fresh
          .filter((tc) => tc.status === "approved" && tc.confirmKeyword)
          .map((tc) => ({ toolCallId: tc.id, confirmKeyword: tc.confirmKeyword as string }));
        fresh.forEach((tc) => submittedIdsRef.current.add(tc.id));
        // Send a fixed approval instruction (NOT a free-text user message) so the
        // model treats it as "the pending tools were decided" rather than a new
        // task, keeping behavior consistent across turns.
        mutation.mutate({
          content: "[用户已批准上述待确认工具，请直接执行并继续]",
          approvedToolCallIds: approvedIds,
          rejectedToolCallIds: rejectedIds,
          toolApprovals,
        });
      }
    },
    [mutation],
  );

  return {
    ...state,
    send: mutation.mutate,
    resolveToolCall,
    isPending: mutation.isPending,
    error: mutation.error,
  };
};

export type { Conversation, ConversationMessage };
