import { useCallback, useEffect, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
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
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../contexts/AuthContext";
import {
  deletePhoto,
  getPlant,
  listPlantTypes,
  patchPlant,
  recordAction,
  setCoverPhoto,
  uploadPhoto,
  type ActionKind,
  type PlantType,
  type PublicAction,
  type PublicPlant,
} from "../lib/api";
import AuthImage from "../components/AuthImage";
import type { RootStackParamList } from "../navigation/types";

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
  const [types, setTypes] = useState<PlantType[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  const [actionInput, setActionInput] = useState<{
    kind: ActionKind;
    label: string;
    notes: string;
  } | null>(null);

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
        const t = await listPlantTypes(token);
        if (t.ok) setTypes(t.data.types);
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
    const r = await recordAction(token, plant.id, {
      kind: actionInput.kind,
      notes: actionInput.notes.trim() || undefined,
    });
    if (!r.ok) {
      Alert.alert("Failed", r.error);
      return;
    }
    setActionInput(null);
    await reload();
  }

  if (loading || !plant) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator />
      </View>
    );
  }

  const typeLabel = plant.type?.name ?? "Set type";

  return (
    <View style={styles.root}>
      <SafeAreaView edges={["top"]} style={styles.headerSafe}>
        <View style={styles.header}>
          <Pressable onPress={() => nav.goBack()} hitSlop={12}>
            <Ionicons name="chevron-back" size={28} color="#171717" />
          </Pressable>
          <Text style={styles.qrCode} numberOfLines={1}>
            {plant.qrCode}
          </Text>
          <View style={{ width: 28 }} />
        </View>
      </SafeAreaView>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await reload(); setRefreshing(false); }} />}
      >
        <View style={styles.coverWrap}>
          {plant.coverPhoto ? (
            <AuthImage
              path={plant.coverPhoto.urls.cover}
              style={styles.cover}
              resizeMode="cover"
            />
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
          <Pressable onPress={() => setTypePickerOpen(true)} style={styles.row}>
            <Text style={styles.rowLabel}>Type</Text>
            <Text style={[styles.rowValue, !plant.type && styles.placeholderValue]}>
              {typeLabel}
            </Text>
          </Pressable>
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
            {plant.photos.map((p) => (
              <Pressable
                key={p.id}
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
                onPress={() => setActionInput({ kind, label, notes: "" })}
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
              plant.actions.map((a) => <ActionRow key={a.id} action={a} />)
            )}
          </View>
        </View>
      </ScrollView>

      <Modal
        transparent
        visible={typePickerOpen}
        animationType="fade"
        onRequestClose={() => setTypePickerOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setTypePickerOpen(false)}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <Text style={styles.modalTitle}>Choose type</Text>
            <FlatList
              data={types}
              keyExtractor={(t) => t.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.typeRow}
                  onPress={async () => {
                    setTypePickerOpen(false);
                    await patch({ typeId: item.id });
                  }}
                >
                  <Text style={styles.typeLabel}>{item.name}</Text>
                  {plant.type?.id === item.id && (
                    <Ionicons name="checkmark" size={18} color="#16a34a" />
                  )}
                </TouchableOpacity>
              )}
            />
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        transparent
        visible={actionInput !== null}
        animationType="fade"
        onRequestClose={() => setActionInput(null)}
      >
        {actionInput && (
          <Pressable style={styles.modalBackdrop} onPress={() => setActionInput(null)}>
            <Pressable style={styles.modalSheet} onPress={() => {}}>
              <Text style={styles.modalTitle}>Record {actionInput.label.toLowerCase()}</Text>
              <TextInput
                style={styles.notesInput}
                placeholder="Notes (optional)"
                multiline
                value={actionInput.notes}
                onChangeText={(t) => setActionInput({ ...actionInput, notes: t })}
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

function ActionRow({ action }: { action: PublicAction }) {
  const date = new Date(action.takenAt);
  const formatted = `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  const label = action.kind.charAt(0).toUpperCase() + action.kind.slice(1);
  return (
    <View style={styles.actionRowItem}>
      <View style={styles.actionRowHeader}>
        <Text style={styles.actionRowKind}>{label}</Text>
        <Text style={styles.actionRowDate}>{formatted}</Text>
      </View>
      {action.notes ? <Text style={styles.actionRowNotes}>{action.notes}</Text> : null}
      <Text style={styles.actionRowMeta}>by {action.createdBy.username}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fafafa" },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerSafe: { backgroundColor: "#fff", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#e5e5e5" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  qrCode: { fontSize: 13, color: "#737373", flex: 1, textAlign: "center" },
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
    paddingVertical: 10,
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
  actionRowMeta: { marginTop: 4, fontSize: 12, color: "#a3a3a3" },
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
  typeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: "#f5f5f5",
  },
  typeLabel: { fontSize: 16, color: "#171717" },
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
});
