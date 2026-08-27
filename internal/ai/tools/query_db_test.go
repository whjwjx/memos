package tools_test

import (
	"context"
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"

	"github.com/usememos/memos/internal/ai/tools"
	"github.com/usememos/memos/store"
	"github.com/usememos/memos/store/test"
)

func TestQueryDBRequiresConfirmation(t *testing.T) {
	t.Parallel()
	tool := tools.NewRegistry().Get("query_db")
	require.NotNil(t, tool)

	// Read-only select never requires confirmation.
	require.False(t, tool.RequiresConfirmation(`{"operation":"select","table":"memo"}`))
	// Every write operation is gated behind confirmation.
	for _, op := range []string{"insert", "update", "delete"} {
		require.Truef(t, tool.RequiresConfirmation(`{"operation":"`+op+`","table":"memo"}`), "operation %s", op)
	}
	// Unparseable arguments never ask for confirmation.
	require.False(t, tool.RequiresConfirmation(`not-json`))
}

func TestQueryDBRejectsInvalidArgs(t *testing.T) {
	ctx := context.Background()
	s := test.NewTestingStore(ctx, t)
	defer func() { _ = s.Close() }()
	admin := createQueryDBTestUser(t, ctx, s, "qdb-invalid-admin", store.RoleAdmin)
	tool := tools.NewRegistry().Get("query_db")
	require.NotNil(t, tool)
	tc := tools.ToolContext{UserID: admin.ID, Store: s}

	cases := []string{
		`{}`,                                  // missing operation
		`{"operation":"select"}`,              // missing table
		`{"operation":"drop","table":"memo"}`, // unknown operation
		`{"operation":"select","table":"system_setting"}`,                                                                                 // blocked table
		`{"operation":"select","table":"resource"}`,                                                                                       // blocked table
		`{"operation":"select","table":"user","fields":["password_hash"]}`,                                                                // sensitive column
		`{"operation":"select","table":"attachment","fields":["blob"]}`,                                                                   // sensitive column
		`{"operation":"select","table":"memo","where":[{"field":"creator_id","op":"DROP","value":1}]}`,                                    // bad operator
		`{"operation":"select","table":"memo","where":[{"field":"nope","op":"=","value":1}]}`,                                             // bad column
		`{"operation":"delete","table":"memo"}`,                                                                                           // delete without where
		`{"operation":"update","table":"memo","fields":["content"],"values":{"content":"x"}}`,                                             // update without where
		`{"operation":"update","table":"memo","fields":["content"],"values":{"content":"x"},"where":[{"field":"id","op":"=","value":1}]}`, // missing confirm keyword
		`{"operation":"delete","table":"memo","where":[{"field":"id","op":"=","value":1}],"confirm_keyword":"nope"}`,                      // wrong confirm keyword
	}
	for _, args := range cases {
		_, err := tool.Run(ctx, tc, args)
		require.Error(t, err, "args: %s", args)
	}

	// Argument validation happens before touching the store.
	_, err := tool.Run(context.Background(), tools.ToolContext{UserID: 1, Store: nil}, `{"operation":"select","table":"memo"}`)
	require.Error(t, err)
}

func createQueryDBTestUser(t *testing.T, ctx context.Context, s *store.Store, username string, role store.Role) *store.User {
	t.Helper()
	passwordHash, err := bcrypt.GenerateFromPassword([]byte("test_password"), bcrypt.MinCost)
	require.NoError(t, err)
	user, err := s.CreateUser(ctx, &store.User{
		Username:     username,
		Role:         role,
		Email:        username + "@test.com",
		Nickname:     username + "_nickname",
		PasswordHash: string(passwordHash),
	})
	require.NoError(t, err)
	return user
}

func TestQueryDBWithStore(t *testing.T) {
	ctx := context.Background()
	s := test.NewTestingStore(ctx, t)
	defer func() { _ = s.Close() }()
	admin := createQueryDBTestUser(t, ctx, s, "qdb-admin", store.RoleAdmin)
	normal := createQueryDBTestUser(t, ctx, s, "qdb-user", store.RoleUser)
	tool := tools.NewRegistry().Get("query_db")
	require.NotNil(t, tool)

	// Seed a memo through the store so select has data.
	_, err := s.CreateMemo(ctx, &store.Memo{
		UID:        "qdb-memo-1",
		CreatorID:  admin.ID,
		Content:    "hello from query db",
		Visibility: store.Public,
	})
	require.NoError(t, err)

	// Non-admin users are rejected even for reads.
	_, err = tool.Run(ctx, tools.ToolContext{UserID: normal.ID, Store: s},
		`{"operation":"select","table":"memo","fields":["content"],"where":[{"field":"uid","op":"=","value":"qdb-memo-1"}]}`)
	require.Error(t, err)
	require.Contains(t, err.Error(), "admin")

	// Admin select works.
	result, err := tool.Run(ctx, tools.ToolContext{UserID: admin.ID, Store: s},
		`{"operation":"select","table":"memo","fields":["content"],"where":[{"field":"uid","op":"=","value":"qdb-memo-1"}]}`)
	require.NoError(t, err)
	require.Contains(t, result, "hello from query db")

	// Write operations without the confirm keyword are refused.
	_, err = tool.Run(ctx, tools.ToolContext{UserID: admin.ID, Store: s},
		`{"operation":"update","table":"memo","fields":["content"],"values":{"content":"updated"},"where":[{"field":"uid","op":"=","value":"qdb-memo-1"}]}`)
	require.Error(t, err)
	require.Contains(t, err.Error(), "confirmation")

	// Insert with confirmation.
	insertArgs := fmt.Sprintf(`{"operation":"insert","table":"memo","fields":["uid","creator_id","content","visibility"],"values":{"uid":"qdb-memo-2","creator_id":%d,"content":"inserted memo","visibility":"PUBLIC"},"confirm_keyword":"yes"}`, admin.ID)
	result, err = tool.Run(ctx, tools.ToolContext{UserID: admin.ID, Store: s}, insertArgs)
	require.NoError(t, err)
	require.Contains(t, result, "inserted 1 row")

	// Update with confirmation.
	result, err = tool.Run(ctx, tools.ToolContext{UserID: admin.ID, Store: s},
		`{"operation":"update","table":"memo","fields":["content"],"values":{"content":"updated content"},"where":[{"field":"uid","op":"=","value":"qdb-memo-1"}],"confirm_keyword":"yes"}`)
	require.NoError(t, err)
	require.Contains(t, result, "updated 1 row")

	// The update actually took effect.
	result, err = tool.Run(ctx, tools.ToolContext{UserID: admin.ID, Store: s},
		`{"operation":"select","table":"memo","fields":["content"],"where":[{"field":"uid","op":"=","value":"qdb-memo-1"}]}`)
	require.NoError(t, err)
	require.Contains(t, result, "updated content")

	// Delete with confirmation.
	result, err = tool.Run(ctx, tools.ToolContext{UserID: admin.ID, Store: s},
		`{"operation":"delete","table":"memo","where":[{"field":"uid","op":"=","value":"qdb-memo-2"}],"confirm_keyword":"yes"}`)
	require.NoError(t, err)
	require.Contains(t, result, "deleted 1 row")
}
