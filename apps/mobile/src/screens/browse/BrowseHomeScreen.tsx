import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { TAG_KIND_STYLES } from "../../lib/tagStyle";

type Nav = NativeStackNavigationProp<RootStackParamList, "Browse">;

type Tile = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  onPress: (nav: Nav) => void;
};

const TILES: Tile[] = [
  {
    key: "map",
    label: "Map",
    icon: "map-outline",
    iconColor: "#0ea5e9",
    onPress: (nav) => nav.push("Map"),
  },
  {
    key: "search",
    label: "Search",
    icon: "search-outline",
    onPress: (nav) => nav.push("BrowseSearch"),
  },
  {
    key: "location",
    label: "Locations",
    icon: TAG_KIND_STYLES.location.icon,
    iconColor: TAG_KIND_STYLES.location.color,
    onPress: (nav) => nav.push("BrowseEntries", { category: "location" }),
  },
  {
    key: "tag",
    label: "Tags",
    icon: TAG_KIND_STYLES.custom.icon,
    iconColor: "#16a34a",
    onPress: (nav) => nav.push("BrowseEntries", { category: "tag" }),
  },
  {
    key: "all",
    label: "All",
    icon: "apps-outline",
    onPress: (nav) =>
      nav.push("PlantList", { filter: { kind: "all" }, title: "All plants" }),
  },
];

export default function BrowseHomeScreen() {
  const nav = useNavigation<Nav>();
  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.h1}>Browse</Text>
        <View style={styles.grid}>
          {TILES.map((t) => (
            <Pressable
              key={t.key}
              style={({ pressed }) => [
                styles.tile,
                pressed && { opacity: 0.7, transform: [{ scale: 0.98 }] },
              ]}
              onPress={() => t.onPress(nav)}
            >
              <Ionicons name={t.icon} size={36} color={t.iconColor ?? "#16a34a"} />
              <Text style={styles.tileLabel}>{t.label}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fafafa" },
  scroll: { padding: 16 },
  h1: { fontSize: 28, fontWeight: "600", color: "#171717", marginBottom: 16 },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  tile: {
    width: "48%",
    aspectRatio: 1,
    backgroundColor: "#fff",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e5e5",
  },
  tileLabel: { fontSize: 16, color: "#171717", fontWeight: "500" },
});
