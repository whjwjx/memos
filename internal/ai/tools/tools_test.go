package tools_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/internal/ai/tools"
	storepb "github.com/usememos/memos/proto/gen/store"
)

func TestRegistryContainsConversationalTools(t *testing.T) {
	t.Parallel()
	r := tools.NewRegistry()
	got := make(map[string]bool)
	for _, spec := range r.Specs() {
		got[spec.Name] = true
	}
	for _, name := range []string{
		"search_memos",
		"web_search",
		"get_memo",
		"get_comments",
		"create_memo",
		"update_memo",
		"tag_memo",
		"batch_update_memos",
		"manage_settings",
		"query_db",
		"get_logs",
		"manage_memory",
		"query_queue",
		"project_status",
	} {
		require.Truef(t, got[name], "registry missing tool %q", name)
	}
	// Names must be unique.
	require.Len(t, r.Specs(), len(got))
}

func TestRegistryRemove(t *testing.T) {
	t.Parallel()
	r := tools.NewRegistry()
	require.NotNil(t, r.Get("get_logs"))
	r.Remove("get_logs")
	require.Nil(t, r.Get("get_logs"))
	for _, spec := range r.Specs() {
		require.NotEqual(t, "get_logs", spec.Name)
	}
	// Removing a name that is not registered is a no-op.
	r.Remove("does-not-exist")
}

func TestToolsRejectMissingRequiredArgs(t *testing.T) {
	t.Parallel()
	r := tools.NewRegistry()
	ctx := context.Background()
	// Store is nil: tool implementations must validate required args before
	// touching the store, so these should return an error, not panic.
	tc := tools.ToolContext{UserID: 1, Store: nil}

	cases := []struct {
		name string
		args string
	}{
		{"get_comments", `{"limit":5}`},            // missing memoUid
		{"web_search", `{}`},                       // missing query
		{"get_memo", `{}`},                         // missing memoUid
		{"create_memo", `{"visibility":"PUBLIC"}`}, // missing content
		{"update_memo", `{}`},                      // missing memoUid
		{"tag_memo", `{}`},                         // missing memoUid
		{"batch_update_memos", `{}`},               // missing memoUids
		{"delete_memo", `{}`},                      // missing memoUid
		{"manage_settings", `{"key":"GENERAL"}`},   // missing action
	}
	for _, c := range cases {
		tool := r.Get(c.name)
		require.NotNil(t, tool, c.name)
		_, err := tool.Run(ctx, tc, c.args)
		require.Error(t, err, "tool %s should reject missing required args", c.name)
	}
}

func TestManageSettingsRejectsUnknownKey(t *testing.T) {
	t.Parallel()
	r := tools.NewRegistry()
	tool := r.Get("manage_settings")
	require.NotNil(t, tool)
	_, err := tool.Run(context.Background(), tools.ToolContext{UserID: 1, Store: nil}, `{"action":"get","key":"NOPE"}`)
	require.Error(t, err)
}

func TestWebSearchToolCallsTavily(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, http.MethodPost, r.Method)
		require.Equal(t, "/search", r.URL.Path)
		require.Equal(t, "Bearer tvly-test", r.Header.Get("Authorization"))

		var body map[string]any
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		require.Equal(t, "memos tavily", body["query"])
		require.Equal(t, "advanced", body["search_depth"])
		require.Equal(t, float64(3), body["max_results"])
		require.Equal(t, true, body["include_answer"])

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"query":"memos tavily",
			"answer":"Tavily can search the web for AI agents.",
			"response_time":0.12,
			"results":[
				{"title":"Tavily Docs","url":"https://docs.tavily.com/","content":"Search API documentation","score":0.95,"published_date":"2026-09-12"}
			]
		}`))
	}))
	defer server.Close()

	tool := &tools.WebSearchTool{
		HTTPClient: server.Client(),
		Config: &storepb.WebSearchConfig{
			Enabled:       true,
			Provider:      storepb.WebSearchConfig_TAVILY,
			Endpoint:      server.URL,
			ApiKey:        "tvly-test",
			MaxResults:    5,
			SearchDepth:   "basic",
			IncludeAnswer: false,
		},
	}

	result, err := tool.Run(context.Background(), tools.ToolContext{}, `{
		"query":"memos tavily",
		"maxResults":3,
		"searchDepth":"advanced",
		"includeAnswer":true
	}`)
	require.NoError(t, err)
	require.Contains(t, result, "Web search results:")
	require.Contains(t, result, "Tavily can search the web for AI agents.")
	require.Contains(t, result, "https://docs.tavily.com/")
}
