export type FrameResponse = {
  taskId: string;
  interactionId: string;
  response:
    | { kind: "approved"; reason?: string }
    | { kind: "rejected"; reason?: string }
    | { kind: "option_selected"; optionIds: string[] }
    | { kind: "form_submitted"; values: Record<string, unknown> }
    | { kind: "dismissed" };
};
