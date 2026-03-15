export type AttentionSurfaceCapabilities = {
  supportsQueue: boolean;
  supportsAmbient: boolean;
  supportsSingleChoice: boolean;
  supportsMultipleChoice: boolean;
  supportsForms: boolean;
  supportsFreeformText: boolean;
};

export const DEFAULT_ATTENTION_SURFACE_CAPABILITIES: AttentionSurfaceCapabilities = {
  supportsQueue: true,
  supportsAmbient: true,
  supportsSingleChoice: true,
  supportsMultipleChoice: false,
  supportsForms: true,
  supportsFreeformText: false,
};

export function mergeAttentionSurfaceCapabilities(
  capabilities: AttentionSurfaceCapabilities[],
): AttentionSurfaceCapabilities {
  if (capabilities.length === 0) {
    return { ...DEFAULT_ATTENTION_SURFACE_CAPABILITIES };
  }

  return {
    supportsQueue: capabilities.some((value) => value.supportsQueue),
    supportsAmbient: capabilities.some((value) => value.supportsAmbient),
    supportsSingleChoice: capabilities.some((value) => value.supportsSingleChoice),
    supportsMultipleChoice: capabilities.some((value) => value.supportsMultipleChoice),
    supportsForms: capabilities.some((value) => value.supportsForms),
    supportsFreeformText: capabilities.some((value) => value.supportsFreeformText),
  };
}
