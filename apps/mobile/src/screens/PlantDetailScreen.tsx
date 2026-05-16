import { useCallback, useEffect, useRef, useState } from "react";
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
  type PublicPlant,
  type Tag,
} from "../lib/api";
import AuthImage from "../components/AuthImage";
import ScreenHeader from "../components/ScreenHeader";
import type { RootStackParamList } from "../navigation/types";
import type { PlantFilter } from "../navigation/BrowseStackTypes";
import { tagKindStyle } from "../lib/tagStyle";

type Route = RouteProp<RootStackParamList, "PlantDetail">;

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
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const { width: winW, height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const dragY = useRef(new Animated.Value(0)).current;
  const closeLightbox = useCallback(() => {
    dragY.setValue(0);
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

  const reload = useCallback(async () => {
    if (!token) return;
    const r = await getPlant(token, route.params.plantId);
    if (r.ok) setPlant(r.data.plant);
  }, [token, route.params.plantId]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await reload();
      if (token) {
        const t = await listTags(token);
        if (t.ok) setTags(t.data.tags);
      }
      setLoading(false);
    })();
  }, [reload, token]);

  async function patch(data: Parameters<typeof patchPlant>[2]) {
    if (!token || !plant) return;
    const r = await patchPlant(token, plant.id, data);
    if (r.ok) setPlant(r.data.plant);
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

  function showPhotoMenu(photoId: string, isCover: boolean) {
    if (!token || !plant) return;
    const options = isCover
      ? ["Cancel", "Delete"]
      : ["Cancel", "Set as Cover", "Delete"];
    const cancelButtonIndex = 0;
    const destructiveButtonIndex = isCover ? 1 : 2;

    const handle = async (index: number) => {
      if (Platform.OS === "ios") {
        if (!isCover && index === 1) {
          const r = await setCoverPhoto(token, photoId);
          if (r.ok) setPlant(r.data.plant);
          else Alert.alert("Failed", r.error);
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
            if (r.ok) setPlant(r.data.plant);
          },
        });
      }
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

  function openPlantMenu() {
    if (!plant) return;
    const code = plant.qrCode;
    const onReset = () =>
      Alert.alert(
        "Reset plant?",
        `All photos, actions, name, type, GPS, and notes for ${code} will be erased. The QR code stays available for a new plant. This cannot be undone.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Reset", style: "destructive", onPress: doReset },
        ],
      );
    const onDelete = () =>
      Alert.alert(
        "Delete plant?",
        `${code} will be permanently removed along with its photos and actions. The QR code can be scanned again to create a fresh entry. This cannot be undone.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Delete", style: "destructive", onPress: doDelete },
        ],
      );

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Cancel", "Reset plant", "Delete plant"],
          cancelButtonIndex: 0,
          destructiveButtonIndex: 2,
          title: code,
        },
        (i) => {
          if (i === 1) onReset();
          else if (i === 2) onDelete();
        },
      );
    } else {
      Alert.alert(code, undefined, [
        { text: "Cancel", style: "cancel" },
        { text: "Reset plant", onPress: onReset },
        { text: "Delete plant", style: "destructive", onPress: onDelete },
      ]);
    }
  }

  async function doReset() {
    if (!token || !plant) return;
    const r = await resetPlant(token, plant.id);
    if (!r.ok) {
      Alert.alert("Reset failed", r.error);
      return;
    }
    setPlant(r.data.plant);
  }

  async function doDelete() {
    if (!token || !plant) return;
    const r = await deletePlant(token, plant.id);
    if (!r.ok) {
      Alert.alert("Delete failed", r.error);
      return;
    }
    nav.goBack();
  }

  function openTagBrowse(tag: Tag) {
    const filter: PlantFilter =
      tag.kind === "location"
        ? { kind: "location", tagId: tag.id, label: tag.name }
        : { kind: "tag", tagId: tag.id, label: tag.name };
    nav.push("PlantList", { filter, title: tag.name });
  }

  if (loading || !plant) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={plant.qrCode}
        onBack={() => nav.goBack()}
        right={
          <Pressable onPress={openPlantMenu} hitSlop={12}>
            <Ionicons name="ellipsis-horizontal" size={24} color="#171717" />
          </Pressable>
        }
      />

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await reload(); setRefreshing(false); }} />}
      >
        <View style={styles.coverWrap}>
          {plant.coverPhoto ? (
            <Pressable
              onPress={() => {
                const idx = plant.photos.findIndex((p) => p.id === plant.coverPhoto!.id);
                setLightboxIndex(idx >= 0 ? idx : 0);
              }}
            >
              <AuthImage
                path={plant.coverPhoto.urls.cover}
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
            value={plant.name}
            placeholder="Add a name"
            onSave={(v) => patch({ name: v || null })}
            big
          />
          <View style={[styles.row, styles.rowMultiline]}>
            <Pressable
              onPress={() => setTagPickerOpen(true)}
              hitSlop={6}
              style={styles.rowLabelPressable}
            >
              <Text style={styles.rowLabel}>Tags</Text>
            </Pressable>
            <View style={styles.rowValueWrap}>
              {plant.tags.length > 0 ? (
                <View style={styles.tagWrap}>
                  {plant.tags.map((t) => (
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
          <EditableText
            label="Species"
            value={plant.species}
            placeholder="Add species"
            onSave={(v) => patch({ species: v || null })}
          />
          <EditableText
            label="Description"
            value={plant.description}
            placeholder="Add description"
            onSave={(v) => patch({ description: v || null })}
            multiline
          />
          <EditableText
            label="Notes"
            value={plant.notes}
            placeholder="Add notes"
            onSave={(v) => patch({ notes: v || null })}
            multiline
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Photos</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {plant.photos.map((p, i) => (
              <Pressable
                key={p.id}
                onPress={() => setLightboxIndex(i)}
                onLongPress={() => showPhotoMenu(p.id, p.id === plant.coverPhoto?.id)}
                delayLongPress={400}
                style={styles.thumbWrap}
              >
                <AuthImage path={p.urls.thumb} style={styles.thumb} resizeMode="cover" />
                {p.id === plant.coverPhoto?.id && (
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
            {plant.actions.length === 0 ? (
              <Text style={styles.emptyText}>No actions yet.</Text>
            ) : (
              plant.actions.map((a) => (
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
                showsHorizontalScrollIndicator={false}
                initialScrollIndex={lightboxIndex ?? 0}
                getItemLayout={(_, index) => ({
                  length: winW,
                  offset: winW * index,
                  index,
                })}
                keyExtractor={(p) => p.id}
                renderItem={({ item }) => (
                  <View style={{ width: winW, height: winH, alignItems: "center", justifyContent: "center" }}>
                    <AuthImage
                      path={item.urls.cover}
                      style={{ width: winW, height: winH }}
                      resizeMode="contain"
                    />
                  </View>
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
