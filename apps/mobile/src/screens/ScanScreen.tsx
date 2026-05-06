import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import {
  ALL_BARCODE_TYPES,
  loadEnabledBarcodeTypes,
  type BarcodeType,
} from "../lib/scannerTypes";
import * as Location from "expo-location";
import Ionicons from "@expo/vector-icons/Ionicons";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../contexts/AuthContext";
import {
  createPlant,
  getPlantByQr,
  listTags,
  patchPlant,
  recordAction,
  type ActionKind,
  type PublicPlant,
  type Tag,
} from "../lib/api";
import type { RootStackParamList } from "../navigation/types";
import AuthImage from "../components/AuthImage";

type BrushState = {
  enabled: boolean;
  tagIds: string[];
  species: string;
  description: string;
  notes: string;
  actions: ActionKind[];
};

const EMPTY_BRUSH: BrushState = {
  enabled: false,
  tagIds: [],
  species: "",
  description: "",
  notes: "",
  actions: [],
};

const ACTION_KINDS: {
  kind: ActionKind;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { kind: "feeding", label: "Feed", icon: "nutrition-outline" },
  { kind: "watering", label: "Water", icon: "water-outline" },
  { kind: "fertilizing", label: "Fertilize", icon: "flask-outline" },
  { kind: "treating", label: "Treat", icon: "medkit-outline" },
];

type Toast = {
  id: string;
  qrCode: string;
  name: string | null;
  thumbPath: string | null;
  isNew: boolean;
};

