import { basename } from "node:path";

import type {
  SourceEvent,
  SourceTaskCompletedEvent,
  SourceTaskUpdatedEvent,
} from "@tomismeta/aperture-core";

import type {
  ClaudeCodeCompactTrigger,
  ClaudeCodeConfigChangeEvent,
  ClaudeCodeConfigSource,
  ClaudeCodeCwdChangedEvent,
  ClaudeCodeInstructionsLoadedEvent,
  ClaudeCodeNotificationEvent,
  ClaudeCodePostCompactEvent,
  ClaudeCodePreCompactEvent,
  ClaudeCodeSessionEndEvent,
  ClaudeCodeSessionEndReason,
  ClaudeCodeSessionStartEvent,
  ClaudeCodeSessionStartSource,
  ClaudeCodeStopEvent,
  ClaudeCodeStopFailureEvent,
  ClaudeCodeSubagentStartEvent,
  ClaudeCodeSubagentStopEvent,
  ClaudeCodeTaskCompletedEvent,
  ClaudeCodeTaskCreatedEvent,
  ClaudeCodeTeammateIdleEvent,
  ClaudeCodeUserPromptSubmitEvent,
} from "./mapping.js";
import {
  claudeAgentTaskId,
  claudeEventId,
  claudeSource,
  claudeSubagentTaskId,
  claudeTaskId,
  followUpTaskSemanticHints,
  followUpWhyNow,
  nowIso,
  readString,
} from "./mapping-shared.js";

export function mapSessionStart(event: ClaudeCodeSessionStartEvent): SourceEvent {
  return {
    id: claudeEventId(event, "task.started"),
    type: "task.started",
    taskId: claudeTaskId(event.session_id),
    timestamp: nowIso(),
    source: claudeSource(event),
    semanticHints: sessionStatusSemanticHints(sessionStartWhyNow(event.source)),
    title: sessionStartTitle(event.source),
    summary: sessionStartSummary(event),
  };
}

export function mapInstructionsLoaded(
  event: ClaudeCodeInstructionsLoadedEvent,
): SourceTaskUpdatedEvent {
  return {
    id: claudeEventId(event, "task.updated"),
    type: "task.updated",
    taskId: claudeTaskId(event.session_id),
    timestamp: nowIso(),
    source: claudeSource(event),
    activityClass: "session_status",
    semanticHints: sessionStatusSemanticHints(instructionsLoadedWhyNow(event)),
    title: instructionsLoadedTitle(event),
    summary: instructionsLoadedSummary(event),
    status: "running",
  };
}

export function mapNotification(event: ClaudeCodeNotificationEvent): SourceEvent[] {
  if (
    event.notification_type !== "idle_prompt" &&
    event.notification_type !== "elicitation_dialog"
  ) {
    return [];
  }

  const title =
    event.notification_type === "elicitation_dialog"
      ? "Claude requested input"
      : "Claude is waiting for input";
  const whyNow =
    event.notification_type === "elicitation_dialog"
      ? "Claude surfaced an input dialog and is waiting for operator input."
      : "Claude paused and is waiting for follow-up input before continuing.";

  return [
    {
      id: claudeEventId(event, "task.updated"),
      type: "task.updated",
      taskId: claudeTaskId(event.session_id),
      timestamp: nowIso(),
      source: claudeSource(event),
      activityClass: "follow_up",
      semanticHints: followUpTaskSemanticHints(whyNow),
      title,
      summary: event.title ? `${event.title}: ${event.message}` : event.message,
      status: "blocked",
    },
  ];
}

export function mapSubagentStart(event: ClaudeCodeSubagentStartEvent): SourceEvent {
  return {
    id: claudeEventId(event, "task.started"),
    type: "task.started",
    taskId: claudeSubagentTaskId(event.session_id, event.agent_id),
    timestamp: nowIso(),
    source: claudeSource(event),
    semanticHints: sessionStatusSemanticHints(`Claude started a ${event.agent_type} subagent.`),
    title: `Claude started ${event.agent_type} subagent`,
    summary: subagentStartSummary(event),
  };
}

export function mapSubagentStop(event: ClaudeCodeSubagentStopEvent): SourceEvent[] {
  if (event.stop_hook_now) {
    return [];
  }

  return [
    {
      id: claudeEventId(event, "task.completed"),
      type: "task.completed",
      taskId: claudeSubagentTaskId(event.session_id, event.agent_id),
      timestamp: nowIso(),
      source: claudeSource(event),
      summary: subagentStopSummary(event),
    },
  ];
}

