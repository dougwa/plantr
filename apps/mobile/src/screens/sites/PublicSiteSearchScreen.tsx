import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import * as Location from "expo-location";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { useAuth } from "../../contexts/AuthContext";
import {
  joinPublicSite,
  searchPublicSites,
  type PublicSiteSearchResult,
} from "../../lib/api";

type Nav = NativeStackNavigationProp<RootStackParamList, "PublicSiteSearch">;

export default function PublicSiteSearchScreen() {
  const nav = useNavigation<Nav>();
  const { state, refreshSites, setCurrentSite } = useAuth();
  const token = state.status === "authed" ? state.token : null;
  const [q, setQ] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [results, setResults] = useState<PublicSiteSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  const runSearch = useCallback(
    async (overrides?: { coords?: { lat: number; lng: number } | null }) => {
      if (!token) return;
      const useCoords = overrides?.coords !== undefined ? overrides.coords : coords;
      setSearching(true);
      const r = await searchPublicSites(token, {
        q: q.trim() || undefined,
        lat: useCoords?.lat,
        lng: useCoords?.lng,
        radiusKm: useCoords ? 50 : undefined,
      });
      setSearching(false);
      setResults(r.ok ? r.data.sites : []);
    },
    [coords, q, token],
  );

  if (!token) return null;

  async function useMyLocation() {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== "granted") {
      Alert.alert(
        "Location permission denied",
        "Grant location access in Settings to search nearby sites.",
      );
      return;
    }
    try {
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setCoords(next);
      await runSearch({ coords: next });
    } catch {
      Alert.alert("Could not determine your location.");
    }
  }

  function clearLocation() {
    setCoords(null);
    runSearch({ coords: null });
  }

  async function onJoin(site: PublicSiteSearchResult) {
    if (!token) return;
    setJoiningId(site.id);
    const r = await joinPublicSite(token, site.id);
    setJoiningId(null);
    if (!r.ok && r.error !== "already_member") {
      Alert.alert("Could not join site", r.error);
      return;
    }
    await refreshSites();
    setCurrentSite(site.id);
    nav.goBack();
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => nav.goBack()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color="#171717" />
        </Pressable>
        <Text style={styles.title}>Find public sites</Text>
        <View style={styles.backBtn} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={18} color="#737373" />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search by name or city"
            returnKeyType="search"
            onSubmitEditing={() => runSearch()}
            style={styles.searchInput}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {q.length > 0 && (
            <Pressable onPress={() => setQ("")} hitSlop={6}>
              <Ionicons name="close-circle" size={18} color="#a3a3a3" />
            </Pressable>
          )}
        </View>

        <Pressable
          onPress={coords ? clearLocation : useMyLocation}
          style={({ pressed }) => [
            styles.locationRow,
            coords && styles.locationRowActive,
            pressed && { opacity: 0.7 },
          ]}
        >
          <Ionicons
            name={coords ? "location" : "location-outline"}
            size={18}
            color={coords ? "#16a34a" : "#525252"}
          />
          <Text style={[styles.locationText, coords && styles.locationTextActive]}>
            {coords ? "Searching within 50km — tap to clear" : "Use my location"}
          </Text>
        </Pressable>

        <ScrollView contentContainerStyle={styles.results}>
          {searching && (
            <View style={{ paddingVertical: 24 }}>
              <ActivityIndicator />
            </View>
          )}
          {!searching && results && results.length === 0 && (
            <Text style={styles.empty}>No public sites match. Try a broader query.</Text>
          )}
          {!searching && results && results.length > 0 && (
            <>
              {results.map((s) => (
                <View key={s.id} style={styles.resultRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.resultName}>{s.name}</Text>
                    {s.address ? <Text style={styles.resultMeta}>{s.address}</Text> : null}
                    <Text style={styles.resultMeta}>
                      by {s.owner.name ?? s.owner.username}
                      {s.distanceKm != null ? ` · ${s.distanceKm.toFixed(1)} km away` : ""}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => onJoin(s)}
                    disabled={joiningId === s.id}
                    style={({ pressed }) => [
                      styles.joinBtn,
                      (pressed || joiningId === s.id) && { opacity: 0.7 },
                    ]}
                  >
                    {joiningId === s.id ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={styles.joinText}>Join</Text>
                    )}
                  </Pressable>
                </View>
              ))}
            </>
          )}
          {!searching && results === null && (
            <Text style={styles.empty}>Search for a public site by name or location.</Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
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
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#fff",
    margin: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e5e5",
  },
  searchInput: { flex: 1, fontSize: 16, color: "#171717" },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  locationRowActive: {},
  locationText: { color: "#525252", fontSize: 14 },
  locationTextActive: { color: "#16a34a" },
  results: { padding: 12, gap: 8 },
  empty: { color: "#737373", fontSize: 13, padding: 24, textAlign: "center" },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#fff",
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e5e5",
  },
  resultName: { fontSize: 15, fontWeight: "500", color: "#171717" },
  resultMeta: { fontSize: 12, color: "#737373", marginTop: 2 },
  joinBtn: {
    backgroundColor: "#16a34a",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    minWidth: 64,
    alignItems: "center",
  },
  joinText: { color: "#fff", fontSize: 14, fontWeight: "500" },
});
