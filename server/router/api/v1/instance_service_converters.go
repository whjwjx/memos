package v1

import (
	"fmt"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
)

func convertInstanceSettingFromStore(setting *storepb.InstanceSetting) *v1pb.InstanceSetting {
	instanceSetting := &v1pb.InstanceSetting{
		Name: fmt.Sprintf("instance/settings/%s", setting.Key.String()),
	}
	switch setting.Value.(type) {
	case *storepb.InstanceSetting_GeneralSetting:
		instanceSetting.Value = &v1pb.InstanceSetting_GeneralSetting_{
			GeneralSetting: convertInstanceGeneralSettingFromStore(setting.GetGeneralSetting()),
		}
	case *storepb.InstanceSetting_StorageSetting:
		instanceSetting.Value = &v1pb.InstanceSetting_StorageSetting_{
			StorageSetting: convertInstanceStorageSettingFromStore(setting.GetStorageSetting()),
		}
	case *storepb.InstanceSetting_MemoRelatedSetting:
		instanceSetting.Value = &v1pb.InstanceSetting_MemoRelatedSetting_{
			MemoRelatedSetting: convertInstanceMemoRelatedSettingFromStore(setting.GetMemoRelatedSetting()),
		}
	case *storepb.InstanceSetting_TagsSetting:
		instanceSetting.Value = &v1pb.InstanceSetting_TagsSetting_{
			TagsSetting: convertInstanceTagsSettingFromStore(setting.GetTagsSetting()),
		}
	case *storepb.InstanceSetting_NotificationSetting:
		instanceSetting.Value = &v1pb.InstanceSetting_NotificationSetting_{
			NotificationSetting: convertInstanceNotificationSettingFromStore(setting.GetNotificationSetting()),
		}
	case *storepb.InstanceSetting_AiSetting:
		instanceSetting.Value = &v1pb.InstanceSetting_AiSetting{
			AiSetting: convertInstanceAISettingFromStore(setting.GetAiSetting()),
		}
	case *storepb.InstanceSetting_LogSetting:
		instanceSetting.Value = &v1pb.InstanceSetting_LogSetting{
			LogSetting: convertInstanceLogSettingFromStore(setting.GetLogSetting()),
		}
	default:
		// Leave Value unset for unsupported setting variants.
	}
	return instanceSetting
}

func convertInstanceSettingToStore(setting *v1pb.InstanceSetting) *storepb.InstanceSetting {
	settingKeyString, _ := ExtractInstanceSettingKeyFromName(setting.Name)
	instanceSetting := &storepb.InstanceSetting{
		Key: storepb.InstanceSettingKey(storepb.InstanceSettingKey_value[settingKeyString]),
		Value: &storepb.InstanceSetting_GeneralSetting{
			GeneralSetting: convertInstanceGeneralSettingToStore(setting.GetGeneralSetting()),
		},
	}
	switch instanceSetting.Key {
	case storepb.InstanceSettingKey_GENERAL:
		instanceSetting.Value = &storepb.InstanceSetting_GeneralSetting{
			GeneralSetting: convertInstanceGeneralSettingToStore(setting.GetGeneralSetting()),
		}
	case storepb.InstanceSettingKey_STORAGE:
		instanceSetting.Value = &storepb.InstanceSetting_StorageSetting{
			StorageSetting: convertInstanceStorageSettingToStore(setting.GetStorageSetting()),
		}
	case storepb.InstanceSettingKey_MEMO_RELATED:
		instanceSetting.Value = &storepb.InstanceSetting_MemoRelatedSetting{
			MemoRelatedSetting: convertInstanceMemoRelatedSettingToStore(setting.GetMemoRelatedSetting()),
		}
	case storepb.InstanceSettingKey_TAGS:
		instanceSetting.Value = &storepb.InstanceSetting_TagsSetting{
			TagsSetting: convertInstanceTagsSettingToStore(setting.GetTagsSetting()),
		}
	case storepb.InstanceSettingKey_NOTIFICATION:
		instanceSetting.Value = &storepb.InstanceSetting_NotificationSetting{
			NotificationSetting: convertInstanceNotificationSettingToStore(setting.GetNotificationSetting()),
		}
	case storepb.InstanceSettingKey_AI:
		instanceSetting.Value = &storepb.InstanceSetting_AiSetting{
			AiSetting: convertInstanceAISettingToStore(setting.GetAiSetting()),
		}
	case storepb.InstanceSettingKey_LOG:
		instanceSetting.Value = &storepb.InstanceSetting_LogSetting{
			LogSetting: convertInstanceLogSettingToStore(setting.GetLogSetting()),
		}
	default:
		// Keep the default GeneralSetting value
	}
	return instanceSetting
}

