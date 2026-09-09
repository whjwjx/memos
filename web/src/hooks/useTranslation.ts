import { create } from "@bufbuild/protobuf";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aiServiceClient } from "@/connect";
import {
  DeleteTranslationHistoryRequestSchema,
  GenerateTranslationPracticeLessonRequestSchema,
  ListTranslationHistoriesRequestSchema,
  ReviewTranslationPracticeDraftRequestSchema,
  TranslateRequestSchema,
  type TranslationDirection,
  type TranslationPracticeFeedback,
  type TranslationPracticeLesson,
} from "@/types/proto/api/v1/ai_service_pb";

export const translationKeys = {
  histories: ["translation", "histories"] as const,
};

export const useTranslationHistories = (enabled = true) => {
  return useQuery({
    queryKey: translationKeys.histories,
    enabled,
    queryFn: async () => {
      const response = await aiServiceClient.listTranslationHistories(
        create(ListTranslationHistoriesRequestSchema, {
          pageSize: 50,
        }),
      );
      return response.histories;
    },
  });
};

export const useTranslateText = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { text: string; direction: TranslationDirection }) => {
      return aiServiceClient.translate(
        create(TranslateRequestSchema, {
          text: input.text,
          direction: input.direction,
        }),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: translationKeys.histories });
    },
  });
};

export const useGenerateTranslationPracticeLesson = () => {
  return useMutation({
    mutationFn: async (input: { memoContent: string; locale: string }): Promise<TranslationPracticeLesson> => {
      const response = await aiServiceClient.generateTranslationPracticeLesson(
        create(GenerateTranslationPracticeLessonRequestSchema, {
          memoContent: input.memoContent,
          locale: input.locale,
        }),
      );
      if (!response.lesson) {
        throw new Error("translation practice lesson response missing lesson");
      }
      return response.lesson;
    },
  });
};

export const useReviewTranslationPracticeDraft = () => {
  return useMutation({
    mutationFn: async (input: {
      memoContent: string;
      draft: string;
      attempt: number;
      locale: string;
    }): Promise<TranslationPracticeFeedback> => {
      const response = await aiServiceClient.reviewTranslationPracticeDraft(
        create(ReviewTranslationPracticeDraftRequestSchema, {
          memoContent: input.memoContent,
          draft: input.draft,
          attempt: input.attempt,
          locale: input.locale,
        }),
      );
      if (!response.feedback) {
        throw new Error("translation practice review response missing feedback");
      }
      return response.feedback;
    },
  });
};

export const useDeleteTranslationHistory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await aiServiceClient.deleteTranslationHistory(create(DeleteTranslationHistoryRequestSchema, { id }));
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: translationKeys.histories });
    },
  });
};

export const useClearTranslationHistories = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await aiServiceClient.clearTranslationHistories({});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: translationKeys.histories });
    },
  });
};
