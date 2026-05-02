export type RootStackParamList = {
  Tabs: undefined;
  Scan: undefined;
  PlantDetail: { plantId: string };
};

export type TabParamList = {
  Map: undefined;
  Browse: undefined;
  ScanTab: undefined;
  Reports: undefined;
  Settings: undefined;
};

declare global {
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
