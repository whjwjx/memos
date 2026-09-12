import type { LocalLLM } from "./types";

export const DEFAULT_LLM_TEMPERATURE = 0.2;
export const MIN_LLM_TEMPERATURE = 0;
export const MAX_LLM_TEMPERATURE = 2;
export const DEFAULT_LLM_MAX_OUTPUT_TOKENS = 2048;
export const MIN_LLM_MAX_OUTPUT_TOKENS = 256;
export const MAX_LLM_MAX_OUTPUT_TOKENS = 8192;
export const COMPATIBILITY_PRESET_AUTO_VALUE = "__auto__";

export const compatibilityPresetOptions = [
  { value: COMPATIBILITY_PRESET_AUTO_VALUE, labelKey: "setting.ai.llm-compat-auto" },
  { value: "openai-compatible", labelKey: "setting.ai.llm-compat-openai-compatible" },
  { value: "deepseek-compatible", labelKey: "setting.ai.llm-compat-deepseek-compatible" },
  { value: "gemini", labelKey: "setting.ai.llm-compat-gemini" },
  { value: "strict-tools", labelKey: "setting.ai.llm-compat-strict-tools" },
] as const;

export const allowedCompatibilityPresets: ReadonlySet<string> = new Set(
  compatibilityPresetOptions.map((option) => option.value).filter((value) => value !== COMPATIBILITY_PRESET_AUTO_VALUE),
);

export const isAllowedCompatibilityPreset = (value: string) => allowedCompatibilityPresets.has(value);

export const normalizeCompatibilityPreset = (value: string) => (value === COMPATIBILITY_PRESET_AUTO_VALUE ? "" : value.trim());

export const getEffectiveLLMTemperature = (llm: LocalLLM) => llm.temperature ?? DEFAULT_LLM_TEMPERATURE;

export const getEffectiveLLMMaxOutputTokens = (llm: LocalLLM) =>
  llm.maxOutputTokens > 0 ? llm.maxOutputTokens : DEFAULT_LLM_MAX_OUTPUT_TOKENS;

export const getCompatibilityPresetLabelKey = (preset: string) => {
  const value = preset || COMPATIBILITY_PRESET_AUTO_VALUE;
  const option = compatibilityPresetOptions.find((item) => item.value === value);
  return option?.labelKey ?? "setting.ai.llm-compat-auto";
};
