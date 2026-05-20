import { useEffect, useRef, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
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
import SitesScreen from "../screens/sites/SitesScreen";
import SiteCreateScreen from "../screens/sites/SiteCreateScreen";
import SiteManagementScreen from "../screens/sites/SiteManagementScreen";
import PublicSiteSearchScreen from "../screens/sites/PublicSiteSearchScreen";
import { useAuth } from "../contexts/AuthContext";
import BottomBar from "./BottomBar";
import type { RootStackParamList, RootTab } from "./types";

const Stack = createNativeStackNavigator<RootStackParamList>();

const ROOT_TABS: RootTab[] = ["Sites", "Browse", "Reports", "Settings"];
// Tabs that need a current-site selection. Sites + Settings stay live so
// users can always pick a site or sign out.
const SITE_GATED_TABS = new Set<RootTab>(["Browse", "Reports"]);

function isRootTab(name: string | undefined): name is RootTab {
  return !!name && (ROOT_TABS as string[]).includes(name);
}

function deriveActive(state: NavigationState | undefined, fallback: RootTab): RootTab {
  const root = state?.routes[0]?.name;
  return isRootTab(root) ? root : fallback;
}

export default function AppNavigator() {
  const navigationRef = useNavigationContainerRef<RootStackParamList>();
  const { state } = useAuth();
  const hasCurrentSite =
    state.status === "authed" && state.currentSiteId != null;
  const [activeTab, setActiveTab] = useState<RootTab>("Sites");
  const lastActiveRef = useRef<RootTab>("Sites");

  // If the current site is cleared while the user is on a gated tab, bounce
  // them back to Sites so they don't hit no_site_selected errors.
  useEffect(() => {
    if (!hasCurrentSite && SITE_GATED_TABS.has(activeTab)) {
      lastActiveRef.current = "Sites";
      setActiveTab("Sites");
      navigationRef.reset({ index: 0, routes: [{ name: "Sites" }] });
    }
  }, [hasCurrentSite, activeTab, navigationRef]);

  function selectTab(tab: RootTab) {
    if (!hasCurrentSite && SITE_GATED_TABS.has(tab)) {
      Alert.alert("Pick a site first", "Choose or create a site to continue.");
      return;
    }
    navigationRef.reset({ index: 0, routes: [{ name: tab }] });
  }

  function openScan() {
    if (!hasCurrentSite) {
      Alert.alert("Pick a site first", "Choose or create a site to scan plants.");
      return;
    }
    navigationRef.navigate("Scan");
  }

  return (
    <NavigationContainer
      ref={navigationRef}
      onStateChange={(navState) => {
        const next = deriveActive(navState ?? undefined, lastActiveRef.current);
        if (next !== lastActiveRef.current) {
          lastActiveRef.current = next;
          setActiveTab(next);
        }
      }}
    >
      <View style={styles.root}>
        <View style={styles.stackWrap}>
          <Stack.Navigator
            initialRouteName="Sites"
            screenOptions={{ headerShown: false }}
          >
            <Stack.Screen name="Sites" component={SitesScreen} />
            <Stack.Screen name="Browse" component={BrowseHomeScreen} />
            <Stack.Screen name="Reports" component={ReportsScreen} />
            <Stack.Screen name="Settings" component={SettingsScreen} />
            <Stack.Screen name="Map" component={MapScreen} />
            <Stack.Screen name="SiteCreate" component={SiteCreateScreen} />
            <Stack.Screen name="PublicSiteSearch" component={PublicSiteSearchScreen} />
            <Stack.Screen name="SiteManagement" component={SiteManagementScreen} />
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
        <BottomBar
          active={activeTab}
          onSelectTab={selectTab}
          onScan={openScan}
          siteSelected={hasCurrentSite}
        />
      </View>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  stackWrap: { flex: 1 },
});
