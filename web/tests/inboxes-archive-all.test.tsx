import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Inboxes from "@/pages/Inboxes";
import { type UserNotification, UserNotification_Status, UserNotification_Type } from "@/types/proto/api/v1/user_service_pb";

const mocks = vi.hoisted(() => ({
  inboxFilter: "all",
  notifications: [] as UserNotification[],
  updateNotification: vi.fn(),
}));

vi.mock("@/components/Inbox/MemoCommentMessage", () => ({
  default: ({ notification }: { notification: UserNotification }) => <div>{notification.name}</div>,
}));

vi.mock("@/components/Inbox/MemoMentionMessage", () => ({
  default: ({ notification }: { notification: UserNotification }) => <div>{notification.name}</div>,
}));

vi.mock("@/components/Inbox/ScheduleReminderMessage", () => ({
  default: ({ notification }: { notification: UserNotification }) => <div>{notification.name}</div>,
}));

vi.mock("@/contexts/AppSidebarContext", () => ({
  useAppSidebar: () => ({ inboxFilter: mocks.inboxFilter }),
}));

vi.mock("@/hooks/useUserQueries", () => ({
  useNotifications: () => ({ data: mocks.notifications }),
  useUpdateUserNotification: () => ({ mutateAsync: mocks.updateNotification }),
}));

vi.mock("@/utils/i18n", () => ({
  useTranslate: () => (key: string, params?: Record<string, number>) => `${key}${params?.count ? ` ${params.count}` : ""}`,
}));

describe("Inboxes archive all", () => {
  beforeEach(() => {
    mocks.inboxFilter = "all";
    mocks.notifications = [];
    mocks.updateNotification.mockReset();
    mocks.updateNotification.mockResolvedValue(undefined);
  });

  it("archives unread notifications without touching archived notifications", async () => {
    const unread = {
      name: "users/alice/notifications/1",
      status: UserNotification_Status.UNREAD,
      type: UserNotification_Type.SCHEDULE_REMINDER,
    } as UserNotification;
    const archived = {
      name: "users/alice/notifications/2",
      status: UserNotification_Status.ARCHIVED,
      type: UserNotification_Type.MEMO_COMMENT,
    } as UserNotification;
    mocks.notifications = [unread, archived];

    render(<Inboxes />);

    fireEvent.click(screen.getByRole("button", { name: "inbox.archive-all" }));

    await waitFor(() => expect(mocks.updateNotification).toHaveBeenCalledOnce());
    expect(mocks.updateNotification).toHaveBeenCalledWith({
      notification: {
        name: unread.name,
        status: UserNotification_Status.ARCHIVED,
      },
      updateMask: ["status"],
    });
  });
});
