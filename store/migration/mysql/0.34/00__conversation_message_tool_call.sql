-- Correlate tool-result messages back to the assistant tool call that produced
-- them so the model can rebuild a valid history on subsequent turns.
ALTER TABLE `conversation_message` ADD COLUMN `tool_call_id` VARCHAR(256) NOT NULL DEFAULT '';
ALTER TABLE `conversation_message` ADD COLUMN `name` VARCHAR(256) NOT NULL DEFAULT '';
