package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/pkg/errors"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	"github.com/usememos/memos/internal/ai/chat"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

// ManageSettingsTool reads or writes the current user's own settings. Because it
// mutates user data it requires explicit confirmation before execution.
type ManageSettingsTool struct{}

type manageSettingsArgs struct {
	Action string `json:"action"`
	Key    string `json:"key"`
	Value  string `json:"value"`
}

func (*ManageSettingsTool) Spec() chat.ToolSpec {
	return chat.ToolSpec{
		Name:        "manage_settings",
		Description: "Read or update the current user's own settings. action must be \"get\" or \"set\". key is one of GENERAL, TAGS. Setting a value requires user confirmation. Reading never requires confirmation.",
		ParametersJSON: `{
			"type": "object",
			"properties": {
				"action": {"type": "string", "enum": ["get", "set"], "description": "Whether to read or write the setting."},
				"key": {"type": "string", "enum": ["GENERAL", "TAGS"], "description": "Which user setting to act on."},
				"value": {"type": "string", "description": "New JSON value when action is set."}
			},
			"required": ["action", "key"]
		}`,
	}
}

func (*ManageSettingsTool) RequiresConfirmation(argsJSON string) bool {
	var args manageSettingsArgs
	if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
		// If we can't tell, err on the side of requiring confirmation.
		return true
	}
	// Only mutating ("set") operations require confirmation; reads are safe.
	return strings.ToLower(strings.TrimSpace(args.Action)) == "set"
}

func (*ManageSettingsTool) Run(ctx context.Context, tc ToolContext, argsJSON string) (string, error) {
	var args manageSettingsArgs
	if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
		return "", errors.Wrap(err, "invalid manage_settings arguments")
	}
	action := strings.ToLower(strings.TrimSpace(args.Action))
	key, err := parseUserSettingKey(args.Key)
	if err != nil {
		return "", err
	}

	if action == "get" {
		setting, err := tc.Store.GetUserSetting(ctx, &store.FindUserSetting{
			UserID: &tc.UserID,
			Key:    key,
		})
		if err != nil {
			return "", errors.Wrap(err, "failed to get user setting")
		}
		if setting == nil {
			return fmt.Sprintf("No %s setting found for the current user.", key), nil
		}
		var msg proto.Message
		switch key {
		case storepb.UserSetting_GENERAL:
			msg = setting.GetGeneral()
		case storepb.UserSetting_TAGS:
			msg = setting.GetTags()
		default:
			return "", errors.Errorf("unsupported setting key %q", key)
		}
		raw, err := protojson.Marshal(msg)
		if err != nil {
			return "", errors.Wrap(err, "failed to marshal setting value")
		}
		return fmt.Sprintf("%s setting:\n%s", key, string(raw)), nil
	}

	if action == "set" {
		if strings.TrimSpace(args.Value) == "" {
			return "", errors.New("value is required when action is set")
		}
		var setting *storepb.UserSetting
		switch key {
		case storepb.UserSetting_GENERAL:
			v := &storepb.GeneralUserSetting{}
			if err := protojson.Unmarshal([]byte(args.Value), v); err != nil {
				return "", errors.Wrap(err, "invalid GENERAL setting value")
			}
			setting = &storepb.UserSetting{
				UserId: tc.UserID,
				Key:    key,
				Value:  &storepb.UserSetting_General{General: v},
			}
		case storepb.UserSetting_TAGS:
			v := &storepb.TagsUserSetting{}
			if err := protojson.Unmarshal([]byte(args.Value), v); err != nil {
				return "", errors.Wrap(err, "invalid TAGS setting value")
			}
			setting = &storepb.UserSetting{
				UserId: tc.UserID,
				Key:    key,
				Value:  &storepb.UserSetting_Tags{Tags: v},
			}
		default:
			return "", errors.Errorf("unsupported setting key %q", key)
		}
		if _, err := tc.Store.UpsertUserSetting(ctx, setting); err != nil {
			return "", errors.Wrap(err, "failed to upsert user setting")
		}
		return fmt.Sprintf("Updated %s setting for the current user.", key), nil
	}

	return "", errors.Errorf("unsupported action %q", args.Action)
}

func parseUserSettingKey(key string) (storepb.UserSetting_Key, error) {
	switch strings.ToUpper(strings.TrimSpace(key)) {
	case "GENERAL":
		return storepb.UserSetting_GENERAL, nil
	case "TAGS":
		return storepb.UserSetting_TAGS, nil
	default:
		return storepb.UserSetting_GENERAL, errors.Errorf("unsupported setting key %q", key)
	}
}