export function mapTaskCreated(event: ClaudeCodeTaskCreatedEvent): SourceEvent {
  return {
    id: claudeEventId(event, "task.started"),
    type: "task.started",
    taskId: claudeAgentTaskId(event.session_id, event.task_id),
    timestamp: nowIso(),
    source: claudeSource(event),
    semanticHints: sessionStatusSemanticHints("Claude created a teammate task."),
    title: event.task_subject,
    summary: taskLifecycleSummary(event, "created"),
  };
}

export function mapTaskCompleted(event: ClaudeCodeTaskCompletedEvent): SourceTaskCompletedEvent {
  return {
    id: claudeEventId(event, "task.completed"),
    type: "task.completed",
    taskId: claudeAgentTaskId(event.session_id, event.task_id),
    timestamp: nowIso(),
    source: claudeSource(event),
    summary: taskLifecycleSummary(event, "completed"),
  };
}

export function mapUserPromptSubmit(
  event: ClaudeCodeUserPromptSubmitEvent,
): SourceTaskCompletedEvent {
  return {
    id: claudeEventId(event, "task.completed"),
    type: "task.completed",
    taskId: claudeTaskId(event.session_id),
    timestamp: nowIso(),
    source: claudeSource(event),
    summary: "Operator replied in Claude Code.",
  };
}

export function mapStopFailure(event: ClaudeCodeStopFailureEvent): SourceTaskUpdatedEvent {
  return {
    id: claudeEventId(event, "task.updated"),
    type: "task.updated",
    taskId: claudeTaskId(event.session_id),
    timestamp: nowIso(),
    source: claudeSource(event),
    activityClass: "session_status",
    semanticHints: sessionStatusSemanticHints(
      "Claude could not finish the turn because the API returned an error.",
    ),
    title: "Claude hit an API error",
    summary: stopFailureSummary(event),
    status: "failed",
  };
}

export function mapTeammateIdle(event: ClaudeCodeTeammateIdleEvent): SourceTaskUpdatedEvent {
  return {
    id: claudeEventId(event, "task.updated"),
    type: "task.updated",
    taskId: claudeTaskId(event.session_id),
    timestamp: nowIso(),
    source: claudeSource(event),
    activityClass: "session_status",
    semanticHints: sessionStatusSemanticHints(
      "A Claude teammate finished its turn and is about to go idle.",
    ),
    title: `${event.teammate_name} teammate is idle`,
    summary: `${event.teammate_name} teammate in team ${event.team_name} is waiting for more work.`,
    status: "waiting",
  };
}

export function mapConfigChange(event: ClaudeCodeConfigChangeEvent): SourceTaskUpdatedEvent {
  return {
    id: claudeEventId(event, "task.updated"),
    type: "task.updated",
    taskId: claudeTaskId(event.session_id),
    timestamp: nowIso(),
    source: claudeSource(event),
    activityClass: "session_status",
    semanticHints: sessionStatusSemanticHints(configChangeWhyNow(event.source)),
    title: configChangeTitle(event.source),
    summary: configChangeSummary(event),
    status: "running",
  };
}

export function mapCwdChanged(event: ClaudeCodeCwdChangedEvent): SourceTaskUpdatedEvent {
  return {
    id: claudeEventId(event, "task.updated"),
    type: "task.updated",
    taskId: claudeTaskId(event.session_id),
    timestamp: nowIso(),
    source: claudeSource(event),
    activityClass: "session_status",
    semanticHints: sessionStatusSemanticHints(
      "Claude changed the working directory during the session.",
    ),
    title: "Claude changed working directory",
    summary: `${event.old_cwd} -> ${event.new_cwd}`,
    status: "running",
  };
}

export function mapPreCompact(event: ClaudeCodePreCompactEvent): SourceTaskUpdatedEvent {
  return {
    id: claudeEventId(event, "task.updated"),
    type: "task.updated",
    taskId: claudeTaskId(event.session_id),
    timestamp: nowIso(),
    source: claudeSource(event),
    activityClass: "session_status",
    semanticHints: sessionStatusSemanticHints(preCompactWhyNow(event.trigger)),
    title: preCompactTitle(event.trigger),
    summary: preCompactSummary(event),
    status: "running",
  };
}

export function mapPostCompact(event: ClaudeCodePostCompactEvent): SourceTaskUpdatedEvent {
  return {
    id: claudeEventId(event, "task.updated"),
    type: "task.updated",
    taskId: claudeTaskId(event.session_id),
    timestamp: nowIso(),
    source: claudeSource(event),
    activityClass: "session_status",
    semanticHints: sessionStatusSemanticHints(postCompactWhyNow(event.trigger)),
    title: postCompactTitle(event.trigger),
    summary: postCompactSummary(event),
    status: "running",
  };
}

export function mapSessionEnd(event: ClaudeCodeSessionEndEvent): SourceTaskCompletedEvent {
  return {
    id: claudeEventId(event, "task.completed"),
    type: "task.completed",
    taskId: claudeTaskId(event.session_id),
    timestamp: nowIso(),
    source: claudeSource(event),
    summary: sessionEndSummary(event.reason),
  };
}

