import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Location from "expo-location";
import Ionicons from "@expo/vector-icons/Ionicons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../contexts/AuthContext";
import { createPlant, getPlantByQr, patchPlant } from "../lib/api";
import type { RootStackParamList } from "../navigation/types";

export default function ScanScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { state } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const lastCodeRef = useRef<string | null>(null);

  useEffect(() => {
    if (!permission) return;
    if (!permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  async function getGps(): Promise<{ lat?: number; lng?: number }> {
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") return {};
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Highest,
      });
      return { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch (err) {
      console.warn("getGps failed", err);
      return {};
    }
  }

  async function handleScan(code: string) {
    if (state.status !== "authed") return;
    if (busy) return;
    if (lastCodeRef.current === code) return;
    lastCodeRef.current = code;
    setBusy(true);

    try {
      const gps = await getGps();
      const found = await getPlantByQr(state.token, code);
      if (found.ok) {
        // Update GPS on existing plant if we have a new fix. Await so the
        // detail screen reload sees the new coordinates.
        if (gps.lat !== undefined && gps.lng !== undefined) {
          const r = await patchPlant(state.token, found.data.plant.id, {
            gpsLat: gps.lat,
            gpsLng: gps.lng,
          });
          if (!r.ok) console.warn("GPS update failed", r.error);
        }
        nav.replace("PlantDetail", { plantId: found.data.plant.id });
        return;
      }
      if (found.status === 404) {
        const created = await createPlant(state.token, {
          qrCode: code,
          gpsLat: gps.lat,
          gpsLng: gps.lng,
        });
        if (!created.ok) {
          Alert.alert("Could not create plant", created.error);
          setBusy(false);
          lastCodeRef.current = null;
          return;
        }
        nav.replace("PlantDetail", { plantId: created.data.plant.id });
        return;
      }
      Alert.alert("Lookup failed", found.error);
      setBusy(false);
      lastCodeRef.current = null;
    } catch (err) {
      Alert.alert("Error", String(err));
      setBusy(false);
      lastCodeRef.current = null;
    }
  }

  if (!permission) {
    return (
      <View style={styles.fullCenter}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.headerBar}>
          <Pressable onPress={() => nav.goBack()} hitSlop={12}>
            <Ionicons name="close" size={28} color="#fff" />
          </Pressable>
        </View>
        <View style={styles.fullCenter}>
          <Text style={styles.permissionText}>
            Camera access is required to scan QR codes.
          </Text>
          <Pressable style={styles.permissionButton} onPress={requestPermission}>
            <Text style={styles.permissionButtonText}>Grant access</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr", "code128"] }}
        onBarcodeScanned={busy ? undefined : (e) => handleScan(e.data)}
      />
      {busy && (
        <View style={styles.busyOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.busyText}>Looking up plant…</Text>
        </View>
      )}
      <SafeAreaView
        style={styles.overlay}
        edges={["top", "bottom"]}
        pointerEvents="box-none"
      >
        <View style={styles.headerBar} pointerEvents="box-none">
          <Pressable
            onPress={() => nav.goBack()}
            hitSlop={20}
            style={styles.closeHit}
          >
            <Ionicons name="close" size={32} color="#fff" />
          </Pressable>
        </View>
        <View style={styles.frameWrap} pointerEvents="none">
          <View style={styles.frame} />
          <Text style={styles.helpText}>Center the code in the box</Text>
        </View>
        <View />
      </SafeAreaView>
    </View>
  );
}

const FRAME_SIZE = 260;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  fullCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#000",
  },
  permissionText: {
    color: "#fafafa",
    fontSize: 16,
    textAlign: "center",
    marginBottom: 16,
  },
  permissionButton: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: "#16a34a",
    borderRadius: 6,
  },
  permissionButtonText: { color: "#fff", fontSize: 15, fontWeight: "500" },
  overlay: {
    flex: 1,
    justifyContent: "space-between",
  },
  headerBar: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  frameWrap: {
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
  },
  frame: {
    width: FRAME_SIZE,
    height: FRAME_SIZE,
    borderColor: "#fff",
    borderWidth: 2,
    borderRadius: 16,
    backgroundColor: "transparent",
  },
  helpText: {
    color: "#fafafa",
    marginTop: 16,
    fontSize: 14,
  },
  busyOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  busyText: { color: "#fff", marginTop: 12, fontSize: 14 },
  closeHit: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: -10,
  },
});
