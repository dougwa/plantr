import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useAuth } from "../../contexts/AuthContext";
import {
  listPlants,
  listTags,
  type PlantListItem,
  type Tag,
} from "../../lib/api";
import { tagKindStyle } from "../../lib/tagStyle";
import type { PlantFilter } from "../../navigation/BrowseStackTypes";
import type { RootStackParamList } from "../../navigation/types";
import ScreenHeader from "../../components/ScreenHeader";

type Nav = NativeStackNavigationProp<RootStackParamList, "BrowseEntries">;
type Route = RouteProp<RootStackParamList, "BrowseEntries">;

type Entry = {
  key: string;
  label: string;
  count: number;
  filter: PlantFilter;
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
};

const CATEGORY_TITLES: Record<string, string> = {
  location: "Locations",
  tag: "Custom Tags",
  species: "Species",
};

export default function BrowseEntriesScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { state } = useAuth();
  const token = state.status === "authed" ? state.token : null;

  const [plants, setPlants] = useState<PlantListItem[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);

  const title = CATEGORY_TITLES[route.params.category] ?? "Browse";

  const reload = useCallback(async () => {
    if (!token) return;
    const [pRes, tRes] = await Promise.all([listPlants(token), listTags(token)]);
    if (pRes.ok) setPlants(pRes.data.plants);
    if (tRes.ok) setTags(tRes.data.tags);
  }, [token]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await reload();
      setLoading(false);
    })();
  }, [reload]);

  // Refresh on focus so entities deleted in PlantList disappear here.
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const entries: Entry[] = useMemo(() => {
    const cat = route.params.category;

    if (cat === "location" || cat === "tag") {
      const wantKind = cat === "location" ? "location" : "custom";
      const style = tagKindStyle(wantKind);
      const tagsOfKind = tags.filter((t) => t.kind === wantKind);
      const counts = new Map<string, number>();
      let unassignedCount = 0;
      for (const p of plants) {
        const matching = p.tags.filter((t) => t.kind === wantKind);
        if (matching.length === 0) {
          unassignedCount += 1;
          continue;
        }
        for (const t of matching) counts.set(t.id, (counts.get(t.id) ?? 0) + 1);
      }
      const named: Entry[] = tagsOfKind
        .map((t) => ({
          key: t.id,
          label: t.name,
          count: counts.get(t.id) ?? 0,
          icon: style.icon,
          iconColor: style.color,
          filter:
            cat === "location"
              ? { kind: "location" as const, tagId: t.id, label: t.name }
              : { kind: "tag" as const, tagId: t.id, label: t.name },
        }))
        .filter((e) => (cat === "location" ? true : e.count > 0))
        .sort((a, b) => a.label.localeCompare(b.label));
      if (unassignedCount > 0) {
        const unassignedLabel = cat === "location" ? "Unassigned" : "Untagged";
        named.push({
          key: "__unassigned",
          label: unassignedLabel,
          count: unassignedCount,
          filter:
            cat === "location"
              ? { kind: "location", tagId: null, label: unassignedLabel }
              : { kind: "tag", tagId: null, label: unassignedLabel },
        });
      }
      return named;
    }

    // species
    const counts = new Map<string | null, number>();
    for (const p of plants) {
      const k = p.species?.trim() ? p.species.trim() : null;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const named: Entry[] = [];
    for (const [species, count] of counts) {
      if (species == null) continue;
      named.push({
        key: species,
        label: species,
        count,
        filter: { kind: "species", species, label: species },
      });
    }
    named.sort((a, b) => a.label.localeCompare(b.label));
    const unassignedCount = counts.get(null) ?? 0;
    if (unassignedCount > 0) {
      named.push({
        key: "__unassigned",
        label: "Unspecified",
        count: unassignedCount,
        filter: { kind: "species", species: null, label: "Unspecified" },
      });
    }
    return named;
  }, [plants, tags, route.params.category]);

  return (
    <View style={styles.root}>
      <ScreenHeader title={title} onBack={() => nav.goBack()} />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : entries.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.empty}>Nothing to browse yet.</Text>
        </View>
      ) : (
        <FlatList
          style={styles.list}
          data={entries}
          keyExtractor={(e) => e.key}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: "#f5f5f5" }]}
              onPress={() =>
                nav.push("PlantList", { filter: item.filter, title: item.label })
              }
            >
              {item.icon && (
                <Ionicons name={item.icon} size={16} color={item.iconColor ?? "#737373"} />
              )}
              <Text style={styles.rowLabel}>{item.label}</Text>
              <View style={styles.rowRight}>
                <Text style={styles.rowCount}>{item.count}</Text>
                <Ionicons name="chevron-forward" size={18} color="#a3a3a3" />
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fff" },
  list: { flex: 1, backgroundColor: "#fff" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fafafa",
  },
  empty: { color: "#737373" },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e5e5",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  rowLabel: { fontSize: 16, color: "#171717", flex: 1 },
  rowRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowCount: { fontSize: 14, color: "#737373" },
});
