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
import AuthImage from "../../components/AuthImage";
import { useAuth } from "../../contexts/AuthContext";
import {
  listPlants,
  type PlantListItem,
  type Tag,
} from "../../lib/api";
import { tagKindStyle } from "../../lib/tagStyle";
import type { PlantFilter } from "../../navigation/BrowseStackTypes";
import type { RootStackParamList } from "../../navigation/types";
import ScreenHeader from "../../components/ScreenHeader";

type Nav = NativeStackNavigationProp<RootStackParamList, "PlantList">;
type Route = RouteProp<RootStackParamList, "PlantList">;

function iconForTags(tagNames: string[]): keyof typeof Ionicons.glyphMap {
  const joined = tagNames.join(" ").toLowerCase();
  if (joined.includes("tree")) return "leaf-outline";
  if (
    joined.includes("orchid") ||
    joined.includes("rose") ||
    joined.includes("hydrangea") ||
    joined.includes("rhodod")
  ) {
    return "flower-outline";
  }
  return "leaf-outline";
}

function matchesFilter(p: PlantListItem, f: PlantFilter): boolean {
  switch (f.kind) {
    case "all":
      return true;
    case "tag": {
      const customTags = p.tags.filter((t) => t.kind === "custom");
      if (f.tagId == null) return customTags.length === 0;
      return customTags.some((t) => t.id === f.tagId);
    }
    case "location": {
      const locTags = p.tags.filter((t) => t.kind === "location");
      if (f.tagId == null) return locTags.length === 0;
      return locTags.some((t) => t.id === f.tagId);
    }
    case "species": {
      const s = p.species?.trim() || null;
      return s === (f.species ?? null);
    }
  }
}

function TagChip({ tag, dense }: { tag: Tag; dense?: boolean }) {
  const s = tagKindStyle(tag.kind);
  return (
    <View
      style={[
        dense ? styles.tagChipDense : styles.tagChip,
        { backgroundColor: s.color },
      ]}
    >
      <Ionicons name={s.icon} size={dense ? 10 : 12} color="#fff" />
      <Text style={dense ? styles.tagChipDenseText : styles.tagChipText} numberOfLines={1}>
        {tag.name}
      </Text>
    </View>
  );
}

export default function PlantListScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { state } = useAuth();
  const token = state.status === "authed" ? state.token : null;

  const [plants, setPlants] = useState<PlantListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"tile" | "list">("tile");

  const reload = useCallback(async () => {
    if (!token) return;
    const pRes = await listPlants(token);
    if (pRes.ok) setPlants(pRes.data.plants);
  }, [token]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await reload();
      setLoading(false);
    })();
  }, [reload]);

  // Refresh on focus so plants edited in PlantDetail show up updated.
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const filtered = useMemo(
    () => plants.filter((p) => matchesFilter(p, route.params.filter)),
    [plants, route.params.filter],
  );

  function open(plantId: string) {
    nav.push("PlantDetail", { plantId });
  }

  const header = (
    <ScreenHeader
      title={route.params.title}
      onBack={() => nav.goBack()}
      right={
        <Pressable
          onPress={() => setView((v) => (v === "tile" ? "list" : "tile"))}
          hitSlop={12}
        >
          <Ionicons
            name={view === "tile" ? "list-outline" : "grid-outline"}
            size={22}
            color="#171717"
          />
        </Pressable>
      }
    />
  );

  if (loading) {
    return (
      <View style={styles.root}>
        {header}
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      </View>
    );
  }

  if (filtered.length === 0) {
    return (
      <View style={styles.root}>
        {header}
        <View style={styles.center}>
          <Text style={styles.empty}>No plants here yet.</Text>
        </View>
      </View>
    );
  }

  if (view === "list") {
    return (
      <View style={styles.root}>
        {header}
        <FlatList
        style={styles.list}
        data={filtered}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [
              styles.listRow,
              pressed && { backgroundColor: "#f5f5f5" },
            ]}
            onPress={() => open(item.id)}
          >
            <View style={styles.listThumb}>
              {item.coverPhotoThumbUrl ? (
                <AuthImage
                  path={item.coverPhotoThumbUrl}
                  style={styles.listThumbImg}
                />
              ) : (
                <Ionicons
                  name={iconForTags(item.tags.map((t) => t.name))}
                  size={24}
                  color="#16a34a"
                />
              )}
            </View>
            <View style={styles.listText}>
              <Text style={styles.listName} numberOfLines={1}>
                {item.name?.trim() || item.qrCode}
              </Text>
              {item.tags.length > 0 ? (
                <View style={styles.listTagRow}>
                  {item.tags.map((t) => (
                    <TagChip key={t.id} tag={t} />
                  ))}
                </View>
              ) : (
                <Text style={styles.listMeta} numberOfLines={1}>
                  {[
                    item.name?.trim() ? item.qrCode : null,
                    item.species,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </Text>
              )}
            </View>
            <Ionicons name="chevron-forward" size={18} color="#a3a3a3" />
          </Pressable>
        )}
      />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {header}
      <FlatList
        style={styles.list}
        data={filtered}
        key="tile-2col"
        numColumns={2}
        contentContainerStyle={styles.tileContent}
        columnWrapperStyle={styles.tileRow}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.tile, pressed && { opacity: 0.7 }]}
            onPress={() => open(item.id)}
          >
            <View style={styles.tileImageWrap}>
              {item.coverPhotoThumbUrl ? (
                <AuthImage
                  path={item.coverPhotoThumbUrl}
                  style={styles.tileImage}
                  resizeMode="cover"
                />
              ) : (
                <Ionicons
                  name={iconForTags(item.tags.map((t) => t.name))}
                  size={48}
                  color="#16a34a"
                />
              )}
            </View>
            <Text style={styles.tileName} numberOfLines={1}>
              {item.name?.trim() || item.qrCode}
            </Text>
            {item.tags.length > 0 ? (
              <View style={styles.tileTagRow}>
                {item.tags.slice(0, 3).map((t) => (
                  <TagChip key={t.id} tag={t} dense />
                ))}
              </View>
            ) : (
              <Text style={styles.tileType} numberOfLines={1}>
                {item.name?.trim() ? item.qrCode : ""}
              </Text>
            )}
          </Pressable>
        )}
      />
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

  listRow: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e5e5",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  listThumb: {
    width: 48,
    height: 48,
    borderRadius: 6,
    backgroundColor: "#f5f5f5",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  listThumbImg: { width: 48, height: 48 },
  listText: { flex: 1 },
  listName: { fontSize: 15, fontWeight: "500", color: "#171717" },
  listMeta: { fontSize: 12, color: "#737373", marginTop: 2 },
  listTagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 4,
  },
  tagChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  tagChipText: { color: "#fff", fontSize: 11, fontWeight: "500" },
  tagChipDense: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
  },
  tagChipDenseText: { color: "#fff", fontSize: 10, fontWeight: "500" },
  tileTagRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 3,
    paddingHorizontal: 8,
    paddingTop: 2,
  },

  tileContent: { padding: 12, gap: 12 },
  tileRow: { gap: 12 },
  tile: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 10,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e5e5",
    paddingBottom: 8,
  },
  tileImageWrap: {
    aspectRatio: 1,
    backgroundColor: "#f5f5f5",
    alignItems: "center",
    justifyContent: "center",
  },
  tileImage: { width: "100%", height: "100%" },
  tileName: {
    fontSize: 14,
    fontWeight: "500",
    color: "#171717",
    paddingHorizontal: 8,
    paddingTop: 6,
  },
  tileType: { fontSize: 12, color: "#737373", paddingHorizontal: 8 },
});
