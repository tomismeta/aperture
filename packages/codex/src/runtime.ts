import type { ConformedEvent, FrameResponse } from "@aperture/core";

import {
  type CodexClientResponse,
  type CodexServerRequest,
} from "./index.js";

export type CodexEventHost = {
  publishConformed(event: ConformedEvent): void | Promise<void>;
  publishConformedBatch?(events: ConformedEvent[]): void | Promise<void>;
  onResponse(listener: (response: FrameResponse) => void): () => void;
};

export type CodexResponseSink = {
  sendCodexResponse(response: CodexClientResponse): void | Promise<void>;
};

export type CodexRuntimeBridge = {
  handleCodexRequest(request: CodexServerRequest): Promise<void>;
  close(): void;
};

export function createCodexRuntimeBridge(
  host: CodexEventHost,
  sink: CodexResponseSink,
): CodexRuntimeBridge {
  const unsubscribe = host.onResponse((response) => {
    void Promise.resolve(loadProtocol()).then(({ mapCodexFrameResponse }) => {
      const codexResponse = mapCodexFrameResponse(response);
      if (!codexResponse) {
        return;
      }
      return sink.sendCodexResponse(codexResponse);
    });
  });

  return {
    async handleCodexRequest(request) {
      const { mapCodexServerRequest } = await loadProtocol();
      const events = mapCodexServerRequest(request);
      if (events.length === 0) {
        return;
      }

      if (host.publishConformedBatch) {
        await host.publishConformedBatch(events);
        return;
      }

      for (const event of events) {
        await host.publishConformed(event);
      }
    },
    close() {
      unsubscribe();
    },
  };
}

let protocolModulePromise: Promise<typeof import("./index.js")> | null = null;

function loadProtocol(): Promise<typeof import("./index.js")> {
  protocolModulePromise ??= import("./index.js");
  return protocolModulePromise;
}
