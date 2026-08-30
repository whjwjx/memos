import { DownloadIcon, UploadIcon } from "lucide-react";
import type { ChangeEvent } from "react";
import { useRef, useState } from "react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import {
  downloadMemosExport,
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
import SettingSection from "./SettingSection";

const formatImportResult = (result: ImportExportResult) => {
  const created = result.createdMemos + result.createdAttachments + result.createdRelations + result.createdReactions;
  const skipped = result.skippedMemos + result.skippedAttachments + result.skippedRelations + result.skippedReactions;
  return { created, skipped };
};

const DataSection = () => {
  const t = useTranslate();
  const user = useCurrentUser();
  const isAdmin = user?.role === User_Role.ADMIN;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingScopeRef = useRef<ImportExportScope>("mine");
  const pendingSourceRef = useRef<ImportSource>("memos");
  const [exportingScope, setExportingScope] = useState<ImportExportScope | undefined>();
  const [importingScope, setImportingScope] = useState<ImportExportScope | undefined>();
  const [importingSource, setImportingSource] = useState<ImportSource | undefined>();
  const [importProgress, setImportProgress] = useState<ImportProgress | undefined>();

  const handleExport = async (scope: ImportExportScope) => {
    setExportingScope(scope);
    try {
      await downloadMemosExport(scope);
      toast.success(t("setting.data.export-success"));
    } catch (error) {
      handleError(error, toast.error, { context: "Export data" });
    } finally {
      setExportingScope(undefined);
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
    setImportProgress(undefined);
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

  const getImportButtonText = (scope: ImportExportScope, source: ImportSource, labelKey: Translations) => {
    if (importingScope !== scope || importingSource !== source) {
      return t(labelKey);
    }
    if (importProgress) {
      return t("setting.data.importing-progress", {
        current: importProgress.uploadedChunks,
        total: importProgress.totalChunks,
      });
    }
    return t("setting.data.importing");
  };

  return (
    <SettingSection title={t("setting.data.label")} description={t("setting.data.description")}>
      <input ref={fileInputRef} type="file" accept=".zip,application/zip" className="hidden" onChange={handleImportFileChange} />

      <SettingGroup title={t("setting.data.my-data")} description={t("setting.data.my-data-description")}>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={!!exportingScope || !!importingScope} onClick={() => handleExport("mine")}>
            <DownloadIcon className="mr-1.5 h-4 w-4" />
            {exportingScope === "mine" ? t("setting.data.exporting") : t("setting.data.export-memos-package")}
          </Button>
        </div>
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!!exportingScope || !!importingScope}
              onClick={() => openImportFilePicker("mine", "memos")}
            >
              <UploadIcon className="mr-1.5 h-4 w-4" />
              {getImportButtonText("mine", "memos", "setting.data.import-memos-package")}
            </Button>
            <span className="text-muted-foreground text-sm">{t("setting.data.import-memos-package-description")}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!!exportingScope || !!importingScope}
              onClick={() => openImportFilePicker("mine", "flomo")}
            >
              <UploadIcon className="mr-1.5 h-4 w-4" />
              {getImportButtonText("mine", "flomo", "setting.data.import-flomo-package")}
            </Button>
            <span className="text-muted-foreground text-sm">{t("setting.data.import-flomo-package-description")}</span>
          </div>
        </div>
      </SettingGroup>

      {isAdmin && (
        <SettingGroup showSeparator title={t("setting.data.admin-data")} description={t("setting.data.admin-data-description")}>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" disabled={!!exportingScope || !!importingScope} onClick={() => handleExport("all")}>
              <DownloadIcon className="mr-1.5 h-4 w-4" />
              {exportingScope === "all" ? t("setting.data.exporting") : t("setting.data.export-all-memos-package")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!!exportingScope || !!importingScope}
              onClick={() => openImportFilePicker("all", "memos")}
            >
              <UploadIcon className="mr-1.5 h-4 w-4" />
              {getImportButtonText("all", "memos", "setting.data.import-all-memos-package")}
            </Button>
          </div>
        </SettingGroup>
      )}
    </SettingSection>
  );
};

export default DataSection;