func convertInstanceLogSettingFromStore(setting *storepb.InstanceLogSetting) *v1pb.LogSetting {
	if setting == nil {
		return nil
	}
	return &v1pb.LogSetting{
		Enabled:       setting.Enabled,
		RetentionDays: setting.RetentionDays,
	}
}

func convertInstanceLogSettingToStore(setting *v1pb.LogSetting) *storepb.InstanceLogSetting {
	if setting == nil {
		return nil
	}
	return &storepb.InstanceLogSetting{
		Enabled:       setting.Enabled,
		RetentionDays: setting.RetentionDays,
	}
}

func convertInstanceGeneralSettingFromStore(setting *storepb.InstanceGeneralSetting) *v1pb.InstanceSetting_GeneralSetting {
	if setting == nil {
		return nil
	}

	generalSetting := &v1pb.InstanceSetting_GeneralSetting{
		DisallowUserRegistration: setting.DisallowUserRegistration,
		DisallowPasswordAuth:     setting.DisallowPasswordAuth,
		AdditionalScript:         setting.AdditionalScript,
		AdditionalStyle:          setting.AdditionalStyle,
		WeekStartDayOffset:       setting.WeekStartDayOffset,
		DisallowChangeUsername:   setting.DisallowChangeUsername,
		DisallowChangeNickname:   setting.DisallowChangeNickname,
	}
	if setting.CustomProfile != nil {
		generalSetting.CustomProfile = &v1pb.InstanceSetting_GeneralSetting_CustomProfile{
			Title:       setting.CustomProfile.Title,
			Description: setting.CustomProfile.Description,
			LogoUrl:     setting.CustomProfile.LogoUrl,
		}
	}
	return generalSetting
}

func convertInstanceGeneralSettingToStore(setting *v1pb.InstanceSetting_GeneralSetting) *storepb.InstanceGeneralSetting {
	if setting == nil {
		return nil
	}
	generalSetting := &storepb.InstanceGeneralSetting{
		DisallowUserRegistration: setting.DisallowUserRegistration,
		DisallowPasswordAuth:     setting.DisallowPasswordAuth,
		AdditionalScript:         setting.AdditionalScript,
		AdditionalStyle:          setting.AdditionalStyle,
		WeekStartDayOffset:       setting.WeekStartDayOffset,
		DisallowChangeUsername:   setting.DisallowChangeUsername,
		DisallowChangeNickname:   setting.DisallowChangeNickname,
	}
	if setting.CustomProfile != nil {
		generalSetting.CustomProfile = &storepb.InstanceCustomProfile{
			Title:       setting.CustomProfile.Title,
			Description: setting.CustomProfile.Description,
			LogoUrl:     setting.CustomProfile.LogoUrl,
		}
	}
	return generalSetting
}

func convertInstanceStorageSettingFromStore(settingpb *storepb.InstanceStorageSetting) *v1pb.InstanceSetting_StorageSetting {
	if settingpb == nil {
		return nil
	}
	setting := &v1pb.InstanceSetting_StorageSetting{
		StorageType:       v1pb.InstanceSetting_StorageSetting_StorageType(settingpb.StorageType),
		FilepathTemplate:  settingpb.FilepathTemplate,
		UploadSizeLimitMb: settingpb.UploadSizeLimitMb,
		DefaultStorageId:  settingpb.DefaultStorageId,
	}
	for _, storagepb := range settingpb.Storages {
		setting.Storages = append(setting.Storages, convertStorageFromStore(storagepb))
	}
	if settingpb.S3Config != nil {
		setting.S3Config = &v1pb.InstanceSetting_StorageSetting_S3Config{
			AccessKeyId: settingpb.S3Config.AccessKeyId,
			// AccessKeySecret is write-only: never returned in responses.
			Endpoint:              settingpb.S3Config.Endpoint,
			Region:                settingpb.S3Config.Region,
			Bucket:                settingpb.S3Config.Bucket,
			UsePathStyle:          settingpb.S3Config.UsePathStyle,
			InsecureSkipTlsVerify: settingpb.S3Config.InsecureSkipTlsVerify,
		}
	}
	return setting
}

