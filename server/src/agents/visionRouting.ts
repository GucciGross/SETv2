/**
 * Vision routing for computer-use captures — adapted from hermes-agent's
 * tools/computer_use/vision_routing.py (MIT, Nous Research).
 *
 * Decides whether the active provider/model can consume a screenshot
 * (multimodal tool result) or whether the capture must stay text-only
 * (the annotated AT-SPI element list is always included as the fallback,
 * playing the role of hermes-agent's aux-vision analysis).
 */

interface ProviderInfo {
  id?: string;
  provider?: string;
  model?: string | null;
  baseUrl?: string;
  [k: string]: any;
}

// Model-name fragments of known vision-capable families. Anything else is
// assumed text-only: the capture falls back to the element-index summary.
const VISION_MODEL_PATTERNS: RegExp[] = [
  /gpt-4o/i, /gpt-4\.1/i, /gpt-5/, /chatgpt-4o/i, /o[34](-|$)/i,
  /claude-/i,
  /gemini/i,
  /qwen.*vl/i, /qwen2?-vl/i, /qvq/i,
  /glm-\d+(\.\d+)?v/i, /glm-5\.3-flash/i,
  /llava/i, /moondream/i, /bakllava/i, /internvl/i, /gemma.*vision/i,
  /pixtral/i, /phi-.*vision/i, /vision/i,
];

export function providerAcceptsScreenshots(provider: ProviderInfo | null): boolean {
  if (!provider) return false;
  const model = String(provider.model ?? '');
  if (!model) return false;
  // Explicit per-space override wins (settings.data.auxVision === true means
  // "never send images", mirroring hermes-agent's explicit aux-vision config).
  return VISION_MODEL_PATTERNS.some((re) => re.test(model));
}

/** Rough size guard: most OpenAI-compatible gateways choke on giant tool results. */
export const MAX_INLINE_SCREENSHOT_BYTES = 900_000;
