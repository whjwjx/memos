import { PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslate } from "@/utils/i18n";
import SettingGroup from "../SettingGroup";
import SettingTable from "../SettingTable";
import type { LocalMemory, LocalMemoryEntry } from "./types";

type MemoryPanelProps = {
  memory: LocalMemory;
  memoryHasChanges: boolean;
  onToggleEnabled: () => void;
  onAddEntry: () => void;
  onUpdateEntry: (id: string, content: string) => void;
  onDeleteEntry: (id: string) => void;
  onSave: () => void;
};

export const MemoryPanel = ({
  memory,
  memoryHasChanges,
  onToggleEnabled,
  onAddEntry,
  onUpdateEntry,
  onDeleteEntry,
  onSave,
}: MemoryPanelProps) => {
  const t = useTranslate();

  return (
    <SettingGroup
      title={t("setting.ai.memory-title")}
      description={t("setting.ai.memory-description")}
      showSeparator
      actions={
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
          <Button variant="outline" className="justify-start sm:justify-center" onClick={onAddEntry}>
            <PlusIcon className="w-4 h-4 mr-2" />
            {t("setting.ai.memory-add-entry")}
          </Button>
          <Button className="justify-start sm:justify-center" disabled={!memoryHasChanges} onClick={onSave}>
            {t("common.save")}
          </Button>
        </div>
      }
    >
      <div className="flex items-center gap-2 mb-3">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={memory.enabled}
          onChange={onToggleEnabled}
          aria-label={t("setting.ai.memory-enabled-label")}
        />
        <span className="text-sm">{t("setting.ai.memory-enabled-label")}</span>
      </div>
      <div className="flex flex-col gap-2 md:hidden">
        {memory.entries.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            {t("setting.ai.memory-no-entries")}
          </div>
        ) : (
          memory.entries.map((entry) => (
            <div key={entry.id} className="rounded-lg border border-border bg-background px-3 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <Input
                    value={entry.content}
                    onChange={(e) => onUpdateEntry(entry.id, e.target.value)}
                    placeholder={t("setting.ai.memory-entry-placeholder")}
                  />
                  <div className="mt-2 text-xs text-muted-foreground">
                    {t("setting.ai.memory-entry-created-by")}: {entry.createdBy || "-"}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="size-9 shrink-0 p-0"
                  onClick={() => onDeleteEntry(entry.id)}
                  aria-label={t("setting.ai.memory-entry-delete-aria")}
                >
                  <Trash2Icon className="w-4 h-auto" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
      <SettingTable
        className="hidden md:block"
        columns={[
          {
            key: "content",
            header: t("setting.ai.memory-entry-content"),
            render: (_, entry: LocalMemoryEntry) => (
              <Input
                value={entry.content}
                onChange={(e) => onUpdateEntry(entry.id, e.target.value)}
                placeholder={t("setting.ai.memory-entry-placeholder")}
              />
            ),
          },
          {
            key: "createdBy",
            header: t("setting.ai.memory-entry-created-by"),
            render: (_, entry: LocalMemoryEntry) => <span className="text-xs text-muted-foreground">{entry.createdBy || "-"}</span>,
          },
          {
            key: "actions",
            header: "",
            className: "text-right",
            render: (_, entry: LocalMemoryEntry) => (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onDeleteEntry(entry.id)}
                aria-label={t("setting.ai.memory-entry-delete-aria")}
              >
                <Trash2Icon className="w-4 h-auto" />
              </Button>
            ),
          },
        ]}
        data={memory.entries}
        emptyMessage={t("setting.ai.memory-no-entries")}
        getRowKey={(entry) => entry.id}
      />
    </SettingGroup>
  );
};
