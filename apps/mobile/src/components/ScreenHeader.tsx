import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";

export default function ScreenHeader({
  title,
  icon,
  iconColor,
  onBack,
  right,
}: {
  title: string;
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  onBack?: () => void;
  right?: ReactNode;
}) {
  return (
    <SafeAreaView edges={["top"]} style={styles.safe}>
      <View style={styles.row}>
        <View style={styles.side}>
          {onBack ? (
            <Pressable onPress={onBack} hitSlop={12}>
              <Ionicons name="chevron-back" size={28} color="#171717" />
            </Pressable>
          ) : null}
        </View>
        <View style={styles.titleWrap}>
          {icon ? (
            <Ionicons
              name={icon}
              size={18}
              color={iconColor ?? "#171717"}
              style={styles.titleIcon}
            />
          ) : null}
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        </View>
        <View style={[styles.side, styles.sideRight]}>{right}</View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    backgroundColor: "#fff",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e5e5",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 44,
  },
  side: {
    width: 44,
    alignItems: "flex-start",
    justifyContent: "center",
  },
  sideRight: { alignItems: "flex-end" },
  titleWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  titleIcon: {},
  title: {
    fontSize: 17,
    fontWeight: "600",
    color: "#171717",
    flexShrink: 1,
  },
});
