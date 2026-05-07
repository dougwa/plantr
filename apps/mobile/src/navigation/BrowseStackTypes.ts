export type BrowseCategory = "location" | "tag" | "species";

export type PlantFilter =
  | { kind: "all" }
  | { kind: "tag"; tagId: string | null; label: string }
  | { kind: "location"; shapeId: string | null; label: string }
  | { kind: "species"; species: string | null; label: string };

export type BrowseStackParamList = {
  BrowseHome: undefined;
  BrowseEntries: { category: BrowseCategory };
  PlantList: { filter: PlantFilter; title: string };
  BrowseSearch: undefined;
};
