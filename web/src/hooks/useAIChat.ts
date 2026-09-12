import { create } from "@bufbuild/protobuf";
import { FieldMaskSchema } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { aiChatServiceClient, isAuthFailureError, refreshAccessToken } from "@/connect";
import { AIChatStreamEventType, type Conversation, type ConversationMessage, type ToolCall } from "@/types/proto/api/v1/ai_chat_service_pb";
import { redirectOnAuthFailure } from "@/utils/auth-redirect";

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
    mutationFn: async (input: { agentId?: string; llmId?: string; title?: string }) => {
      const response = await aiChatServiceClient.createConversation({
        agentId: input.agentId ?? "",
        llmId: input.llmId ?? "",
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
        updateMask: create(FieldMaskSchema, { paths: ["title"] }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-chat", "conversations"] });
    },
  });
};

export const useUpdateConversationLLM = (conversationId: string | undefined) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (llmId: string) => {
      if (!conversationId) return undefined;
      return aiChatServiceClient.updateConversation({
        conversation: { id: conversationId, llmId },
        updateMask: create(FieldMaskSchema, { paths: ["llm_id"] }),
      });
    },
    onSuccess: (conversation) => {
      queryClient.invalidateQueries({ queryKey: ["ai-chat", "conversations"] });
      if (conversation && conversationId) {
        queryClient.setQueryData(
          ["ai-chat", "conversation", conversationId],
          (prev?: { conversation?: Conversation; messages?: ConversationMessage[] }) => ({
            ...prev,
            conversation,
            messages: prev?.messages ?? [],
          }),
        );
      }
    },
  });
};

export const useUpdateConversationAgent = (conversationId: string | undefined) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (agentId: string) => {
      if (!conversationId) return undefined;
      return aiChatServiceClient.updateConversation({
        conversation: { id: conversationId, agentId },
        updateMask: create(FieldMaskSchema, { paths: ["agent_id"] }),
      });
    },
    onSuccess: (conversation) => {
      queryClient.invalidateQueries({ queryKey: ["ai-chat", "conversations"] });
      if (conversation && conversationId) {
        queryClient.setQueryData(
          ["ai-chat", "conversation", conversationId],
          (prev?: { conversation?: Conversation; messages?: ConversationMessage[] }) => ({
            ...prev,
            conversation,
            messages: prev?.messages ?? [],
          }),
        );
      }
    },
  });
};

