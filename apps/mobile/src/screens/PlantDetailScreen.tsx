import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  GestureHandlerRootView,
  PanGestureHandler,
  State,
  type PanGestureHandlerGestureEvent,
  type PanGestureHandlerStateChangeEvent,
} from "react-native-gesture-handler";
import Swipeable from "react-native-gesture-handler/Swipeable";
import * as ImagePicker from "expo-image-picker";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../contexts/AuthContext";
import {
  deleteAction,
  deletePhoto,
  deletePlant,
  getPlant,
  listTags,
  patchAction,
  patchPlant,
  recordAction,
  resetPlant,
  setCoverPhoto,
  uploadPhoto,
  type ActionKind,
  type PublicAction,
  type PublicPhoto,
  type PublicPlant,
  type Tag,
} from "../lib/api";
import AuthImage from "../components/AuthImage";
import ZoomablePhoto from "../components/ZoomablePhoto";
import { getCachedImageUri } from "../lib/imageCache";
import ScreenHeader from "../components/ScreenHeader";
import type { RootStackParamList } from "../navigation/types";
import type { PlantFilter } from "../navigation/BrowseStackTypes";
import { tagKindStyle } from "../lib/tagStyle";

type Route = RouteProp<RootStackParamList, "PlantDetail">;

function normalizeExt(ext: string): string {
  if (ext === "jpeg") return "jpg";
  if (ext === "heif") return "heic";
  if (["jpg", "png", "webp", "heic", "gif"].includes(ext)) return ext;
  return "jpg";
}

function mimeFromExt(ext: string): string {
  switch (ext) {
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "heic":
      return "image/heic";
    case "gif":
      return "image/gif";
    default:
      return "image/jpeg";
  }
}

function utiFromExt(ext: string): string {
  switch (ext) {
    case "png":
      return "public.png";
    case "webp":
      return "org.webmproject.webp";
    case "heic":
      return "public.heic";
    case "gif":
      return "com.compuserve.gif";
    default:
      return "public.jpeg";
  }
}

const ACTION_KINDS: { kind: ActionKind; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { kind: "feeding", label: "Feed", icon: "nutrition-outline" },
  { kind: "watering", label: "Water", icon: "water-outline" },
  { kind: "fertilizing", label: "Fertilize", icon: "flask-outline" },
  { kind: "treating", label: "Treat", icon: "medkit-outline" },
];

