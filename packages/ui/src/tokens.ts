/**
 * Design tokens shared by the web console and the mobile client.
 *
 * Tokens are plain data, not CSS: the web layer maps them to CSS custom
 * properties and React Native maps them to style objects. This keeps one
 * source of truth without coupling the package to either renderer.
 */

export const colors = {
  bg: '#0b0d10',
  surface: '#14181d',
  surfaceRaised: '#1b2129',
  border: '#232a32',
  text: '#e6edf3',
  textMuted: '#8b98a5',
  accent: '#5b9dff',
  success: '#3fb950',
  warning: '#d29922',
  danger: '#f85149',
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 18,
  xl: 28,
  xxl: 48,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
  pill: 999,
} as const;

export const typography = {
  familySans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  familyMono: 'ui-monospace, "SF Mono", "Cascadia Code", monospace',
  size: {
    xs: 11,
    sm: 13,
    md: 15,
    lg: 19,
    xl: 28,
    xxl: 52,
  },
  weight: {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },
} as const;

export const tokens = { colors, space, radius, typography } as const;

export type Tokens = typeof tokens;
export type ColorToken = keyof typeof colors;
export type SpaceToken = keyof typeof space;
