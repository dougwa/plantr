import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import Ionicons from "@expo/vector-icons/Ionicons";
import AuthImage from "../../components/AuthImage";
import { useAuth } from "../../contexts/AuthContext";
import {
  deleteLocationShape,
  deletePlant,
  deleteTag,
  listPlants,
  listTags,
  recordAction,
  type ActionKind,
  type PlantListItem,
  type Tag,
} from "../../lib/api";
import { tagKindStyle } from "../../lib/tagStyle";
import type { PlantFilter } from "../../navigation/BrowseStackTypes";
import type { RootStackParamList } from "../../navigation/types";
import ScreenHeader from "../../components/ScreenHeader";

type Nav = NativeStackNavigationProp<RootStackParamList, "PlantList">;
type Route = RouteProp<RootStackParamList, "PlantList">;

const MENU_ACTIONS: { kind: ActionKind; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { kind: "feeding", label: "Feed", icon: "nutrition-outline" },
  { kind: "watering", label: "Water", icon: "water-outline" },
  { kind: "fertilizing", label: "Fertilize", icon: "flask-outline" },
  { kind: "treating", label: "Treat", icon: "medkit-outline" },
];

function iconForTags(tagNames: string[]): keyof typeof Ionicons.glyphMap {
  const joined = tagNames.join(" ").toLowerCase();
  if (joined.includes("tree")) return "leaf-outline";
  if (
    joined.includes("orchid") ||
    joined.includes("rose") ||
    joined.includes("hydrangea") ||
    joined.includes("rhodod")
  ) {
    return "flower-outline";
  }
  return "leaf-outline";
}

function headerIconForFilter(
  filter: PlantFilter,
): { icon: keyof typeof Ionicons.glyphMap; color: string } {
  switch (filter.kind) {
    case "all":
      return { icon: "apps-outline", color: "#171717" };
    case "tag":
      return { icon: tagKindStyle("custom").icon, color: tagKindStyle("custom").color };
    case "location":
      return { icon: tagKindStyle("location").icon, color: tagKindStyle("location").color };
    case "species":
      return { icon: "leaf-outline", color: "#16a34a" };
  }
}

function matchesFilter(p: PlantListItem, f: PlantFilter): boolean {
  switch (f.kind) {
    case "all":
      return true;
    case "tag": {
      const customTags = p.tags.filter((t) => t.kind === "custom");
      if (f.tagId == null) return customTags.length === 0;
      return customTags.some((t) => t.id === f.tagId);
    }
    case "location": {
      const locTags = p.tags.filter((t) => t.kind === "location");
      if (f.tagId == null) return locTags.length === 0;
      return locTags.some((t) => t.id === f.tagId);
    }
    case "species": {
      const s = p.species?.trim() || null;
      return s === (f.species ?? null);
    }
  }
}

function TagChip({ tag, dense }: { tag: Tag; dense?: boolean }) {
  const s = tagKindStyle(tag.kind);
  return (
    <View
      style={[
        dense ? styles.tagChipDense : styles.tagChip,
        { backgroundColor: s.color },
      ]}
    >
      <Ionicons name={s.icon} size={dense ? 10 : 12} color="#fff" />
      <Text style={dense ? styles.tagChipDenseText : styles.tagChipText} numberOfLines={1}>
        {tag.name}
      </Text>
    </View>
  );
}