func convertInstanceStorageSettingToStore(setting *v1pb.InstanceSetting_StorageSetting) *storepb.InstanceStorageSetting {
	if setting == nil {
		return nil
	}
	settingpb := &storepb.InstanceStorageSetting{
		StorageType:       storepb.InstanceStorageSetting_StorageType(setting.StorageType),
		FilepathTemplate:  setting.FilepathTemplate,
		UploadSizeLimitMb: setting.UploadSizeLimitMb,
		DefaultStorageId:  setting.DefaultStorageId,
	}
	for _, storage := range setting.Storages {
		settingpb.Storages = append(settingpb.Storages, convertStorageToStore(storage))
	}
	if setting.S3Config != nil {
		settingpb.S3Config = &storepb.StorageS3Config{
			AccessKeyId:           setting.S3Config.AccessKeyId,
			AccessKeySecret:       setting.S3Config.AccessKeySecret,
			Endpoint:              setting.S3Config.Endpoint,
			Region:                setting.S3Config.Region,
			Bucket:                setting.S3Config.Bucket,
			UsePathStyle:          setting.S3Config.UsePathStyle,
			InsecureSkipTlsVerify: setting.S3Config.InsecureSkipTlsVerify,
		}
	}
	return settingpb
}

func convertStorageFromStore(storagepb *storepb.Storage) *v1pb.InstanceSetting_Storage {
	if storagepb == nil {
		return nil
	}
	storage := &v1pb.InstanceSetting_Storage{
		Id:   storagepb.Id,
		Name: storagepb.Name,
		Type: v1pb.InstanceSetting_StorageType(storagepb.Type),
	}
	if s3Config := storagepb.GetS3Config(); s3Config != nil {
		storage.Config = &v1pb.InstanceSetting_Storage_S3Config_{
			S3Config: &v1pb.InstanceSetting_Storage_S3Config{
				AccessKeyId: s3Config.AccessKeyId,
				// AccessKeySecret is write-only: never returned in responses.
				Endpoint:              s3Config.Endpoint,
				Region:                s3Config.Region,
				Bucket:                s3Config.Bucket,
				UsePathStyle:          s3Config.UsePathStyle,
				InsecureSkipTlsVerify: s3Config.InsecureSkipTlsVerify,
			},
		}
	}
	return storage
}

func convertStorageToStore(storage *v1pb.InstanceSetting_Storage) *storepb.Storage {
	if storage == nil {
		return nil
	}
	storagepb := &storepb.Storage{
		Id:   storage.Id,
		Name: storage.Name,
		Type: storepb.StorageType(storage.Type),
	}
	if s3Config := storage.GetS3Config(); s3Config != nil {
		storagepb.Config = &storepb.Storage_S3Config{
			S3Config: &storepb.StorageS3Config{
				AccessKeyId:           s3Config.AccessKeyId,
				AccessKeySecret:       s3Config.AccessKeySecret,
				Endpoint:              s3Config.Endpoint,
				Region:                s3Config.Region,
				Bucket:                s3Config.Bucket,
				UsePathStyle:          s3Config.UsePathStyle,
				InsecureSkipTlsVerify: s3Config.InsecureSkipTlsVerify,
			},
		}
	}
	return storagepb
}

func convertInstanceMemoRelatedSettingFromStore(setting *storepb.InstanceMemoRelatedSetting) *v1pb.InstanceSetting_MemoRelatedSetting {
	if setting == nil {
		return nil
	}
	return &v1pb.InstanceSetting_MemoRelatedSetting{
		ContentLengthLimit:    setting.ContentLengthLimit,
		EnableDoubleClickEdit: setting.EnableDoubleClickEdit,
		Reactions:             setting.Reactions,
	}
}

func convertInstanceMemoRelatedSettingToStore(setting *v1pb.InstanceSetting_MemoRelatedSetting) *storepb.InstanceMemoRelatedSetting {
	if setting == nil {
		return nil
	}
	return &storepb.InstanceMemoRelatedSetting{
		ContentLengthLimit:    setting.ContentLengthLimit,
		EnableDoubleClickEdit: setting.EnableDoubleClickEdit,
		Reactions:             setting.Reactions,
	}
}

