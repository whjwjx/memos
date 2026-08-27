package store

import "context"

// TranslationHistory is one AI translation request owned by a user.
type TranslationHistory struct {
	ID             int32
	UID            string
	UserID         int32
	SourceText     string
	TranslatedText string
	SourceLanguage string
	TargetLanguage string
	ProviderID     string
	Model          string
	CreatedTs      int64
}

// FindTranslationHistory filters translation history records.
type FindTranslationHistory struct {
	ID     *int32
	UID    *string
	UserID *int32
	Limit  *int
	Offset *int
}

// DeleteTranslationHistory identifies a translation history item to remove.
type DeleteTranslationHistory struct {
	ID     *int32
	UID    *string
	UserID *int32
}

// DeleteTranslationHistories identifies a group of translation history items to remove.
type DeleteTranslationHistories struct {
	UserID *int32
}

// CreateTranslationHistory creates a translation history item.
func (s *Store) CreateTranslationHistory(ctx context.Context, create *TranslationHistory) (*TranslationHistory, error) {
	return s.driver.CreateTranslationHistory(ctx, create)
}

// ListTranslationHistories lists translation history items.
func (s *Store) ListTranslationHistories(ctx context.Context, find *FindTranslationHistory) ([]*TranslationHistory, error) {
	return s.driver.ListTranslationHistories(ctx, find)
}

// GetTranslationHistory returns the first translation history item matching the filter.
func (s *Store) GetTranslationHistory(ctx context.Context, find *FindTranslationHistory) (*TranslationHistory, error) {
	return s.driver.GetTranslationHistory(ctx, find)
}

// DeleteTranslationHistory deletes one translation history item.
func (s *Store) DeleteTranslationHistory(ctx context.Context, delete *DeleteTranslationHistory) error {
	return s.driver.DeleteTranslationHistory(ctx, delete)
}

// DeleteTranslationHistories deletes translation history items matching the filter.
func (s *Store) DeleteTranslationHistories(ctx context.Context, delete *DeleteTranslationHistories) error {
	return s.driver.DeleteTranslationHistories(ctx, delete)
}
