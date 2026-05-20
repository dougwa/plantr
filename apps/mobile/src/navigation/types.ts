import type { BrowseCategory, PlantFilter } from "./BrowseStackTypes";

export type RootStackParamList = {
  Sites: undefined;
  Browse: undefined;
  Reports: undefined;
  Settings: undefined;
  Map: { highlightPlantIds?: string[]; focusShapeId?: string | null } | undefined;
  SiteCreate: undefined;
  PublicSiteSearch: undefined;
  SiteManagement: { siteId: string };
  BrowseEntries: { category: BrowseCategory };
  BrowseSearch: undefined;
  PlantList: { filter: PlantFilter; title: string };
  PlantDetail: { plantId: string };
  Scan: undefined;
};

export type RootTab = "Sites" | "Browse" | "Reports" | "Settings";

declare global {
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
