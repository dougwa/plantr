import type { TagKind } from "./api";

export type TagKindStyle = {
  color: string;
  // Heroicons-style SVG path drawn inside a 24-unit viewBox. Inlined so the
  // chip render stays self-contained — adding an icon library for two glyphs
  // would be overkill.
  iconPath: string;
  label: string;
};

export const TAG_KIND_STYLES: Record<TagKind, TagKindStyle> = {
  custom: {
    color: "#0ea5e9",
    iconPath:
      "M5.25 7.5A2.25 2.25 0 0 1 7.5 5.25h6.379a2.25 2.25 0 0 1 1.59.659l7.122 7.121a2.25 2.25 0 0 1 0 3.182l-6.379 6.379a2.25 2.25 0 0 1-3.182 0L5.91 15.47A2.25 2.25 0 0 1 5.25 13.88V7.5Zm4.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z",
    label: "Custom",
  },
  location: {
    color: "#16a34a",
    iconPath:
      "M12 2.25a7.5 7.5 0 0 0-7.5 7.5c0 4.5 7.5 12 7.5 12s7.5-7.5 7.5-12a7.5 7.5 0 0 0-7.5-7.5Zm0 10.125a2.625 2.625 0 1 1 0-5.25 2.625 2.625 0 0 1 0 5.25Z",
    label: "Location",
  },
};

export function tagKindStyle(kind: TagKind): TagKindStyle {
  return TAG_KIND_STYLES[kind];
}
