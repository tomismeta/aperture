import "./styles.css";
import { ApertureCore, scoreFrame, } from "@aperture/core";
import { mapCodexServerRequest } from "@aperture/codex";
import { mapPaperclipLiveEvent } from "@aperture/paperclip";
const app = document.querySelector("#app");
if (!app) {
    throw new Error("Missing app container");
}
const appRoot = app;
const replayDurationMs = 120_000;
const tickIntervalMs = 200;
let intervalId = null;
let state = createReplayState();
render();
start();
function createReplayState() {
    const core = new ApertureCore();
    let ready = false;
    const nextState = {
        core,
        events: buildScheduledEvents(),
        attentionView: core.getAttentionView(),
        traces: [],
        publishedEvents: [],
        currentTimeMs: 0,
        cursor: 0,
        playing: false,
        speed: 20,
        selection: {},
        values: {},
    };
    core.subscribeAttentionView((attentionView) => {
        nextState.attentionView = attentionView;
        if (ready) {
            render();
        }
    });
    core.onTrace((trace) => {
        nextState.traces = [trace, ...nextState.traces].slice(0, 18);
        if (ready) {
            render();
        }
    });
    ready = true;
    return nextState;
}
function buildScheduledEvents() {
    const base = Date.parse("2026-03-09T12:00:00.000Z");
    const scheduled = [];
    pushPaperclip(scheduled, 0, "Paperclip approval.created", {
        id: 1,
        companyId: "company:paperclip",
        type: "activity.logged",
        createdAt: new Date(base).toISOString(),
        payload: {
            entityType: "approval",
            entityId: "approval:hire:17",
            action: "approval.created",
            details: {
                type: "hire_agent",
                requestedByAgentId: "agent:paperclip:ceo",
                issueIds: ["ISS-17"],
            },
        },
    });
    pushPaperclip(scheduled, 20_000, "Paperclip run.status failed", {
        id: 2,
        companyId: "company:paperclip",
        type: "heartbeat.run.status",
        createdAt: new Date(base + 20_000).toISOString(),
        payload: {
            runId: "run:paperclip:1",
            agentId: "agent:paperclip:dev",
            status: "failed",
            error: "Migration failed in staging",
        },
    });
    pushCodex(scheduled, 35_000, "Codex requestUserInput choice", {
        id: "req-choice",
        method: "item/tool/requestUserInput",
        params: {
            itemId: "item:choice:1",
            threadId: "thread:codex:1",
            turnId: "turn:codex:1",
            questions: [
                {
                    id: "target",
                    header: "Target",
                    question: "Which environment should be used?",
                    options: [
                        { label: "staging", description: "Preview environment" },
                        { label: "production", description: "Live traffic" },
                    ],
                },
            ],
        },
    });
    pushPaperclip(scheduled, 55_000, "Paperclip issue.updated blocked", {
        id: 3,
        companyId: "company:paperclip",
        type: "activity.logged",
        createdAt: new Date(base + 55_000).toISOString(),
        payload: {
            entityType: "issue",
            entityId: "ISS-17",
            action: "issue.updated",
            details: {
                title: "Finalize hiring plan",
                status: "blocked",
            },
        },
    });
    pushCodex(scheduled, 75_000, "Codex command approval", {
        id: "req-approval",
        method: "execCommandApproval",
        params: {
            callId: "call-approval-1",
            conversationId: "thread:codex:approval",
            command: ["git", "push", "origin", "main"],
            cwd: "/workspace/repo",
            reason: "Push deployment fix",
        },
    });
    pushPaperclip(scheduled, 95_000, "Paperclip run.status running", {
        id: 4,
        companyId: "company:paperclip",
        type: "heartbeat.run.status",
        createdAt: new Date(base + 95_000).toISOString(),
        payload: {
            runId: "run:paperclip:2",
            agentId: "agent:paperclip:ops",
            status: "running",
        },
    });
    pushCodex(scheduled, 112_000, "Codex requestUserInput form", {
        id: "req-form",
        method: "item/tool/requestUserInput",
        params: {
            itemId: "item:form:1",
            threadId: "thread:codex:2",
            turnId: "turn:codex:2",
            questions: [
                {
                    id: "reason",
                    header: "Reason",
                    question: "Why should the command continue?",
                },
            ],
        },
    });
    return scheduled.sort((left, right) => left.atMs - right.atMs);
}
function pushPaperclip(scheduled, atMs, label, liveEvent) {
    for (const event of mapPaperclipLiveEvent(liveEvent)) {
        scheduled.push({ atMs, source: "paperclip", label, event });
    }
}
function pushCodex(scheduled, atMs, label, request) {
    for (const event of mapCodexServerRequest(request)) {
        scheduled.push({ atMs, source: "codex", label, event });
    }
}
function start() {
    if (intervalId !== null) {
        window.clearInterval(intervalId);
    }
    state.playing = true;
    intervalId = window.setInterval(tick, tickIntervalMs);
    render();
}
function pause() {
    state.playing = false;
    if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
    }
    render();
}
function reset() {
    pause();
    state = createReplayState();
    render();
}
function tick() {
    if (!state.playing) {
        return;
    }
    state.currentTimeMs = Math.min(replayDurationMs, state.currentTimeMs + tickIntervalMs * state.speed);
    while (state.cursor < state.events.length &&
        state.events[state.cursor] !== undefined &&
        state.events[state.cursor].atMs <= state.currentTimeMs) {
        const scheduledEvent = state.events[state.cursor];
        if (!scheduledEvent) {
            break;
        }
        state.publishedEvents = [scheduledEvent, ...state.publishedEvents].slice(0, 18);
        state.core.publish(scheduledEvent.event);
        state.cursor += 1;
    }
    if (state.currentTimeMs >= replayDurationMs) {
        pause();
    }
    render();
}
function respond(response) {
    state.core.submit(response);
    render();
}
function render() {
    const activeFrame = state.attentionView.active;
    const nextEvent = state.events[state.cursor] ?? null;
    const progress = Math.min(100, (state.currentTimeMs / replayDurationMs) * 100);
    const latestTrace = state.traces[0] ?? null;
    const latestEvent = state.publishedEvents[0] ?? null;
    appRoot.innerHTML = `
    <div class="shell">
      <section class="hero">
        <span class="badge">Attention Lab</span>
        <h1>Simulated streaming attention harness</h1>
        <p>Mixed Paperclip and Codex events replay over a two-minute window. This page shows the full chain: incoming event, Aperture’s decision, and the resulting attention state.</p>
        <div class="controls">
          <button id="play-button" class="primary">${state.playing ? "Pause" : "Play"}</button>
          <button id="reset-button">Reset</button>
          <label class="badge">Speed
            <select id="speed-select">
              ${[1, 5, 10, 20, 30].map((value) => `<option value="${value}" ${value === state.speed ? "selected" : ""}>${value}x</option>`).join("")}
            </select>
          </label>
        </div>
        <div class="meta-row">
          <span class="badge">Time ${formatElapsed(state.currentTimeMs)} / 02:00</span>
          <span class="badge ${activeFrame ? "focused" : ""}">Active ${activeFrame ? "present" : "none"}</span>
          <span class="badge">${nextEvent ? `Next ${formatElapsed(nextEvent.atMs)} · ${escapeHtml(nextEvent.label)}` : "Replay complete"}</span>
        </div>
        <div class="timeline"><div class="timeline-progress" style="width:${progress}%"></div></div>
        <div class="hero-grid">
          <div class="hero-card">
            <div class="section-label">Incoming event</div>
            <div class="hero-value">${latestEvent ? escapeHtml(latestEvent.label) : "Waiting for first event"}</div>
            <div class="meta">${latestEvent ? `${latestEvent.source} · ${escapeHtml(latestEvent.event.type)}` : "No event published yet"}</div>
          </div>
          <div class="hero-card">
            <div class="section-label">Aperture decided</div>
            <div class="hero-value">${latestTrace ? escapeHtml(readTraceDecision(latestTrace)) : "No decision yet"}</div>
            <div class="meta">${latestTrace ? `task=${latestTrace.taskAttentionState} · global=${latestTrace.globalAttentionState}` : "No trace yet"}</div>
          </div>
          <div class="hero-card">
            <div class="section-label">Current focus</div>
            <div class="hero-value">${activeFrame ? escapeHtml(activeFrame.title) : "No active frame"}</div>
            <div class="meta">${activeFrame ? `${escapeHtml(activeFrame.mode)} · ${escapeHtml(activeFrame.source?.label ?? activeFrame.source?.kind ?? "core")}` : "Aperture is keeping the surface calm"}</div>
          </div>
        </div>
      </section>

      <section class="grid">
        <div class="column">
          <article class="panel emphasis">
            <h2>What Aperture is doing now</h2>
            ${renderDecisionSnapshot(latestTrace, activeFrame)}
          </article>

          <article class="panel">
            <h2>Active frame</h2>
            ${renderActiveFrame(activeFrame)}
          </article>

          <article class="panel">
            <h2>Attention queue</h2>
            ${renderAttentionView(state.attentionView)}
          </article>
        </div>

        <div class="column">
          <article class="panel">
            <h2>Published events</h2>
            ${renderPublishedEvents(state.publishedEvents)}
          </article>

          <article class="panel">
            <h2>Trace</h2>
            ${renderTraceList(state.traces)}
          </article>
        </div>
      </section>
    </div>
  `;
    bindControls();
    bindResponseControls(activeFrame);
}
function bindControls() {
    const playButton = document.querySelector("#play-button");
    const resetButton = document.querySelector("#reset-button");
    const speedSelect = document.querySelector("#speed-select");
    playButton?.addEventListener("click", () => {
        if (state.playing) {
            pause();
        }
        else {
            start();
        }
    });
    resetButton?.addEventListener("click", () => {
        reset();
    });
    speedSelect?.addEventListener("change", (event) => {
        const target = event.currentTarget;
        state.speed = Number(target.value);
        render();
    });
}
function bindResponseControls(activeFrame) {
    if (!activeFrame || !activeFrame.responseSpec || activeFrame.responseSpec.kind === "none") {
        return;
    }
    const frameId = activeFrame.interactionId;
    if (activeFrame.responseSpec.kind === "approval") {
        document.querySelectorAll("[data-action-kind]").forEach((button) => {
            button.addEventListener("click", () => {
                const actionKind = button.dataset.actionKind;
                if (actionKind === "approve") {
                    respond({ taskId: activeFrame.taskId, interactionId: activeFrame.interactionId, response: { kind: "approved" } });
                }
                else if (actionKind === "reject") {
                    respond({ taskId: activeFrame.taskId, interactionId: activeFrame.interactionId, response: { kind: "rejected" } });
                }
                else if (actionKind === "dismiss") {
                    respond({ taskId: activeFrame.taskId, interactionId: activeFrame.interactionId, response: { kind: "dismissed" } });
                }
            });
        });
        return;
    }
    if (activeFrame.responseSpec.kind === "choice") {
        document.querySelectorAll(`input[name="${safeName(frameId)}:choice"]`).forEach((input) => {
            input.addEventListener("change", () => {
                const selected = Array.from(document.querySelectorAll(`input[name="${safeName(frameId)}:choice"]:checked`)).map((item) => item.value);
                state.selection[frameId] = selected;
            });
        });
        document.querySelector("#submit-choice")?.addEventListener("click", () => {
            const optionIds = state.selection[frameId] ?? [];
            if (optionIds.length === 0) {
                return;
            }
            respond({
                taskId: activeFrame.taskId,
                interactionId: activeFrame.interactionId,
                response: { kind: "option_selected", optionIds },
            });
        });
        return;
    }
    if (activeFrame.responseSpec.kind === "form") {
        const values = state.values[frameId] ?? {};
        document.querySelectorAll("[data-field-id]").forEach((input) => {
            input.addEventListener("input", () => {
                const fieldId = input.dataset.fieldId;
                if (!fieldId) {
                    return;
                }
                values[fieldId] = input.value;
                state.values[frameId] = values;
            });
        });
        document.querySelector("#submit-form")?.addEventListener("click", () => {
            respond({
                taskId: activeFrame.taskId,
                interactionId: activeFrame.interactionId,
                response: { kind: "form_submitted", values },
            });
        });
    }
}
function renderActiveFrame(frame) {
    if (!frame) {
        return `
      <div class="empty-state">
        <div class="section-label">Calm state</div>
        <p>No frame currently deserves interruption. Aperture is leaving low-value work ambient instead of forcing focus.</p>
      </div>
    `;
    }
    const attention = readAttention(frame);
    const context = frame.context?.items ?? [];
    const rationale = attention?.rationale ?? [];
    return `
    <div class="frame-card">
      <div class="actions">
        <span class="badge ${frame.mode}">${escapeHtml(frame.mode)}</span>
        <span class="badge ${frame.tone}">${escapeHtml(frame.tone)}</span>
        <span class="badge">${escapeHtml(frame.source?.label ?? frame.source?.kind ?? "core")}</span>
        ${attention ? `<span class="metric-badge">score ${attention.score}</span>` : ""}
      </div>
      <div class="section-label">Surfaced now</div>
      <h3>${escapeHtml(frame.title)}</h3>
      <p>${escapeHtml(frame.summary ?? "No summary")}</p>
      ${context.length > 0
        ? `<div class="list">
              <div class="section-label">Context</div>
              ${context.map((item) => `<div>${escapeHtml(item.label)}: ${escapeHtml(item.value ?? "n/a")}</div>`).join("")}
            </div>`
        : ""}
      ${rationale.length > 0
        ? `<div class="list">
              <div class="section-label">Attention rationale</div>
              <div class="metric-row"><span class="metric-label">Score</span><span class="metric-value">${attention?.score ?? "n/a"}</span></div>
              <div class="metric-row"><span class="metric-label">Offset</span><span class="metric-value">${attention?.scoreOffset ?? 0}</span></div>
              ${rationale.map((item) => `<div>${escapeHtml(item)}</div>`).join("")}
            </div>`
        : attention
            ? `<div class="list">
                <div class="section-label">Attention score</div>
                <div class="metric-row"><span class="metric-label">Score</span><span class="metric-value">${attention.score}</span></div>
                <div class="metric-row"><span class="metric-label">Offset</span><span class="metric-value">${attention.scoreOffset}</span></div>
              </div>`
            : ""}
      ${renderResponseSurface(frame)}
    </div>
  `;
}
function renderResponseSurface(frame) {
    if (!frame.responseSpec || frame.responseSpec.kind === "none") {
        return `<p class="empty">No response required.</p>`;
    }
    if (frame.responseSpec.kind === "approval") {
        return `
      <div class="response-grid">
        ${frame.responseSpec.actions
            .map((action) => `<button class="${buttonClass(action.kind)}" data-action-kind="${action.kind}">${escapeHtml(action.label)}</button>`)
            .join("")}
      </div>
    `;
    }
    if (frame.responseSpec.kind === "choice") {
        const inputType = frame.responseSpec.selectionMode === "multiple" ? "checkbox" : "radio";
        return `
      <div class="list">
        <div class="section-label">Options</div>
        ${frame.responseSpec.options
            .map((option) => `
              <div class="option">
                <label>
                  <input type="${inputType}" name="${safeName(frame.interactionId)}:choice" value="${escapeHtml(option.id)}" />
                  ${escapeHtml(option.label)}
                </label>
                ${option.summary ? `<div class="meta">${escapeHtml(option.summary)}</div>` : ""}
              </div>
            `)
            .join("")}
        <div class="actions">
          <button id="submit-choice" class="primary">Submit choice</button>
        </div>
      </div>
    `;
    }
    return `
    <div class="list">
      <div class="section-label">Form</div>
      ${frame.responseSpec.fields
        .map((field) => {
        const control = field.type === "textarea"
            ? `<textarea data-field-id="${escapeHtml(field.id)}" placeholder="${escapeHtml(field.placeholder ?? "")}"></textarea>`
            : `<input data-field-id="${escapeHtml(field.id)}" type="${field.type === "number" ? "number" : "text"}" placeholder="${escapeHtml(field.placeholder ?? "")}" />`;
        return `
            <div class="field">
              <label>${escapeHtml(field.label)}</label>
              ${control}
              ${field.helpText ? `<div class="meta">${escapeHtml(field.helpText)}</div>` : ""}
            </div>
          `;
    })
        .join("")}
      <div class="actions">
        <button id="submit-form" class="primary">Submit form</button>
      </div>
    </div>
  `;
}
function renderAttentionView(attentionView) {
    return `
    <div class="stack-grid">
      <div class="stack-column">
        <div class="section-label">Active</div>
        ${renderFrameSummary(attentionView.active)}
      </div>
      <div class="stack-column">
        <div class="section-label">Queued</div>
        ${attentionView.queued.length > 0 ? attentionView.queued.map(renderFrameSummary).join("") : `<p class="empty">None</p>`}
      </div>
      <div class="stack-column">
        <div class="section-label">Ambient</div>
        ${attentionView.ambient.length > 0 ? attentionView.ambient.map(renderFrameSummary).join("") : `<p class="empty">None</p>`}
      </div>
    </div>
  `;
}
function renderFrameSummary(frame) {
    if (!frame) {
        return `<p class="empty">None</p>`;
    }
    const attention = readAttention(frame);
    return `
    <div class="frame-card">
      <div class="card-head">
        <div class="frame-title">${escapeHtml(frame.title)}</div>
        ${attention ? `<span class="metric-badge">score ${attention.score}</span>` : ""}
      </div>
      <div class="meta">${escapeHtml(frame.source?.label ?? frame.source?.kind ?? "core")} · ${escapeHtml(frame.mode)} · ${escapeHtml(frame.tone)}</div>
      ${frame.summary ? `<div class="meta">${escapeHtml(frame.summary)}</div>` : ""}
      ${attention ? `<div class="metric-row compact"><span class="metric-label">Offset</span><span class="metric-value">${attention.scoreOffset}</span></div>` : ""}
    </div>
  `;
}
function renderDecisionSnapshot(trace, frame) {
    if (!trace) {
        return `<p class="empty">No decision yet. Start the replay to watch Aperture classify and allocate attention.</p>`;
    }
    if (!isCandidateTrace(trace)) {
        return `
      <div class="snapshot-grid">
        <div class="snapshot-item">
          <div class="section-label">Latest event</div>
          <div>${escapeHtml(trace.event.type)}</div>
        </div>
        <div class="snapshot-item">
          <div class="section-label">Decision</div>
          <div>${escapeHtml(trace.evaluation.kind)}</div>
        </div>
      </div>
    `;
    }
    return `
    <div class="snapshot-grid">
      <div class="snapshot-item">
        <div class="section-label">Incoming</div>
        <div>${escapeHtml(trace.event.type)}</div>
        <div class="meta">${escapeHtml(eventLabel(trace.event))}</div>
      </div>
      <div class="snapshot-item">
        <div class="section-label">Decision</div>
        <div>${escapeHtml(trace.coordination.kind)}</div>
        <div class="meta">candidate ${trace.coordination.candidateScore} · current ${trace.coordination.currentScore ?? "n/a"}</div>
      </div>
      <div class="snapshot-item">
        <div class="section-label">Result</div>
        <div>${frame ? escapeHtml(frame.title) : "No active frame"}</div>
        <div class="meta">task ${trace.taskAttentionState} · global ${trace.globalAttentionState}</div>
      </div>
    </div>
    ${trace.heuristics.rationale.length > 0
        ? `
          <div class="list">
            <div class="section-label">Why</div>
            ${trace.heuristics.rationale.map((item) => `<div class="explain-row">${escapeHtml(item)}</div>`).join("")}
          </div>
        `
        : `
          <div class="meta">No heuristic adjustment. This decision came from the deterministic baseline.</div>
        `}
  `;
}
function renderPublishedEvents(events) {
    if (events.length === 0) {
        return `<p class="empty">No events published yet.</p>`;
    }
    return `
    <div class="list">
      ${events
        .map((item) => `
            <div class="event-item">
              <div class="event-title">${escapeHtml(item.label)}</div>
              <div class="meta">${item.source} · ${formatElapsed(item.atMs)} · ${escapeHtml(item.event.type)}</div>
              <div class="meta">${escapeHtml(eventLabel(item.event))}</div>
            </div>
          `)
        .join("")}
    </div>
  `;
}
function renderTraceList(traces) {
    if (traces.length === 0) {
        return `<p class="empty">No trace yet.</p>`;
    }
    return `
    <div class="list">
      ${traces
        .map((trace) => {
        const decision = isCandidateTrace(trace) ? trace.coordination.kind : trace.evaluation.kind;
        const offset = isCandidateTrace(trace) ? trace.heuristics.scoreOffset : 0;
        return `
            <div class="trace-item">
              <div class="trace-title">${escapeHtml(trace.event.type)} → ${escapeHtml(decision)}</div>
              <div class="meta">${escapeHtml(trace.event.taskId)} · task=${trace.taskAttentionState} · global=${trace.globalAttentionState}</div>
              ${isCandidateTrace(trace)
            ? `<div class="meta">candidate=${trace.coordination.candidateScore} current=${trace.coordination.currentScore ?? "n/a"} offset=${offset}</div>`
            : ""}
            </div>
          `;
    })
        .join("")}
    </div>
  `;
}
function readAttention(frame) {
    const attention = frame.metadata?.attention;
    if (!attention || typeof attention !== "object") {
        return { score: scoreFrame(frame), scoreOffset: 0, rationale: [] };
    }
    const score = "score" in attention && typeof attention.score === "number"
        ? attention.score
        : scoreFrame(frame);
    const scoreOffset = "scoreOffset" in attention && typeof attention.scoreOffset === "number"
        ? attention.scoreOffset
        : 0;
    const rationale = "rationale" in attention && Array.isArray(attention.rationale)
        ? attention.rationale.filter((item) => typeof item === "string")
        : [];
    return { score, scoreOffset, rationale };
}
function buttonClass(kind) {
    if (kind === "approve" || kind === "submit") {
        return "primary";
    }
    if (kind === "reject" || kind === "dismiss") {
        return "danger";
    }
    return "";
}
function formatElapsed(valueMs) {
    const totalSeconds = Math.max(0, Math.floor(valueMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
function escapeHtml(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}
function safeName(value) {
    return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}
function readTraceDecision(trace) {
    return isCandidateTrace(trace) ? trace.coordination.kind : trace.evaluation.kind;
}
function eventLabel(event) {
    if ("title" in event && typeof event.title === "string") {
        return event.title;
    }
    return event.taskId;
}
function isCandidateTrace(trace) {
    return "coordination" in trace && "heuristics" in trace;
}
//# sourceMappingURL=main.js.map