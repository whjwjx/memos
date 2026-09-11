package tools

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/ai/chat"
	storepb "github.com/usememos/memos/proto/gen/store"
)

const (
	defaultTavilyEndpoint     = "https://api.tavily.com"
	tavilySearchDepthBasic    = "basic"
	tavilySearchDepthAdvanced = "advanced"
	defaultWebSearchLimit     = 5
	maxWebSearchLimit         = 10
)

// WebSearchTool lets the assistant search the public web through Tavily.
type WebSearchTool struct {
	HTTPClient *http.Client
	Config     *storepb.WebSearchConfig
}

type webSearchArgs struct {
	Query         string `json:"query"`
	MaxResults    int32  `json:"maxResults"`
	SearchDepth   string `json:"searchDepth"`
	IncludeAnswer *bool  `json:"includeAnswer"`
}

type tavilySearchRequest struct {
	Query             string `json:"query"`
	SearchDepth       string `json:"search_depth,omitempty"`
	Topic             string `json:"topic,omitempty"`
	MaxResults        int32  `json:"max_results,omitempty"`
	IncludeAnswer     bool   `json:"include_answer"`
	IncludeRawContent bool   `json:"include_raw_content"`
	IncludeImages     bool   `json:"include_images"`
}

type tavilySearchResponse struct {
	Query        string               `json:"query"`
	Answer       string               `json:"answer"`
	ResponseTime float64              `json:"response_time"`
	Results      []tavilySearchResult `json:"results"`
}

type tavilySearchResult struct {
	Title         string  `json:"title"`
	URL           string  `json:"url"`
	Content       string  `json:"content"`
	Score         float64 `json:"score"`
	PublishedDate string  `json:"published_date"`
}

type webSearchResult struct {
	Title         string  `json:"title"`
	URL           string  `json:"url"`
	Content       string  `json:"content"`
	Score         float64 `json:"score,omitempty"`
	PublishedDate string  `json:"publishedDate,omitempty"`
}

type webSearchToolResult struct {
	Query        string            `json:"query"`
	Answer       string            `json:"answer,omitempty"`
	ResponseTime float64           `json:"responseTime,omitempty"`
	Results      []webSearchResult `json:"results"`
}

func (*WebSearchTool) Spec() chat.ToolSpec {
	return chat.ToolSpec{
		Name:        "web_search",
		Description: "Search the public web for current or external information using Tavily. Use search_memos for the user's local memos, and web_search for internet sources. Use concise search queries and do not send private memo content verbatim. Include source URLs from the results when answering.",
		ParametersJSON: `{
			"type": "object",
			"properties": {
				"query": {"type": "string", "description": "Concise public-web search query. Do not include private memo text verbatim."},
				"maxResults": {"type": "integer", "minimum": 1, "maximum": 10, "description": "Maximum number of web results to return. Defaults to the instance web search setting."},
				"searchDepth": {"type": "string", "enum": ["basic", "advanced"], "description": "Tavily search depth. Defaults to the instance web search setting."},
				"includeAnswer": {"type": "boolean", "description": "Whether Tavily should include its generated answer when available. Defaults to the instance web search setting."}
			},
			"required": ["query"]
		}`,
	}
}

func (*WebSearchTool) RequiresConfirmation(_ string) bool {
	return false
}

func (t *WebSearchTool) Run(ctx context.Context, tc ToolContext, argsJSON string) (string, error) {
	var args webSearchArgs
	if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
		return "", errors.Wrap(err, "invalid web_search arguments")
	}
	args.Query = strings.TrimSpace(args.Query)
	if args.Query == "" {
		return "", errors.New("query is required")
	}

	cfg, err := t.resolveConfig(ctx, tc)
	if err != nil {
		return "", err
	}
	request, err := buildTavilySearchRequest(args, cfg)
	if err != nil {
		return "", err
	}
	response, err := t.searchTavily(ctx, cfg, request)
	if err != nil {
		return "", err
	}

	results := make([]webSearchResult, 0, len(response.Results))
	for _, item := range response.Results {
		results = append(results, webSearchResult{
			Title:         strings.TrimSpace(item.Title),
			URL:           strings.TrimSpace(item.URL),
			Content:       truncate(strings.TrimSpace(item.Content), 1000),
			Score:         item.Score,
			PublishedDate: strings.TrimSpace(item.PublishedDate),
		})
	}
	out := webSearchToolResult{
		Query:        response.Query,
		Answer:       strings.TrimSpace(response.Answer),
		ResponseTime: response.ResponseTime,
		Results:      results,
	}
	if out.Query == "" {
		out.Query = args.Query
	}
	if len(out.Results) == 0 && out.Answer == "" {
		return "No web results found.", nil
	}
	return marshalToolResult("Web search results:\n", out)
}

