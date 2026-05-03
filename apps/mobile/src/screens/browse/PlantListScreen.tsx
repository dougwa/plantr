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
import { listPlants, type PlantListItem } from "../../lib/api";
import type { BrowseStackParamList, PlantFilter } from "../../navigation/BrowseStackTypes";
import type { RootStackParamList } from "../../navigation/types";

type StackNav = NativeStackNavigationProp<BrowseStackParamList, "PlantList">;
type RootNav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<BrowseStackParamList, "PlantList">;

function iconForType(typeName: string | null): keyof typeof Ionicons.glyphMap {
  const n = (typeName ?? "").toLowerCase();
  if (n.includes("tree")) return "leaf-outline";
  if (
    n.includes("orchid") ||
    n.includes("rose") ||
    n.includes("hydrangea") ||
    n.includes("rhodod")
  ) {
    return "flower-outline";
  }
  return "leaf-outline";
}

function matchesFilter(p: PlantListItem, f: PlantFilter): boolean {
  switch (f.kind) {
    case "all":
      return true;
    case "type":
      return (p.type?.id ?? null) === f.typeId;
    case "location":
      return (p.locationShapeId ?? null) === f.shapeId;
    case "species": {
      const s = p.species?.trim() || null;
      return s === (f.species ?? null);
    }
  }
}

export default function PlantListScreen() {
  const stackNav = useNavigation<StackNav>();
  const rootNav = useNavigation<RootNav>();
  const route = useRoute<Route>();
  const { state } = useAuth();
  const token = state.status === "authed" ? state.token : null;

  const [plants, setPlants] = useState<PlantListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"tile" | "list">("tile");

  const reload = useCallback(async () => {
    if (!token) return;
    const r = await listPlants(token);
    if (r.ok) setPlants(r.data.plants);
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

  useEffect(() => {
    stackNav.setOptions({
      title: route.params.title,
      headerRight: () => (
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
      ),
    });
  }, [stackNav, route.params.title, view]);

  const filtered = useMemo(
    () => plants.filter((p) => matchesFilter(p, route.params.filter)),
    [plants, route.params.filter],
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (filtered.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>No plants here yet.</Text>
      </View>
    );
  }

  function open(plantId: string) {
    rootNav.navigate("PlantDetail", { plantId });
  }

  if (view === "list") {
    return (
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
                  name={iconForType(item.type?.name ?? null)}
                  size={24}
                  color="#16a34a"
                />
              )}
            </View>
            <View style={styles.listText}>
              <Text style={styles.listName} numberOfLines={1}>
                {item.name?.trim() || item.qrCode}
              </Text>
              <Text style={styles.listMeta} numberOfLines={1}>
                {[
                  item.name?.trim() ? item.qrCode : null,
                  item.type?.name,
                  item.species,
                ]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#a3a3a3" />
          </Pressable>
        )}
      />
    );
  }

  return (
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
                name={iconForType(item.type?.name ?? null)}
                size={48}
                color="#16a34a"
              />
            )}
          </View>
          <Text style={styles.tileName} numberOfLines={1}>
            {item.name?.trim() || item.qrCode}
          </Text>
          <Text style={styles.tileType} numberOfLines={1}>
            {[item.name?.trim() ? item.qrCode : null, item.type?.name]
              .filter(Boolean)
              .join(" · ")}
          </Text>
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