interface ResolvedToolCall {
  id: string;
  name: string;
  arguments: string;
  requiresConfirmation: boolean;
  // "pending" 等待用户决定；"approved"/"rejected" 已处理（卡片保留作为记录，不消失）。
  status: "pending" | "approved" | "rejected" | "submitting";
  // 用户在二次确认卡片上输入的确认词（如 query_db 写操作的 "yes"）。
  confirmKeyword?: string;
  submittedDecision?: "approved" | "rejected";
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

type ConversationCache = { conversation?: Conversation; messages?: ConversationMessage[] };

interface SendMessageInput {
  content: string;
  approvedToolCallIds?: string[];
  rejectedToolCallIds?: string[];
  toolApprovals?: { toolCallId: string; confirmKeyword: string }[];
  llmId?: string;
}

const hasToolDecisions = (input: SendMessageInput) =>
  (input.approvedToolCallIds?.length ?? 0) > 0 || (input.rejectedToolCallIds?.length ?? 0) > 0 || (input.toolApprovals?.length ?? 0) > 0;

const LEGACY_TOOL_APPROVAL_USER_MESSAGE = "[用户已批准上述待确认工具，请直接执行并继续]";
const MEMO_CONTEXT_QUESTION_MARKER = "[/Selected memo context]\n\nUser question:\n";

const createConversationTitle = (content: string): string => {
  const markerIndex = content.indexOf(MEMO_CONTEXT_QUESTION_MARKER);
  const visibleContent = markerIndex >= 0 ? content.slice(markerIndex + MEMO_CONTEXT_QUESTION_MARKER.length) : content;
  const compacted = visibleContent.trim().replace(/\s+/g, " ");
  if (!compacted || compacted === LEGACY_TOOL_APPROVAL_USER_MESSAGE) {
    return "";
  }
  return compacted.slice(0, 32);
};

const appendOrReplaceMessage = (messages: ConversationMessage[], next: ConversationMessage) => {
  if (next.id) {
    const idx = messages.findIndex((message) => message.id === next.id);
    if (idx >= 0) {
      return [...messages.slice(0, idx), next, ...messages.slice(idx + 1)];
    }
  }
  return [...messages, next];
};

const removeLocalTurnMessages = (messages: ConversationMessage[], localIds: Set<string>) =>
  messages.filter((message) => !localIds.has(message.id));

const toResolvedToolCall = (toolCall: ToolCall): ResolvedToolCall => ({
  id: toolCall.id,
  name: toolCall.name,
  arguments: toolCall.arguments,
  requiresConfirmation: toolCall.requiresConfirmation,
  status: "pending",
});

const shouldUseUnaryFallback = (error: unknown) => error instanceof ConnectError && error.code === Code.Unimplemented;

export const useSendMessage = (conversationId: string | undefined) => {
  const queryClient = useQueryClient();
  const [state, setState] = useState<SendMessageState>(emptyState);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const updateTitle = useUpdateConversationTitle(conversationId);
  const abortRef = useRef<AbortController | null>(null);
  const localTurnIdsRef = useRef<Set<string>>(new Set());
  const localAssistantIdRef = useRef("");
  const localToolAssistantIdRef = useRef("");
  const localUserIdRef = useRef("");

  const patchConversation = useCallback(
    (updater: (prev: ConversationCache) => ConversationCache) => {
      queryClient.setQueryData(["ai-chat", "conversation", conversationId], (prev?: ConversationCache) => updater(prev ?? {}));
    },
    [conversationId, queryClient],
  );

  const appendMessage = useCallback(
    (message: ConversationMessage) => {
      patchConversation((prev) => ({
        ...prev,
        messages: appendOrReplaceMessage(prev.messages ?? [], message),
      }));
    },
    [patchConversation],
  );

  const replaceLocalTurnWithFinalMessages = useCallback(
    (finalMessages: ConversationMessage[]) => {
      if (finalMessages.length === 0) {
        return;
      }
      patchConversation((prev) => {
        const withoutLocal = removeLocalTurnMessages(prev.messages ?? [], localTurnIdsRef.current);
        return {
          ...prev,
          messages: finalMessages.reduce(appendOrReplaceMessage, withoutLocal),
        };
      });
      localTurnIdsRef.current = new Set();
      localAssistantIdRef.current = "";
      localToolAssistantIdRef.current = "";
    },
    [patchConversation],
  );

  const runUnaryFallback = useCallback(
    async (input: SendMessageInput) => {
      if (!conversationId) {
        throw new Error("conversation not created yet");
      }
      const response = await aiChatServiceClient.sendMessage({
        conversationId,
        content: input.content,
        approvedToolCallIds: input.approvedToolCallIds ?? [],
        rejectedToolCallIds: input.rejectedToolCallIds ?? [],
        toolApprovals: input.toolApprovals ?? [],
        llmId: input.llmId ?? "",
      });
      setState((prevState) => ({
        requiresConfirmation: response.requiresConfirmation,
        toolCalls: [...prevState.toolCalls, ...(response.toolCalls ?? []).map(toResolvedToolCall)],
      }));
      queryClient.invalidateQueries({ queryKey: ["ai-chat", "conversation", conversationId] });
      return response;
    },
    [conversationId, queryClient],
  );

  const sendAsync = useCallback(
    async (input: SendMessageInput) => {
      if (!conversationId) {
        setError(new Error("conversation not created yet"));
        return;
      }
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      localTurnIdsRef.current = new Set();
      localAssistantIdRef.current = "";
      localToolAssistantIdRef.current = "";
      localUserIdRef.current = "";
      setIsPending(true);
      setError(null);

      const hasDecisions = hasToolDecisions(input);
      await queryClient.cancelQueries({ queryKey: ["ai-chat", "conversation", conversationId] });
      const prev = queryClient.getQueryData<ConversationCache>(["ai-chat", "conversation", conversationId]);
      if (hasDecisions) {
        setState((prevState) => ({
          ...prevState,
          requiresConfirmation: false,
          toolCalls: prevState.toolCalls.map((tc) =>
            tc.status === "approved" || tc.status === "rejected" ? { ...tc, status: "submitting", submittedDecision: tc.status } : tc,
          ),
        }));
      } else {
        const localUserId = `local-user-${Date.now()}`;
        localUserIdRef.current = localUserId;
        localTurnIdsRef.current.add(localUserId);
        appendMessage({
          id: localUserId,
          role: "user",
          content: input.content,
        } as ConversationMessage);
      }

      const streamRequest = {
        conversationId,
        content: input.content,
        approvedToolCallIds: input.approvedToolCallIds ?? [],
        rejectedToolCallIds: input.rejectedToolCallIds ?? [],
        toolApprovals: input.toolApprovals ?? [],
        llmId: input.llmId ?? "",
      };
      const settleSubmittingToolCalls = () => {
        setState((prevState) => ({
          ...prevState,
          toolCalls: prevState.toolCalls.map((tc) =>
            tc.status === "submitting" ? { ...tc, status: tc.submittedDecision ?? "approved", submittedDecision: undefined } : tc,
          ),
        }));
      };
      let accepted = false;
      const consumeStream = async () => {
        const stream = aiChatServiceClient.streamMessage(streamRequest, { signal: controller.signal });
        for await (const event of stream) {
          if (
            event.type === AIChatStreamEventType.AI_CHAT_STREAM_EVENT_TYPE_STARTED ||
            event.type === AIChatStreamEventType.AI_CHAT_STREAM_EVENT_TYPE_MESSAGE_CREATED
          ) {
            accepted = true;
          }
          switch (event.type) {
            case AIChatStreamEventType.AI_CHAT_STREAM_EVENT_TYPE_MESSAGE_CREATED:
              if (event.message) {
                if (localUserIdRef.current && event.message.role === "user") {
                  const localUserId = localUserIdRef.current;
                  patchConversation((cache) => ({
                    ...cache,
                    messages: (cache.messages ?? []).map((message) =>
                      message.id === localUserId ? (event.message as ConversationMessage) : message,
                    ),
                  }));
                  localTurnIdsRef.current.delete(localUserId);
                  localUserIdRef.current = "";
                } else {
                  appendMessage(event.message);
                }
              }
              break;
            case AIChatStreamEventType.AI_CHAT_STREAM_EVENT_TYPE_ASSISTANT_DELTA: {
              if (!event.delta) {
                break;
              }
              localToolAssistantIdRef.current = "";
              if (!localAssistantIdRef.current) {
                const id = `local-assistant-${Date.now()}`;
                localAssistantIdRef.current = id;
                localTurnIdsRef.current.add(id);
                appendMessage({ id, role: "assistant", content: event.delta, toolCalls: [] } as unknown as ConversationMessage);
                break;
              }
              const id = localAssistantIdRef.current;
              patchConversation((cache) => ({
                ...cache,
                messages: (cache.messages ?? []).map((message) =>
                  message.id === id ? ({ ...message, content: `${message.content}${event.delta}` } as ConversationMessage) : message,
                ),
              }));
              break;
            }
            case AIChatStreamEventType.AI_CHAT_STREAM_EVENT_TYPE_TOOL_CALL:
              if (event.toolCall) {
                localAssistantIdRef.current = "";
                if (!localToolAssistantIdRef.current) {
                  const id = `local-tools-${Date.now()}`;
                  localToolAssistantIdRef.current = id;
                  localTurnIdsRef.current.add(id);
                  appendMessage({ id, role: "assistant", content: "", toolCalls: [event.toolCall] } as ConversationMessage);
                  break;
                }
                const id = localToolAssistantIdRef.current;
                patchConversation((cache) => ({
                  ...cache,
                  messages: (cache.messages ?? []).map((message) =>
                    message.id === id
                      ? ({ ...message, toolCalls: [...(message.toolCalls ?? []), event.toolCall as ToolCall] } as ConversationMessage)
                      : message,
                  ),
                }));
              }
              break;
            case AIChatStreamEventType.AI_CHAT_STREAM_EVENT_TYPE_TOOL_RESULT:
              if (event.message?.toolCallId) {
                const id = `local-tool-${event.message.toolCallId}`;
                localTurnIdsRef.current.add(id);
                appendMessage({ ...event.message, id } as ConversationMessage);
              }
              break;
            case AIChatStreamEventType.AI_CHAT_STREAM_EVENT_TYPE_CONFIRMATION_REQUIRED:
              replaceLocalTurnWithFinalMessages(event.finalMessages ?? []);
              setState((prevState) => ({
                requiresConfirmation: event.requiresConfirmation,
                toolCalls: [...prevState.toolCalls, ...(event.toolCalls ?? []).map(toResolvedToolCall)],
              }));
              break;
            case AIChatStreamEventType.AI_CHAT_STREAM_EVENT_TYPE_DONE:
              replaceLocalTurnWithFinalMessages(event.finalMessages ?? []);
              setState((prevState) => ({
                ...prevState,
                requiresConfirmation: false,
                toolCalls: prevState.toolCalls.map((tc) =>
                  tc.status === "submitting" ? { ...tc, status: tc.submittedDecision ?? "approved", submittedDecision: undefined } : tc,
                ),
              }));
              break;
            case AIChatStreamEventType.AI_CHAT_STREAM_EVENT_TYPE_ERROR:
              throw new Error(event.error || "AI chat stream failed");
          }
        }
      };
      const invalidateChatQueries = () => {
        queryClient.invalidateQueries({ queryKey: ["ai-chat", "conversation", conversationId] });
        queryClient.invalidateQueries({ queryKey: ["ai-chat", "conversations"] });
      };
      try {
        await consumeStream();
        invalidateChatQueries();
      } catch (streamError) {
        if (!accepted && !controller.signal.aborted && isAuthFailureError(streamError)) {
          try {
            await refreshAccessToken();
            await consumeStream();
            invalidateChatQueries();
            return;
          } catch (retryError) {
            if (isAuthFailureError(retryError)) {
              redirectOnAuthFailure();
            }
            if (!accepted && prev) {
              queryClient.setQueryData(["ai-chat", "conversation", conversationId], prev);
            }
            settleSubmittingToolCalls();
            setError(retryError);
            return;
          }
        }
        if (!accepted && !controller.signal.aborted && shouldUseUnaryFallback(streamError)) {
          try {
            await runUnaryFallback(input);
          } catch (fallbackError) {
            if (prev) {
              queryClient.setQueryData(["ai-chat", "conversation", conversationId], prev);
            }
            setState(emptyState);
            submittedIdsRef.current = new Set();
            setError(fallbackError);
          }
        } else if (!controller.signal.aborted) {
          settleSubmittingToolCalls();
          setError(streamError);
        }
      } finally {
        setIsPending(false);
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    },
    [appendMessage, conversationId, patchConversation, queryClient, replaceLocalTurnWithFinalMessages, runUnaryFallback, updateTitle],
  );

  const send = useCallback(
    (input: SendMessageInput) => {
      void sendAsync(input);
      if (input.content.trim()) {
        const cached = queryClient.getQueryData<ConversationCache>(["ai-chat", "conversation", conversationId]);
        if (cached?.conversation && cached.conversation.title === "") {
          const title = createConversationTitle(input.content);
          if (title) {
            updateTitle.mutate(title);
          }
        }
      }
    },
    [conversationId, queryClient, sendAsync, updateTitle],
  );

  // Reset transient confirmation state whenever the active conversation changes,
  // so a stale "pending tool" card from another chat never leaks across sessions.
  useEffect(() => {
    setState(emptyState);
    submittedIdsRef.current = new Set();
    abortRef.current?.abort();
    abortRef.current = null;
    localTurnIdsRef.current = new Set();
    localAssistantIdRef.current = "";
    localToolAssistantIdRef.current = "";
    localUserIdRef.current = "";
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
        send({
          content: "",
          approvedToolCallIds: approvedIds,
          rejectedToolCallIds: rejectedIds,
          toolApprovals,
        });
      }
    },
    [send],
  );

  return {
    ...state,
    send,
    resolveToolCall,
    isPending,
    error,
  };
};

export type { Conversation, ConversationMessage };
