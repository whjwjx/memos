package v1

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/pkg/errors"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	"github.com/usememos/memos/internal/ai"
	agentpkg "github.com/usememos/memos/internal/ai/agent"
	"github.com/usememos/memos/internal/ai/chat"
	"github.com/usememos/memos/server/auth"
	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

// scheduleAutoTagForMemo queues a PENDING tagging task for every enabled
// tagger configured instance-wide. It is called from CreateMemo (guarded by
// isAgentSchedulingSuppressed, so agent replies / tagger runs never trigger one
// another) and from the manual AutoTagMemo RPC. One row per (memo_id, tagger_id)
// keeps tagging idempotent: a memo is tagged at most once per tagger.
//
// force re-arms an already-completed (DONE/FAILED) task back to PENDING so the
// user can re-tag a memo after removing the tags a previous run applied. When
// force is false, an existing finished task keeps its status (idempotent
// scheduling on memo creation).
func (s *APIV1Service) scheduleAutoTagForMemo(ctx context.Context, memoID int32, force bool) {
	setting, err := s.Store.GetInstanceAISetting(ctx)
	if err != nil {
		slog.Warn("Failed to load instance AI setting for auto-tagging", slog.Any("err", err))
		return
	}
	if setting == nil {
		return
	}
	// Only auto-tag memos that don't already have any tags, to avoid re-tagging
	// on every edit / re-trigger beyond what the user intends. A forced re-tag
	// (manual AutoTagMemo) skips this guard so a user can re-apply tags they
	// removed.
	if !force {
		if memo, err := s.Store.GetMemo(ctx, &store.FindMemo{ID: &memoID}); err == nil && memo != nil {
			if len(memo.Payload.GetTags()) > 0 {
				return
			}
		}
	}

	now := time.Now().Unix()
	for _, tagger := range setting.GetTaggers() {
		if !tagger.GetEnabled() || tagger.GetProviderId() == "" {
			continue
		}
		if _, err := s.Store.UpsertMemoTagTask(ctx, &store.CreateMemoTagTask{
			MemoID:   memoID,
			TaggerID: tagger.GetId(),
			DueAt:    now,
			Force:    force,
		}); err != nil {
			slog.Warn("Failed to schedule memo tag task",
				slog.Int("memo_id", int(memoID)),
				slog.String("tagger_id", tagger.GetId()),
				slog.Any("err", err))
		}
	}
}

// processDueMemoTagTasks scans for due tagging tasks and applies AI-selected
// tags to each memo. It mirrors processDueAgentReplies and shares the same
// poller so taggers are part of the Agent system family of async tasks.
func (s *APIV1Service) processDueMemoTagTasks(ctx context.Context) {
	dueBefore := time.Now().Unix()
	tasks, err := s.Store.ListMemoTagTasks(ctx, &store.FindMemoTagTask{
		StatusList: []store.MemoTagTaskStatus{store.MemoTagTaskPending},
		DueBefore:  &dueBefore,
		Limit:      func() *int { n := agentReplyBatchLimit; return &n }(),
	})
	if err != nil {
		slog.Warn("Failed to list due memo tag tasks", slog.Any("err", err))
		return
	}

	setting, err := s.Store.GetInstanceAISetting(ctx)
	if err != nil {
		slog.Warn("Failed to load instance AI setting for auto-tagging", slog.Any("err", err))
		return
	}
	if setting == nil {
		return
	}
	taggersByID := make(map[string]*storepb.TaggerConfig, len(setting.GetTaggers()))
	for _, tagger := range setting.GetTaggers() {
		taggersByID[tagger.GetId()] = tagger
	}
	providersByID := make(map[string]*storepb.AIProviderConfig, len(setting.GetProviders()))
	for _, provider := range setting.GetProviders() {
		providersByID[provider.GetId()] = provider
	}

	for _, task := range tasks {
		s.processMemoTagTask(ctx, task, taggersByID, providersByID)
	}
}

