import { useColorScheme } from "react-native";

export type ThemeColors = {
  background: string;
  surface: string;
  surfaceRaised: string;
  border: string;
  divider: string;
  text: string;
  muted: string;
  accent: string;
  accentDeep: string;
  success: string;
  warning: string;
  danger: string;
  white: string;
  input: string;
  placeholder: string;
  textOnAccent: string;
  accentContainer: string;
};

// Monochrome ORCA palette adapted from the reference app's lightColors/darkColors.
export const lightColors: ThemeColors = {
  background: "#F4F4F4",
  surface: "#FFFFFF",
  surfaceRaised: "#FFFFFF",
  border: "#D7D7D7",
  divider: "#D7D7D7",
  text: "#101010",
  muted: "#5A5A5A",
  accent: "#202020",
  accentDeep: "#000000",
  success: "#333333",
  warning: "#555555",
  danger: "#111111",
  white: "#FFFFFF",
  input: "#F0F0F0",
  placeholder: "#999999",
  textOnAccent: "#FFFFFF",
  accentContainer: "#E6E6E6",
};

export const darkColors: ThemeColors = {
  background: "#000000",
  surface: "#2D2D2D",
  surfaceRaised: "#353535",
  border: "#555555",
  divider: "#555555",
  text: "#F5F5F5",
  muted: "#B5B5B5",
  accent: "#FFFFFF",
  accentDeep: "#D9D9D9",
  success: "#D0D0D0",
  warning: "#AAAAAA",
  danger: "#FFFFFF",
  white: "#FFFFFF",
  input: "#202020",
  placeholder: "#AAAAAA",
  textOnAccent: "#121212",
  accentContainer: "#3A3A3A",
};

export function useAppTheme() {
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  return {
    colors: isDark ? darkColors : lightColors,
    isDark,
    mode: isDark ? ("dark" as const) : ("light" as const),
  };
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;
export const fontSizes = {
  title: 28,
  stat: 24,
  cardTitle: 20,
  heading: 18,
  label: 16,
  input: 15,
  body: 14,
  description: 13,
  caption: 12,
  small: 11,
  micro: 10,
} as const;
export const fontFamilies = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semiBold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
  extraBold: "Inter_800ExtraBold",
} as const;
