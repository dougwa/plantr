import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { useAuth } from "../contexts/AuthContext";
import {
  ALL_BARCODE_TYPES,
  BARCODE_LABELS,
  BARCODE_IMAGES,
  loadEnabledBarcodeTypes,
  saveEnabledBarcodeTypes,
  type BarcodeType,
} from "../lib/scannerTypes";
import { Image } from 'expo-image';
import { clearImageCache, getImageCacheBytes } from "../lib/imageCache";
import {
  createTag,
  deleteTag,
  listTags,
  updateTag,
  type Tag,
} from "../lib/api";
import { tagKindStyle } from "../lib/tagStyle";

type Nav = NativeStackNavigationProp<RootStackParamList, "Settings">;

export default function SettingsScreen() {
  const { state, signOut } = useAuth();
  const nav = useNavigation<Nav>();
  if (state.status !== "authed") return null;

  const currentSite = state.sites.find((s) => s.id === state.currentSiteId) ?? null;

  function confirmSignOut() {
    Alert.alert("Sign out?", "You will need to log in again.", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: signOut },
    ]);
  }

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Settings</Text>

        <View style={styles.row}>
          <Text style={styles.label}>Signed in as</Text>
          <Text style={styles.value}>
            {state.user.email ?? state.user.username}
          </Text>
        </View>

        <Pressable
          onPress={() =>
            currentSite ? nav.push("SiteManagement", { siteId: currentSite.id }) : null
          }
          disabled={!currentSite}
          style={({ pressed }) => [
            styles.row,
            !currentSite && { opacity: 0.6 },
            pressed && { backgroundColor: "#f5f5f5" },
          ]}
        >
          <Text style={styles.label}>Current site</Text>
          <View style={styles.rowEnd}>
            <Text style={styles.value}>{currentSite?.name ?? "None selected"}</Text>
            {currentSite ? (
              <Ionicons name="chevron-forward" size={18} color="#a3a3a3" />
            ) : null}
          </View>
        </Pressable>

        {state.currentSiteId ? <TagsSection token={state.token} /> : null}

        <ScannerSection />

        <StorageSection />

        <TouchableOpacity style={styles.button} onPress={confirmSignOut}>
          <Text style={styles.buttonText}>Sign out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

type TagEditor =
  | { mode: "create"; name: string }
  | { mode: "edit"; id: string; name: string };