export function mapStop(event: ClaudeCodeStopEvent): SourceEvent[] {
  if (event.stop_hook_now) {
    return [];
  }

  const message = stopSummary(event);
  if (message && looksLikeFollowUpQuestion(message)) {
    const whyNow = followUpWhyNow("Claude");
    return [
      {
        id: claudeEventId(event, "task.updated"),
        type: "task.updated",
        taskId: claudeTaskId(event.session_id),
        timestamp: nowIso(),
        source: claudeSource(event),
        activityClass: "follow_up",
        semanticHints: followUpTaskSemanticHints(whyNow),
        title: "Claude is waiting for follow-up",
        summary: message,
        status: "blocked",
      },
    ];
  }

  return [
    {
      id: claudeEventId(event, "task.updated"),
      type: "task.updated",
      taskId: claudeTaskId(event.session_id),
      timestamp: nowIso(),
      source: claudeSource(event),
      activityClass: "status_update",
      title: "Claude completed a turn",
      summary: message ?? "Claude finished responding.",
      status: "running",
    },
  ];
}

function sessionStatusSemanticHints(
  whyNow: string,
): NonNullable<SourceTaskUpdatedEvent["semanticHints"]> {
  return {
    activityClass: "session_status",
    whyNow,
    confidence: "high",
  };
}

function sessionStartTitle(source: ClaudeCodeSessionStartSource): string {
  switch (source) {
    case "startup":
      return "Claude Code session started";
    case "resume":
      return "Claude Code session resumed";
    case "clear":
      return "Claude Code session cleared";
    case "compact":
      return "Claude Code session resumed after compaction";
  }
}

function sessionStartWhyNow(source: ClaudeCodeSessionStartSource): string {
  switch (source) {
    case "startup":
      return "Claude started a new session.";
    case "resume":
      return "Claude resumed an existing session.";
    case "clear":
      return "Claude cleared the current session and is ready to continue.";
    case "compact":
      return "Claude resumed after a compaction cycle.";
  }
}

function sessionStartSummary(event: ClaudeCodeSessionStartEvent): string {
  const details = [`model ${event.model}`];
  if (event.agent_type) {
    details.push(`agent ${event.agent_type}`);
  }

  return `${sessionStartTitle(event.source)} with ${details.join(", ")}.`;
}

function instructionsLoadedTitle(event: ClaudeCodeInstructionsLoadedEvent): string {
  return `Claude loaded ${event.memory_type.toLowerCase()} instructions`;
}

function instructionsLoadedWhyNow(event: ClaudeCodeInstructionsLoadedEvent): string {
  switch (event.load_reason) {
    case "session_start":
      return "Claude loaded instructions while starting the session.";
    case "nested_traversal":
      return "Claude loaded nested instructions after traversing into a deeper directory.";
    case "path_glob_match":
      return "Claude loaded path-scoped instructions because a matching file came into scope.";
    case "include":
      return "Claude loaded included instructions from another rules file.";
    case "compact":
      return "Claude reloaded instructions after compaction.";
  }
}

function instructionsLoadedSummary(event: ClaudeCodeInstructionsLoadedEvent): string {
  const details = [basename(event.file_path), `reason ${event.load_reason.replace(/_/g, " ")}`];
  if (event.trigger_file_path) {
    details.push(`trigger ${basename(event.trigger_file_path)}`);
  }
  if (event.parent_file_path) {
    details.push(`parent ${basename(event.parent_file_path)}`);
  }
  if (event.globs?.length) {
    details.push(`globs ${event.globs.join(", ")}`);
  }

  return details.join(" · ");
}

function subagentStopSummary(event: ClaudeCodeSubagentStopEvent): string {
  const direct = readString(event.last_assistant_message);
  if (direct) {
    const firstLine = direct
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    if (firstLine) {
      return `${event.agent_type} subagent ${event.agent_id} finished: ${firstLine}`;
    }
  }

  const transcriptName = event.agent_transcript_path
    ? basename(event.agent_transcript_path)
    : null;
  return transcriptName
    ? `${event.agent_type} subagent ${event.agent_id} finished. Transcript: ${transcriptName}.`
    : `${event.agent_type} subagent ${event.agent_id} finished.`;
}

function subagentStartSummary(event: ClaudeCodeSubagentStartEvent): string {
  return `${event.agent_type} subagent ${event.agent_id} is now running.`;
}

function stopFailureSummary(event: ClaudeCodeStopFailureEvent): string {
  return (
    readString(event.last_assistant_message) ??
    readString(event.error_details) ??
    `Claude Code API error: ${event.error}.`
  );
}