export default function ScanScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { state } = useAuth();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [barcodeTypes, setBarcodeTypes] = useState<BarcodeType[]>([
    ...ALL_BARCODE_TYPES,
  ]);
  const lastCodeRef = useRef<string | null>(null);

  const [brush, setBrush] = useState<BrushState>(EMPTY_BRUSH);
  const [brushModalOpen, setBrushModalOpen] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [tags, setTags] = useState<Tag[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!permission) return;
    if (!permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  useEffect(() => {
    loadEnabledBarcodeTypes().then(setBarcodeTypes);
  }, []);

  useEffect(() => {
    if (state.status !== "authed") return;
    listTags(state.token).then((r) => {
      if (r.ok) setTags(r.data.tags);
    });
  }, [state]);

  function showToast(t: Toast) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(t);
    toastTimerRef.current = setTimeout(() => setToast(null), 2500);
  }

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

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

  async function applyBrush(plant: PublicPlant): Promise<PublicPlant> {
    if (state.status !== "authed") return plant;
    const patch: Parameters<typeof patchPlant>[2] = {};
    if (brush.tagIds.length > 0) {
      const merged = new Set([
        ...plant.tags.map((t) => t.id),
        ...brush.tagIds,
      ]);
      patch.tagIds = Array.from(merged);
    }
    if (brush.species.trim()) patch.species = brush.species.trim();
    if (brush.description.trim()) patch.description = brush.description.trim();
    if (brush.notes.trim()) patch.notes = brush.notes.trim();
    let updated = plant;
    if (Object.keys(patch).length > 0) {
      const r = await patchPlant(state.token, plant.id, patch);
      if (r.ok) updated = r.data.plant;
      else console.warn("brush patch failed", r.error);
    }
    for (const k of brush.actions) {
      const r = await recordAction(state.token, plant.id, { kind: k });
      if (!r.ok) console.warn("brush action failed", k, r.error);
    }
    return updated;
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
      let plant: PublicPlant;
      let isNew = false;

      if (found.ok) {
        plant = found.data.plant;
        if (gps.lat !== undefined && gps.lng !== undefined) {
          const r = await patchPlant(state.token, plant.id, {
            gpsLat: gps.lat,
            gpsLng: gps.lng,
          });
          if (r.ok) plant = r.data.plant;
        }
      } else if (found.status === 404) {
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
        plant = created.data.plant;
        isNew = true;
      } else {
        Alert.alert("Lookup failed", found.error);
        setBusy(false);
        lastCodeRef.current = null;
        return;
      }

      if (brush.enabled) {
        plant = await applyBrush(plant);
        showToast({
          id: plant.id,
          qrCode: plant.qrCode,
          name: plant.name,
          thumbPath: plant.coverPhoto?.urls.thumb ?? null,
          isNew,
        });
        setBusy(false);
        return;
      }

      nav.replace("PlantDetail", { plantId: plant.id });
    } catch (err) {
      Alert.alert("Error", String(err));
      setBusy(false);
      lastCodeRef.current = null;
    }
  }

  function toggleBrush(on: boolean) {
    if (on) setBrush((b) => ({ ...b, enabled: true }));
    else setBrush(EMPTY_BRUSH);
  }

  function toggleAction(kind: ActionKind) {
    setBrush((b) => {
      const has = b.actions.includes(kind);
      return {
        ...b,
        actions: has ? b.actions.filter((a) => a !== kind) : [...b.actions, kind],
      };
    });
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

  const brushSelectedTags = tags.filter((t) => brush.tagIds.includes(t.id));

  const cameraActive = !brushModalOpen;

  function toggleTag(id: string) {
    setBrush((b) => {
      const has = b.tagIds.includes(id);
      return {
        ...b,
        tagIds: has ? b.tagIds.filter((x) => x !== id) : [...b.tagIds, id],
      };
    });
  }

  return (
    <View style={styles.container}>
      {cameraActive && (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes }}
          onBarcodeScanned={busy ? undefined : (e) => handleScan(e.data)}
        />
      )}
      {busy && (
        <View style={styles.busyOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.busyText}>
            {brush.enabled ? "Applying brush…" : "Looking up plant…"}
          </Text>
        </View>
      )}
      <View
        style={[
          styles.overlay,
          { paddingTop: insets.top, paddingBottom: insets.bottom },
        ]}
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
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={() => setBrushModalOpen(true)}
            hitSlop={20}
            style={[
              styles.brushHit,
              brush.enabled && styles.brushHitActive,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Brush settings"
          >
            <Ionicons
              name="brush"
              size={24}
              color={brush.enabled ? "#16a34a" : "#fff"}
            />
          </Pressable>
        </View>
        <View style={styles.frameWrap} pointerEvents="none">
          <View style={styles.frame} />
          <Text style={styles.helpText}>
            {brush.enabled
              ? "Brush mode — keep scanning"
              : "Center the code in the box"}
          </Text>
        </View>
        <View style={styles.toastWrap} pointerEvents="none">
          {toast && (
            <View style={styles.toast}>
              <View style={styles.toastThumb}>
                {toast.thumbPath ? (
                  <AuthImage path={toast.thumbPath} style={styles.toastThumbImg} />
                ) : (
                  <Ionicons name="leaf-outline" size={22} color="#16a34a" />
                )}
              </View>
              <View style={styles.toastText}>
                <View style={styles.toastTopRow}>
                  {toast.isNew && (
                    <View style={styles.newBadge}>
                      <Text style={styles.newBadgeText}>New</Text>
                    </View>
                  )}
                  <Text style={styles.toastName} numberOfLines={1}>
                    {toast.name?.trim() || toast.qrCode}
                  </Text>
                </View>
                <Text style={styles.toastQr} numberOfLines={1}>
                  {toast.qrCode}
                </Text>
              </View>
            </View>
          )}
        </View>
      </View>

      <Modal
        transparent
        visible={brushModalOpen}
        animationType="fade"
        onRequestClose={() => {
          if (tagPickerOpen) setTagPickerOpen(false);
          else setBrushModalOpen(false);
        }}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setBrushModalOpen(false)}
        >
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <View style={styles.brushHeader}>
              <Text style={styles.modalTitle}>Brush</Text>
              <Switch value={brush.enabled} onValueChange={toggleBrush} />
            </View>
            <Text style={styles.brushHint}>
              When on, every scanned plant gets these properties applied. Toggle
              off to reset.
            </Text>
            <ScrollView
              style={styles.brushScroll}
              keyboardShouldPersistTaps="handled"
            >
              <Pressable
                style={styles.brushRow}
                onPress={() => setTagPickerOpen(true)}
              >
                <Text style={styles.brushLabel}>Tags</Text>
                <View style={styles.brushValueRow}>
                  {brushSelectedTags.length === 0 ? (
                    <Text
                      style={[styles.brushValue, styles.brushPlaceholder]}
                      numberOfLines={1}
                    >
                      Not set
                    </Text>
                  ) : (
                    <View style={styles.brushTagWrap}>
                      {brushSelectedTags.map((t) => (
                        <View
                          key={t.id}
                          style={[styles.tagBubble, { backgroundColor: t.color }]}
                        >
                          <Text style={styles.tagBubbleText} numberOfLines={1}>
                            {t.name}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                  <Ionicons name="chevron-forward" size={18} color="#a3a3a3" />
                </View>
              </Pressable>

              <View style={styles.brushFieldBlock}>
                <Text style={styles.brushLabel}>Species</Text>
                <TextInput
                  style={styles.brushInput}
                  value={brush.species}
                  onChangeText={(v) => setBrush((b) => ({ ...b, species: v }))}
                  placeholder="Not set"
                  placeholderTextColor="#a3a3a3"
                />
              </View>

              <View style={styles.brushFieldBlock}>
                <Text style={styles.brushLabel}>Description</Text>
                <TextInput
                  style={[styles.brushInput, styles.brushInputMulti]}
                  value={brush.description}
                  onChangeText={(v) =>
                    setBrush((b) => ({ ...b, description: v }))
                  }
                  placeholder="Not set"
                  placeholderTextColor="#a3a3a3"
                  multiline
                />
              </View>

              <View style={styles.brushFieldBlock}>
                <Text style={styles.brushLabel}>Notes</Text>
                <TextInput
                  style={[styles.brushInput, styles.brushInputMulti]}
                  value={brush.notes}
                  onChangeText={(v) => setBrush((b) => ({ ...b, notes: v }))}
                  placeholder="Not set"
                  placeholderTextColor="#a3a3a3"
                  multiline
                />
              </View>

              <View style={styles.brushFieldBlock}>
                <Text style={styles.brushLabel}>Actions</Text>
                <View style={styles.actionChipsRow}>
                  {ACTION_KINDS.map((a) => {
                    const on = brush.actions.includes(a.kind);
                    return (
                      <Pressable
                        key={a.kind}
                        onPress={() => toggleAction(a.kind)}
                        style={[
                          styles.actionChip,
                          on && styles.actionChipOn,
                        ]}
                      >
                        <Ionicons
                          name={a.icon}
                          size={16}
                          color={on ? "#fff" : "#171717"}
                        />
                        <Text
                          style={[
                            styles.actionChipLabel,
                            on && styles.actionChipLabelOn,
                          ]}
                        >
                          {a.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </ScrollView>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                onPress={() => setBrushModalOpen(false)}
                style={styles.modalSave}
              >
                <Text style={styles.modalSaveText}>Done</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
        {tagPickerOpen && (
          <Pressable
            style={[styles.modalBackdrop, StyleSheet.absoluteFill]}
            onPress={() => setTagPickerOpen(false)}
          >
            <Pressable style={styles.modalSheet} onPress={() => {}}>
              <Text style={styles.modalTitle}>Choose tags</Text>
              {tags.length === 0 ? (
                <Text style={styles.tagPickerEmpty}>
                  No tags yet — add some in Settings.
                </Text>
              ) : (
                <FlatList
                  data={tags}
                  keyExtractor={(t) => t.id}
                  renderItem={({ item }) => {
                    const on = brush.tagIds.includes(item.id);
                    return (
                      <TouchableOpacity
                        style={styles.tagPickerRow}
                        onPress={() => toggleTag(item.id)}
                      >
                        <View
                          style={[
                            styles.tagBubble,
                            { backgroundColor: item.color },
                            !on && { opacity: 0.35 },
                          ]}
                        >
                          <Text style={styles.tagBubbleText} numberOfLines={1}>
                            {item.name}
                          </Text>
                        </View>
                        <View style={{ flex: 1 }} />
                        <Ionicons
                          name={on ? "checkbox" : "square-outline"}
                          size={22}
                          color={on ? "#16a34a" : "#a3a3a3"}
                        />
                      </TouchableOpacity>
                    );
                  }}
                />
              )}
              <View style={styles.modalButtons}>
                <TouchableOpacity
                  onPress={() => setTagPickerOpen(false)}
                  style={styles.modalSave}
                >
                  <Text style={styles.modalSaveText}>Done</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        )}
      </Modal>
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
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 16,
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
  brushHit: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  brushHitActive: {
    backgroundColor: "rgba(255,255,255,0.95)",
  },

  toastWrap: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(23,23,23,0.92)",
    borderRadius: 12,
    padding: 10,
    gap: 12,
  },
  toastThumb: {
    width: 44,
    height: 44,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#262626",
    alignItems: "center",
    justifyContent: "center",
  },
  toastThumbImg: { width: 44, height: 44 },
  toastText: { flex: 1 },
  toastTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  toastName: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "500",
    flexShrink: 1,
  },
  toastQr: {
    color: "#a3a3a3",
    fontSize: 12,
    marginTop: 2,
  },
  newBadge: {
    backgroundColor: "#16a34a",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  newBadgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
  },

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
  modalTitle: { fontSize: 18, fontWeight: "600" },
  modalButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 12,
    gap: 8,
  },
  modalSave: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: "#171717",
    borderRadius: 6,
  },
  modalSaveText: { color: "#fff", fontSize: 15, fontWeight: "500" },

  brushHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  brushHint: {
    fontSize: 13,
    color: "#737373",
    marginBottom: 12,
  },
  brushScroll: { maxHeight: 460 },
  brushRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e5e5",
  },
  brushLabel: { fontSize: 14, color: "#737373" },
  brushValueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 1,
  },
  brushValue: { fontSize: 16, color: "#171717" },
  brushPlaceholder: { color: "#a3a3a3" },
  brushFieldBlock: {
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e5e5",
    gap: 6,
  },
  brushInput: {
    borderWidth: 1,
    borderColor: "#d4d4d4",
    borderRadius: 6,
    padding: 10,
    fontSize: 15,
    color: "#171717",
  },
  brushInputMulti: {
    minHeight: 70,
    textAlignVertical: "top",
  },
  actionChipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  actionChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: "#f5f5f5",
    borderWidth: 1,
    borderColor: "#e5e5e5",
  },
  actionChipOn: {
    backgroundColor: "#16a34a",
    borderColor: "#16a34a",
  },
  actionChipLabel: { fontSize: 13, color: "#171717" },
  actionChipLabelOn: { color: "#fff" },

  brushTagWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    flexShrink: 1,
    justifyContent: "flex-end",
  },
  tagBubble: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    alignSelf: "flex-start",
    maxWidth: 200,
  },
  tagBubbleText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "500",
  },
  tagPickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: "#f5f5f5",
  },
  tagPickerEmpty: {
    paddingVertical: 16,
    fontSize: 14,
    color: "#737373",
    textAlign: "center",
  },
});
