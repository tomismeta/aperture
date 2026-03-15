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

export const baseAttentionSurfaceCapabilities: AttentionSurfaceCapabilities = {
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
      topology: { ...baseAttentionSurfaceCapabilities.topology },
      responses: { ...baseAttentionSurfaceCapabilities.responses },
    };
  }

  // Shared-runtime planning should only assume capabilities that every
  // attached attention surface can satisfy. Richer surface-specific planning
  // should happen against a single declared surface, not by widening the core
  // contract to the union of all attached surfaces.
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

/**
 * @deprecated Prefer `baseAttentionSurfaceCapabilities`.
 */
export const DEFAULT_ATTENTION_SURFACE_CAPABILITIES = baseAttentionSurfaceCapabilities;
