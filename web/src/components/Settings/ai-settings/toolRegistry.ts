export type AIChatToolRegistryItem = {
  name: string;
  descriptionKey: string;
  adminOnly: boolean;
  defaultRequiresConfirmation: boolean;
  confirmEditable?: boolean;
};

// Static registry of the conversational assistant's built-in tools. The tool set
// is fixed server-side; admin may only toggle enable and mark confirmation. Keys
// must match internal/ai/tools registry names.
export const toolRegistry: AIChatToolRegistryItem[] = [
  {
    name: "search_memos",
    descriptionKey: "setting.ai.tool-search-memos",
    adminOnly: false,
    defaultRequiresConfirmation: false,
    confirmEditable: false,
  },
  {
    name: "get_memo",
    descriptionKey: "setting.ai.tool-get-memo",
    adminOnly: false,
    defaultRequiresConfirmation: false,
    confirmEditable: false,
  },
  {
    name: "get_comments",
    descriptionKey: "setting.ai.tool-get-comments",
    adminOnly: false,
    defaultRequiresConfirmation: false,
    confirmEditable: false,
  },
  { name: "create_memo", descriptionKey: "setting.ai.tool-create-memo", adminOnly: false, defaultRequiresConfirmation: true },
  { name: "update_memo", descriptionKey: "setting.ai.tool-update-memo", adminOnly: false, defaultRequiresConfirmation: true },
  { name: "tag_memo", descriptionKey: "setting.ai.tool-tag-memo", adminOnly: false, defaultRequiresConfirmation: true },
  { name: "batch_update_memos", descriptionKey: "setting.ai.tool-batch-update-memos", adminOnly: false, defaultRequiresConfirmation: true },
  { name: "manage_settings", descriptionKey: "setting.ai.tool-manage-settings", adminOnly: false, defaultRequiresConfirmation: true },
  { name: "delete_memo", descriptionKey: "setting.ai.tool-delete-memo", adminOnly: false, defaultRequiresConfirmation: true },
  {
    name: "get_logs",
    descriptionKey: "setting.ai.tool-get-logs",
    adminOnly: true,
    defaultRequiresConfirmation: false,
    confirmEditable: false,
  },
  { name: "query_db", descriptionKey: "setting.ai.tool-query-db", adminOnly: true, defaultRequiresConfirmation: true },
  { name: "manage_memory", descriptionKey: "setting.ai.tool-manage-memory", adminOnly: true, defaultRequiresConfirmation: true },
  {
    name: "query_queue",
    descriptionKey: "setting.ai.tool-query-queue",
    adminOnly: true,
    defaultRequiresConfirmation: false,
    confirmEditable: false,
  },
  {
    name: "project_status",
    descriptionKey: "setting.ai.tool-project-status",
    adminOnly: true,
    defaultRequiresConfirmation: false,
    confirmEditable: false,
  },
];
