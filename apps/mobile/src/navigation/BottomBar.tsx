import { Pressable, StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { SafeAreaView } from "react-native-safe-area-context";
import type { RootTab } from "./types";

type Item = {
  route: RootTab;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  gated: boolean;
};

const ITEMS: Item[] = [
  { route: "Sites", icon: "albums-outline", label: "Sites", gated: false },
  { route: "Browse", icon: "grid-outline", label: "Browse", gated: true },
  { route: "Reports", icon: "bar-chart-outline", label: "Reports", gated: true },
  { route: "Settings", icon: "settings-outline", label: "Settings", gated: false },
];

export default function BottomBar({
  active,
  onSelectTab,
  onScan,
  siteSelected,
}: {
  active: RootTab;
  onSelectTab: (tab: RootTab) => void;
  onScan: () => void;
  siteSelected: boolean;
}) {
  return (
    <SafeAreaView edges={["bottom"]} style={styles.safe}>
      <View style={styles.bar}>
        <BarButton
          item={ITEMS[0]!}
          active={active === ITEMS[0]!.route}
          disabled={false}
          onPress={() => onSelectTab(ITEMS[0]!.route)}
        />
        <BarButton
          item={ITEMS[1]!}
          active={active === ITEMS[1]!.route}
          disabled={!siteSelected}
          onPress={() => onSelectTab(ITEMS[1]!.route)}
        />
        <ScanButton onPress={onScan} disabled={!siteSelected} />
        <BarButton
          item={ITEMS[2]!}
          active={active === ITEMS[2]!.route}
          disabled={!siteSelected}
          onPress={() => onSelectTab(ITEMS[2]!.route)}
        />
        <BarButton
          item={ITEMS[3]!}
          active={active === ITEMS[3]!.route}
          disabled={false}
          onPress={() => onSelectTab(ITEMS[3]!.route)}
        />
      </View>
    </SafeAreaView>
  );
}

function BarButton({
  item,
  active,
  disabled,
  onPress,
}: {
  item: Item;
  active: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.label}
      accessibilityState={{ disabled }}
      onPress={onPress}
      style={styles.tab}
      hitSlop={6}
    >
      <Ionicons
        name={item.icon}
        size={24}
        color={disabled ? "#d4d4d4" : active ? "#171717" : "#a3a3a3"}
      />
    </Pressable>
  );
}

function ScanButton({ onPress, disabled }: { onPress: () => void; disabled: boolean }) {
  return (
    <View style={styles.scanSlot} pointerEvents="box-none">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Scan QR code"
        accessibilityState={{ disabled }}
        onPress={onPress}
        style={({ pressed }) => [
          styles.scanButton,
          disabled && styles.scanButtonDisabled,
          pressed && { transform: [{ scale: 0.96 }], opacity: 0.9 },
        ]}
      >
        <Ionicons name="qr-code-outline" size={28} color="#fff" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    backgroundColor: "#fff",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#e5e5e5",
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    height: 50,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
  },
  scanSlot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  scanButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#16a34a",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  scanButtonDisabled: { backgroundColor: "#bbf7d0" },
});
