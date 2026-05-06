import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useAuth } from "../../contexts/AuthContext";
import {
  listLocationShapes,
  listPlants,
  listTags,
  type LocationShape,
  type PlantListItem,
  type Tag,
} from "../../lib/api";
import { shapeIdsForPlant } from "../../lib/geometry";
import type {
  BrowseStackParamList,
  PlantFilter,
} from "../../navigation/BrowseStackTypes";

type Nav = NativeStackNavigationProp<BrowseStackParamList, "BrowseEntries">;
type Route = RouteProp<BrowseStackParamList, "BrowseEntries">;

type Entry = {
  key: string;
  label: string;
  count: number;
  filter: PlantFilter;
  color?: string;
};

const CATEGORY_TITLES: Record<string, string> = {
  location: "Locations",
  tag: "Tags",
  species: "Species",
};

export default function BrowseEntriesScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { state } = useAuth();
  const token = state.status === "authed" ? state.token : null;

  const [plants, setPlants] = useState<PlantListItem[]>([]);
  const [shapes, setShapes] = useState<LocationShape[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    nav.setOptions({ title: CATEGORY_TITLES[route.params.category] ?? "Browse" });
  }, [nav, route.params.category]);

  useEffect(() => {
    if (!token) return;
    (async () => {
      setLoading(true);
      const [pRes, sRes, tRes] = await Promise.all([
        listPlants(token),
        listLocationShapes(token),
        listTags(token),
      ]);
      if (pRes.ok) setPlants(pRes.data.plants);
      if (sRes.ok) setShapes(sRes.data.shapes);
      if (tRes.ok) setTags(tRes.data.tags);
      setLoading(false);
    })();
  }, [token]);

  const entries: Entry[] = useMemo(() => {
    const cat = route.params.category;
    if (cat === "location") {
      const counts = new Map<string, number>();
      let unassignedCount = 0;
      for (const p of plants) {
        const ids = shapeIdsForPlant(p, shapes);
        if (ids.size === 0) {
          unassignedCount += 1;
          continue;
        }
        for (const id of ids) {
          counts.set(id, (counts.get(id) ?? 0) + 1);
        }
      }
      const named: Entry[] = shapes
        .map((s) => ({
          key: s.id,
          label: s.name?.trim() || "(unnamed)",
          count: counts.get(s.id) ?? 0,
          filter: {
            kind: "location" as const,
            shapeId: s.id,
            label: s.name?.trim() || "(unnamed)",
          },
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
      if (unassignedCount > 0) {
        named.push({
          key: "__unassigned",
          label: "Unassigned",
          count: unassignedCount,
          filter: { kind: "location", shapeId: null, label: "Unassigned" },
        });
      }
      return named;
    }
    if (cat === "tag") {
      const counts = new Map<string, number>();
      let unassignedCount = 0;
      for (const p of plants) {
        if (p.tags.length === 0) {
          unassignedCount += 1;
          continue;
        }
        for (const t of p.tags) {
          counts.set(t.id, (counts.get(t.id) ?? 0) + 1);
        }
      }
      const named: Entry[] = tags
        .map((t) => ({
          key: t.id,
          label: t.name,
          count: counts.get(t.id) ?? 0,
          color: t.color,
          filter: { kind: "tag" as const, tagId: t.id, label: t.name },
        }))
        .filter((e) => e.count > 0)
        .sort((a, b) => a.label.localeCompare(b.label));
      if (unassignedCount > 0) {
        named.push({
          key: "__unassigned",
          label: "Untagged",
          count: unassignedCount,
          filter: { kind: "tag", tagId: null, label: "Untagged" },
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
  }, [plants, shapes, tags, route.params.category]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (entries.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>Nothing to browse yet.</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.list}
      data={entries}
      keyExtractor={(e) => e.key}
      renderItem={({ item }) => (
        <Pressable
          style={({ pressed }) => [styles.row, pressed && { backgroundColor: "#f5f5f5" }]}
          onPress={() =>
            nav.navigate("PlantList", { filter: item.filter, title: item.label })
          }
        >
          {item.color && (
            <View style={[styles.tagDot, { backgroundColor: item.color }]} />
          )}
          <Text style={styles.rowLabel}>{item.label}</Text>
          <View style={styles.rowRight}>
            <Text style={styles.rowCount}>{item.count}</Text>
            <Ionicons name="chevron-forward" size={18} color="#a3a3a3" />
          </View>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
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
  tagDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  rowLabel: { fontSize: 16, color: "#171717", flex: 1 },
  rowRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowCount: { fontSize: 14, color: "#737373" },
});
