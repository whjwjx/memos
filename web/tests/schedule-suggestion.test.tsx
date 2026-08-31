import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ScheduleSuggestion } from "@/components/MemoEditor/components/ScheduleSuggestion";
import { EditorProvider, useEditorContext } from "@/components/MemoEditor/state";
import { MemoScheduleRecurrence_Frequency } from "@/types/proto/api/v1/memo_service_pb";

vi.mock("@/utils/i18n", () => ({ useTranslate: () => (key: string) => key }));

let api: ReturnType<typeof useEditorContext>;

function Probe() {
  api = useEditorContext();
  return null;
}

function renderSuggestion() {
  return render(
    <EditorProvider>
      <ScheduleSuggestion />
      <Probe />
    </EditorProvider>,
  );
}

describe("ScheduleSuggestion", () => {
  it("detects the same schedule again after the editor is reset", async () => {
    renderSuggestion();

    act(() => {
      api.dispatch(api.actions.updateContent("每天8点吃早饭"));
    });
    await waitFor(() => expect(api.getState().metadata.scheduledTime).toBeDefined());
    expect(api.getState().metadata.scheduledRecurrence?.frequency).toBe(MemoScheduleRecurrence_Frequency.DAILY);

    act(() => {
      api.dispatch(api.actions.reset());
    });
    expect(api.getState().content).toBe("");
    expect(api.getState().metadata.scheduledTime).toBeUndefined();

    act(() => {
      api.dispatch(api.actions.updateContent("每天8点吃早饭"));
    });

    await waitFor(() => expect(api.getState().metadata.scheduledTime).toBeDefined());
    expect(api.getState().metadata.scheduledRecurrence?.frequency).toBe(MemoScheduleRecurrence_Frequency.DAILY);
    expect(screen.getByText("editor.schedule-detected")).toBeInTheDocument();
  });
});