export default function PlantDetailScreen() {
  const route = useRoute<Route>();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { state } = useAuth();
  const [plant, setPlant] = useState<PublicPlant | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [actionInput, setActionInput] = useState<
    | { mode: "create"; kind: ActionKind; label: string; notes: string }
    | { mode: "edit"; actionId: string; label: string; notes: string }
    | null
  >(null);
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; right: number } | null>(null);
  const ellipsisRef = useRef<View>(null);
  const [confirmInput, setConfirmInput] = useState<"delete" | "reset" | null>(null);
  const [applying, setApplying] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [lightboxZoomed, setLightboxZoomed] = useState(false);
  const [zoomResetSignal, setZoomResetSignal] = useState(0);
  const { width: winW, height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const dragY = useRef(new Animated.Value(0)).current;
  const closeLightbox = useCallback(() => {
    dragY.setValue(0);
    setLightboxZoomed(false);
    setZoomResetSignal((n) => n + 1);
    setLightboxIndex(null);
  }, [dragY]);
  const onLightboxPan = useCallback(
    (e: PanGestureHandlerGestureEvent) => {
      const dy = e.nativeEvent.translationY;
      dragY.setValue(dy > 0 ? dy : 0);
    },
    [dragY],
  );
  const onLightboxPanEnd = useCallback(
    (e: PanGestureHandlerStateChangeEvent) => {
      if (
        e.nativeEvent.state !== State.END &&
        e.nativeEvent.state !== State.CANCELLED &&
        e.nativeEvent.state !== State.FAILED
      ) {
        return;
      }
      const dy = e.nativeEvent.translationY;
      const vy = e.nativeEvent.velocityY;
      if (dy > 120 || vy > 600) {
        Animated.timing(dragY, {
          toValue: winH,
          duration: 200,
          useNativeDriver: false,
        }).start(closeLightbox);
      } else {
        Animated.spring(dragY, {
          toValue: 0,
          useNativeDriver: false,
        }).start();
      }
    },
    [dragY, winH, closeLightbox],
  );
  const backdropOpacity = dragY.interpolate({
    inputRange: [0, 300],
    outputRange: [1, 0.4],
    extrapolate: "clamp",
  });

  const token = state.status === "authed" ? state.token : null;

  const plantIds = useMemo<string[]>(() => {
    const ids = route.params.plantIds;
    if (ids && ids.length > 0) return ids;
    return [route.params.plantId];
  }, [route.params.plantIds, route.params.plantId]);
  const initialIdx = useMemo(() => {
    const idx = plantIds.indexOf(route.params.plantId);
    return idx >= 0 ? idx : 0;
  }, [plantIds, route.params.plantId]);
  const [currentIdx, setCurrentIdx] = useState(initialIdx);
  const currentPlantId = plantIds[currentIdx] ?? route.params.plantId;
  const swipeEnabled = plantIds.length > 1;

  const [plantCache, setPlantCache] = useState<Map<string, PublicPlant>>(
    () => new Map(),
  );
  const plantCacheRef = useRef(plantCache);
  useEffect(() => {
    plantCacheRef.current = plantCache;
  }, [plantCache]);
  const inflightRef = useRef<Set<string>>(new Set());
  const pagerRef = useRef<FlatList<string>>(null);

  const updatePlant = useCallback((p: PublicPlant) => {
    setPlant(p);
    setPlantCache((c) => {
      const next = new Map(c);
      next.set(p.id, p);
      return next;
    });
  }, []);

  const reload = useCallback(async () => {
    if (!token) return;
    const r = await getPlant(token, currentPlantId);
    if (r.ok) updatePlant(r.data.plant);
  }, [token, currentPlantId, updatePlant]);

  useEffect(() => {
    if (!token) return;
    (async () => {
      const t = await listTags(token);
      if (t.ok) setTags(t.data.tags);
    })();
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    const cached = plantCacheRef.current.get(currentPlantId);
    if (cached) {
      setPlant(cached);
      setLoading(false);
    } else {
      setLoading(true);
      setPlant(null);
    }
    (async () => {
      await reload();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [reload, currentPlantId]);

  useEffect(() => {
    if (!token) return;
    const ensure = async (id: string) => {
      if (plantCacheRef.current.has(id)) return;
      if (inflightRef.current.has(id)) return;
      inflightRef.current.add(id);
      try {
        const r = await getPlant(token, id);
        if (r.ok) {
          setPlantCache((c) => {
            const next = new Map(c);
            next.set(id, r.data.plant);
            return next;
          });
        }
      } finally {
        inflightRef.current.delete(id);
      }
    };
    if (currentIdx > 0) ensure(plantIds[currentIdx - 1]);
    if (currentIdx < plantIds.length - 1) ensure(plantIds[currentIdx + 1]);
  }, [token, currentIdx, plantIds]);

  const pagerExtraData = useMemo(
    () => ({ currentIdx, plantCache }),
    [currentIdx, plantCache],
  );

  async function patch(data: Parameters<typeof patchPlant>[2]) {
    if (!token || !plant) return;
    const r = await patchPlant(token, plant.id, data);
    if (r.ok) updatePlant(r.data.plant);
    else Alert.alert("Save failed", r.error);
  }

  async function pickAndUpload() {
    if (!token || !plant) return;
    const choice = await new Promise<"camera" | "library" | null>((resolve) => {
      if (Platform.OS === "ios") {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: ["Cancel", "Take Photo", "Choose from Library"],
            cancelButtonIndex: 0,
          },
          (i) => resolve(i === 1 ? "camera" : i === 2 ? "library" : null),
        );
      } else {
        Alert.alert("Add photo", undefined, [
          { text: "Cancel", style: "cancel", onPress: () => resolve(null) },
          { text: "Take Photo", onPress: () => resolve("camera") },
          { text: "Choose from Library", onPress: () => resolve("library") },
        ]);
      }
    });
    if (!choice) return;

    let result: ImagePicker.ImagePickerResult;
    if (choice === "camera") {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission required", "Camera access is required to take photos.");
        return;
      }
      result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.85,
        exif: true,
      });
    } else {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission required", "Photo library access is required.");
        return;
      }
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.85,
        exif: true,
      });
    }
    if (result.canceled || !result.assets[0]) return;
    const r = await uploadPhoto(token, plant.id, result.assets[0].uri);
    if (!r.ok) {
      Alert.alert("Upload failed", r.error);
      return;
    }
    await reload();
  }

  async function sharePhoto(photo: PublicPhoto) {
    try {
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert("Sharing unavailable", "This device does not support sharing.");
        return;
      }
      const url = photo.urls.original;
      const q = url.indexOf("?");
      const pathPart = q === -1 ? url : url.slice(0, q);
      const dot = pathPart.lastIndexOf(".");
      const rawExt = dot === -1 ? "" : pathPart.slice(dot + 1).toLowerCase();
      const ext = normalizeExt(rawExt);
      const cachedUri = await getCachedImageUri(url, pathPart);

      const safeName =
        (plant?.name ?? "")
          .replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, "_")
          .replace(/^\.+|[. ]+$/g, "")
          .trim() || "photo";
      const shareDir = `${FileSystem.cacheDirectory}plantr-share/`;
      const dirInfo = await FileSystem.getInfoAsync(shareDir);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(shareDir, { intermediates: true });
      }
      const shareUri = `${shareDir}${safeName}.${ext}`;
      const existing = await FileSystem.getInfoAsync(shareUri);
      if (existing.exists) {
        await FileSystem.deleteAsync(shareUri, { idempotent: true });
      }
      await FileSystem.copyAsync({ from: cachedUri, to: shareUri });

      await Sharing.shareAsync(shareUri, {
        mimeType: mimeFromExt(ext),
        UTI: utiFromExt(ext),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert("Share failed", msg);
    }
  }

  function showPhotoMenu(photo: PublicPhoto, isCover: boolean) {
    if (!token || !plant) return;
    const photoId = photo.id;
    const options = isCover
      ? ["Cancel", "Share", "Delete"]
      : ["Cancel", "Set as Cover", "Share", "Delete"];
    const cancelButtonIndex = 0;
    const shareIndex = isCover ? 1 : 2;
    const destructiveButtonIndex = isCover ? 2 : 3;

    const handle = async (index: number) => {
      if (Platform.OS === "ios") {
        if (!isCover && index === 1) {
          const r = await setCoverPhoto(token, photoId);
          if (r.ok) updatePlant(r.data.plant);
          else Alert.alert("Failed", r.error);
        } else if (index === shareIndex) {
          sharePhoto(photo);
        } else if (index === destructiveButtonIndex) {
          confirmDelete(photoId);
        }
      } else {
        // mapped via Alert buttons below
      }
    };

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex, destructiveButtonIndex },
        handle,
      );
    } else {
      const buttons: { text: string; style?: "cancel" | "destructive"; onPress?: () => void }[] = [
        { text: "Cancel", style: "cancel" },
      ];
      if (!isCover) {
        buttons.push({
          text: "Set as Cover",
          onPress: async () => {
            const r = await setCoverPhoto(token, photoId);
            if (r.ok) updatePlant(r.data.plant);
          },
        });
      }
      buttons.push({
        text: "Share",
        onPress: () => sharePhoto(photo),
      });
      buttons.push({
        text: "Delete",
        style: "destructive",
        onPress: () => confirmDelete(photoId),
      });
      Alert.alert("Photo", undefined, buttons);
    }
  }

  function confirmDelete(photoId: string) {
    Alert.alert("Delete photo?", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          if (!token) return;
          const r = await deletePhoto(token, photoId);
          if (!r.ok) {
            Alert.alert("Delete failed", r.error);
            return;
          }
          await reload();
        },
      },
    ]);
  }

  async function submitAction() {
    if (!token || !plant || !actionInput) return;
    if (actionInput.mode === "create") {
      const r = await recordAction(token, plant.id, {
        kind: actionInput.kind,
        notes: actionInput.notes.trim() || undefined,
      });
      if (!r.ok) {
        Alert.alert("Failed", r.error);
        return;
      }
    } else {
      const r = await patchAction(token, actionInput.actionId, {
        notes: actionInput.notes.trim() || null,
      });
      if (!r.ok) {
        Alert.alert("Failed", r.error);
        return;
      }
    }
    setActionInput(null);
    await reload();
  }

  async function removeAction(actionId: string) {
    if (!token) return;
    const r = await deleteAction(token, actionId);
    if (!r.ok) {
      Alert.alert("Delete failed", r.error);
    }
    await reload();
  }

  function openEditAction(action: PublicAction) {
    const label = action.kind.charAt(0).toUpperCase() + action.kind.slice(1);
    setActionInput({
      mode: "edit",
      actionId: action.id,
      label,
      notes: action.notes ?? "",
    });
  }

  function openMenu() {
    ellipsisRef.current?.measureInWindow((x, y, w, h) => {
      setMenuAnchor({ top: y + h + 4, right: 12 });
    });
  }
  const closeMenu = () => setMenuAnchor(null);

  function viewOnMap() {
    if (!plant) return;
    closeMenu();
    nav.navigate("Map", { highlightPlantIds: [plant.id], focusShapeId: null });
  }

  async function submitConfirm() {
    if (!token || !plant || !confirmInput) return;
    setApplying(true);
    if (confirmInput === "delete") {
      const r = await deletePlant(token, plant.id);
      setApplying(false);
      setConfirmInput(null);
      if (!r.ok) {
        Alert.alert("Delete failed", r.error);
        return;
      }
      nav.goBack();
    } else {
      const r = await resetPlant(token, plant.id);
      setApplying(false);
      setConfirmInput(null);
      if (!r.ok) {
        Alert.alert("Reset failed", r.error);
        return;
      }
      updatePlant(r.data.plant);
    }
  }

  const hasGps = !!plant && plant.gpsLat != null && plant.gpsLng != null;

  function openTagBrowse(tag: Tag) {
    const filter: PlantFilter =
      tag.kind === "location"
        ? { kind: "location", tagId: tag.id, label: tag.name }
        : { kind: "tag", tagId: tag.id, label: tag.name };
    nav.push("PlantList", { filter, title: tag.name });
  }

  const renderLoading = () => (
    <View style={styles.loading}>
      <ActivityIndicator />
    </View>
  );

  const renderBody = (p: PublicPlant, interactive: boolean) => (
    <Fragment>
      <ScreenHeader
        title={p.qrCode}
        onBack={() => nav.goBack()}
        right={
          <Pressable
            ref={interactive ? ellipsisRef : null}
            onPress={openMenu}
            hitSlop={12}
          >
            <Ionicons name="ellipsis-horizontal" size={24} color="#171717" />
          </Pressable>
        }
      />

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await reload(); setRefreshing(false); }} />}
      >
        <View style={styles.coverWrap}>
          {p.coverPhoto ? (
            <Pressable
              onPress={() => {
                const idx = p.photos.findIndex((ph) => ph.id === p.coverPhoto!.id);
                setLightboxIndex(idx >= 0 ? idx : 0);
              }}
            >
              <AuthImage
                path={p.coverPhoto.urls.cover}
                style={styles.cover}
                resizeMode="cover"
              />
            </Pressable>
          ) : (
            <View style={[styles.cover, styles.coverEmpty]}>
              <Ionicons name="leaf-outline" size={64} color="#a3a3a3" />
              <Text style={styles.coverEmptyText}>No photo yet</Text>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <EditableText
            label="Name"
            value={p.name}
            placeholder="Add a name"
            onSave={(v) => patch({ name: v || null })}
            big
          />
          {(() => {
            const customTags = p.tags.filter((t) => t.kind === "custom");
            const locationTags = p.tags.filter((t) => t.kind === "location");
            return (
              <>
                <View style={[styles.row, styles.rowMultiline]}>
                  <Pressable
                    onPress={() => setTagPickerOpen(true)}
                    hitSlop={6}
                    style={styles.rowLabelPressable}
                  >
                    <Text style={styles.rowLabel}>Tags</Text>
                  </Pressable>
                  <View style={styles.rowValueWrap}>
                    {customTags.length > 0 ? (
                      <View style={styles.tagWrap}>
                        {customTags.map((t) => (
                          <Pressable
                            key={t.id}
                            onPress={() => openTagBrowse(t)}
                            hitSlop={4}
                          >
                            <TagBubble tag={t} />
                          </Pressable>
                        ))}
                        <Pressable onPress={() => setTagPickerOpen(true)} hitSlop={8}>
                          <View style={styles.tagBubbleAdd}>
                            <Ionicons name="add" size={14} color="#525252" />
                          </View>
                        </Pressable>
                      </View>
                    ) : (
                      <Pressable onPress={() => setTagPickerOpen(true)}>
                        <Text style={[styles.rowValue, styles.placeholderValue]}>
                          Add tags
                        </Text>
                      </Pressable>
                    )}
                  </View>
                </View>
                {locationTags.length > 0 && (
                  <View style={[styles.row, styles.rowMultiline]}>
                    <Text style={styles.rowLabel}>Location</Text>
                    <View style={styles.rowValueWrap}>
                      <View style={styles.tagWrap}>
                        {locationTags.map((t) => (
                          <Pressable
                            key={t.id}
                            onPress={() => openTagBrowse(t)}
                            hitSlop={4}
                          >
                            <TagBubble tag={t} />
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  </View>
                )}
              </>
            );
          })()}
          <EditableText
            label="Description"
            value={p.description}
            placeholder="Add description"
            onSave={(v) => patch({ description: v || null })}
            multiline
          />
          <EditableText
            label="Notes"
            value={p.notes}
            placeholder="Add notes"
            onSave={(v) => patch({ notes: v || null })}
            multiline
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Photos</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {p.photos.map((ph, i) => (
              <Pressable
                key={ph.id}
                onPress={() => setLightboxIndex(i)}
                onLongPress={() => showPhotoMenu(ph, ph.id === p.coverPhoto?.id)}
                delayLongPress={400}
                style={styles.thumbWrap}
              >
                <AuthImage path={ph.urls.thumb} style={styles.thumb} resizeMode="cover" />
                {ph.id === p.coverPhoto?.id && (
                  <View style={styles.coverBadge}>
                    <Ionicons name="star" size={12} color="#fff" />
                  </View>
                )}
              </Pressable>
            ))}
            <Pressable onPress={pickAndUpload} style={[styles.thumbWrap, styles.thumbAdd]}>
              <Ionicons name="add" size={32} color="#16a34a" />
            </Pressable>
          </ScrollView>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Actions</Text>
          <View style={styles.actionRow}>
            {ACTION_KINDS.map(({ kind, label, icon }) => (
              <TouchableOpacity
                key={kind}
                style={styles.actionButton}
                onPress={() =>
                  setActionInput({ mode: "create", kind, label, notes: "" })
                }
              >
                <Ionicons name={icon} size={22} color="#171717" />
                <Text style={styles.actionLabel}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.actionLog}>
            {p.actions.length === 0 ? (
              <Text style={styles.emptyText}>No actions yet.</Text>
            ) : (
              p.actions.map((a) => (
                <ActionRow
                  key={a.id}
                  action={a}
                  onEdit={() => openEditAction(a)}
                  onDelete={() => removeAction(a.id)}
                />
              ))
            )}
          </View>
        </View>
      </ScrollView>
    </Fragment>
  );

  return (
    <View style={styles.root}>
      {!swipeEnabled ? (
        loading || !plant ? renderLoading() : renderBody(plant, true)
      ) : (
        <FlatList
          ref={pagerRef}
          style={styles.pager}
          data={plantIds}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={initialIdx}
          getItemLayout={(_, i) => ({
            length: winW,
            offset: winW * i,
            index: i,
          })}
          keyExtractor={(id) => id}
          windowSize={3}
          extraData={pagerExtraData}
          decelerationRate="fast"
          renderItem={({ item, index }) => {
            const cached = plantCache.get(item);
            const isCurrent = index === currentIdx;
            return (
              <View
                style={{ width: winW, height: "100%" }}
                pointerEvents={isCurrent ? "auto" : "none"}
              >
                {cached ? renderBody(cached, isCurrent) : renderLoading()}
              </View>
            );
          }}
          onMomentumScrollEnd={(e) => {
            const idx = Math.round(e.nativeEvent.contentOffset.x / winW);
            if (idx !== currentIdx) setCurrentIdx(idx);
          }}
          onScrollToIndexFailed={(info) => {
            setTimeout(() => {
              pagerRef.current?.scrollToOffset({
                offset: info.index * winW,
                animated: false,
              });
            }, 100);
          }}
        />
      )}

      {plant && (<>
      <Modal
        visible={lightboxIndex !== null}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={closeLightbox}
      >
        <GestureHandlerRootView style={styles.lightboxRoot}>
          <Animated.View
            style={[styles.lightboxBackdrop, { opacity: backdropOpacity }]}
            pointerEvents="none"
          />
          <PanGestureHandler
            enabled={!lightboxZoomed}
            activeOffsetY={[-9999, 12]}
            failOffsetX={[-12, 12]}
            onGestureEvent={onLightboxPan}
            onHandlerStateChange={onLightboxPanEnd}
          >
            <Animated.View
              style={[styles.lightboxStage, { transform: [{ translateY: dragY }] }]}
            >
              <FlatList
                data={plant.photos}
                horizontal
                pagingEnabled
                scrollEnabled={!lightboxZoomed}
                showsHorizontalScrollIndicator={false}
                initialScrollIndex={lightboxIndex ?? 0}
                getItemLayout={(_, index) => ({
                  length: winW,
                  offset: winW * index,
                  index,
                })}
                keyExtractor={(p) => p.id}
                renderItem={({ item }) => (
                  <ZoomablePhoto
                    path={item.urls.cover}
                    width={winW}
                    height={winH}
                    resetSignal={zoomResetSignal}
                    onZoomChange={setLightboxZoomed}
                    onLongPress={() =>
                      showPhotoMenu(item, item.id === plant.coverPhoto?.id)
                    }
                  />
                )}
                onMomentumScrollEnd={(e) => {
                  const idx = Math.round(e.nativeEvent.contentOffset.x / winW);
                  setLightboxIndex((cur) => (cur === null ? null : idx));
                }}
              />
            </Animated.View>
          </PanGestureHandler>
          <View
            style={[styles.lightboxBar, { paddingTop: insets.top }]}
            pointerEvents="box-none"
          >
            <View style={styles.lightboxBarRow} pointerEvents="box-none">
              <Pressable onPress={closeLightbox} hitSlop={20} style={styles.lightboxCloseHit}>
                <Ionicons name="close" size={32} color="#fff" />
              </Pressable>
              {plant.photos.length > 1 && (
                <Text style={styles.lightboxCount}>
                  {(lightboxIndex ?? 0) + 1} / {plant.photos.length}
                </Text>
              )}
              <View style={{ width: 44 }} />
            </View>
          </View>
        </GestureHandlerRootView>
      </Modal>

      <TagPickerModal
        visible={tagPickerOpen}
        tags={tags.filter((t) => t.kind === "custom")}
        selectedIds={plant.tags.filter((t) => t.kind === "custom").map((t) => t.id)}
        onClose={() => setTagPickerOpen(false)}
        onSave={async (customIds) => {
          setTagPickerOpen(false);
          // Preserve auto-managed location tags — they're driven by GPS and
          // can't be set from the picker.
          const locationIds = plant.tags
            .filter((t) => t.kind === "location")
            .map((t) => t.id);
          await patch({ tagIds: [...customIds, ...locationIds] });
        }}
      />

      <Modal
        transparent
        visible={actionInput !== null}
        animationType="fade"
        onRequestClose={() => setActionInput(null)}
      >
        {actionInput && (
          <Pressable style={styles.modalBackdrop} onPress={() => setActionInput(null)}>
            <Pressable style={styles.modalSheet} onPress={() => {}}>
              <Text style={styles.modalTitle}>
                {actionInput.mode === "create" ? "Record " : "Edit "}
                {actionInput.label.toLowerCase()}
                {actionInput.mode === "edit" ? " notes" : ""}
              </Text>
              <TextInput
                style={styles.notesInput}
                placeholder="Notes (optional)"
                multiline
                value={actionInput.notes}
                onChangeText={(t) =>
                  setActionInput((cur) => (cur ? { ...cur, notes: t } : cur))
                }
              />
              <View style={styles.modalButtons}>
                <TouchableOpacity onPress={() => setActionInput(null)} style={styles.modalCancel}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={submitAction} style={styles.modalSave}>
                  <Text style={styles.modalSaveText}>Save</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        )}
      </Modal>

      <Modal
        visible={menuAnchor !== null}
        transparent
        animationType="fade"
        onRequestClose={closeMenu}
      >
        <Pressable style={styles.menuBackdrop} onPress={closeMenu}>
          {menuAnchor ? (
            <View style={[styles.menu, { top: menuAnchor.top, right: menuAnchor.right }]}>
              {ACTION_KINDS.map(({ kind, label, icon }) => (
                <Pressable
                  key={kind}
                  style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
                  onPress={() => {
                    closeMenu();
                    setActionInput({ mode: "create", kind, label, notes: "" });
                  }}
                >
                  <Ionicons name={icon} size={18} color="#171717" />
                  <Text style={styles.menuItemText}>{label}</Text>
                </Pressable>
              ))}
              {hasGps && (
                <>
                  <View style={styles.menuSeparator} />
                  <Pressable
                    style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
                    onPress={viewOnMap}
                  >
                    <Ionicons name="map-outline" size={18} color="#171717" />
                    <Text style={styles.menuItemText}>View on Map</Text>
                  </Pressable>
                </>
              )}
              <View style={styles.menuSeparator} />
              <Pressable
                style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
                onPress={() => {
                  closeMenu();
                  setConfirmInput("delete");
                }}
              >
                <Ionicons name="trash-outline" size={18} color="#dc2626" />
                <Text style={[styles.menuItemText, styles.menuItemDanger]}>Delete Plant</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
                onPress={() => {
                  closeMenu();
                  setConfirmInput("reset");
                }}
              >
                <Ionicons name="refresh-outline" size={18} color="#dc2626" />
                <Text style={[styles.menuItemText, styles.menuItemDanger]}>Reset Plant</Text>
              </Pressable>
            </View>
          ) : null}
        </Pressable>
      </Modal>

      <Modal
        transparent
        visible={confirmInput !== null}
        animationType="fade"
        onRequestClose={() => !applying && setConfirmInput(null)}
      >
        {confirmInput && (
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => !applying && setConfirmInput(null)}
          >
            <Pressable style={styles.modalSheet} onPress={() => {}}>
              <Text style={styles.modalTitle}>
                {confirmInput === "delete"
                  ? `Delete plant "${plant.qrCode}"?`
                  : `Reset plant "${plant.qrCode}"?`}
              </Text>
              <Text style={styles.modalBody}>
                {confirmInput === "delete"
                  ? "The plant, its photos, and its actions will be permanently removed. The QR code can be scanned again to create a fresh entry. This cannot be undone."
                  : "All photos, actions, name, species, GPS, and notes will be erased. The QR code stays bound to this plant. This cannot be undone."}
              </Text>
              <View style={styles.modalButtons}>
                <TouchableOpacity
                  onPress={() => setConfirmInput(null)}
                  disabled={applying}
                  style={styles.modalCancel}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={submitConfirm}
                  disabled={applying}
                  style={[styles.modalDelete, applying && styles.modalDeleteDisabled]}
                >
                  {applying ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.modalDeleteText}>
                      {confirmInput === "delete" ? "Delete" : "Reset"}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        )}
      </Modal>
      </>)}
    </View>
  );
}

function EditableText({
  label,
  value,
  placeholder,
  onSave,
  big,
  multiline,
}: {
  label: string;
  value: string | null;
  placeholder: string;
  onSave: (v: string) => void | Promise<void>;
  big?: boolean;
  multiline?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  async function commit() {
    setEditing(false);
    if (draft === (value ?? "")) return;
    await onSave(draft);
  }

  return (
    <View style={[styles.row, multiline && styles.rowMultiline]}>
      <Text style={styles.rowLabel}>{label}</Text>
      {editing ? (
        <TextInput
          autoFocus
          value={draft}
          onChangeText={setDraft}
          onBlur={commit}
          onSubmitEditing={multiline ? undefined : commit}
          multiline={!!multiline}
          style={[
            styles.rowInput,
            multiline && styles.rowInputMultiline,
            big && styles.rowInputBig,
          ]}
          placeholder={placeholder}
        />
      ) : (
        <Pressable onPress={() => setEditing(true)} style={styles.rowValueWrap}>
          <Text
            style={[
              styles.rowValue,
              big && styles.rowValueBig,
              !value && styles.placeholderValue,
            ]}
            numberOfLines={multiline ? undefined : 2}
          >
            {value || placeholder}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

function TagBubble({ tag, dim }: { tag: Tag; dim?: boolean }) {
  const style = tagKindStyle(tag.kind);
  return (
    <View
      style={[
        styles.tagBubble,
        { backgroundColor: style.color },
        dim && { opacity: 0.35 },
      ]}
    >
      <Ionicons name={style.icon} size={12} color="#fff" />
      <Text style={styles.tagBubbleText} numberOfLines={1}>
        {tag.name}
      </Text>
    </View>
  );
}

function TagPickerModal({
  visible,
  tags,
  selectedIds,
  onClose,
  onSave,
}: {
  visible: boolean;
  tags: Tag[];
  selectedIds: string[];
  onClose: () => void;
  onSave: (ids: string[]) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (visible) setDraft(new Set(selectedIds));
  }, [visible, selectedIds]);

  function toggle(id: string) {
    setDraft((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalSheet} onPress={() => {}}>
          <Text style={styles.modalTitle}>Choose tags</Text>
          {tags.length === 0 ? (
            <Text style={styles.tagPickerEmpty}>
              No custom tags yet — add some in Settings.
            </Text>
          ) : (
            <FlatList
              data={tags}
              keyExtractor={(t) => t.id}
              renderItem={({ item }) => {
                const on = draft.has(item.id);
                return (
                  <TouchableOpacity
                    style={styles.tagPickerRow}
                    onPress={() => toggle(item.id)}
                  >
                    <TagBubble tag={item} dim={!on} />
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
            <TouchableOpacity onPress={onClose} style={styles.modalCancel}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onSave(Array.from(draft))}
              style={styles.modalSave}
            >
              <Text style={styles.modalSaveText}>Save</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ActionRow({
  action,
  onEdit,
  onDelete,
}: {
  action: PublicAction;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const date = new Date(action.takenAt);
  const formatted = `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  const label = action.kind.charAt(0).toUpperCase() + action.kind.slice(1);
  return (
    <Swipeable
      renderRightActions={(_progress, dragX) => {
        const willDelete = dragX.interpolate({
          inputRange: [-200, -160],
          outputRange: [1, 0],
          extrapolate: "clamp",
        });
        return (
          <View style={styles.actionDeleteSwipe} pointerEvents="none">
            <Ionicons name="trash-outline" size={22} color="#fff" />
            <Animated.Text
              style={[styles.actionDeleteSwipeText, { opacity: willDelete }]}
            >
              Release
            </Animated.Text>
          </View>
        );
      }}
      rightThreshold={160}
      overshootRight={false}
      onSwipeableOpen={(direction) => {
        if (direction === "right") onDelete();
      }}
    >
      <Pressable
        onPress={onEdit}
        style={({ pressed }) => [
          styles.actionRowItem,
          pressed && { backgroundColor: "#f5f5f5" },
        ]}
      >
        <View style={styles.actionRowHeader}>
          <Text style={styles.actionRowKind}>{label}</Text>
          <Text style={styles.actionRowDate}>{formatted}</Text>
        </View>
        {action.notes ? (
          <Text style={styles.actionRowNotes}>{action.notes}</Text>
        ) : (
          <Text style={[styles.actionRowNotes, styles.actionRowNotesEmpty]}>
            Tap to add notes
          </Text>
        )}
        <Text style={styles.actionRowMeta}>by {action.createdBy.username}</Text>
      </Pressable>
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fafafa" },
  pager: { flex: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { paddingBottom: 32 },

  coverWrap: { backgroundColor: "#000" },
  cover: { width: "100%", aspectRatio: 4 / 3 },
  coverEmpty: {
    backgroundColor: "#e5e5e5",
    alignItems: "center",
    justifyContent: "center",
  },
  coverEmptyText: { marginTop: 8, color: "#737373", fontSize: 14 },

  section: {
    backgroundColor: "#fff",
    marginTop: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e5e5",
  },
  sectionTitle: { fontSize: 13, color: "#737373", textTransform: "uppercase", marginBottom: 8 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: "#f5f5f5",
    minHeight: 48,
  },
  rowMultiline: { alignItems: "flex-start" },
  rowLabel: { fontSize: 14, color: "#737373", width: 100 },
  rowValueWrap: { flex: 1 },
  rowValue: { fontSize: 16, color: "#171717", flex: 1 },
  rowValueBig: { fontSize: 20, fontWeight: "600" },
  placeholderValue: { color: "#a3a3a3" },
  rowInput: {
    flex: 1,
    fontSize: 16,
    color: "#171717",
    padding: 0,
  },
  rowInputBig: { fontSize: 20, fontWeight: "600" },
  rowInputMultiline: { minHeight: 60, textAlignVertical: "top" },

  thumbWrap: {
    width: 100,
    height: 100,
    marginRight: 8,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#e5e5e5",
  },
  thumb: { width: "100%", height: "100%" },
  thumbAdd: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f5f5f5",
    borderWidth: 1,
    borderColor: "#16a34a",
    borderStyle: "dashed",
  },
  coverBadge: {
    position: "absolute",
    top: 4,
    right: 4,
    backgroundColor: "#16a34a",
    borderRadius: 10,
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
  },

  actionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginVertical: 12,
  },
  actionButton: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    marginHorizontal: 4,
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
  },
  actionLabel: { fontSize: 12, color: "#171717", marginTop: 4 },

  actionLog: { paddingTop: 8, paddingBottom: 12 },
  actionRowItem: {
    backgroundColor: "#fff",
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginHorizontal: -16, // bleed to section edges so swipe-delete fills
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: "#f5f5f5",
  },
  actionRowHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  actionRowKind: { fontSize: 15, fontWeight: "500", color: "#171717" },
  actionRowDate: { fontSize: 12, color: "#737373" },
  actionRowNotes: { marginTop: 4, fontSize: 14, color: "#404040" },
  actionRowNotesEmpty: { color: "#a3a3a3", fontStyle: "italic" },
  actionRowMeta: { marginTop: 4, fontSize: 12, color: "#a3a3a3" },
  actionDeleteSwipe: {
    backgroundColor: "#dc2626",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingHorizontal: 24,
    gap: 8,
    minWidth: 200,
  },
  actionDeleteSwipeText: { color: "#fff", fontSize: 12, fontWeight: "500" },
  emptyText: { color: "#a3a3a3", fontSize: 14, paddingVertical: 8 },

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
    maxHeight: "70%",
  },
  modalTitle: { fontSize: 18, fontWeight: "600", marginBottom: 12 },
  modalBody: { fontSize: 14, color: "#525252", lineHeight: 20, marginBottom: 4 },

  menuBackdrop: { flex: 1 },
  menu: {
    position: "absolute",
    minWidth: 180,
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingVertical: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e5e5",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  menuItemPressed: { backgroundColor: "#f5f5f5" },
  menuItemText: { fontSize: 15, color: "#171717" },
  menuItemDanger: { color: "#dc2626" },
  menuSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#e5e5e5",
    marginVertical: 4,
  },

  modalDelete: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: "#dc2626",
    borderRadius: 6,
    minWidth: 60,
    alignItems: "center",
  },
  modalDeleteDisabled: { opacity: 0.6 },
  modalDeleteText: { color: "#fff", fontSize: 15, fontWeight: "500" },

  tagWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  tagBubble: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    alignSelf: "flex-start",
    maxWidth: "100%",
  },
  tagBubbleText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "500",
  },
  tagBubbleAdd: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#d4d4d4",
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  rowLabelPressable: { width: 100 },
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
  notesInput: {
    borderWidth: 1,
    borderColor: "#d4d4d4",
    borderRadius: 6,
    padding: 10,
    minHeight: 80,
    textAlignVertical: "top",
    fontSize: 15,
  },
  modalButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 12,
    gap: 8,
  },
  modalCancel: { paddingVertical: 8, paddingHorizontal: 14 },
  modalCancelText: { color: "#525252", fontSize: 15 },
  modalSave: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: "#171717",
    borderRadius: 6,
  },
  modalSaveText: { color: "#fff", fontSize: 15, fontWeight: "500" },

  lightboxRoot: { flex: 1, backgroundColor: "#000" },
  lightboxBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
  },
  lightboxStage: { flex: 1 },
  lightboxBar: { position: "absolute", top: 0, left: 0, right: 0 },
  lightboxBarRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  lightboxCloseHit: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: -6,
  },
  lightboxCount: { color: "#fff", fontSize: 14, fontWeight: "500" },
});
