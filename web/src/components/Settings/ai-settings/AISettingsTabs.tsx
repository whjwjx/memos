import type { AISettingsPanel } from "./types";

export const AISettingsTabs = ({
  activePanel,
  panels,
  onSelect,
}: {
  activePanel: AISettingsPanel;
  panels: { key: AISettingsPanel; label: string }[];
  onSelect: (panel: AISettingsPanel) => void;
}) => {
  return (
    <div className="border-b border-border">
      <div className="grid grid-cols-3 gap-2 pb-2 sm:flex sm:flex-wrap" aria-label="AI settings sections">
        {panels.map((panel) => (
          <button
            key={panel.key}
            type="button"
            className={`min-w-0 rounded-md px-3 py-1.5 text-center text-sm transition-colors ${
              activePanel === panel.key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
            onClick={() => onSelect(panel.key)}
          >
            {panel.label}
          </button>
        ))}
      </div>
    </div>
  );
};