func (s *APIV1Service) processMemoTagTask(
	ctx context.Context,
	task *store.MemoTagTask,
	taggersByID map[string]*storepb.TaggerConfig,
	providersByID map[string]*storepb.AIProviderConfig,
) {
	tagger := taggersByID[task.TaggerID]
	if tagger == nil || !tagger.GetEnabled() || tagger.GetProviderId() == "" {
		// Tagger was removed or disabled; drop the task so it never retries.
		if err := s.Store.UpdateMemoTagTask(ctx, &store.UpdateMemoTagTask{
			ID:     task.ID,
			Status: func() *store.MemoTagTaskStatus { st := store.MemoTagTaskDone; return &st }(),
		}); err != nil {
			slog.Warn("Failed to mark disabled tagger task done", slog.Int("task_id", int(task.ID)), slog.Any("err", err))
		}
		return
	}
	provider := providersByID[tagger.GetProviderId()]
	if provider == nil || provider.GetApiKey() == "" {
		// Provider is missing or has no key; record failure and stop retrying.
		status := store.MemoTagTaskFailed
		if err := s.Store.UpdateMemoTagTask(ctx, &store.UpdateMemoTagTask{ID: task.ID, Status: &status}); err != nil {
			slog.Warn("Failed to mark tagger task failed", slog.Int("task_id", int(task.ID)), slog.Any("err", err))
		}
		return
	}

	// Mark the task DONE *before* generating so a crash mid-generation does not
	// produce a duplicate tag application on the next poll.
	if err := s.Store.UpdateMemoTagTask(ctx, &store.UpdateMemoTagTask{
		ID:     task.ID,
		Status: func() *store.MemoTagTaskStatus { st := store.MemoTagTaskDone; return &st }(),
	}); err != nil {
		slog.Warn("Failed to claim memo tag task", slog.Int("task_id", int(task.ID)), slog.Any("err", err))
		return
	}

	if err := s.applyTaggingToMemo(ctx, task, tagger, provider); err != nil {
		slog.Warn("Failed to auto-tag memo",
			slog.Int("memo_id", int(task.MemoID)),
			slog.String("tagger_id", task.TaggerID),
			slog.Any("err", err))
	}
}

