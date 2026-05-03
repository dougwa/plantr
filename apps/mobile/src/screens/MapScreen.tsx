import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, {
  Marker,
  Polygon,
  PROVIDER_DEFAULT,
  type LatLng,
  type LongPressEvent,
  type Region,
} from "react-native-maps";
import Ionicons from "@expo/vector-icons/Ionicons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../contexts/AuthContext";
import {
  createLocationShape,
  deleteLocationShape,
  listLocationShapes,
  listPlants,
  patchLocationShape,
  type LocationShape,
  type PlantListItem,
} from "../lib/api";
import type { RootStackParamList } from "../navigation/types";

const METERS_PER_DEGREE_LAT = 111_320;

const COLOR_PALETTE = [
  "#16a34a",
  "#0ea5e9",
  "#eab308",
  "#f97316",
  "#dc2626",
  "#a855f7",
  "#ec4899",
  "#525252",
];

function metersToDegrees(meters: number, atLat: number) {
  return {
    lat: meters / METERS_PER_DEGREE_LAT,
    lng: meters / (METERS_PER_DEGREE_LAT * Math.cos((atLat * Math.PI) / 180)),
  };
}

function rectangleCorners(s: LocationShape): LatLng[] {
  const { lat: dLat, lng: dLng } = metersToDegrees(1, s.centerLat);
  const halfH = (s.heightMeters / 2) * dLat;
  const halfW = (s.widthMeters / 2) * dLng;
  return [
    { latitude: s.centerLat - halfH, longitude: s.centerLng - halfW },
    { latitude: s.centerLat - halfH, longitude: s.centerLng + halfW },
    { latitude: s.centerLat + halfH, longitude: s.centerLng + halfW },
    { latitude: s.centerLat + halfH, longitude: s.centerLng - halfW },
  ];
}

function ellipsePoints(s: LocationShape, segments = 48): LatLng[] {
  const { lat: dLat, lng: dLng } = metersToDegrees(1, s.centerLat);
  const halfH = (s.heightMeters / 2) * dLat;
  const halfW = (s.widthMeters / 2) * dLng;
  const points: LatLng[] = [];
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * 2 * Math.PI;
    points.push({
      latitude: s.centerLat + halfH * Math.sin(t),
      longitude: s.centerLng + halfW * Math.cos(t),
    });
  }
  return points;
}

function fitRegion(points: LatLng[]): Region | null {
  if (points.length === 0) return null;
  let minLat = points[0]!.latitude;
  let maxLat = points[0]!.latitude;
  let minLng = points[0]!.longitude;
  let maxLng = points[0]!.longitude;
  for (const p of points) {
    if (p.latitude < minLat) minLat = p.latitude;
    if (p.latitude > maxLat) maxLat = p.latitude;
    if (p.longitude < minLng) minLng = p.longitude;
    if (p.longitude > maxLng) maxLng = p.longitude;
  }
  const latDelta = Math.max((maxLat - minLat) * 1.4, 0.0008);
  const lngDelta = Math.max((maxLng - minLng) * 1.4, 0.0008);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: latDelta,
    longitudeDelta: lngDelta,
  };
}

type EditorState = {
  shape: LocationShape;
  name: string;
  color: string;
  widthMeters: string;
  heightMeters: string;
};

