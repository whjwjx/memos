import { useDirection } from "@base-ui/react/direction-provider";
import type { CSSProperties } from "react";
import { useEffect, useRef } from "react";
import { Navigate, Outlet, useLocation, useSearchParams } from "react-router-dom";
import AppSidebar, {
  MobileAppHeader,
  MobileAppSidebar,
  QuickFindDialog,
  SIDEBAR_WIDTH_VAR,
  SidebarResizeHandle,
  useSidebarWidth,
} from "@/components/AppSidebar";
import { AppSidebarProvider, useAppSidebar } from "@/contexts/AppSidebarContext";
import { GlobalMemoEditorProvider } from "@/contexts/GlobalMemoEditorContext";
import { useInstance } from "@/contexts/InstanceContext";
import { MemoFilterProvider, useMemoFilterContext } from "@/contexts/MemoFilterContext";
import useCurrentUser from "@/hooks/useCurrentUser";
import useMediaQuery from "@/hooks/useMediaQuery";
import { buildAuthRoute, shouldGatePrivateInstance } from "@/utils/auth-redirect";
import { useTranslate } from "@/utils/i18n";

const MEMOS_DEPLOY_URL = "https://usememos.com/docs/deploy";
const MOBILE_SIDEBAR_SWIPE_DISTANCE_PX = 64;
const MOBILE_SIDEBAR_SWIPE_MAX_VERTICAL_PX = 56;
const MOBILE_SIDEBAR_SWIPE_AXIS_RATIO = 1.4;
const MOBILE_SIDEBAR_SWIPE_IGNORE_SELECTOR = "input, textarea, select, button, [contenteditable='true']";

const DemoBanner = () => {
  const t = useTranslate();

  return (
    <div className="static w-full border-b border-border bg-muted/70 px-4 py-2 text-sm text-muted-foreground sm:px-6">
      <div className="mx-auto flex max-w-5xl flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-center sm:gap-2">
        <span className="font-medium text-foreground">{t("demo.banner-title")}</span>
        <span>{t("demo.banner-description")}</span>
        <a className="font-medium text-primary underline-offset-4 hover:underline" href={MEMOS_DEPLOY_URL} target="_blank" rel="noreferrer">
          {t("demo.deploy-link")}
        </a>
      </div>
    </div>
  );
};

function useMobileSidebarSwipe(enabled: boolean, open: boolean, setOpen: (open: boolean) => void, direction: "ltr" | "rtl") {
  const setOpenRef = useRef(setOpen);

  useEffect(() => {
    setOpenRef.current = setOpen;
  }, [setOpen]);

  useEffect(() => {
    if (!enabled || open) {
      return;
    }

    const start = { x: 0, y: 0, tracking: false };

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        start.tracking = false;
        return;
      }

      if (event.target instanceof Element && event.target.closest(MOBILE_SIDEBAR_SWIPE_IGNORE_SELECTOR)) {
        start.tracking = false;
        return;
      }

      const touch = event.touches[0];
      if (!touch) {
        start.tracking = false;
        return;
      }

      start.tracking = true;
      start.x = touch.clientX;
      start.y = touch.clientY;
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!start.tracking || event.touches.length !== 1) {
        return;
      }

      const touch = event.touches[0];
      if (!touch) {
        return;
      }

      const horizontalDelta = direction === "rtl" ? start.x - touch.clientX : touch.clientX - start.x;
      const verticalDelta = Math.abs(touch.clientY - start.y);
      const isSidebarSwipe =
        horizontalDelta >= MOBILE_SIDEBAR_SWIPE_DISTANCE_PX &&
        verticalDelta <= MOBILE_SIDEBAR_SWIPE_MAX_VERTICAL_PX &&
        horizontalDelta / Math.max(verticalDelta, 1) >= MOBILE_SIDEBAR_SWIPE_AXIS_RATIO;

      if (isSidebarSwipe) {
        start.tracking = false;
        setOpenRef.current(true);
      }
    };

    const stopTracking = () => {
      start.tracking = false;
    };

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", stopTracking, { passive: true });
    window.addEventListener("touchcancel", stopTracking, { passive: true });

    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", stopTracking);
      window.removeEventListener("touchcancel", stopTracking);
    };
  }, [direction, enabled, open]);
}

const RootLayoutContent = () => {
  const location = useLocation();
  const direction = useDirection();
  const [searchParams] = useSearchParams();
  const currentUser = useCurrentUser();
  const md = useMediaQuery("md");
  const { profile } = useInstance();
  const { removeFilter } = useMemoFilterContext();
  const { mobileOpen, setMobileOpen } = useAppSidebar();
  const { pathname } = location;
  const prevPathnameRef = useRef<string | undefined>(undefined);
  const shellRef = useRef<HTMLDivElement>(null);
  const { width: sidebarWidth, minWidth, maxWidth, setWidth: setSidebarWidth } = useSidebarWidth();

  useMobileSidebarSwipe(!md, mobileOpen, setMobileOpen, direction);

  useEffect(() => {
    const prevPathname = prevPathnameRef.current;

    // When the route changes and there is no filter in the search params, remove all filters.
    if (prevPathname !== undefined && prevPathname !== pathname && !searchParams.has("filter")) {
      removeFilter(() => true);
    }

    prevPathnameRef.current = pathname;
  }, [pathname, searchParams, removeFilter]);

  // Private instance (no InstanceURL configured): anonymous visitors may only reach
  // share links; everything else redirects to the sign-in page, preserving the intended
  // destination. Public instances keep the open Explore behavior for logged-out users.
  if (shouldGatePrivateInstance({ isPrivateInstance: !profile.instanceUrl, isAuthenticated: !!currentUser, pathname })) {
    const redirect = `${pathname}${location.search}${location.hash}`;
    return <Navigate to={buildAuthRoute({ redirect })} replace />;
  }

  return (
    <div ref={shellRef} className="min-h-full w-full bg-background" style={{ [SIDEBAR_WIDTH_VAR]: `${sidebarWidth}px` } as CSSProperties}>
      {md && (
        <div className="fixed inset-y-0 start-0 z-30 w-(--app-sidebar-width) border-e border-border/70">
          <AppSidebar />
          <SidebarResizeHandle
            width={sidebarWidth}
            minWidth={minWidth}
            maxWidth={maxWidth}
            onWidthChange={setSidebarWidth}
            targetRef={shellRef}
          />
        </div>
      )}
      <MobileAppSidebar />
      <main className="flex min-h-full w-full min-w-0 flex-col items-center md:ps-(--app-sidebar-width)">
        <MobileAppHeader />
        {profile.demo && <DemoBanner />}
        <Outlet />
      </main>
      <QuickFindDialog />
    </div>
  );
};

const RootLayout = () => (
  <MemoFilterProvider>
    <AppSidebarProvider>
      <GlobalMemoEditorProvider>
        <RootLayoutContent />
      </GlobalMemoEditorProvider>
    </AppSidebarProvider>
  </MemoFilterProvider>
);

export default RootLayout;
