import { timestampDate } from "@bufbuild/protobuf/wkt";
import { sortBy } from "lodash-es";
import { ArchiveIcon, BellIcon, LoaderIcon } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";
import MemoCommentMessage from "@/components/Inbox/MemoCommentMessage";
import MemoMentionMessage from "@/components/Inbox/MemoMentionMessage";
import ScheduleReminderMessage from "@/components/Inbox/ScheduleReminderMessage";
import Placeholder from "@/components/Placeholder";
import { Button } from "@/components/ui/button";
import { useAppSidebar } from "@/contexts/AppSidebarContext";
import { useNotifications, useUpdateUserNotification } from "@/hooks/useUserQueries";
import { handleError } from "@/lib/error";
import { UserNotification, UserNotification_Status, UserNotification_Type } from "@/types/proto/api/v1/user_service_pb";
import { useTranslate } from "@/utils/i18n";

const Inboxes = () => {
  const t = useTranslate();
  const { inboxFilter: filter } = useAppSidebar();
  const [archivingAll, setArchivingAll] = useState(false);
  const updateNotification = useUpdateUserNotification();

  // Fetch notifications with React Query
  const { data: fetchedNotifications = [] } = useNotifications();

  const allNotifications = sortBy(fetchedNotifications, (notification: UserNotification) => {
    return -((notification.createTime ? timestampDate(notification.createTime) : undefined)?.getTime() || 0);
  });

  const notifications = allNotifications.filter((notification) => {
    if (filter === "unread") return notification.status === UserNotification_Status.UNREAD;
    if (filter === "archived") return notification.status === UserNotification_Status.ARCHIVED;
    return true;
  });

  const unreadCount = allNotifications.filter((n) => n.status === UserNotification_Status.UNREAD).length;
  const unreadNotifications = allNotifications.filter((notification) => notification.status === UserNotification_Status.UNREAD);
  const showArchiveAll = filter !== "archived" && unreadNotifications.length > 0;

  const handleArchiveAll = async () => {
    if (unreadNotifications.length === 0) {
      return;
    }

    try {
      setArchivingAll(true);
      await Promise.all(
        unreadNotifications.map((notification) =>
          updateNotification.mutateAsync({
            notification: {
              name: notification.name,
              status: UserNotification_Status.ARCHIVED,
            },
            updateMask: ["status"],
          }),
        ),
      );
      toast.success(t("inbox.archive-all-success", { count: unreadNotifications.length }));
    } catch (error: unknown) {
      await handleError(error, toast.error, { context: "Archive all notifications" });
    } finally {
      setArchivingAll(false);
    }
  };

  return (
    <section className="@container w-full max-w-5xl min-h-full flex flex-col justify-start items-center sm:pt-3 md:pt-6 pb-8">
      <div className="w-full px-4 sm:px-6">
        <div className="w-full border border-border flex flex-col justify-start items-start rounded-xl bg-background text-foreground overflow-hidden">
          {/* Header */}
          <div className="w-full px-4 py-4 border-b border-border">
            <div className="flex flex-row justify-between items-center">
              <div className="flex flex-row items-center gap-2">
                <BellIcon className="w-5 h-auto text-muted-foreground" />
                <h1 className="text-xl font-semibold">{t("common.inbox")}</h1>
                {unreadCount > 0 && (
                  <span className="ml-1 px-2 py-0.5 text-xs font-medium rounded-full bg-primary text-primary-foreground">
                    {unreadCount}
                  </span>
                )}
              </div>
              {showArchiveAll && (
                <Button variant="ghost" size="sm" disabled={archivingAll} onClick={handleArchiveAll}>
                  {archivingAll ? <LoaderIcon className="size-4 animate-spin" /> : <ArchiveIcon className="size-4" />}
                  {t("inbox.archive-all")}
                </Button>
              )}
            </div>
          </div>

          {/* Notifications List */}
          <div className="w-full">
            {notifications.length === 0 ? (
              <Placeholder
                variant="empty"
                message={filter === "unread" ? t("inbox.no-unread") : filter === "archived" ? t("inbox.no-archived") : t("message.no-data")}
              />
            ) : (
              <div className="flex flex-col">
                {notifications.map((notification: UserNotification) => {
                  if (notification.type === UserNotification_Type.MEMO_COMMENT) {
                    return <MemoCommentMessage key={notification.name} notification={notification} />;
                  }
                  if (notification.type === UserNotification_Type.MEMO_MENTION) {
                    return <MemoMentionMessage key={notification.name} notification={notification} />;
                  }
                  if (notification.type === UserNotification_Type.SCHEDULE_REMINDER) {
                    return <ScheduleReminderMessage key={notification.name} notification={notification} />;
                  }
                  return null;
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

export default Inboxes;
