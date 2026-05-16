import type Ionicons from "@expo/vector-icons/Ionicons";
import type { TagKind } from "./api";

export type TagKindStyle = {
  color: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
};

// Single source of truth for what each tag kind looks like and how it's
// labeled across the app. The icon doubles as a visual differentiator inside
// the tag chip so users can distinguish kinds without learning the colors.
export const TAG_KIND_STYLES: Record<TagKind, TagKindStyle> = {
  custom: {
    color: "#0ea5e9",
    icon: "pricetag",
    label: "Custom",
  },
  location: {
    color: "#16a34a",
    icon: "location",
    label: "Location",
  },
};

export function tagKindStyle(kind: TagKind): TagKindStyle {
  return TAG_KIND_STYLES[kind];
}