func convertInstanceTagsSettingFromStore(setting *storepb.InstanceTagsSetting) *v1pb.InstanceSetting_TagsSetting {
	if setting == nil {
		return nil
	}
	tags := make(map[string]*v1pb.InstanceSetting_TagMetadata, len(setting.Tags))
	for tag, metadata := range setting.Tags {
		tags[tag] = &v1pb.InstanceSetting_TagMetadata{
			BackgroundColor: metadata.GetBackgroundColor(),
			BlurContent:     metadata.GetBlurContent(),
		}
	}
	return &v1pb.InstanceSetting_TagsSetting{
		Tags: tags,
	}
}

func convertInstanceTagsSettingToStore(setting *v1pb.InstanceSetting_TagsSetting) *storepb.InstanceTagsSetting {
	if setting == nil {
		return nil
	}
	tags := make(map[string]*storepb.InstanceTagMetadata, len(setting.Tags))
	for tag, metadata := range setting.Tags {
		tags[tag] = &storepb.InstanceTagMetadata{
			BackgroundColor: metadata.GetBackgroundColor(),
			BlurContent:     metadata.GetBlurContent(),
		}
	}
	return &storepb.InstanceTagsSetting{
		Tags: tags,
	}
}

func convertInstanceNotificationSettingFromStore(setting *storepb.InstanceNotificationSetting) *v1pb.InstanceSetting_NotificationSetting {
	if setting == nil {
		return nil
	}

	notificationSetting := &v1pb.InstanceSetting_NotificationSetting{}
	if setting.Email != nil {
		notificationSetting.Email = &v1pb.InstanceSetting_NotificationSetting_EmailSetting{
			Enabled:      setting.Email.Enabled,
			SmtpHost:     setting.Email.SmtpHost,
			SmtpPort:     setting.Email.SmtpPort,
			SmtpUsername: setting.Email.SmtpUsername,
			// SmtpPassword is write-only: never returned in responses.
			FromEmail: setting.Email.FromEmail,
			FromName:  setting.Email.FromName,
			ReplyTo:   setting.Email.ReplyTo,
			UseTls:    setting.Email.UseTls,
			UseSsl:    setting.Email.UseSsl,
		}
	}
	return notificationSetting
}

func convertInstanceNotificationSettingToStore(setting *v1pb.InstanceSetting_NotificationSetting) *storepb.InstanceNotificationSetting {
	if setting == nil {
		return nil
	}

	notificationSetting := &storepb.InstanceNotificationSetting{}
	if setting.Email != nil {
		notificationSetting.Email = &storepb.InstanceNotificationSetting_EmailSetting{
			Enabled:      setting.Email.Enabled,
			SmtpHost:     setting.Email.SmtpHost,
			SmtpPort:     setting.Email.SmtpPort,
			SmtpUsername: setting.Email.SmtpUsername,
			SmtpPassword: setting.Email.SmtpPassword,
			FromEmail:    setting.Email.FromEmail,
			FromName:     setting.Email.FromName,
			ReplyTo:      setting.Email.ReplyTo,
			UseTls:       setting.Email.UseTls,
			UseSsl:       setting.Email.UseSsl,
		}
	}
	return notificationSetting
}