function configChangeTitle(source: ClaudeCodeConfigSource): string {
  switch (source) {
    case "user_settings":
      return "Claude user settings changed";
    case "project_settings":
      return "Claude project settings changed";
    case "local_settings":
      return "Claude local settings changed";
    case "policy_settings":
      return "Claude managed policy changed";
    case "skills":
      return "Claude skills changed";
  }
}

function configChangeWhyNow(source: ClaudeCodeConfigSource): string {
  switch (source) {
    case "user_settings":
      return "Claude detected a change to user settings during the session.";
    case "project_settings":
      return "Claude detected a change to project settings during the session.";
    case "local_settings":
      return "Claude detected a change to local project settings during the session.";
    case "policy_settings":
      return "Claude detected a managed policy change during the session.";
    case "skills":
      return "Claude detected a skill change during the session.";
  }
}

function configChangeSummary(event: ClaudeCodeConfigChangeEvent): string {
  if (event.file_path) {
    return `${configChangeLabel(event.source)} changed: ${basename(event.file_path)}.`;
  }

  return `${configChangeLabel(event.source)} changed.`;
}

function configChangeLabel(source: ClaudeCodeConfigSource): string {
  switch (source) {
    case "user_settings":
      return "User settings";
    case "project_settings":
      return "Project settings";
    case "local_settings":
      return "Local settings";
    case "policy_settings":
      return "Managed policy";
    case "skills":
      return "Skills";
  }
}

function preCompactTitle(trigger: ClaudeCodeCompactTrigger): string {
  return trigger === "manual"
    ? "Claude is compacting the session"
    : "Claude is auto-compacting the session";
}

function preCompactWhyNow(trigger: ClaudeCodeCompactTrigger): string {
  return trigger === "manual"
    ? "Claude is starting a manual compaction cycle."
    : "Claude is compacting because the context window is full.";
}

function preCompactSummary(event: ClaudeCodePreCompactEvent): string {
  const instructions = readString(event.custom_instructions);
  if (!instructions) {
    return event.trigger === "manual"
      ? "Manual compaction started."
      : "Automatic compaction started because the context window is full.";
  }

  const firstLine = instructions
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return firstLine ? `Manual compaction instructions: ${firstLine}` : "Manual compaction started.";
}

function postCompactTitle(trigger: ClaudeCodeCompactTrigger): string {
  return trigger === "manual"
    ? "Claude compacted the session"
    : "Claude auto-compacted the session";
}

function postCompactWhyNow(trigger: ClaudeCodeCompactTrigger): string {
  return trigger === "manual"
    ? "Claude finished a manual compaction cycle."
    : "Claude finished an automatic compaction cycle.";
}

function postCompactSummary(event: ClaudeCodePostCompactEvent): string {
  const summary = readString(event.compact_summary);
  if (!summary) {
    return event.trigger === "manual"
      ? "Manual compaction finished."
      : "Automatic compaction finished.";
  }

  const firstLine = summary
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return firstLine ?? summary;
}

function sessionEndSummary(reason: ClaudeCodeSessionEndReason): string {
  switch (reason) {
    case "clear":
      return "Claude Code session ended after /clear.";
    case "resume":
      return "Claude Code session ended because another session was resumed.";
    case "logout":
      return "Claude Code session ended after logout.";
    case "prompt_input_exit":
      return "Claude Code session ended while prompt input was open.";
    case "bypass_permissions_disabled":
      return "Claude Code session ended after bypass permissions mode was disabled.";
    case "other":
      return "Claude Code session ended.";
  }
}

function taskLifecycleSummary(
  event: ClaudeCodeTaskCreatedEvent | ClaudeCodeTaskCompletedEvent,
  action: "created" | "completed",
): string {
  const details: string[] = [];
  if (event.task_description) {
    details.push(event.task_description);
  }
  if (event.teammate_name) {
    details.push(`${event.teammate_name} teammate`);
  }
  if (event.team_name) {
    details.push(`team ${event.team_name}`);
  }

  if (details.length === 0) {
    return `Task ${action}: ${event.task_subject}.`;
  }

  return `Task ${action}: ${event.task_subject}. ${details.join(" · ")}.`;
}

function stopSummary(event: ClaudeCodeStopEvent): string | undefined {
  const direct = readString(event.last_assistant_message) ?? readString(event.message);
  if (direct) {
    const firstLine = direct
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    return firstLine ?? "Claude finished responding.";
  }

  if (event.stop_reason === "end_turn") {
    return "Claude finished responding.";
  }

  return undefined;
}

function looksLikeFollowUpQuestion(value: string): boolean {
  const lines = value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const lastLine = lines.at(-1) ?? value.trim();
  const normalized = lastLine.replace(/[\s)\]}'"”]+$/, "");
  return /\?$/.test(normalized);
}
