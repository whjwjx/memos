import { DownloadIcon, UploadIcon } from "lucide-react";
import type { ChangeEvent } from "react";
import { useRef, useState } from "react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import {
  downloadMemosExport,
  type ExportProgress,
  type ImportExportResult,
  type ImportExportScope,
  type ImportProgress,
  type ImportSource,
  importMemosExport,
} from "@/helpers/import-export";
import useCurrentUser from "@/hooks/useCurrentUser";
import { handleError } from "@/lib/error";
import { User_Role } from "@/types/proto/api/v1/user_service_pb";
import type { Translations } from "@/utils/i18n";
import { useTranslate } from "@/utils/i18n";
import SettingGroup from "./SettingGroup";
import { SettingList, SettingListItem } from "./SettingList";
import SettingSection from "./SettingSection";

const formatImportResult = (result: ImportExportResult) => {
  const created = result.createdMemos + result.createdAttachments + result.createdRelations + result.createdReactions;
  const skipped = result.skippedMemos + result.skippedAttachments + result.skippedRelations + result.skippedReactions;
  return { created, skipped };
};

const getExportProgressPercent = (progress: ExportProgress): number | undefined => {
  if (!progress.totalBytes) return undefined;
  return Math.min(100, Math.round((progress.downloadedBytes / progress.totalBytes) * 100));
};

const getImportProgressPercent = (progress: ImportProgress): number | undefined => {
  if (!progress.totalBytes || progress.uploadedBytes === undefined) return undefined;
  return Math.min(100, Math.round((progress.uploadedBytes / progress.totalBytes) * 100));
};

