import type { BrowseCategory, PlantFilter } from "./BrowseStackTypes";

export type RootStackParamList = {
  Map: undefined;
  Browse: undefined;
  Reports: undefined;
  Settings: undefined;
  BrowseEntries: { category: BrowseCategory };
  BrowseSearch: undefined;
  PlantList: { filter: PlantFilter; title: string };
  PlantDetail: { plantId: string };
  Scan: undefined;
};

export type RootTab = "Map" | "Browse" | "Reports" | "Settings";

declare global {
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
