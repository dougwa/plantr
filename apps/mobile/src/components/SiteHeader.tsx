import { Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../contexts/AuthContext";

export default function SiteHeader({ onPress }: { onPress: () => void }) {
  const { state } = useAuth();
  if (state.status !== "authed") return null;

  const current = state.sites.find((s) => s.id === state.currentSiteId) ?? null;
  const label = current?.name ?? "Pick a site";

  return (
    <SafeAreaView edges={["top"]} style={styles.safe}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Switch site"
        onPress={onPress}
        style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
        hitSlop={4}
      >
        <Ionicons
          name={current ? "leaf" : "leaf-outline"}
          size={18}
          color={current ? "#16a34a" : "#a3a3a3"}
        />
        <Text
          style={[styles.name, !current && styles.namePlaceholder]}
          numberOfLines={1}
        >
          {label}
        </Text>
        <Ionicons name="chevron-down" size={18} color="#525252" />
      </Pressable>
      <View style={styles.divider} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: "#fff" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  name: { flex: 1, fontSize: 16, fontWeight: "600", color: "#171717" },
  namePlaceholder: { color: "#a3a3a3", fontWeight: "500" },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: "#e5e5e5" },
});