func (t *WebSearchTool) resolveConfig(ctx context.Context, tc ToolContext) (*storepb.WebSearchConfig, error) {
	if t.Config != nil {
		return t.Config, nil
	}
	if tc.Store == nil {
		return nil, errors.New("web search is not configured")
	}
	setting, err := tc.Store.GetInstanceAISetting(ctx)
	if err != nil {
		return nil, errors.Wrap(err, "failed to load AI setting")
	}
	if setting == nil || setting.GetWebSearch() == nil {
		return nil, errors.New("web search is not configured")
	}
	return setting.GetWebSearch(), nil
}

func buildTavilySearchRequest(args webSearchArgs, cfg *storepb.WebSearchConfig) (*tavilySearchRequest, error) {
	if cfg == nil || !cfg.GetEnabled() {
		return nil, errors.New("web search is disabled")
	}
	if cfg.GetProvider() != storepb.WebSearchConfig_TAVILY {
		return nil, errors.New("web search provider is unsupported")
	}
	if strings.TrimSpace(cfg.GetApiKey()) == "" {
		return nil, errors.New("web search API key is required")
	}

	maxResults := args.MaxResults
	if maxResults <= 0 {
		maxResults = cfg.GetMaxResults()
	}
	if maxResults <= 0 {
		maxResults = defaultWebSearchLimit
	}
	if cfg.GetMaxResults() > 0 && maxResults > cfg.GetMaxResults() {
		maxResults = cfg.GetMaxResults()
	}
	if maxResults > maxWebSearchLimit {
		maxResults = maxWebSearchLimit
	}

	searchDepth := strings.ToLower(strings.TrimSpace(args.SearchDepth))
	if searchDepth == "" {
		searchDepth = strings.ToLower(strings.TrimSpace(cfg.GetSearchDepth()))
	}
	if searchDepth == "" {
		searchDepth = tavilySearchDepthBasic
	}
	if searchDepth != tavilySearchDepthBasic && searchDepth != tavilySearchDepthAdvanced {
		return nil, errors.New("searchDepth must be basic or advanced")
	}

	includeAnswer := cfg.GetIncludeAnswer()
	if args.IncludeAnswer != nil {
		includeAnswer = *args.IncludeAnswer
	}
	return &tavilySearchRequest{
		Query:             args.Query,
		SearchDepth:       searchDepth,
		Topic:             "general",
		MaxResults:        maxResults,
		IncludeAnswer:     includeAnswer,
		IncludeRawContent: false,
		IncludeImages:     false,
	}, nil
}

func (t *WebSearchTool) searchTavily(ctx context.Context, cfg *storepb.WebSearchConfig, request *tavilySearchRequest) (*tavilySearchResponse, error) {
	body, err := json.Marshal(request)
	if err != nil {
		return nil, errors.Wrap(err, "failed to marshal Tavily request")
	}
	endpoint, err := tavilySearchURL(cfg.GetEndpoint())
	if err != nil {
		return nil, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, errors.Wrap(err, "failed to build Tavily request")
	}
	httpReq.Header.Set("Authorization", "Bearer "+strings.TrimSpace(cfg.GetApiKey()))
	httpReq.Header.Set("Content-Type", "application/json")

	client := t.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	httpResp, err := client.Do(httpReq)
	if err != nil {
		return nil, errors.Wrap(err, "failed to send Tavily request")
	}
	defer httpResp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(httpResp.Body, 2<<20))
	if err != nil {
		return nil, errors.Wrap(err, "failed to read Tavily response")
	}
	if httpResp.StatusCode < 200 || httpResp.StatusCode >= 300 {
		return nil, errors.Errorf("Tavily request failed with status %d: %s", httpResp.StatusCode, truncate(strings.TrimSpace(string(respBody)), 500))
	}

	var response tavilySearchResponse
	if err := json.Unmarshal(respBody, &response); err != nil {
		return nil, errors.Wrap(err, "failed to decode Tavily response")
	}
	return &response, nil
}

func tavilySearchURL(endpoint string) (string, error) {
	endpoint = strings.TrimSpace(endpoint)
	if endpoint == "" {
		endpoint = defaultTavilyEndpoint
	}
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return "", errors.Wrap(err, "invalid Tavily endpoint")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", errors.New("Tavily endpoint must use http or https")
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	if !strings.HasSuffix(parsed.Path, "/search") {
		parsed.Path += "/search"
	}
	return parsed.String(), nil
}