export default function MapScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { state } = useAuth();
  const mapRef = useRef<MapView>(null);
  const [plants, setPlants] = useState<PlantListItem[]>([]);
  const [shapes, setShapes] = useState<LocationShape[]>([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const fittedRef = useRef(false);

  const token = state.status === "authed" ? state.token : null;

  const reload = useCallback(async () => {
    if (!token) return;
    const [pRes, sRes] = await Promise.all([listPlants(token), listLocationShapes(token)]);
    if (pRes.ok) setPlants(pRes.data.plants);
    if (sRes.ok) setShapes(sRes.data.shapes);
  }, [token]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await reload();
      setLoading(false);
    })();
  }, [reload]);

  const plantsWithGps = useMemo(
    () => plants.filter((p) => p.gpsLat != null && p.gpsLng != null),
    [plants],
  );

  // Auto-fit once after first load (when we have any anchors).
  useEffect(() => {
    if (fittedRef.current || loading) return;
    const points: LatLng[] = [
      ...plantsWithGps.map((p) => ({
        latitude: p.gpsLat as number,
        longitude: p.gpsLng as number,
      })),
      ...shapes.map((s) => ({ latitude: s.centerLat, longitude: s.centerLng })),
    ];
    const region = fitRegion(points);
    if (region && mapRef.current) {
      mapRef.current.animateToRegion(region, 0);
      fittedRef.current = true;
    }
  }, [loading, plantsWithGps, shapes]);

  function chooseShapeKind(): Promise<"rectangle" | "ellipse" | null> {
    return new Promise((resolve) => {
      if (Platform.OS === "ios") {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: ["Cancel", "Rectangle", "Ellipse"],
            cancelButtonIndex: 0,
            title: "Add a location",
          },
          (i) => resolve(i === 1 ? "rectangle" : i === 2 ? "ellipse" : null),
        );
      } else {
        Alert.alert("Add a location", undefined, [
          { text: "Cancel", style: "cancel", onPress: () => resolve(null) },
          { text: "Rectangle", onPress: () => resolve("rectangle") },
          { text: "Ellipse", onPress: () => resolve("ellipse") },
        ]);
      }
    });
  }

  async function addShapeAt(coord: LatLng) {
    if (!token) return;
    const kind = await chooseShapeKind();
    if (!kind) return;
    const r = await createLocationShape(token, {
      kind,
      color: COLOR_PALETTE[shapes.length % COLOR_PALETTE.length] ?? COLOR_PALETTE[0]!,
      centerLat: coord.latitude,
      centerLng: coord.longitude,
      widthMeters: 8,
      heightMeters: 8,
      name: null,
    });
    if (!r.ok) {
      Alert.alert("Failed to create location", r.error);
      return;
    }
    setShapes((cur) => [...cur, r.data.shape]);
    openEditor(r.data.shape);
  }

  async function addShapeAtCenter() {
    const region = await mapRef.current?.getCamera();
    if (!region) {
      Alert.alert("Map not ready");
      return;
    }
    await addShapeAt(region.center);
  }

  function onMapLongPress(e: LongPressEvent) {
    addShapeAt(e.nativeEvent.coordinate);
  }

  function openEditor(shape: LocationShape) {
    setEditor({
      shape,
      name: shape.name ?? "",
      color: shape.color,
      widthMeters: String(shape.widthMeters),
      heightMeters: String(shape.heightMeters),
    });
  }

  async function saveEditor() {
    if (!token || !editor) return;
    const w = Number(editor.widthMeters);
    const h = Number(editor.heightMeters);
    if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0) {
      Alert.alert("Invalid size", "Width and height must be positive numbers.");
      return;
    }
    const r = await patchLocationShape(token, editor.shape.id, {
      name: editor.name.trim() || null,
      color: editor.color,
      widthMeters: w,
      heightMeters: h,
    });
    if (!r.ok) {
      Alert.alert("Save failed", r.error);
      return;
    }
    setShapes((cur) => cur.map((s) => (s.id === r.data.shape.id ? r.data.shape : s)));
    setEditor(null);
  }

  async function toggleLock() {
    if (!token || !editor) return;
    const r = await patchLocationShape(token, editor.shape.id, {
      locked: !editor.shape.locked,
    });
    if (!r.ok) return;
    setShapes((cur) => cur.map((s) => (s.id === r.data.shape.id ? r.data.shape : s)));
    setEditor({ ...editor, shape: r.data.shape });
  }

  async function deleteShape() {
    if (!token || !editor) return;
    Alert.alert("Delete location?", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          const r = await deleteLocationShape(token, editor.shape.id);
          if (!r.ok) {
            Alert.alert("Delete failed", r.error);
            return;
          }
          setShapes((cur) => cur.filter((s) => s.id !== editor.shape.id));
          setEditor(null);
          await reload(); // refresh plants in case some were attached
        },
      },
    ]);
  }

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_DEFAULT}
        mapType="hybrid"
        style={StyleSheet.absoluteFill}
        onLongPress={onMapLongPress}
      >
        {shapes.map((s) => (
          <Polygon
            key={s.id}
            coordinates={
              s.kind === "ellipse" ? ellipsePoints(s) : rectangleCorners(s)
            }
            strokeColor={s.color}
            fillColor={`${s.color}33`}
            strokeWidth={2}
            tappable
            onPress={() => openEditor(s)}
          />
        ))}
        {plantsWithGps.map((p) => (
          <Marker
            key={p.id}
            coordinate={{
              latitude: p.gpsLat as number,
              longitude: p.gpsLng as number,
            }}
            onPress={() => nav.navigate("PlantDetail", { plantId: p.id })}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={styles.dotOuter}>
              <View style={styles.dotInner} />
            </View>
          </Marker>
        ))}
      </MapView>

      <SafeAreaView style={styles.fabSafe} edges={["bottom"]} pointerEvents="box-none">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add location"
          style={styles.fab}
          onPress={addShapeAtCenter}
        >
          <Ionicons name="add" size={28} color="#fff" />
        </Pressable>
      </SafeAreaView>

      <SafeAreaView style={styles.helpSafe} edges={["top"]} pointerEvents="box-none">
        <View style={styles.helpPill}>
          <Text style={styles.helpText}>
            Long-press to add a location · Tap a marker for details
          </Text>
        </View>
      </SafeAreaView>

      <Modal
        transparent
        visible={editor !== null}
        animationType="fade"
        onRequestClose={() => setEditor(null)}
      >
        {editor && (
          <Pressable style={styles.modalBackdrop} onPress={() => setEditor(null)}>
            <Pressable style={styles.modalSheet} onPress={() => {}}>
              <ScrollView keyboardShouldPersistTaps="handled">
                <Text style={styles.modalTitle}>
                  Edit {editor.shape.kind === "ellipse" ? "Ellipse" : "Rectangle"}
                </Text>
                <Text style={styles.modalLabel}>Name</Text>
                <TextInput
                  style={styles.modalInput}
                  value={editor.name}
                  onChangeText={(t) => setEditor({ ...editor, name: t })}
                  placeholder="e.g. Big Rose Garden"
                />
                <Text style={styles.modalLabel}>Color</Text>
                <View style={styles.swatchRow}>
                  {COLOR_PALETTE.map((c) => (
                    <Pressable
                      key={c}
                      onPress={() => setEditor({ ...editor, color: c })}
                      style={[
                        styles.swatch,
                        { backgroundColor: c },
                        editor.color === c && styles.swatchActive,
                      ]}
                    />
                  ))}
                </View>
                <View style={styles.sizeRow}>
                  <View style={styles.sizeField}>
                    <Text style={styles.modalLabel}>Width (m)</Text>
                    <TextInput
                      style={styles.modalInput}
                      keyboardType="decimal-pad"
                      value={editor.widthMeters}
                      onChangeText={(t) => setEditor({ ...editor, widthMeters: t })}
                    />
                  </View>
                  <View style={styles.sizeField}>
                    <Text style={styles.modalLabel}>Height (m)</Text>
                    <TextInput
                      style={styles.modalInput}
                      keyboardType="decimal-pad"
                      value={editor.heightMeters}
                      onChangeText={(t) => setEditor({ ...editor, heightMeters: t })}
                    />
                  </View>
                </View>

                <View style={styles.lockRow}>
                  <TouchableOpacity onPress={toggleLock} style={styles.lockButton}>
                    <Ionicons
                      name={editor.shape.locked ? "lock-closed" : "lock-open"}
                      size={16}
                      color="#171717"
                    />
                    <Text style={styles.lockText}>
                      {editor.shape.locked ? "Locked" : "Unlocked"}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={deleteShape} style={styles.deleteButton}>
                    <Text style={styles.deleteText}>Delete</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.modalButtons}>
                  <TouchableOpacity onPress={() => setEditor(null)} style={styles.cancelBtn}>
                    <Text style={styles.cancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={saveEditor} style={styles.saveBtn}>
                    <Text style={styles.saveText}>Save</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </Pressable>
          </Pressable>
        )}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  dotOuter: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  dotInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#16a34a",
  },
  fabSafe: {
    position: "absolute",
    right: 16,
    bottom: 16,
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#16a34a",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  helpSafe: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  helpPill: {
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  helpText: { color: "#fafafa", fontSize: 12 },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: 24,
  },
  modalSheet: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    maxHeight: "80%",
  },
  modalTitle: { fontSize: 18, fontWeight: "600", marginBottom: 12 },
  modalLabel: { fontSize: 13, color: "#525252", marginTop: 8, marginBottom: 4 },
  modalInput: {
    borderWidth: 1,
    borderColor: "#d4d4d4",
    borderRadius: 6,
    padding: 10,
    fontSize: 15,
  },
  swatchRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  swatch: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "#fff",
  },
  swatchActive: {
    borderColor: "#171717",
  },
  sizeRow: { flexDirection: "row", gap: 12 },
  sizeField: { flex: 1 },
  lockRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 16,
  },
  lockButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: "#f5f5f5",
    borderRadius: 6,
  },
  lockText: { fontSize: 13, color: "#171717" },
  deleteButton: { paddingVertical: 8, paddingHorizontal: 10 },
  deleteText: { color: "#dc2626", fontSize: 13 },
  modalButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 16,
    gap: 8,
  },
  cancelBtn: { paddingVertical: 8, paddingHorizontal: 14 },
  cancelText: { color: "#525252", fontSize: 15 },
  saveBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: "#171717",
    borderRadius: 6,
  },
  saveText: { color: "#fff", fontSize: 15, fontWeight: "500" },
});
