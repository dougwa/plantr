import { useCallback, useEffect, useRef, useState } from "react";
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
import SiteCreateScreen from "../screens/sites/SiteCreateScreen";
import SiteManagementScreen from "../screens/sites/SiteManagementScreen";
import PublicSiteSearchScreen from "../screens/sites/PublicSiteSearchScreen";
import SiteInviteScreen from "../screens/sites/SiteInviteScreen";
import NotificationsScreen from "../screens/sites/NotificationsScreen";
import { useAuth } from "../contexts/AuthContext";
import SiteHeader from "../components/SiteHeader";
import SiteSelectorModal from "../components/SiteSelectorModal";
import BottomBar from "./BottomBar";
import type { RootStackParamList, RootTab } from "./types";

const Stack = createNativeStackNavigator<RootStackParamList>();

const ROOT_TABS: RootTab[] = ["Map", "Browse", "Reports", "Settings"];

function isRootTab(name: string | null | undefined): name is RootTab {
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
  const [activeTab, setActiveTab] = useState<RootTab>("Map");
  const [topRoute, setTopRoute] = useState<string | null>("Map");
  const [modalOpen, setModalOpen] = useState(false);
  const lastActiveRef = useRef<RootTab>("Map");
  // Tracks whether we've already auto-opened the modal for the current
  // null-site state. Reset whenever a site is selected so a later null
  // (e.g. site deletion) re-triggers the auto-open.
  const autoOpenedForNull = useRef(false);

  // Auto-open the modal whenever the user transitions into a no-site state
  // (post-login, site deleted, etc.). Dismissing via Settings sticks for the
  // remainder of this null-state run.
  useEffect(() => {
    if (state.status !== "authed") {
      autoOpenedForNull.current = false;
      return;
    }
    if (state.currentSiteId == null) {
      if (!autoOpenedForNull.current) {
        autoOpenedForNull.current = true;
        setModalOpen(true);
      }
    } else {
      autoOpenedForNull.current = false;
    }
  }, [state]);

  const closeModal = useCallback(() => setModalOpen(false), []);
  const openModal = useCallback(() => setModalOpen(true), []);

  function selectTab(tab: RootTab) {
    if (tab === "Settings") {
      closeModal();
      navigationRef.reset({ index: 0, routes: [{ name: tab }] });
      return;
    }
    if (!hasCurrentSite) {
      openModal();
      return;
    }
    navigationRef.reset({ index: 0, routes: [{ name: tab }] });
  }

  function openScan() {
    if (!hasCurrentSite) {
      openModal();
      return;
    }
    navigationRef.navigate("Scan");
  }

  function navigateFromModal(
    destination: "SiteCreate" | "SiteManagement" | "PublicSiteSearch" | "Notifications",
    params?: { siteId: string },
  ) {
    closeModal();
    if (destination === "SiteManagement" && params) {
      navigationRef.navigate("SiteManagement", params);
    } else if (destination === "SiteCreate") {
      navigationRef.navigate("SiteCreate");
    } else if (destination === "PublicSiteSearch") {
      navigationRef.navigate("PublicSiteSearch");
    } else if (destination === "Notifications") {
      navigationRef.navigate("Notifications");
    }
  }

  const showHeader = isRootTab(topRoute);

  return (
    <NavigationContainer
      ref={navigationRef}
      onStateChange={(navState) => {
        const next = deriveActive(navState ?? undefined, lastActiveRef.current);
        if (next !== lastActiveRef.current) {
          lastActiveRef.current = next;
          setActiveTab(next);
        }
        const top = navState?.routes[navState.index]?.name;
        setTopRoute(top ?? null);
      }}
    >
      <View style={styles.root}>
        {showHeader ? <SiteHeader onPress={openModal} /> : null}
        <View style={styles.stackWrap}>
          <Stack.Navigator
            initialRouteName="Map"
            screenOptions={{ headerShown: false }}
          >
            <Stack.Screen name="Map" component={MapScreen} />
            <Stack.Screen name="Browse" component={BrowseHomeScreen} />
            <Stack.Screen name="Reports" component={ReportsScreen} />
            <Stack.Screen name="Settings" component={SettingsScreen} />
            <Stack.Screen name="SiteCreate" component={SiteCreateScreen} />
            <Stack.Screen name="PublicSiteSearch" component={PublicSiteSearchScreen} />
            <Stack.Screen name="SiteManagement" component={SiteManagementScreen} />
            <Stack.Screen name="SiteInvite" component={SiteInviteScreen} />
            <Stack.Screen name="Notifications" component={NotificationsScreen} />
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
        <SiteSelectorModal
          visible={modalOpen}
          onClose={closeModal}
          onNavigate={navigateFromModal}
        />
      </View>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  stackWrap: { flex: 1 },
});
