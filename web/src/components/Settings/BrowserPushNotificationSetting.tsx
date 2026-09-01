import { BellIcon, BellOffIcon, ChevronDownIcon, MonitorCheckIcon, SendIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  useCreatePushSubscription,
  useDeletePushSubscription,
  usePushNotificationConfig,
  usePushSubscriptions,
  useTestPushNotification,
} from "@/hooks/useUserQueries";
import { handleError } from "@/lib/error";
import { useTranslate } from "@/utils/i18n";
import {
  browserPushSubscriptionToInput,
  getExistingBrowserPushSubscription,
  getNotificationPermission,
  isBrowserPushSupported,
  showLocalBrowserNotification,
  subscribeBrowserPush,
  unsubscribeBrowserPush,
} from "@/utils/push-notifications";
import { SettingList, SettingListItem } from "./SettingList";

const BrowserPushNotificationSetting = ({ parent }: { parent?: string }) => {
  const t = useTranslate();
  const supported = useMemo(() => isBrowserPushSupported(), []);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(() => getNotificationPermission());
  const [currentEndpoint, setCurrentEndpoint] = useState("");
  const [localNotificationPending, setLocalNotificationPending] = useState(false);
  const { data: config } = usePushNotificationConfig(parent);
  const { data: subscriptions = [] } = usePushSubscriptions(parent);
  const createSubscription = useCreatePushSubscription(parent);
  const deleteSubscription = useDeletePushSubscription(parent);
  const testNotification = useTestPushNotification(parent);

  useEffect(() => {
    let canceled = false;
    getExistingBrowserPushSubscription()
      .then((subscription) => {
        if (!canceled) {
          setCurrentEndpoint(subscription?.endpoint || "");
        }
      })
      .catch(() => {
        if (!canceled) {
          setCurrentEndpoint("");
        }
      });
    return () => {
      canceled = true;
    };
  }, []);

  const currentServerSubscription = subscriptions.find((subscription) => subscription.endpoint === currentEndpoint);
  const enabled = Boolean(currentServerSubscription && permission === "granted");
  const pending = createSubscription.isPending || deleteSubscription.isPending || testNotification.isPending || localNotificationPending;
  const canEnable = Boolean(parent && supported && config?.enabled && config.vapidPublicKey);

  const ensureBrowserPushEnabled = async () => {
    if (!config?.vapidPublicKey) {
      throw new Error(t("setting.preference.browser-notification-server-disabled"));
    }
    const browserSubscription = await subscribeBrowserPush(config.vapidPublicKey);
    setPermission(getNotificationPermission());
    setCurrentEndpoint(browserSubscription.endpoint);
    await createSubscription.mutateAsync(browserPushSubscriptionToInput(browserSubscription));
  };

  const handleEnabledChange = async (checked: boolean) => {
    if (!parent) {
      toast.error(t("setting.preference.browser-notification-sign-in-required"));
      return;
    }
    if (!supported) {
      toast.error(t("setting.preference.browser-notification-unsupported"));
      return;
    }
    if (!config?.enabled || !config.vapidPublicKey) {
      toast.error(t("setting.preference.browser-notification-server-disabled"));
      return;
    }

    try {
      if (checked) {
        await ensureBrowserPushEnabled();
        toast.success(t("setting.preference.browser-notification-enabled"));
        return;
      }

      await unsubscribeBrowserPush();
      setCurrentEndpoint("");
      if (currentServerSubscription?.name) {
        await deleteSubscription.mutateAsync(currentServerSubscription.name);
      }
      toast.success(t("setting.preference.browser-notification-disabled"));
    } catch (error: unknown) {
      setPermission(getNotificationPermission());
      await handleError(error, toast.error, { context: "Update browser notifications" });
    }
  };

  const handleTestNotification = async () => {
    if (!parent) {
      toast.error(t("setting.preference.browser-notification-sign-in-required"));
      return;
    }
    if (!supported) {
      toast.error(t("setting.preference.browser-notification-unsupported"));
      return;
    }
    if (!config?.enabled || !config.vapidPublicKey) {
      toast.error(t("setting.preference.browser-notification-server-disabled"));
      return;
    }

    try {
      await ensureBrowserPushEnabled();
      await testNotification.mutateAsync();
      toast.success(t("setting.preference.browser-notification-test-sent"));
    } catch (error: unknown) {
      await handleError(error, toast.error, { context: "Test browser notification" });
    }
  };

  const handleLocalNotificationCheck = async () => {
    if (!supported) {
      toast.error(t("setting.preference.browser-notification-unsupported"));
      return;
    }

    try {
      setLocalNotificationPending(true);
      await showLocalBrowserNotification();
      setPermission(getNotificationPermission());
      toast.success(t("setting.preference.browser-notification-local-test-sent"));
    } catch (error: unknown) {
      setPermission(getNotificationPermission());
      await handleError(error, toast.error, { context: "Check local browser notification" });
    } finally {
      setLocalNotificationPending(false);
    }
  };

  return (
    <SettingList>
      <SettingListItem
        label={t("setting.preference.browser-notification")}
        description={
          supported
            ? t("setting.preference.browser-notification-description")
            : t("setting.preference.browser-notification-unsupported-description")
        }
      >
        <div className="flex items-center gap-2">
          {enabled ? <BellIcon className="size-4 text-primary" /> : <BellOffIcon className="size-4 text-muted-foreground" />}
          <Switch checked={enabled} disabled={pending || !canEnable} onCheckedChange={handleEnabledChange} />
        </div>
      </SettingListItem>
      <SettingListItem
        label={t("setting.preference.browser-notification-test")}
        description={t("setting.preference.browser-notification-test-description")}
      >
        <Button variant="outline" disabled={!canEnable || pending} onClick={handleTestNotification}>
          <SendIcon className="size-4" />
          {testNotification.isPending
            ? t("setting.preference.browser-notification-test-sending")
            : t("setting.preference.browser-notification-test")}
        </Button>
      </SettingListItem>
      <SettingListItem label={t("setting.preference.browser-notification-troubleshooting")} vertical>
        <div className="w-full space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 text-muted-foreground">{t("setting.preference.browser-notification-local-test-description")}</p>
            <Button variant="outline" disabled={!supported || pending} onClick={handleLocalNotificationCheck}>
              <MonitorCheckIcon className="size-4" />
              {localNotificationPending
                ? t("setting.preference.browser-notification-local-test-sending")
                : t("setting.preference.browser-notification-local-test")}
            </Button>
          </div>
          <details className="group rounded-md border border-border bg-muted/20 px-3 py-2">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-foreground">
              <span>{t("setting.preference.browser-notification-troubleshooting-summary")}</span>
              <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-muted-foreground">
              <li>{t("setting.preference.browser-notification-troubleshooting-site")}</li>
              <li>{t("setting.preference.browser-notification-troubleshooting-system")}</li>
              <li>{t("setting.preference.browser-notification-troubleshooting-focus")}</li>
              <li>{t("setting.preference.browser-notification-troubleshooting-center")}</li>
              <li>{t("setting.preference.browser-notification-troubleshooting-restart")}</li>
            </ul>
          </details>
        </div>
      </SettingListItem>
    </SettingList>
  );
};

export default BrowserPushNotificationSetting;
