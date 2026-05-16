import { useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  NavigationContainer,
  useNavigationContainerRef,
  type NavigationState,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import MapScreen from "../screens/MapScreen";
import BrowseHomeScreen from "../screens/browse/BrowseHomeScreen";
import BrowseEntriesScreen from "../screens/browse/BrowseEntriesScreen";
import BrowseSearchScreen from "../screens/browse/BrowseSearchScreen";
import PlantListScreen from "../screens/browse/PlantListScreen";
import PlantDetailScreen from "../screens/PlantDetailScreen";
import ReportsScreen from "../screens/ReportsScreen";
import SettingsScreen from "../screens/SettingsScreen";
import ScanScreen from "../screens/ScanScreen";
import BottomBar from "./BottomBar";
import type { RootStackParamList, RootTab } from "./types";

const Stack = createNativeStackNavigator<RootStackParamList>();

const ROOT_TABS: RootTab[] = ["Map", "Browse", "Reports", "Settings"];

function isRootTab(name: string | undefined): name is RootTab {
  return !!name && (ROOT_TABS as string[]).includes(name);
}

function deriveActive(state: NavigationState | undefined, fallback: RootTab): RootTab {
  const root = state?.routes[0]?.name;
  return isRootTab(root) ? root : fallback;
}

export default function AppNavigator() {
  const navigationRef = useNavigationContainerRef<RootStackParamList>();
  const [activeTab, setActiveTab] = useState<RootTab>("Map");
  const lastActiveRef = useRef<RootTab>("Map");

  function selectTab(tab: RootTab) {
    navigationRef.reset({ index: 0, routes: [{ name: tab }] });
  }

  function openScan() {
    navigationRef.navigate("Scan");
  }

  return (
    <NavigationContainer
      ref={navigationRef}
      onStateChange={(state) => {
        const next = deriveActive(state ?? undefined, lastActiveRef.current);
        if (next !== lastActiveRef.current) {
          lastActiveRef.current = next;
          setActiveTab(next);
        }
      }}
    >
      <View style={styles.root}>
        <View style={styles.stackWrap}>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Map" component={MapScreen} />
            <Stack.Screen name="Browse" component={BrowseHomeScreen} />
            <Stack.Screen name="Reports" component={ReportsScreen} />
            <Stack.Screen name="Settings" component={SettingsScreen} />
            <Stack.Screen name="BrowseEntries" component={BrowseEntriesScreen} />
            <Stack.Screen name="BrowseSearch" component={BrowseSearchScreen} />
            <Stack.Screen name="PlantList" component={PlantListScreen} />
            <Stack.Screen name="PlantDetail" component={PlantDetailScreen} />
            <Stack.Screen
              name="Scan"
              component={ScanScreen}
              options={{ presentation: "fullScreenModal" }}
            />
          </Stack.Navigator>
        </View>
        <BottomBar active={activeTab} onSelectTab={selectTab} onScan={openScan} />
      </View>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  stackWrap: { flex: 1 },
});
