import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { useAuth } from "../../contexts/AuthContext";
import { createSite } from "../../lib/api";

type Nav = NativeStackNavigationProp<RootStackParamList, "SiteCreate">;
type Visibility = "PRIVATE" | "PUBLIC";

export default function SiteCreateScreen() {
  const nav = useNavigation<Nav>();
  const { state, refreshSites, setCurrentSite } = useAuth();
  const token = state.status === "authed" ? state.token : null;
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("PRIVATE");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token) return null;

  async function onSubmit() {
    if (!token) return;
    setError(null);
    if (!name.trim()) {
      setError("Give your site a name.");
      return;
    }
    setBusy(true);
    const r = await createSite(token, {
      name: name.trim(),
      address: address.trim() || undefined,
      visibility,
    });
    setBusy(false);
    if (!r.ok) {
      if (r.error === "plan_limit_owned_sites") {
        setError("Your plan only allows one owned site. Upgrade to add more.");
      } else {
        setError("Could not create the site. Try again.");
      }
      return;
    }
    // Set the new site as current and pop back to Sites tab.
    await refreshSites();
    setCurrentSite(r.data.site.id);
    nav.goBack();
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => nav.goBack()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color="#171717" />
        </Pressable>
        <Text style={styles.title}>New site</Text>
        <View style={styles.backBtn} />
      </View>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.label}>Name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="e.g. Backyard Roses"
            style={styles.input}
            autoCapitalize="words"
            autoFocus
          />

          <Text style={styles.label}>Address (optional)</Text>
          <TextInput
            value={address}
            onChangeText={setAddress}
            placeholder="Street, City"
            style={styles.input}
            autoCapitalize="words"
          />
          <Text style={styles.hint}>
            Used to center the map and to surface this site in public "near me" search if
            you choose Public.
          </Text>

          <Text style={styles.label}>Visibility</Text>
          <VisibilityToggle value={visibility} onChange={setVisibility} />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            onPress={onSubmit}
            disabled={busy}
            style={({ pressed }) => [
              styles.submit,
              (busy || pressed) && { opacity: 0.7 },
            ]}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitText}>Create site</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function VisibilityToggle({
  value,
  onChange,
}: {
  value: Visibility;
  onChange: (v: Visibility) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <Pressable
        onPress={() => onChange("PRIVATE")}
        style={[styles.toggleOption, value === "PRIVATE" && styles.toggleOptionActive]}
      >
        <Ionicons
          name="lock-closed-outline"
          size={18}
          color={value === "PRIVATE" ? "#16a34a" : "#525252"}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.toggleTitle}>Private</Text>
          <Text style={styles.toggleHint}>Only invited members can view.</Text>
        </View>
      </Pressable>
      <Pressable
        onPress={() => onChange("PUBLIC")}
        style={[styles.toggleOption, value === "PUBLIC" && styles.toggleOptionActive]}
      >
        <Ionicons
          name="globe-outline"
          size={18}
          color={value === "PUBLIC" ? "#16a34a" : "#525252"}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.toggleTitle}>Public</Text>
          <Text style={styles.toggleHint}>
            Anyone can view plants and photos. Treatment notes stay hidden.
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fafafa" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: "#fff",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e5e5",
  },
  backBtn: { width: 40, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 17, fontWeight: "600", color: "#171717", textAlign: "center" },
  body: { padding: 16, gap: 6 },
  label: {
    fontSize: 12,
    fontWeight: "600",
    color: "#737373",
    marginTop: 16,
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d4d4d4",
    padding: 12,
    fontSize: 16,
    color: "#171717",
  },
  hint: { color: "#737373", fontSize: 12, marginTop: 4, lineHeight: 18 },
  toggleRow: { gap: 8 },
  toggleOption: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
    padding: 12,
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d4d4d4",
  },
  toggleOptionActive: { borderColor: "#16a34a", backgroundColor: "#f0fdf4" },
  toggleTitle: { fontSize: 15, color: "#171717", fontWeight: "500" },
  toggleHint: { fontSize: 12, color: "#737373", marginTop: 2 },
  error: { color: "#dc2626", fontSize: 13, marginTop: 12 },
  submit: {
    marginTop: 20,
    backgroundColor: "#16a34a",
    padding: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  submitText: { color: "#fff", fontSize: 16, fontWeight: "500" },
});
