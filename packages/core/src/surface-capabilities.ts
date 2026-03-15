export type AttentionTopologyCapabilities = {
  supportsAmbient: boolean;
};

export type AttentionResponseCapabilities = {
  supportsSingleChoice: boolean;
  supportsMultipleChoice: boolean;
  supportsForm: boolean;
  supportsTextResponse: boolean;
};

export type AttentionSurfaceCapabilities = {
  topology: AttentionTopologyCapabilities;
  responses: AttentionResponseCapabilities;
};

export const DEFAULT_ATTENTION_SURFACE_CAPABILITIES: AttentionSurfaceCapabilities = {
  topology: {
    supportsAmbient: true,
  },
  responses: {
    supportsSingleChoice: true,
    supportsMultipleChoice: false,
    supportsForm: true,
    supportsTextResponse: false,
  },
};

export function mergeAttentionSurfaceCapabilities(
  capabilities: AttentionSurfaceCapabilities[],
): AttentionSurfaceCapabilities {
  if (capabilities.length === 0) {
    return {
      topology: { ...DEFAULT_ATTENTION_SURFACE_CAPABILITIES.topology },
      responses: { ...DEFAULT_ATTENTION_SURFACE_CAPABILITIES.responses },
    };
  }

  return {
    topology: {
      supportsAmbient: capabilities.every((value) => value.topology.supportsAmbient),
    },
    responses: {
      supportsSingleChoice: capabilities.every((value) => value.responses.supportsSingleChoice),
      supportsMultipleChoice: capabilities.every((value) => value.responses.supportsMultipleChoice),
      supportsForm: capabilities.every((value) => value.responses.supportsForm),
      supportsTextResponse: capabilities.every((value) => value.responses.supportsTextResponse),
    },
  };
}