func convertInstanceAISettingFromStore(setting *storepb.InstanceAISetting) *v1pb.InstanceSetting_AISetting {
	if setting == nil {
		return nil
	}

	aiSetting := &v1pb.InstanceSetting_AISetting{
		Providers:     make([]*v1pb.InstanceSetting_AIProviderConfig, 0, len(setting.Providers)),
		Transcription: convertTranscriptionConfigFromStore(setting.GetTranscription()),
		Agents:        make([]*v1pb.InstanceSetting_AgentConfig, 0, len(setting.GetAgents())),
		Taggers:       make([]*v1pb.InstanceSetting_TaggerConfig, 0, len(setting.GetTaggers())),
		ChatAgents:    make([]*v1pb.InstanceSetting_ChatAgentConfig, 0, len(setting.GetChatAgents())),
		Tools:         make(map[string]*v1pb.InstanceSetting_ToolConfig, len(setting.GetTools())),
		Memory:        convertMemoryConfigFromStore(setting.GetMemory()),
	}
	for _, provider := range setting.Providers {
		if provider == nil {
			continue
		}
		apiKey := provider.GetApiKey()
		aiSetting.Providers = append(aiSetting.Providers, &v1pb.InstanceSetting_AIProviderConfig{
			Id:         provider.GetId(),
			Title:      provider.GetTitle(),
			Type:       v1pb.InstanceSetting_AIProviderType(provider.GetType()),
			Endpoint:   provider.GetEndpoint(),
			ApiKeySet:  apiKey != "",
			ApiKeyHint: maskAPIKey(apiKey),
		})
	}
	for _, agent := range setting.GetAgents() {
		if agent == nil {
			continue
		}
		aiSetting.Agents = append(aiSetting.Agents, &v1pb.InstanceSetting_AgentConfig{
			Id:            agent.GetId(),
			Name:          agent.GetName(),
			ProviderId:    agent.GetProviderId(),
			Model:         agent.GetModel(),
			PersonaPrompt: agent.GetPersonaPrompt(),
			SystemPrompt:  agent.GetSystemPrompt(),
			Enabled:       agent.GetEnabled(),
			DelayMinutes:  agent.GetDelayMinutes(),
			MaxLength:     agent.GetMaxLength(),
		})
	}
	for _, tagger := range setting.GetTaggers() {
		if tagger == nil {
			continue
		}
		aiSetting.Taggers = append(aiSetting.Taggers, &v1pb.InstanceSetting_TaggerConfig{
			Id:         tagger.GetId(),
			Name:       tagger.GetName(),
			ProviderId: tagger.GetProviderId(),
			Model:      tagger.GetModel(),
			Prompt:     tagger.GetPrompt(),
			Enabled:    tagger.GetEnabled(),
			MaxTags:    tagger.GetMaxTags(),
		})
	}
	for _, chatAgent := range setting.GetChatAgents() {
		if chatAgent == nil {
			continue
		}
		aiSetting.ChatAgents = append(aiSetting.ChatAgents, &v1pb.InstanceSetting_ChatAgentConfig{
			Id:           chatAgent.GetId(),
			Name:         chatAgent.GetName(),
			Builtin:      chatAgent.GetBuiltin(),
			ProviderId:   chatAgent.GetProviderId(),
			Model:        chatAgent.GetModel(),
			SystemPrompt: chatAgent.GetSystemPrompt(),
			Enabled:      chatAgent.GetEnabled(),
		})
	}
	for name, tool := range setting.GetTools() {
		if tool == nil {
			continue
		}
		aiSetting.Tools[name] = &v1pb.InstanceSetting_ToolConfig{
			Enabled:              tool.GetEnabled(),
			RequiresConfirmation: tool.GetRequiresConfirmation(),
		}
	}
	return aiSetting
}