// applyTaggingToMemo asks the LLM to pick tags from the tagger's candidate set,
// then appends any new tags to the memo content. Tagging is additive: tags the
// user already authored are never removed and are skipped when applying AI tags.
func (s *APIV1Service) applyTaggingToMemo(
	ctx context.Context,
	task *store.MemoTagTask,
	tagger *storepb.TaggerConfig,
	provider *storepb.AIProviderConfig,
) error {
	memo, err := s.Store.GetMemo(ctx, &store.FindMemo{ID: &task.MemoID})
	if err != nil {
		return errors.Wrap(err, "failed to load memo")
	}
	if memo == nil {
		return errors.Errorf("memo %d not found", task.MemoID)
	}

	model, err := agentpkg.NewChatModel(ai.ProviderConfig{
		ID:       provider.GetId(),
		Type:     convertAIProviderTypeFromStore(provider.GetType()),
		Endpoint: provider.GetEndpoint(),
		APIKey:   provider.GetApiKey(),
	}, chat.ApplyOptions(nil))
	if err != nil {
		return errors.Wrap(err, "failed to build chat model")
	}

	systemPrompt := buildTaggerSystemPrompt(tagger)
	userPrompt := buildTaggerUserPrompt(tagger, memo.Content)
	req := chat.Request{
		System: systemPrompt,
		Messages: []chat.Message{
			{Role: chat.RoleUser, Content: userPrompt},
		},
	}
	if tagger.GetModel() != "" {
		req.Model = tagger.GetModel()
	}

	resp, err := model.Generate(ctx, req)
	if err != nil {
		return errors.Wrap(err, "chat generation failed")
	}

	// Parse returned tag names (one per line or comma separated), keeping only
	// those present in the tagger's candidate set and not already on the memo.
	existingTags := make(map[string]bool, len(memo.Payload.GetTags()))
	for _, tag := range memo.Payload.GetTags() {
		existingTags[strings.ToLower(tag)] = true
	}
	candidateSet := ParseTaggerCandidateTags(tagger.GetPrompt())
	maxTags := int(tagger.GetMaxTags())
	if maxTags <= 0 {
		maxTags = 3
	}

	newTags := []string{}
	seen := make(map[string]bool)
	for _, raw := range strings.Split(resp.Text, "\n") {
		for _, name := range strings.Split(raw, ",") {
			name = strings.TrimSpace(name)
			name = strings.TrimPrefix(name, "#")
			name = strings.Trim(name, `"'`)
			if name == "" {
				continue
			}
			key := strings.ToLower(name)
			if seen[key] || existingTags[key] || !candidateSet[key] {
				continue
			}
			seen[key] = true
			newTags = append(newTags, name)
			if len(newTags) >= maxTags {
				break
			}
		}
		if len(newTags) >= maxTags {
			break
		}
	}

	if len(newTags) == 0 {
		slog.Info("Auto-tagging produced no new tags",
			slog.Int("memo_id", int(task.MemoID)),
			slog.String("tagger_id", task.TaggerID))
		return nil
	}

	// Append tags to the memo content. Admin authority lets the system act on
	// private memos it did not author, mirroring agent replies.
	admin, err := s.findAdminUser(ctx)
	if err != nil {
		return errors.Wrap(err, "failed to resolve admin user")
	}
	if admin == nil {
		return errors.New("no admin user available to apply auto tags")
	}
	agentCtx := context.WithValue(context.Background(), auth.UserIDContextKey, admin.ID)
	agentCtx = withSystemAgentCall(agentCtx)

	tagSuffix := ""
	for _, name := range newTags {
		tagSuffix += " #" + name
	}
	nextContent := strings.TrimRight(memo.Content, " \n\t") + tagSuffix

	if _, err := s.UpdateMemo(agentCtx, &v1pb.UpdateMemoRequest{
		Memo:       &v1pb.Memo{Name: fmt.Sprintf("memos/%s", memo.UID), Content: nextContent},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content"}},
	}); err != nil {
		return errors.Wrap(err, "failed to update memo with tags")
	}

	slog.Info("Applied AI tags to memo",
		slog.Int("memo_id", int(task.MemoID)),
		slog.String("tagger_id", task.TaggerID),
		slog.Int("tag_count", len(newTags)))
	return nil
}

// buildTaggerSystemPrompt combines admin-controlled safety constraints with the
// tagging spec delivered in the tagger's prompt field.
func buildTaggerSystemPrompt(tagger *storepb.TaggerConfig) string {
	var b strings.Builder
	if prompt := strings.TrimSpace(tagger.GetPrompt()); prompt != "" {
		b.WriteString(prompt)
		b.WriteString("\n\n")
	}
	b.WriteString("You are an auto-tagging assistant. Select tags strictly from the candidate list above. ")
	b.WriteString("Return only the chosen tag names, one per line, without the leading #. ")
	b.WriteString("Do not explain. Do not invent tags outside the candidate set. If nothing fits, return nothing.")
	return strings.TrimSpace(b.String())
}

func buildTaggerUserPrompt(tagger *storepb.TaggerConfig, memoContent string) string {
	return "Here is the memo to tag:\n\n" + memoContent
}

// ParseTaggerCandidateTags extracts the candidate tag names from a tagger prompt.
// We accept either explicit "candidate:" style lines or any #word/#path tokens
// found in the prompt, so admins can author the spec in either style.
func ParseTaggerCandidateTags(prompt string) map[string]bool {
	set := make(map[string]bool)
	for _, line := range strings.Split(prompt, "\n") {
		line = strings.TrimSpace(line)
		// Strip a leading bullet / dash commonly used in prompt lists.
		line = strings.TrimLeft(line, "-•*0123456789. ")
		// If the line lists comma/space separated tags (with or without #),
		// capture them.
		fields := strings.FieldsFunc(line, func(r rune) bool {
			return r == ',' || r == ' ' || r == '、' || r == '，'
		})
		for _, f := range fields {
			f = strings.TrimPrefix(f, "#")
			f = strings.Trim(f, `"'`)
			if f != "" {
				set[strings.ToLower(f)] = true
			}
		}
	}
	return set
}