const DataSection = () => {
  const t = useTranslate();
  const user = useCurrentUser();
  const isAdmin = user?.role === User_Role.ADMIN;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingScopeRef = useRef<ImportExportScope>("mine");
  const pendingSourceRef = useRef<ImportSource>("memos");
  const [exportingScope, setExportingScope] = useState<ImportExportScope | undefined>();
  const [exportProgress, setExportProgress] = useState<ExportProgress | undefined>();
  const [importingScope, setImportingScope] = useState<ImportExportScope | undefined>();
  const [importingSource, setImportingSource] = useState<ImportSource | undefined>();
  const [importProgress, setImportProgress] = useState<ImportProgress | undefined>();

  const handleExport = async (scope: ImportExportScope) => {
    setExportingScope(scope);
    setExportProgress({ downloadedBytes: 0, phase: "preparing" });
    try {
      await downloadMemosExport(scope, setExportProgress);
      toast.success(t("setting.data.export-success"));
    } catch (error) {
      handleError(error, toast.error, { context: "Export data" });
    } finally {
      setExportingScope(undefined);
      setExportProgress(undefined);
    }
  };

  const openImportFilePicker = (scope: ImportExportScope, source: ImportSource) => {
    pendingScopeRef.current = scope;
    pendingSourceRef.current = source;
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  };

  const handleImportFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const scope = pendingScopeRef.current;
    const source = pendingSourceRef.current;
    setImportingScope(scope);
    setImportingSource(source);
    setImportProgress({ phase: "preparing", totalBytes: file.size, uploadedBytes: 0 });
    try {
      const result = await importMemosExport(scope, file, source, setImportProgress);
      const summary = formatImportResult(result);
      toast.success(t("setting.data.import-success", summary));
      if (result.warnings?.length) {
        toast(t("setting.data.import-warning", { count: result.warnings.length }));
      }
    } catch (error) {
      handleError(error, toast.error, { context: "Import data" });
    } finally {
      setImportingScope(undefined);
      setImportingSource(undefined);
      setImportProgress(undefined);
      event.target.value = "";
    }
  };

  const getExportProgressLabel = (progress: ExportProgress) => {
    const percent = getExportProgressPercent(progress);
    if (progress.phase === "downloading" && percent !== undefined) {
      return t("setting.data.export-downloading-progress", { percent });
    }
    if (progress.phase === "downloading") {
      return t("setting.data.export-downloading");
    }
    return t("setting.data.exporting");
  };

  const getImportProgressLabel = (progress: ImportProgress) => {
    const percent = getImportProgressPercent(progress);
    if (progress.phase === "uploading" && percent !== undefined) {
      return t("setting.data.import-uploading-progress", { percent });
    }
    if (progress.phase === "processing") {
      return t("setting.data.import-processing");
    }
    return t("setting.data.importing");
  };

  const renderProgressTrack = (active: boolean, determinate: boolean, percent?: number) => {
    if (!active) return null;

    return (
      <span className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-primary/15">
        <span
          className={`block h-full bg-primary transition-all duration-300 ${determinate ? "" : "w-1/2 animate-pulse"}`}
          style={determinate ? { width: `${percent}%` } : undefined}
        />
      </span>
    );
  };

  const renderExportButton = (scope: ImportExportScope, labelKey: Translations) => {
    const activeProgress = exportingScope === scope ? exportProgress : undefined;
    const percent = activeProgress ? getExportProgressPercent(activeProgress) : undefined;
    const isDeterminate = activeProgress?.phase === "downloading" && percent !== undefined;
    const label = t(labelKey);

    return (
      <Button
        variant="outline"
        size="sm"
        className="relative w-full overflow-hidden sm:w-auto"
        disabled={!!exportingScope || !!importingScope}
        onClick={() => handleExport(scope)}
      >
        <DownloadIcon className="h-4 w-4" />
        <span className="grid min-w-0">
          <span className={`col-start-1 row-start-1 ${activeProgress ? "invisible" : ""}`}>{label}</span>
          {activeProgress && (
            <span className="col-start-1 row-start-1" aria-live="polite">
              {getExportProgressLabel(activeProgress)}
            </span>
          )}
        </span>
        {renderProgressTrack(!!activeProgress, isDeterminate, percent)}
      </Button>
    );
  };

  const renderImportButton = (scope: ImportExportScope, source: ImportSource, labelKey: Translations) => {
    const activeProgress = importingScope === scope && importingSource === source ? importProgress : undefined;
    const percent = activeProgress ? getImportProgressPercent(activeProgress) : undefined;
    const isDeterminate = activeProgress?.phase === "uploading" && percent !== undefined;
    const label = t(labelKey);

    return (
      <Button
        variant="outline"
        size="sm"
        className="relative w-full overflow-hidden sm:w-auto"
        disabled={!!exportingScope || !!importingScope}
        onClick={() => openImportFilePicker(scope, source)}
      >
        <UploadIcon className="h-4 w-4" />
        <span className="grid min-w-0">
          <span className={`col-start-1 row-start-1 ${activeProgress ? "invisible" : ""}`}>{label}</span>
          {activeProgress && (
            <span className="col-start-1 row-start-1" aria-live="polite">
              {getImportProgressLabel(activeProgress)}
            </span>
          )}
        </span>
        {renderProgressTrack(!!activeProgress, isDeterminate, percent)}
      </Button>
    );
  };

  return (
    <SettingSection title={t("setting.data.label")} description={t("setting.data.description")}>
      <input ref={fileInputRef} type="file" accept=".zip,application/zip" className="hidden" onChange={handleImportFileChange} />

      <SettingGroup title={t("setting.data.my-data")} description={t("setting.data.my-data-description")}>
        <SettingList>
          <SettingListItem
            label={t("setting.data.memos-package-title")}
            description={t("setting.data.import-memos-package-description")}
            controlClassName="flex-wrap gap-2"
          >
            {renderExportButton("mine", "setting.data.export-memos-package")}
            {renderImportButton("mine", "memos", "setting.data.import-memos-package")}
          </SettingListItem>

          <SettingListItem
            label={t("setting.data.flomo-package-title")}
            description={t("setting.data.import-flomo-package-description")}
            controlClassName="flex-wrap gap-2"
          >
            {renderImportButton("mine", "flomo", "setting.data.import-flomo-package")}
          </SettingListItem>
        </SettingList>
      </SettingGroup>

      {isAdmin && (
        <SettingGroup showSeparator title={t("setting.data.admin-data")} description={t("setting.data.admin-data-description")}>
          <SettingList>
            <SettingListItem
              label={t("setting.data.memos-package-title")}
              description={t("setting.data.admin-data-description")}
              controlClassName="flex-wrap gap-2"
            >
              {renderExportButton("all", "setting.data.export-all-memos-package")}
              {renderImportButton("all", "memos", "setting.data.import-all-memos-package")}
            </SettingListItem>
          </SettingList>
        </SettingGroup>
      )}
    </SettingSection>
  );
};

export default DataSection;
