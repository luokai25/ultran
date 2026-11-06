/**
 * The obsidian, titanium and warm-metal design system, mirrored from the backend palette.
 *
 * These are the same hex values the API returns from `/v1/workspace/theme`, so a
 * server-driven scene and a client-rendered card can never drift apart.
 */

export const palette = {
  void: "#090a0c",
  obsidian: "#101216",
  carbon: "#171b21",
  graphite: "#202630",
  hairline: "rgba(220,228,238,.10)",
  gold: "#d5b779",
  goldBright: "#e8cb91",
  goldDeep: "#88734d",
  goldGlow: "rgba(213,183,121,.12)",
  ember: "#e34b58",
  danger: "#ef6b73",
  ok: "#55c99a",
  ink: "#f2f4f7",
  muted: "#828d9b",
} as const;

export type SceneId = "palace" | "forge" | "marketplace" | "war-room";
export type EmotionId = "calm" | "focused" | "alert" | "triumphant";

export const scenes: Record<
  SceneId,
  { label: string; accent: string; floor: string; fog: string; spawn: [number, number, number] }
> = {
  palace: { label: "Obsidian Palace", accent: palette.gold, floor: "#101216", fog: "#090a0c", spawn: [0, 0, 0] },
  forge: { label: "The Forge", accent: palette.ember, floor: "#171216", fog: "#0c090d", spawn: [-2, 0, 1.5] },
  marketplace: { label: "Marketplace Vault", accent: palette.goldBright, floor: "#10151b", fog: "#090a0c", spawn: [2, 0, -1] },
  "war-room": { label: "War Room", accent: palette.danger, floor: "#151116", fog: "#09090c", spawn: [0, 0, 2.5] },
};

export const emotions: Record<EmotionId, { tint: string; pulseHz: number; intensity: number }> = {
  calm: { tint: "#d5b779", pulseHz: 0.4, intensity: 0.55 },
  focused: { tint: "#e8cb91", pulseHz: 1.1, intensity: 0.75 },
  alert: { tint: "#e34b58", pulseHz: 2.2, intensity: 0.9 },
  triumphant: { tint: "#55c99a", pulseHz: 1.6, intensity: 1.0 },
};