function TagsSection({ token }: { token: string }) {
  const [tags, setTags] = useState<Tag[] | null>(null);
  const [editor, setEditor] = useState<TagEditor | null>(null);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    const r = await listTags(token);
    if (r.ok) setTags(r.data.tags.filter((t) => t.kind === "custom"));
  }, [token]);

  useEffect(() => {
    reload();
  }, [reload]);

  function openCreate() {
    setEditor({ mode: "create", name: "" });
  }

  function openEdit(tag: Tag) {
    setEditor({ mode: "edit", id: tag.id, name: tag.name });
  }

  async function save() {
    if (!editor) return;
    const name = editor.name.trim();
    if (!name) {
      Alert.alert("Name required");
      return;
    }
    setSaving(true);
    const r =
      editor.mode === "create"
        ? await createTag(token, { name })
        : await updateTag(token, editor.id, { name });
    setSaving(false);
    if (!r.ok) {
      Alert.alert(
        "Save failed",
        r.error === "duplicate_name" ? "A tag with that name already exists." : r.error,
      );
      return;
    }
    setEditor(null);
    await reload();
  }

  function confirmDelete(tag: Tag) {
    Alert.alert(
      `Delete "${tag.name}"?`,
      "This will remove the tag from every plant that has it.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            const r = await deleteTag(token, tag.id);
            if (!r.ok) {
              Alert.alert("Delete failed", r.error);
              return;
            }
            await reload();
          },
        },
      ],
    );
  }

  return (
    <View style={styles.section}>
      <View style={styles.tagsHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionTitle}>Custom Tags</Text>
          <Text style={styles.sectionHint}>
            Free-form labels you can attach to plants. Location tags are managed
            from the Map.
          </Text>
        </View>
        <Pressable
          onPress={openCreate}
          style={({ pressed }) => [
            styles.addTagBtn,
            pressed && { opacity: 0.7 },
          ]}
          accessibilityLabel="Add tag"
        >
          <Ionicons name="add" size={20} color="#fff" />
        </Pressable>
      </View>
      {tags === null ? (
        <Text style={styles.tagsEmpty}>Loading…</Text>
      ) : tags.length === 0 ? (
        <Text style={styles.tagsEmpty}>No tags yet.</Text>
      ) : (
        tags.map((t) => {
          const style = tagKindStyle(t.kind);
          return (
            <View key={t.id} style={styles.tagRow}>
              <Pressable style={styles.tagRowMain} onPress={() => openEdit(t)}>
                <View style={[styles.tagBubble, { backgroundColor: style.color }]}>
                  <Ionicons name={style.icon} size={12} color="#fff" />
                  <Text style={styles.tagBubbleText} numberOfLines={1}>
                    {t.name}
                  </Text>
                </View>
              </Pressable>
              <Pressable
                onPress={() => confirmDelete(t)}
                hitSlop={10}
                accessibilityLabel={`Delete ${t.name}`}
              >
                <Ionicons name="trash-outline" size={20} color="#dc2626" />
              </Pressable>
            </View>
          );
        })
      )}

      <Modal
        visible={editor !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setEditor(null)}
      >
        {editor && (
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => setEditor(null)}
          >
            <Pressable style={styles.modalSheet} onPress={() => {}}>
              <Text style={styles.modalTitle}>
                {editor.mode === "create" ? "New custom tag" : "Edit custom tag"}
              </Text>
              <Text style={styles.modalLabel}>Name</Text>
              <TextInput
                value={editor.name}
                onChangeText={(v) =>
                  setEditor((cur) => (cur ? { ...cur, name: v } : cur))
                }
                style={styles.modalInput}
                placeholder="e.g. Rose"
                autoFocus
              />
              <Text style={styles.modalLabel}>Preview</Text>
              <View
                style={[
                  styles.tagBubble,
                  { backgroundColor: tagKindStyle("custom").color, alignSelf: "flex-start" },
                ]}
              >
                <Ionicons name={tagKindStyle("custom").icon} size={12} color="#fff" />
                <Text style={styles.tagBubbleText}>
                  {editor.name.trim() || "Tag name"}
                </Text>
              </View>
              <View style={styles.modalButtons}>
                <TouchableOpacity
                  onPress={() => setEditor(null)}
                  style={styles.modalCancel}
                  disabled={saving}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={save}
                  style={[styles.modalSave, saving && { opacity: 0.5 }]}
                  disabled={saving}
                >
                  <Text style={styles.modalSaveText}>
                    {saving ? "Saving…" : "Save"}
                  </Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        )}
      </Modal>
    </View>
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
      <Text style={styles.sectionTitle}>Barcode Formats</Text>
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
            <Text style={[styles.toggleLabel, styles.barcodeLabel]}>
              {BARCODE_LABELS[t]}
            </Text>
            <View style={styles.barcodeImageCell}>
              <Image
                source={BARCODE_IMAGES[t]}
                style={{ width: 40, height: 40 }}
              />
            </View>
            <View style={styles.barcodeCheckCell}>
              <Ionicons
                name={on ? "checkbox" : "square-outline"}
                size={24}
                color={on ? "#16a34a" : "#a3a3a3"}
              />
            </View>
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
  rowEnd: { flexDirection: "row", alignItems: "center", gap: 6 },
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
  barcodeLabel: { flex: 1 },
  barcodeImageCell: {
    width: 100,
    alignItems: "center",
  },
  barcodeCheckCell: {
    width: 32,
    alignItems: "flex-end",
  },
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

  tagsHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  addTagBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#16a34a",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  tagsEmpty: {
    paddingVertical: 12,
    color: "#a3a3a3",
    fontSize: 14,
  },
  tagRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e5e5",
  },
  tagRowMain: { flex: 1 },
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
  tagBubbleText: { color: "#fff", fontSize: 13, fontWeight: "500" },

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
  modalLabel: {
    fontSize: 12,
    color: "#737373",
    textTransform: "uppercase",
    marginTop: 12,
    marginBottom: 6,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: "#d4d4d4",
    borderRadius: 6,
    padding: 10,
    fontSize: 15,
    color: "#171717",
  },
  modalButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 16,
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
