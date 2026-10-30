/**
 * The golden-black design system, mirrored from the backend palette.
 *
 * These are the same hex values the API returns from `/v1/workspace/theme`, so a
 * server-driven scene and a client-rendered card can never drift apart.
 */

export const palette = {
  void: "#050505",
  obsidian: "#0b0b0d",
  carbon: "#131317",
  graphite: "#1b1b21",
  hairline: "#2a2a33",
  gold: "#d4af37",
  goldBright: "#f5d76e",
  goldDeep: "#8a6d1f",
  goldGlow: "rgba(212, 175, 55, 0.35)",
  ember: "#ff8a3d",
  danger: "#e5484d",
  ok: "#3dd68c",
  ink: "#f4f1e8",
  muted: "#8d8778",
} as const;

export type SceneId = "palace" | "forge" | "marketplace" | "war-room";
export type EmotionId = "calm" | "focused" | "alert" | "triumphant";

export const scenes: Record<
  SceneId,
  { label: string; accent: string; floor: string; fog: string; spawn: [number, number, number] }
> = {
  palace: { label: "Obsidian Palace", accent: palette.gold, floor: "#0b0b0d", fog: "#050505", spawn: [0, 0, 0] },
  forge: { label: "The Forge", accent: palette.ember, floor: "#120d07", fog: "#0a0603", spawn: [-2, 0, 1.5] },
  marketplace: { label: "Marketplace Vault", accent: palette.goldBright, floor: "#0a0a0e", fog: "#050507", spawn: [2, 0, -1] },
  "war-room": { label: "War Room", accent: palette.danger, floor: "#0d0a0a", fog: "#070404", spawn: [0, 0, 2.5] },
};

export const emotions: Record<EmotionId, { tint: string; pulseHz: number; intensity: number }> = {
  calm: { tint: "#d4af37", pulseHz: 0.4, intensity: 0.55 },
  focused: { tint: "#f5d76e", pulseHz: 1.1, intensity: 0.75 },
  alert: { tint: "#ff8a3d", pulseHz: 2.2, intensity: 0.9 },
  triumphant: { tint: "#3dd68c", pulseHz: 1.6, intensity: 1.0 },
};
