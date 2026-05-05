import type { NavigatorScreenParams } from "@react-navigation/native";
import type { BrowseStackParamList } from "./BrowseStackTypes";

export type TabParamList = {
  Map: undefined;
  Browse: NavigatorScreenParams<BrowseStackParamList>;
  ScanTab: undefined;
  Reports: undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList>;
  Scan: undefined;
  PlantDetail: { plantId: string };
};

declare global {
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
