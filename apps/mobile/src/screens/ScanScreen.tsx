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
  listLocationShapes,
  listTags,
  lookupCode,
  patchLocationShape,
  patchPlant,
  recordAction,
  type ActionKind,
  type LocationShape,
  type PublicPlant,
  type Tag,
} from "../lib/api";
import { tagKindStyle } from "../lib/tagStyle";
import type { RootStackParamList } from "../navigation/types";
import AuthImage from "../components/AuthImage";

type ScanType = "ask" | "plant" | "shape";

type BrushState = {
  enabled: boolean;
  type: ScanType;
  tagIds: string[];
  species: string;
  description: string;
  notes: string;
  actions: ActionKind[];
};

const EMPTY_BRUSH: BrushState = {
  enabled: false,
  type: "ask",
  tagIds: [],
  species: "",
  description: "",
  notes: "",
  actions: [],
};

type Pending = { code: string; gps: { lat?: number; lng?: number } };

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
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  const [shapePickerOpen, setShapePickerOpen] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [shapes, setShapes] = useState<LocationShape[]>([]);
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
    listLocationShapes(state.token).then((r) => {
      if (r.ok) setShapes(r.data.shapes);
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

  function resetScan() {
    setBusy(false);
    setPending(null);
    lastCodeRef.current = null;
  }

  function openShapeInBrowse(shape: LocationShape) {
    // Map the scanned shape to its paired location-kind tag so the browse
    // filter matches the tag-based model.
    const locationTag = tags.find(
      (t) => t.kind === "location" && t.locationShapeId === shape.id,
    );
    const label = locationTag?.name ?? shape.name ?? "Unnamed location";
    nav.goBack();
    nav.push("PlantList", {
      filter: { kind: "location", tagId: locationTag?.id ?? null, label },
      title: label,
    });
  }

  async function createNewPlant(code: string, gps: { lat?: number; lng?: number }) {
    if (state.status !== "authed") return;
    const created = await createPlant(state.token, {
      qrCode: code,
      gpsLat: gps.lat,
      gpsLng: gps.lng,
    });
    if (!created.ok) {
      Alert.alert("Could not create plant", created.error);
      resetScan();
      return;
    }
    await finishWithPlant(created.data.plant, true);
  }

  async function finishWithPlant(plantIn: PublicPlant, isNew: boolean) {
    let plant = plantIn;
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
      setPending(null);
      lastCodeRef.current = null;
      return;
    }
    setPending(null);
    nav.replace("PlantDetail", { plantId: plant.id });
  }

  async function bindCodeToShape(shape: LocationShape, code: string) {
    if (state.status !== "authed") return;
    const r = await patchLocationShape(state.token, shape.id, { qrCode: code });
    if (!r.ok) {
      Alert.alert("Could not bind code to shape", r.error);
      resetScan();
      return;
    }
    setShapes((prev) => prev.map((s) => (s.id === r.data.shape.id ? r.data.shape : s)));
    openShapeInBrowse(r.data.shape);
  }

  async function handleScan(code: string) {
    if (state.status !== "authed") return;
    if (busy) return;
    if (lastCodeRef.current === code) return;
    lastCodeRef.current = code;
    setBusy(true);

    try {
      const gps = await getGps();
      const found = await lookupCode(state.token, code);

      if (found.ok && found.data.type === "plant") {
        let plant = found.data.plant;
        if (gps.lat !== undefined && gps.lng !== undefined) {
          const r = await patchPlant(state.token, plant.id, {
            gpsLat: gps.lat,
            gpsLng: gps.lng,
          });
          if (r.ok) plant = r.data.plant;
        }
        await finishWithPlant(plant, false);
        return;
      }

      if (found.ok && found.data.type === "shape") {
        openShapeInBrowse(found.data.shape);
        setPending(null);
        return;
      }

      if (!found.ok && found.status !== 404) {
        Alert.alert("Lookup failed", found.error);
        resetScan();
        return;
      }

      // New code. Resolve type from brush or prompt the user.
      setPending({ code, gps });
      if (brush.enabled && brush.type === "plant") {
        await createNewPlant(code, gps);
      } else if (brush.enabled && brush.type === "shape") {
        setShapePickerOpen(true);
      } else {
        setTypePickerOpen(true);
      }
    } catch (err) {
      Alert.alert("Error", String(err));
      resetScan();
    }
  }

  async function onPickType(type: "plant" | "shape") {
    setTypePickerOpen(false);
    if (!pending) return;
    if (type === "plant") {
      await createNewPlant(pending.code, pending.gps);
    } else {
      setShapePickerOpen(true);
    }
  }

  function onCancelTypePicker() {
    setTypePickerOpen(false);
    resetScan();
  }

  function onCancelShapePicker() {
    setShapePickerOpen(false);
    // If brush.type is shape, user backed out of binding — drop the scan.
    // If brush.type is ask, the type picker is already dismissed, so also drop.
    resetScan();
  }

  async function onPickShape(shape: LocationShape) {
    setShapePickerOpen(false);
    if (!pending) return;
    await bindCodeToShape(shape, pending.code);
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

  const cameraActive =
    !brushModalOpen && !typePickerOpen && !shapePickerOpen;
  const availableShapes = shapes.filter((s) => !s.qrCode);

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
      {busy && !typePickerOpen && !shapePickerOpen && (
        <View style={styles.busyOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.busyText}>
            {brush.enabled ? "Applying brush…" : "Looking up code…"}
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
              When on, subsequent scans skip the type prompt. Plant fields below
              only apply when the type is Plant.
            </Text>
            <ScrollView
              style={styles.brushScroll}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.brushFieldBlock}>
                <Text style={styles.brushLabel}>Type</Text>
                <View style={styles.typeChipsRow}>
                  {(
                    [
                      { value: "ask", label: "Ask each time" },
                      { value: "plant", label: "Plant" },
                      { value: "shape", label: "Shape" },
                    ] as const
                  ).map((opt) => {
                    const on = brush.type === opt.value;
                    return (
                      <Pressable
                        key={opt.value}
                        onPress={() =>
                          setBrush((b) => ({ ...b, type: opt.value }))
                        }
                        style={[styles.typeChip, on && styles.typeChipOn]}
                      >
                        <Text
                          style={[
                            styles.typeChipLabel,
                            on && styles.typeChipLabelOn,
                          ]}
                        >
                          {opt.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
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
                      {brushSelectedTags.map((t) => {
                        const s = tagKindStyle(t.kind);
                        return (
                          <View
                            key={t.id}
                            style={[styles.tagBubble, { backgroundColor: s.color }]}
                          >
                            <Ionicons name={s.icon} size={12} color="#fff" />
                            <Text style={styles.tagBubbleText} numberOfLines={1}>
                              {t.name}
                            </Text>
                          </View>
                        );
                      })}
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
                  No custom tags yet — add some in Settings.
                </Text>
              ) : (
                <FlatList
                  data={tags.filter((t) => t.kind === "custom")}
                  keyExtractor={(t) => t.id}
                  renderItem={({ item }) => {
                    const on = brush.tagIds.includes(item.id);
                    const s = tagKindStyle(item.kind);
                    return (
                      <TouchableOpacity
                        style={styles.tagPickerRow}
                        onPress={() => toggleTag(item.id)}
                      >
                        <View
                          style={[
                            styles.tagBubble,
                            { backgroundColor: s.color },
                            !on && { opacity: 0.35 },
                          ]}
                        >
                          <Ionicons name={s.icon} size={12} color="#fff" />
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

      <Modal
        transparent
        visible={typePickerOpen}
        animationType="fade"
        onRequestClose={onCancelTypePicker}
      >
        <Pressable style={styles.modalBackdrop} onPress={onCancelTypePicker}>
          <Pressable style={styles.typePickerSheet} onPress={() => {}}>
            <Text style={styles.modalTitle}>What is this code for?</Text>
            {pending && (
              <Text style={styles.typePickerCode} numberOfLines={1}>
                {pending.code}
              </Text>
            )}
            <TouchableOpacity
              style={styles.typePickerRow}
              onPress={() => onPickType("plant")}
            >
              <View style={styles.typePickerIcon}>
                <Ionicons name="leaf-outline" size={20} color="#16a34a" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.typePickerLabel}>Plant</Text>
                <Text style={styles.typePickerSub}>
                  Create a new plant for this code
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#a3a3a3" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.typePickerRow}
              onPress={() => onPickType("shape")}
            >
              <View style={styles.typePickerIcon}>
                <Ionicons name="square-outline" size={20} color="#171717" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.typePickerLabel}>Shape</Text>
                <Text style={styles.typePickerSub}>
                  Bind this code to an existing location
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#a3a3a3" />
            </TouchableOpacity>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                onPress={onCancelTypePicker}
                style={[styles.modalSave, { backgroundColor: "#e5e5e5" }]}
              >
                <Text style={[styles.modalSaveText, { color: "#171717" }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        transparent
        visible={shapePickerOpen}
        animationType="fade"
        onRequestClose={onCancelShapePicker}
      >
        <Pressable style={styles.modalBackdrop} onPress={onCancelShapePicker}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <Text style={styles.modalTitle}>Pick a shape</Text>
            {pending && (
              <Text style={styles.typePickerCode} numberOfLines={1}>
                {pending.code}
              </Text>
            )}
            {availableShapes.length === 0 ? (
              <Text style={styles.shapePickerEmpty}>
                No shapes available. Draw one on the Map first, then scan again.
              </Text>
            ) : (
              <FlatList
                data={availableShapes}
                keyExtractor={(s) => s.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.shapePickerRow}
                    onPress={() => onPickShape(item)}
                  >
                    <View
                      style={[styles.shapeSwatch, { backgroundColor: item.color }]}
                    />
                    <Text style={styles.shapePickerName} numberOfLines={1}>
                      {item.name?.trim() || "Unnamed location"}
                    </Text>
                    <Ionicons name="chevron-forward" size={18} color="#a3a3a3" />
                  </TouchableOpacity>
                )}
              />
            )}
            <View style={styles.modalButtons}>
              <TouchableOpacity
                onPress={onCancelShapePicker}
                style={[styles.modalSave, { backgroundColor: "#e5e5e5" }]}
              >
                <Text style={[styles.modalSaveText, { color: "#171717" }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
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

  typeChipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  typeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: "#f5f5f5",
    borderWidth: 1,
    borderColor: "#e5e5e5",
  },
  typeChipOn: {
    backgroundColor: "#171717",
    borderColor: "#171717",
  },
  typeChipLabel: { fontSize: 13, color: "#171717" },
  typeChipLabelOn: { color: "#fff" },

  typePickerSheet: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
  },
  typePickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e5e5",
  },
  typePickerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#f5f5f5",
    alignItems: "center",
    justifyContent: "center",
  },
  typePickerLabel: { fontSize: 16, color: "#171717", fontWeight: "500" },
  typePickerSub: { fontSize: 12, color: "#737373", marginTop: 2 },
  typePickerCode: {
    fontSize: 13,
    color: "#737373",
    marginTop: 4,
    marginBottom: 4,
  },

  shapePickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: "#f5f5f5",
  },
  shapeSwatch: {
    width: 18,
    height: 18,
    borderRadius: 4,
  },
  shapePickerName: { fontSize: 15, color: "#171717", flex: 1 },
  shapePickerEmpty: {
    paddingVertical: 16,
    fontSize: 14,
    color: "#737373",
    textAlign: "center",
  },

  brushTagWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    flexShrink: 1,
    justifyContent: "flex-end",
  },
  tagBubble: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
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
