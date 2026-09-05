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
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={onAddEntry}>
            <PlusIcon className="w-4 h-4 mr-2" />
            {t("setting.ai.memory-add-entry")}
          </Button>
          <Button disabled={!memoryHasChanges} onClick={onSave}>
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
      <SettingTable
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