export default function PlantListScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { state } = useAuth();
  const token = state.status === "authed" ? state.token : null;

  const [plants, setPlants] = useState<PlantListItem[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"tile" | "list">("tile");
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; right: number } | null>(null);
  const ellipsisRef = useRef<View>(null);
  const [actionInput, setActionInput] = useState<
    { kind: ActionKind; label: string; notes: string } | null
  >(null);
  const [applying, setApplying] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<
    | { kind: "entity"; entityKind: "location" | "tag"; label: string }
    | { kind: "all"; count: number }
    | null
  >(null);
  const [deleting, setDeleting] = useState(false);

  function openMenu() {
    ellipsisRef.current?.measureInWindow((x, y, w, h) => {
      setMenuAnchor({ top: y + h + 4, right: 12 });
    });
  }
  const closeMenu = () => setMenuAnchor(null);

  const reload = useCallback(async () => {
    if (!token) return;
    const [pRes, tRes] = await Promise.all([listPlants(token), listTags(token)]);
    if (pRes.ok) setPlants(pRes.data.plants);
    if (tRes.ok) setTags(tRes.data.tags);
  }, [token]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await reload();
      setLoading(false);
    })();
  }, [reload]);

  // Refresh on focus so plants edited in PlantDetail show up updated.
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const filtered = useMemo(
    () => plants.filter((p) => matchesFilter(p, route.params.filter)),
    [plants, route.params.filter],
  );

  function open(plantId: string) {
    nav.push("PlantDetail", { plantId, plantIds: filtered.map((p) => p.id) });
  }

  // For a location-filter list, find the underlying location shape so we can
  // focus the map on it (and delete it if requested). We look it up from the
  // tags list rather than scanning filtered plants so it's available even
  // when the list is empty.
  const filterLocationShapeId = useMemo<string | null>(() => {
    const f = route.params.filter;
    if (f.kind !== "location" || !f.tagId) return null;
    const t = tags.find((t) => t.id === f.tagId && t.kind === "location");
    return t?.locationShapeId ?? null;
  }, [route.params.filter, tags]);

  function viewOnMap() {
    closeMenu();
    const highlightPlantIds = filtered.map((p) => p.id);
    nav.navigate("Map", {
      highlightPlantIds,
      focusShapeId: filterLocationShapeId,
    });
  }

  const hasMapTargets = useMemo(
    () =>
      filterLocationShapeId != null ||
      filtered.some((p) => p.gpsLat != null && p.gpsLng != null),
    [filtered, filterLocationShapeId],
  );

  type EntityTarget =
    | { kind: "location"; shapeId: string; label: string }
    | { kind: "tag"; tagId: string; label: string };

  const entityToDelete = useMemo<EntityTarget | null>(() => {
    const f = route.params.filter;
    if (f.kind === "location" && filterLocationShapeId) {
      return { kind: "location", shapeId: filterLocationShapeId, label: f.label };
    }
    if (f.kind === "tag" && f.tagId) {
      return { kind: "tag", tagId: f.tagId, label: f.label };
    }
    return null;
  }, [route.params.filter, filterLocationShapeId]);

  async function performDeleteEntity() {
    if (!token || !entityToDelete) return;
    setDeleting(true);
    const r =
      entityToDelete.kind === "location"
        ? await deleteLocationShape(token, entityToDelete.shapeId)
        : await deleteTag(token, entityToDelete.tagId);
    setDeleting(false);
    setDeleteConfirm(null);
    if (!r.ok) {
      Alert.alert("Delete failed", r.error);
      return;
    }
    nav.goBack();
  }

  async function performDeleteAllPlants() {
    if (!token) return;
    const targets = filtered;
    setDeleting(true);
    const results = await Promise.all(
      targets.map((p) => deletePlant(token, p.id)),
    );
    setDeleting(false);
    setDeleteConfirm(null);
    const failed = results.filter((r) => !r.ok).length;
    if (failed > 0) {
      Alert.alert(
        "Some deletions failed",
        `Deleted ${targets.length - failed} of ${targets.length} plants.`,
      );
      await reload();
      return;
    }
    nav.goBack();
  }

  async function submitBulkAction() {
    if (!token || !actionInput) return;
    const notes = actionInput.notes.trim() || undefined;
    const targets = filtered;
    setApplying(true);
    const results = await Promise.all(
      targets.map((p) => recordAction(token, p.id, { kind: actionInput.kind, notes })),
    );
    setApplying(false);
    const failed = results.filter((r) => !r.ok).length;
    setActionInput(null);
    if (failed > 0) {
      Alert.alert(
        "Some actions failed",
        `${targets.length - failed} of ${targets.length} ${actionInput.label.toLowerCase()} records saved.`,
      );
    }
  }

  const headerIcon = headerIconForFilter(route.params.filter);
  const header = (
    <ScreenHeader
      title={route.params.title}
      icon={headerIcon.icon}
      iconColor={headerIcon.color}
      onBack={() => nav.goBack()}
      right={
        <Pressable ref={ellipsisRef} onPress={openMenu} hitSlop={12}>
          <Ionicons name="ellipsis-horizontal" size={24} color="#171717" />
        </Pressable>
      }
    />
  );

  const menu = (
    <Modal
      visible={menuAnchor !== null}
      transparent
      animationType="fade"
      onRequestClose={closeMenu}
    >
      <Pressable style={styles.menuBackdrop} onPress={closeMenu}>
        {menuAnchor ? (
          <View
            style={[styles.menu, { top: menuAnchor.top, right: menuAnchor.right }]}
          >
            {MENU_ACTIONS.map(({ kind, label, icon }) => (
              <Pressable
                key={kind}
                style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
                onPress={() => {
                  closeMenu();
                  setActionInput({ kind, label, notes: "" });
                }}
              >
                <Ionicons name={icon} size={18} color="#171717" />
                <Text style={styles.menuItemText}>{label}</Text>
              </Pressable>
            ))}
            <View style={styles.menuSeparator} />
            {hasMapTargets && (
              <Pressable
                style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
                onPress={viewOnMap}
              >
                <Ionicons name="map-outline" size={18} color="#171717" />
                <Text style={styles.menuItemText}>View on Map</Text>
              </Pressable>
            )}
            <Pressable
              style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
              onPress={() => {
                setView((v) => (v === "tile" ? "list" : "tile"));
                closeMenu();
              }}
            >
              <Ionicons
                name={view === "tile" ? "list-outline" : "grid-outline"}
                size={18}
                color="#171717"
              />
              <Text style={styles.menuItemText}>
                {view === "tile" ? "List view" : "Tile view"}
              </Text>
            </Pressable>
            {(entityToDelete || filtered.length > 0) && (
              <View style={styles.menuSeparator} />
            )}
            {entityToDelete && (
              <Pressable
                style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
                onPress={() => {
                  closeMenu();
                  setDeleteConfirm({
                    kind: "entity",
                    entityKind: entityToDelete.kind,
                    label: entityToDelete.label,
                  });
                }}
              >
                <Ionicons name="trash-outline" size={18} color="#dc2626" />
                <Text style={[styles.menuItemText, styles.menuItemDanger]}>
                  Delete {entityToDelete.kind === "location" ? "Location" : "Tag"}
                </Text>
              </Pressable>
            )}
            {filtered.length > 0 && (
              <Pressable
                style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
                onPress={() => {
                  closeMenu();
                  setDeleteConfirm({ kind: "all", count: filtered.length });
                }}
              >
                <Ionicons name="trash-outline" size={18} color="#dc2626" />
                <Text style={[styles.menuItemText, styles.menuItemDanger]}>
                  Delete all Plants
                </Text>
              </Pressable>
            )}
          </View>
        ) : null}
      </Pressable>
    </Modal>
  );

  const deleteModal = (
    <Modal
      transparent
      visible={deleteConfirm !== null}
      animationType="fade"
      onRequestClose={() => !deleting && setDeleteConfirm(null)}
    >
      {deleteConfirm && (
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => !deleting && setDeleteConfirm(null)}
        >
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <Text style={styles.modalTitle}>
              {deleteConfirm.kind === "all"
                ? `Delete ${deleteConfirm.count} plant${deleteConfirm.count === 1 ? "" : "s"}?`
                : deleteConfirm.entityKind === "location"
                  ? `Delete location "${deleteConfirm.label}"?`
                  : `Delete tag "${deleteConfirm.label}"?`}
            </Text>
            <Text style={styles.modalBody}>
              {deleteConfirm.kind === "all"
                ? "This permanently deletes the plants and their photos. It cannot be undone."
                : deleteConfirm.entityKind === "location"
                  ? "The location shape will be removed from the map and the location tag will be cleared from all plants."
                  : "The tag will be removed from settings and cleared from all plants."}
            </Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                onPress={() => setDeleteConfirm(null)}
                disabled={deleting}
                style={styles.modalCancel}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={
                  deleteConfirm.kind === "all"
                    ? performDeleteAllPlants
                    : performDeleteEntity
                }
                disabled={deleting}
                style={[styles.modalDelete, deleting && styles.modalSaveDisabled]}
              >
                {deleting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.modalDeleteText}>Delete</Text>
                )}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      )}
    </Modal>
  );

  const actionModal = (
    <Modal
      transparent
      visible={actionInput !== null}
      animationType="fade"
      onRequestClose={() => !applying && setActionInput(null)}
    >
      {actionInput && (
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => !applying && setActionInput(null)}
        >
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <Text style={styles.modalTitle}>
              {actionInput.label} {filtered.length} plant{filtered.length === 1 ? "" : "s"}
            </Text>
            <TextInput
              style={styles.notesInput}
              placeholder="Notes (optional)"
              multiline
              editable={!applying}
              value={actionInput.notes}
              onChangeText={(t) =>
                setActionInput((cur) => (cur ? { ...cur, notes: t } : cur))
              }
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                onPress={() => setActionInput(null)}
                disabled={applying}
                style={styles.modalCancel}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={submitBulkAction}
                disabled={applying}
                style={[styles.modalSave, applying && styles.modalSaveDisabled]}
              >
                {applying ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.modalSaveText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      )}
    </Modal>
  );

  if (loading) {
    return (
      <View style={styles.root}>
        {header}
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
        {menu}
        {actionModal}
        {deleteModal}
      </View>
    );
  }

  if (filtered.length === 0) {
    return (
      <View style={styles.root}>
        {header}
        <View style={styles.center}>
          <Text style={styles.empty}>No plants here yet.</Text>
        </View>
        {menu}
        {actionModal}
        {deleteModal}
      </View>
    );
  }

  if (view === "list") {
    return (
      <View style={styles.root}>
        {header}
        <FlatList
        style={styles.list}
        data={filtered}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [
              styles.listRow,
              pressed && { backgroundColor: "#f5f5f5" },
            ]}
            onPress={() => open(item.id)}
          >
            <View style={styles.listThumb}>
              {item.coverPhotoThumbUrl ? (
                <AuthImage
                  path={item.coverPhotoThumbUrl}
                  style={styles.listThumbImg}
                />
              ) : (
                <Ionicons
                  name={iconForTags(item.tags.map((t) => t.name))}
                  size={24}
                  color="#16a34a"
                />
              )}
            </View>
            <View style={styles.listText}>
              <Text style={styles.listName} numberOfLines={1}>
                {item.name?.trim() || item.qrCode}
              </Text>
              {item.tags.length > 0 ? (
                <View style={styles.listTagRow}>
                  {item.tags.map((t) => (
                    <TagChip key={t.id} tag={t} />
                  ))}
                </View>
              ) : (
                <Text style={styles.listMeta} numberOfLines={1}>
                  {[
                    item.name?.trim() ? item.qrCode : null,
                    item.species,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </Text>
              )}
            </View>
            <Ionicons name="chevron-forward" size={18} color="#a3a3a3" />
          </Pressable>
        )}
      />
        {menu}
        {actionModal}
        {deleteModal}
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {header}
      <FlatList
        style={styles.list}
        data={filtered}
        key="tile-2col"
        numColumns={2}
        contentContainerStyle={styles.tileContent}
        columnWrapperStyle={styles.tileRow}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.tile, pressed && { opacity: 0.7 }]}
            onPress={() => open(item.id)}
          >
            <View style={styles.tileImageWrap}>
              {item.coverPhotoThumbUrl ? (
                <AuthImage
                  path={item.coverPhotoThumbUrl}
                  style={styles.tileImage}
                  resizeMode="cover"
                />
              ) : (
                <Ionicons
                  name={iconForTags(item.tags.map((t) => t.name))}
                  size={48}
                  color="#16a34a"
                />
              )}
            </View>
            <Text style={styles.tileName} numberOfLines={1}>
              {item.name?.trim() || item.qrCode}
            </Text>
            {item.tags.length > 0 ? (
              <View style={styles.tileTagRow}>
                {item.tags.slice(0, 3).map((t) => (
                  <TagChip key={t.id} tag={t} dense />
                ))}
              </View>
            ) : (
              <Text style={styles.tileType} numberOfLines={1}>
                {item.name?.trim() ? item.qrCode : ""}
              </Text>
            )}
          </Pressable>
        )}
      />
      {menu}
      {actionModal}
      {deleteModal}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fff" },
  list: { flex: 1, backgroundColor: "#fff" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fafafa",
  },
  empty: { color: "#737373" },

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
  },
  modalTitle: { fontSize: 18, fontWeight: "600", marginBottom: 12 },
  modalBody: { fontSize: 14, color: "#525252", lineHeight: 20, marginBottom: 4 },
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
    minWidth: 60,
    alignItems: "center",
  },
  modalSaveDisabled: { opacity: 0.6 },
  modalSaveText: { color: "#fff", fontSize: 15, fontWeight: "500" },
  modalDelete: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: "#dc2626",
    borderRadius: 6,
    minWidth: 60,
    alignItems: "center",
  },
  modalDeleteText: { color: "#fff", fontSize: 15, fontWeight: "500" },

  listRow: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e5e5",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  listThumb: {
    width: 48,
    height: 48,
    borderRadius: 6,
    backgroundColor: "#f5f5f5",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  listThumbImg: { width: 48, height: 48 },
  listText: { flex: 1 },
  listName: { fontSize: 15, fontWeight: "500", color: "#171717" },
  listMeta: { fontSize: 12, color: "#737373", marginTop: 2 },
  listTagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 4,
  },
  tagChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  tagChipText: { color: "#fff", fontSize: 11, fontWeight: "500" },
  tagChipDense: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
  },
  tagChipDenseText: { color: "#fff", fontSize: 10, fontWeight: "500" },
  tileTagRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 3,
    paddingHorizontal: 8,
    paddingTop: 2,
  },

  tileContent: { padding: 12, gap: 12 },
  tileRow: { gap: 12 },
  tile: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 10,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e5e5",
    paddingBottom: 8,
  },
  tileImageWrap: {
    aspectRatio: 1,
    backgroundColor: "#f5f5f5",
    alignItems: "center",
    justifyContent: "center",
  },
  tileImage: { width: "100%", height: "100%" },
  tileName: {
    fontSize: 14,
    fontWeight: "500",
    color: "#171717",
    paddingHorizontal: 8,
    paddingTop: 6,
  },
  tileType: { fontSize: 12, color: "#737373", paddingHorizontal: 8 },
});
