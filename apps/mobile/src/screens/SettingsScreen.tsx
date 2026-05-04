import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../contexts/AuthContext";
import {
  ALL_BARCODE_TYPES,
  BARCODE_LABELS,
  loadEnabledBarcodeTypes,
  saveEnabledBarcodeTypes,
  type BarcodeType,
} from "../lib/scannerTypes";
import { clearImageCache, getImageCacheBytes } from "../lib/imageCache";

export default function SettingsScreen() {
  const { state, signOut } = useAuth();
  if (state.status !== "authed") return null;

  function confirmSignOut() {
    Alert.alert("Sign out?", "You will need to log in again.", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: signOut },
    ]);
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Settings</Text>

        <View style={styles.row}>
          <Text style={styles.label}>Signed in as</Text>
          <Text style={styles.value}>{state.user.username}</Text>
        </View>

        <ScannerSection />

        <StorageSection />

        <TouchableOpacity style={styles.button} onPress={confirmSignOut}>
          <Text style={styles.buttonText}>Sign out</Text>
        </TouchableOpacity>
        <Text style={styles.note}>User and plant-type management coming soon.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function ScannerSection() {
  const [enabled, setEnabled] = useState<BarcodeType[] | null>(null);

  useEffect(() => {
    loadEnabledBarcodeTypes().then(setEnabled);
  }, []);

  function toggle(type: BarcodeType) {
    if (!enabled) return;
    let next: BarcodeType[];
    if (enabled.includes(type)) {
      next = enabled.filter((t) => t !== type);
      if (next.length === 0) {
        Alert.alert("Keep one enabled", "At least one barcode type must be on.");
        return;
      }
    } else {
      next = [...enabled, type];
    }
    setEnabled(next);
    saveEnabledBarcodeTypes(next);
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Scanner</Text>
      <Text style={styles.sectionHint}>
        Choose which barcode formats the scanner will recognize.
      </Text>
      {ALL_BARCODE_TYPES.map((t) => {
        const on = enabled?.includes(t) ?? true;
        return (
          <Pressable
            key={t}
            style={({ pressed }) => [
              styles.toggleRow,
              pressed && { backgroundColor: "#f5f5f5" },
            ]}
            onPress={() => toggle(t)}
            disabled={enabled === null}
          >
            <Text style={styles.toggleLabel}>{BARCODE_LABELS[t]}</Text>
            <Ionicons
              name={on ? "checkbox" : "square-outline"}
              size={24}
              color={on ? "#16a34a" : "#a3a3a3"}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

function StorageSection() {
  const [bytes, setBytes] = useState<number | null>(null);
  const [working, setWorking] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const n = await getImageCacheBytes();
      setBytes(n);
    } catch (err) {
      console.warn("getImageCacheBytes failed", err);
      setBytes(0);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  function confirmClear() {
    Alert.alert(
      "Clear photo cache?",
      "Cached photos will be re-downloaded as you view them.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: async () => {
            setWorking(true);
            try {
              await clearImageCache();
              await refresh();
            } catch (err) {
              Alert.alert("Clear failed", String(err));
            } finally {
              setWorking(false);
            }
          },
        },
      ],
    );
  }

  const empty = bytes === 0;
  const disabled = working || bytes === null || empty;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Storage</Text>
      <Text style={styles.sectionHint}>
        Photos are cached on your device after first view.
      </Text>
      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>Photo cache</Text>
        <Text style={styles.value}>
          {bytes === null ? "…" : formatBytes(bytes)}
        </Text>
      </View>
      <Pressable
        onPress={confirmClear}
        disabled={disabled}
        style={({ pressed }) => [
          styles.clearButton,
          pressed && !disabled && { backgroundColor: "#f5f5f5" },
          disabled && { opacity: 0.5 },
        ]}
      >
        <Text style={styles.clearButtonText}>
          {working ? "Clearing…" : "Clear cache"}
        </Text>
      </Pressable>
    </View>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fafafa" },
  scroll: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 28, fontWeight: "600", color: "#171717", marginBottom: 24 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#d4d4d4",
  },
  label: { color: "#525252", fontSize: 16 },
  value: { color: "#171717", fontSize: 16, fontWeight: "500" },
  section: { marginTop: 28 },
  sectionTitle: { fontSize: 20, fontWeight: "600", color: "#171717" },
  sectionHint: { color: "#737373", fontSize: 13, marginTop: 4, marginBottom: 8 },
  toggleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e5e5",
  },
  toggleLabel: { fontSize: 16, color: "#171717" },
  button: {
    marginTop: 32,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#d4d4d4",
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
  },
  buttonText: { color: "#dc2626", fontSize: 16, fontWeight: "500" },
  note: { marginTop: 24, color: "#737373", fontSize: 13 },
  clearButton: {
    marginTop: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#d4d4d4",
    borderRadius: 8,
    padding: 12,
    alignItems: "center",
  },
  clearButtonText: { color: "#171717", fontSize: 15, fontWeight: "500" },
});
