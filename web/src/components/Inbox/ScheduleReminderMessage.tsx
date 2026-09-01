import { create } from "@bufbuild/protobuf";
import { FieldMaskSchema, timestampDate } from "@bufbuild/protobuf/wkt";
import { CalendarClockIcon, CheckIcon, TrashIcon, XIcon } from "lucide-react";
import toast from "react-hot-toast";
import { userServiceClient } from "@/connect";
import useNavigateTo from "@/hooks/useNavigateTo";
import { cn } from "@/lib/utils";
import { UserNotification, UserNotification_Status } from "@/types/proto/api/v1/user_service_pb";
import { useTranslate } from "@/utils/i18n";

interface Props {
  notification: UserNotification;
}

function ScheduleReminderMessage({ notification }: Props) {
  const t = useTranslate();
  const navigateTo = useNavigateTo();
  const reminderPayload = notification.payload?.case === "scheduleReminder" ? notification.payload.value : undefined;

  const handleArchiveMessage = async (silence = false) => {
    await userServiceClient.updateUserNotification({
      notification: {
        name: notification.name,
        status: UserNotification_Status.ARCHIVED,
      },
      updateMask: create(FieldMaskSchema, { paths: ["status"] }),
    });
    if (!silence) {
      toast.success(t("message.archived-successfully"));
    }
  };

  const handleDeleteMessage = async () => {
    await userServiceClient.deleteUserNotification({
      name: notification.name,
    });
    toast.success(t("message.deleted-successfully"));
  };

  if (!reminderPayload) {
    return (
      <div className="w-full px-5 py-4 border-b border-border/60 last:border-b-0 bg-destructive/[0.04] group">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-destructive/15 flex items-center justify-center shrink-0 ring-1 ring-destructive/20">
              <XIcon className="w-5 h-5 text-destructive" strokeWidth={2} />
            </div>
            <span className="text-sm text-destructive/80 font-medium">{t("inbox.failed-to-load")}</span>
          </div>
          <button
            onClick={handleDeleteMessage}
            className="p-1.5 hover:bg-destructive/15 rounded-lg transition-all duration-150 opacity-0 group-hover:opacity-100"
            title={t("common.delete")}
          >
            <TrashIcon className="w-4 h-4 text-destructive/70 hover:text-destructive transition-colors" strokeWidth={2} />
          </button>
        </div>
      </div>
    );
  }

  const isUnread = notification.status === UserNotification_Status.UNREAD;
  const occurrenceTime = reminderPayload.occurrenceTime ? timestampDate(reminderPayload.occurrenceTime) : undefined;
  const reminderDateLabel = occurrenceTime?.toLocaleDateString([], { month: "short", day: "numeric" });
  const reminderTimeLabel = occurrenceTime?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const handleNavigateToMemo = async () => {
    navigateTo(`/${reminderPayload.memo}`);
    if (isUnread) {
      await handleArchiveMessage(true);
    }
  };

  return (
    <div
      className={cn(
        "w-full px-5 py-4 border-b border-border/60 last:border-b-0 transition-all duration-200 group relative",
        isUnread ? "bg-primary/[0.03] hover:bg-primary/[0.05]" : "hover:bg-muted/30",
      )}
    >
      {isUnread && <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-gradient-to-b from-primary to-primary/60" />}

      <div className="flex items-start gap-3">
        <div
          className={cn(
            "w-10 h-10 rounded-full flex items-center justify-center shrink-0 ring-1 transition-all",
            isUnread ? "bg-primary/10 text-primary ring-primary/20" : "bg-muted/80 text-muted-foreground ring-border/40",
          )}
        >
          <CalendarClockIcon className="w-5 h-5" strokeWidth={2} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
              <span className="font-semibold text-sm text-foreground/95">Schedule reminder</span>
              {occurrenceTime && (
                <span className="text-xs text-muted-foreground/60">
                  {reminderDateLabel} at {reminderTimeLabel}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {isUnread ? (
                <button
                  onClick={() => handleArchiveMessage()}
                  className="p-1.5 hover:bg-primary/10 rounded-lg transition-all duration-150 opacity-0 group-hover:opacity-100"
                  title={t("common.archive")}
                >
                  <CheckIcon className="w-4 h-4 text-muted-foreground hover:text-primary transition-colors" strokeWidth={2} />
                </button>
              ) : (
                <button
                  onClick={handleDeleteMessage}
                  className="p-1.5 hover:bg-destructive/10 rounded-lg transition-all duration-150 opacity-0 group-hover:opacity-100"
                  title={t("common.delete")}
                >
                  <TrashIcon className="w-4 h-4 text-muted-foreground hover:text-destructive transition-colors" strokeWidth={2} />
                </button>
              )}
            </div>
          </div>

          <div
            onClick={handleNavigateToMemo}
            className="p-2 sm:p-3 rounded-lg bg-gradient-to-br from-primary/[0.06] to-primary/[0.03] hover:from-primary/[0.1] hover:to-primary/[0.06] cursor-pointer border border-primary/30 hover:border-primary/50 transition-all duration-200 shadow-sm hover:shadow"
          >
            <div className="flex items-start gap-2">
              <div className="w-5 h-5 flex items-center justify-center shrink-0">
                <CalendarClockIcon className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-primary/60 font-semibold mb-1 uppercase tracking-wider">Due now</p>
                <p className="text-sm text-foreground/90 line-clamp-2">
                  {reminderPayload.memoSnippet || <span className="italic text-muted-foreground/50">Empty memo</span>}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ScheduleReminderMessage;
