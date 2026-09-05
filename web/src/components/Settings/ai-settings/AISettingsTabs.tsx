import type { AISettingsPanel } from "./types";

export type AISettingsVisiblePanel = Exclude<AISettingsPanel, "legacy">;

export const AISettingsTabs = ({
  activePanel,
  panels,
  onSelect,
}: {
  activePanel: AISettingsPanel;
  panels: { key: AISettingsVisiblePanel; label: string }[];
  onSelect: (panel: AISettingsVisiblePanel) => void;
}) => {
  return (
    <div className="flex gap-2 overflow-x-auto border-b border-border pb-2">
      {panels.map((panel) => (
        <button
          key={panel.key}
          type="button"
          className={`shrink-0 rounded-md px-3 py-1.5 text-sm transition-colors ${
            activePanel === panel.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
          onClick={() => onSelect(panel.key)}
        >
          {panel.label}
        </button>
      ))}
    </div>
  );
};
