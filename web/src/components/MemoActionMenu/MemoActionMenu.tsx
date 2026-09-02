import { create } from "@bufbuild/protobuf";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  BookmarkMinusIcon,
  BookmarkPlusIcon,
  BotMessageSquareIcon,
  CheckCheckIcon,
  CopyIcon,
  Edit3Icon,
  FileTextIcon,
  LinkIcon,
  ListChecksIcon,
  ListRestartIcon,
  MoreVerticalIcon,
  SparklesIcon,
  TrashIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { memoServiceClient } from "@/connect";
import { useInstance } from "@/contexts/InstanceContext";
import { useCreateConversation } from "@/hooks/useAIChat";
import useCurrentUser from "@/hooks/useCurrentUser";
import { ROUTES } from "@/router/routes";
import { State } from "@/types/proto/api/v1/common_pb";
import { AutoTagMemoRequestSchema } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import { useMemoActionHandlers } from "./hooks";
import type { MemoActionMenuProps } from "./types";

const MemoActionMenu = (props: MemoActionMenuProps) => {
  const { memo, readonly } = props;
  const t = useTranslate();
  const { aiSetting } = useInstance();
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const createConversation = useCreateConversation();

  // Dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Derived state
  const isComment = Boolean(memo.parent);
  const isArchived = memo.state === State.ARCHIVED;
  const canMutateTasks = !readonly && !isArchived && Boolean(memo.property?.hasTaskList);
  const hasOpenTasks = Boolean(memo.property?.hasIncompleteTasks);
  // The AI auto-tagging action is shown only when at least one tagger is enabled.
  const hasEnabledTagger = aiSetting.taggers.some((tagger) => tagger.enabled && tagger.providerId);
  const canAskAI = Boolean(currentUser);

  const handleAutoTag = async () => {
    try {
      await memoServiceClient.autoTagMemo(create(AutoTagMemoRequestSchema, { name: memo.name }));
      toast.success(t("memo.ai-tag-queued"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const handleAskAI = async () => {
    try {
      const title = memo.content.trim().replace(/\s+/g, " ").slice(0, 24) || t("common.memo");
      const conversation = await createConversation.mutateAsync({
        title: t("aiChat.memo-context-conversation-title", { title }),
      });
      const params = new URLSearchParams({
        conversation: conversation.id,
        memo: memo.name,
      });
      navigate(`${ROUTES.AI_CHAT}?${params.toString()}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  // Action handlers
  const {
    handleTogglePinMemoBtnClick,
    handleEditMemoClick,
    handleToggleMemoStatusClick,
    handleCopyLink,
    handleCopyContent,
    handleCheckAllTaskListItemsClick,
    handleUncheckAllTaskListItemsClick,
    handleDeleteMemoClick,
    confirmDeleteMemo,
  } = useMemoActionHandlers({
    memo,
    onEdit: props.onEdit,
    setDeleteDialogOpen,
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="size-4" />}>
        <MoreVerticalIcon className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={2}>
        {/* Edit actions (non-readonly, non-archived) */}
        {!readonly && !isArchived && (
          <>
            {!isComment && (
              <DropdownMenuItem onClick={handleTogglePinMemoBtnClick}>
                {memo.pinned ? <BookmarkMinusIcon className="w-4 h-auto" /> : <BookmarkPlusIcon className="w-4 h-auto" />}
                {memo.pinned ? t("common.unpin") : t("common.pin")}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={handleEditMemoClick}>
              <Edit3Icon className="w-4 h-auto" />
              {t("common.edit")}
            </DropdownMenuItem>
            {hasEnabledTagger && (
              <DropdownMenuItem onClick={handleAutoTag}>
                <SparklesIcon className="w-4 h-auto" />
                {t("memo.ai-tag")}
              </DropdownMenuItem>
            )}
          </>
        )}
        {canAskAI && (
          <DropdownMenuItem onClick={handleAskAI} disabled={createConversation.isPending}>
            <BotMessageSquareIcon className="w-4 h-auto" />
            {t("memo.ask-ai")}
          </DropdownMenuItem>
        )}

        {/* Copy submenu (non-archived) */}
        {!isArchived && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <CopyIcon className="w-4 h-auto" />
              {t("common.copy")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onClick={handleCopyLink}>
                <LinkIcon className="w-4 h-auto" />
                {t("memo.copy-link")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleCopyContent}>
                <FileTextIcon className="w-4 h-auto" />
                {t("memo.copy-content")}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        {/* Task submenu (writable task memos) */}
        {canMutateTasks && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <ListChecksIcon className="w-4 h-auto" />
              {t("memo.task-actions.title")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem disabled={!hasOpenTasks} onClick={handleCheckAllTaskListItemsClick}>
                <CheckCheckIcon className="w-4 h-auto" />
                {t("memo.task-actions.check-all")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleUncheckAllTaskListItemsClick}>
                <ListRestartIcon className="w-4 h-auto" />
                {t("memo.task-actions.uncheck-all")}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        {/* Write actions (non-readonly) */}
        {!readonly && (
          <>
            {/* Archive/Restore (non-comment) */}
            {!isComment && (
              <DropdownMenuItem onClick={handleToggleMemoStatusClick}>
                {isArchived ? <ArchiveRestoreIcon className="w-4 h-auto" /> : <ArchiveIcon className="w-4 h-auto" />}
                {isArchived ? t("common.restore") : t("common.archive")}
              </DropdownMenuItem>
            )}

            {/* Delete */}
            <DropdownMenuItem onClick={handleDeleteMemoClick}>
              <TrashIcon className="w-4 h-auto" />
              {t("common.delete")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={t("memo.delete-confirm")}
        confirmLabel={t("common.delete")}
        description={t("memo.delete-confirm-description")}
        cancelLabel={t("common.cancel")}
        onConfirm={confirmDeleteMemo}
        confirmVariant="destructive"
      />
    </DropdownMenu>
  );
};

export default MemoActionMenu;
