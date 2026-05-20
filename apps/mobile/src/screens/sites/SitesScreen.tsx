import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { useAuth } from "../../contexts/AuthContext";
import type { SiteRole, SiteSummary } from "../../lib/api";

type Nav = NativeStackNavigationProp<RootStackParamList, "Sites">;

const ROLE_LABEL: Record<SiteRole, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  USER: "Member",
  VIEWER: "Viewer",
};

export default function SitesScreen() {
  const nav = useNavigation<Nav>();
  const { state, refreshSites, setCurrentSite } = useAuth();
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      // Re-pull on focus — covers external mutations (a peer kicks you out,
      // an invitation got accepted, etc.).
      refreshSites();
    }, [refreshSites]),
  );

  if (state.status !== "authed") return null;

  async function onRefresh() {
    setRefreshing(true);
    await refreshSites();
    setRefreshing(false);
  }

  const sites = state.sites;
  const currentId = state.currentSiteId;

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={styles.h1}>Sites</Text>

        <Pressable
          style={({ pressed }) => [styles.discoverRow, pressed && styles.pressed]}
          onPress={() => nav.push("PublicSiteSearch")}
        >
          <Ionicons name="search-outline" size={22} color="#16a34a" />
          <View style={{ flex: 1 }}>
            <Text style={styles.discoverTitle}>Find public sites</Text>
            <Text style={styles.discoverHint}>Browse public gardens near you or by name.</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#a3a3a3" />
        </Pressable>

        <Text style={styles.sectionLabel}>MY SITES</Text>
        {sites.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              You're not part of any sites yet. Create one to get started.
            </Text>
          </View>
        ) : (
          sites.map((s) => (
            <SiteRow
              key={s.id}
              site={s}
              isCurrent={s.id === currentId}
              onSelect={() => setCurrentSite(s.id)}
              onManage={() => nav.push("SiteManagement", { siteId: s.id })}
            />
          ))
        )}

        <Pressable
          style={({ pressed }) => [styles.createBtn, pressed && styles.pressed]}
          onPress={() => nav.push("SiteCreate")}
        >
          <Ionicons name="add" size={22} color="#fff" />
          <Text style={styles.createText}>Create a new site</Text>
        </Pressable>

        {state.status === "authed" && state.sites.length === 0 ? (
          <Text style={styles.note}>
            New users start without any sites. Create one to plant your flag, or join a
            public site via search.
          </Text>
        ) : null}
      </ScrollView>
      {refreshing && state.sites.length === 0 && (
        <View pointerEvents="none" style={styles.spinner}>
          <ActivityIndicator />
        </View>
      )}
    </SafeAreaView>
  );
}

function SiteRow({
  site,
  isCurrent,
  onSelect,
  onManage,
}: {
  site: SiteSummary;
  isCurrent: boolean;
  onSelect: () => void;
  onManage: () => void;
}) {
  return (
    <View style={[styles.siteRow, isCurrent && styles.siteRowActive]}>
      <Pressable
        onPress={onSelect}
        style={({ pressed }) => [styles.siteMain, pressed && { opacity: 0.7 }]}
      >
        <View style={[styles.dot, isCurrent ? styles.dotActive : styles.dotIdle]} />
        <View style={{ flex: 1 }}>
          <Text style={styles.siteName}>{site.name}</Text>
          <Text style={styles.siteMeta}>
            {ROLE_LABEL[site.role]} · {site.visibility === "PUBLIC" ? "Public" : "Private"}
          </Text>
        </View>
      </Pressable>
      <Pressable
        onPress={onManage}
        hitSlop={10}
        style={({ pressed }) => [styles.manageBtn, pressed && { opacity: 0.5 }]}
        accessibilityLabel={`Manage ${site.name}`}
      >
        <Ionicons name="settings-outline" size={20} color="#525252" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fafafa" },
  scroll: { padding: 16, paddingBottom: 40 },
  h1: { fontSize: 28, fontWeight: "600", color: "#171717", marginBottom: 16 },
  pressed: { opacity: 0.7 },
  discoverRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e5e5",
  },
  discoverTitle: { fontSize: 15, fontWeight: "500", color: "#171717" },
  discoverHint: { fontSize: 12, color: "#737373", marginTop: 2 },

  sectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#737373",
    marginTop: 24,
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  empty: {
    padding: 16,
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e5e5",
  },
  emptyText: { color: "#737373", fontSize: 14, lineHeight: 20 },
  siteRow: {
    flexDirection: "row",
    alignItems: "stretch",
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e5e5",
    marginBottom: 8,
    overflow: "hidden",
  },
  siteRowActive: {
    borderColor: "#16a34a",
    borderWidth: 1.5,
  },
  siteMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotActive: { backgroundColor: "#16a34a" },
  dotIdle: { backgroundColor: "#d4d4d4" },
  siteName: { fontSize: 16, fontWeight: "500", color: "#171717" },
  siteMeta: { fontSize: 12, color: "#737373", marginTop: 2 },
  manageBtn: { paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },

  createBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    justifyContent: "center",
    backgroundColor: "#16a34a",
    borderRadius: 12,
    padding: 14,
    marginTop: 16,
  },
  createText: { color: "#fff", fontSize: 15, fontWeight: "500" },
  note: { color: "#737373", fontSize: 12, marginTop: 16, lineHeight: 18 },
  spinner: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "center",
  },
});
