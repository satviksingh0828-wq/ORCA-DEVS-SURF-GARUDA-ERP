export type VideoGlassAppearance = {
  surfaceOpacity: number;
  backgroundVeil: number;
  textColor: string;
};

export const DEFAULT_VIDEO_GLASS_APPEARANCE: VideoGlassAppearance = {
  surfaceOpacity: 92,
  backgroundVeil: 25,
  textColor: "#172033",
};

export function normalizeVideoGlassAppearance(value: unknown): VideoGlassAppearance {
  const settings = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const clamp = (candidate: unknown, fallback: number, min: number, max: number) => {
    const number = Number(candidate);
    return Number.isFinite(number) ? Math.round(Math.min(max, Math.max(min, number))) : fallback;
  };
  const textColor = typeof settings.textColor === "string" ? settings.textColor.trim() : "";
  return {
    surfaceOpacity: clamp(
      settings.surfaceOpacity,
      DEFAULT_VIDEO_GLASS_APPEARANCE.surfaceOpacity,
      50,
      98,
    ),
    backgroundVeil: clamp(
      settings.backgroundVeil,
      DEFAULT_VIDEO_GLASS_APPEARANCE.backgroundVeil,
      0,
      70,
    ),
    textColor: /^#[0-9a-f]{6}$/i.test(textColor)
      ? textColor
      : DEFAULT_VIDEO_GLASS_APPEARANCE.textColor,
  };
}
