export const annotationBaseColors = [
  "#FFFFFF", "#F4CCCC", "#FCE5CD", "#FFF2CC", "#D9EAD3", "#D0E0E3", "#CFE2F3", "#D9D2E9",
  "#F2F2F2", "#EA9999", "#F9CB9C", "#FFE599", "#B6D7A8", "#A2C4C9", "#9FC5E8", "#B4A7D6",
  "#BFBFBF", "#E06666", "#F6B26B", "#FFD966", "#93C47D", "#76A5AF", "#6FA8DC", "#8E7CC3",
  "#7F7F7F", "#CC0000", "#E69138", "#F1C232", "#6AA84F", "#45818E", "#3D85C6", "#674EA7",
  "#262626", "#990000", "#B45F06", "#BF9000", "#38761D", "#134F5C", "#0B5394", "#351C75",
] as const;

const hexColorPattern = /^#[0-9a-fA-F]{6}$/;

export function uniqueAnnotationColors(colors: string[], limit = 10) {
  const uniqueColors: string[] = [];
  const seen = new Set<string>();

  for (const color of colors) {
    if (!hexColorPattern.test(color)) {
      continue;
    }

    const normalizedColor = color.toUpperCase();
    if (!seen.has(normalizedColor)) {
      seen.add(normalizedColor);
      uniqueColors.push(normalizedColor);
    }

    if (uniqueColors.length >= limit) {
      break;
    }
  }

  return uniqueColors;
}
