import { DownloadIcon, UploadIcon } from "lucide-react";
import type { ChangeEvent } from "react";
import { useRef, useState } from "react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { downloadMemosExport, type ImportExportResult, type ImportExportScope, importMemosExport } from "@/helpers/import-export";
import useCurrentUser from "@/hooks/useCurrentUser";
import { handleError } from "@/lib/error";
import { User_Role } from "@/types/proto/api/v1/user_service_pb";
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
  const [exportingScope, setExportingScope] = useState<ImportExportScope | undefined>();
  const [importingScope, setImportingScope] = useState<ImportExportScope | undefined>();

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

  const openImportFilePicker = (scope: ImportExportScope) => {
    pendingScopeRef.current = scope;
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  };

  const handleImportFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const scope = pendingScopeRef.current;
    setImportingScope(scope);
    try {
      const result = await importMemosExport(scope, file);
      const summary = formatImportResult(result);
      toast.success(t("setting.data.import-success", summary));
      if (result.warnings?.length) {
        toast(t("setting.data.import-warning", { count: result.warnings.length }));
      }
    } catch (error) {
      handleError(error, toast.error, { context: "Import data" });
    } finally {
      setImportingScope(undefined);
      event.target.value = "";
    }
  };

  return (
    <SettingSection title={t("setting.data.label")} description={t("setting.data.description")}>
      <input ref={fileInputRef} type="file" accept=".zip,application/zip" className="hidden" onChange={handleImportFileChange} />

      <SettingGroup title={t("setting.data.my-data")} description={t("setting.data.my-data-description")}>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={!!exportingScope || !!importingScope} onClick={() => handleExport("mine")}>
            <DownloadIcon className="mr-1.5 h-4 w-4" />
            {exportingScope === "mine" ? t("setting.data.exporting") : t("setting.data.export-my-data")}
          </Button>
          <Button variant="outline" size="sm" disabled={!!exportingScope || !!importingScope} onClick={() => openImportFilePicker("mine")}>
            <UploadIcon className="mr-1.5 h-4 w-4" />
            {importingScope === "mine" ? t("setting.data.importing") : t("setting.data.import-my-data")}
          </Button>
        </div>
      </SettingGroup>

      {isAdmin && (
        <SettingGroup showSeparator title={t("setting.data.admin-data")} description={t("setting.data.admin-data-description")}>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" disabled={!!exportingScope || !!importingScope} onClick={() => handleExport("all")}>
              <DownloadIcon className="mr-1.5 h-4 w-4" />
              {exportingScope === "all" ? t("setting.data.exporting") : t("setting.data.export-all-data")}
            </Button>
            <Button variant="outline" size="sm" disabled={!!exportingScope || !!importingScope} onClick={() => openImportFilePicker("all")}>
              <UploadIcon className="mr-1.5 h-4 w-4" />
              {importingScope === "all" ? t("setting.data.importing") : t("setting.data.import-all-data")}
            </Button>
          </div>
        </SettingGroup>
      )}
    </SettingSection>
  );
};

export default DataSection;