func convertInstanceAISettingToStore(setting *v1pb.InstanceSetting_AISetting) *storepb.InstanceAISetting {
	if setting == nil {
		return nil
	}

	aiSetting := &storepb.InstanceAISetting{
		Providers:     make([]*storepb.AIProviderConfig, 0, len(setting.Providers)),
		Transcription: convertTranscriptionConfigToStore(setting.GetTranscription()),
		Agents:        make([]*storepb.AIAgentConfig, 0, len(setting.GetAgents())),
		Taggers:       make([]*storepb.TaggerConfig, 0, len(setting.GetTaggers())),
		ChatAgents:    make([]*storepb.ChatAgentConfig, 0, len(setting.GetChatAgents())),
		Tools:         make(map[string]*storepb.ToolConfig, len(setting.GetTools())),
		Memory:        convertMemoryConfigToStore(setting.GetMemory()),
	}
	for _, provider := range setting.Providers {
		if provider == nil {
			continue
		}
		aiSetting.Providers = append(aiSetting.Providers, &storepb.AIProviderConfig{
			Id:       provider.GetId(),
			Title:    provider.GetTitle(),
			Type:     storepb.AIProviderType(provider.GetType()),
			Endpoint: provider.GetEndpoint(),
			ApiKey:   provider.GetApiKey(),
		})
	}
	for _, agent := range setting.GetAgents() {
		if agent == nil {
			continue
		}
		aiSetting.Agents = append(aiSetting.Agents, &storepb.AIAgentConfig{
			Id:            agent.GetId(),
			Name:          agent.GetName(),
			ProviderId:    agent.GetProviderId(),
			Model:         agent.GetModel(),
			PersonaPrompt: agent.GetPersonaPrompt(),
			SystemPrompt:  agent.GetSystemPrompt(),
			Enabled:       agent.GetEnabled(),
			DelayMinutes:  agent.GetDelayMinutes(),
			MaxLength:     agent.GetMaxLength(),
		})
	}
	for _, tagger := range setting.GetTaggers() {
		if tagger == nil {
			continue
		}
		aiSetting.Taggers = append(aiSetting.Taggers, &storepb.TaggerConfig{
			Id:         tagger.GetId(),
			Name:       tagger.GetName(),
			ProviderId: tagger.GetProviderId(),
			Model:      tagger.GetModel(),
			Prompt:     tagger.GetPrompt(),
			Enabled:    tagger.GetEnabled(),
			MaxTags:    tagger.GetMaxTags(),
		})
	}
	for _, chatAgent := range setting.GetChatAgents() {
		if chatAgent == nil {
			continue
		}
		aiSetting.ChatAgents = append(aiSetting.ChatAgents, &storepb.ChatAgentConfig{
			Id:           chatAgent.GetId(),
			Name:         chatAgent.GetName(),
			Builtin:      chatAgent.GetBuiltin(),
			ProviderId:   chatAgent.GetProviderId(),
			Model:        chatAgent.GetModel(),
			SystemPrompt: chatAgent.GetSystemPrompt(),
			Enabled:      chatAgent.GetEnabled(),
		})
	}
	for name, tool := range setting.GetTools() {
		if tool == nil {
			continue
		}
		aiSetting.Tools[name] = &storepb.ToolConfig{
			Enabled:              tool.GetEnabled(),
			RequiresConfirmation: tool.GetRequiresConfirmation(),
		}
	}
	return aiSetting
}

func convertMemoryConfigFromStore(config *storepb.MemoryConfig) *v1pb.InstanceSetting_MemoryConfig {
	if config == nil {
		return nil
	}
	memory := &v1pb.InstanceSetting_MemoryConfig{
		Enabled: config.GetEnabled(),
		Entries: make([]*v1pb.InstanceSetting_MemoryEntry, 0, len(config.GetEntries())),
	}
	for _, entry := range config.GetEntries() {
		if entry == nil {
			continue
		}
		memory.Entries = append(memory.Entries, &v1pb.InstanceSetting_MemoryEntry{
			Id:        entry.GetId(),
			Content:   entry.GetContent(),
			CreatedBy: entry.GetCreatedBy(),
			CreatedTs: entry.GetCreatedTs(),
			UpdatedTs: entry.GetUpdatedTs(),
		})
	}
	return memory
}

func convertMemoryConfigToStore(config *v1pb.InstanceSetting_MemoryConfig) *storepb.MemoryConfig {
	if config == nil {
		return nil
	}
	memory := &storepb.MemoryConfig{
		Enabled: config.GetEnabled(),
		Entries: make([]*storepb.MemoryEntry, 0, len(config.GetEntries())),
	}
	for _, entry := range config.GetEntries() {
		if entry == nil {
			continue
		}
		memory.Entries = append(memory.Entries, &storepb.MemoryEntry{
			Id:        entry.GetId(),
			Content:   entry.GetContent(),
			CreatedBy: entry.GetCreatedBy(),
			CreatedTs: entry.GetCreatedTs(),
			UpdatedTs: entry.GetUpdatedTs(),
		})
	}
	return memory
}

func convertTranscriptionConfigFromStore(setting *storepb.TranscriptionConfig) *v1pb.InstanceSetting_TranscriptionConfig {
	if setting == nil {
		return nil
	}
	return &v1pb.InstanceSetting_TranscriptionConfig{
		ProviderId: setting.GetProviderId(),
		Model:      setting.GetModel(),
		Language:   setting.GetLanguage(),
		Prompt:     setting.GetPrompt(),
	}
}

func convertTranscriptionConfigToStore(setting *v1pb.InstanceSetting_TranscriptionConfig) *storepb.TranscriptionConfig {
	if setting == nil {
		return nil
	}
	return &storepb.TranscriptionConfig{
		ProviderId: setting.GetProviderId(),
		Model:      setting.GetModel(),
		Language:   setting.GetLanguage(),
		Prompt:     setting.GetPrompt(),
	}
}
