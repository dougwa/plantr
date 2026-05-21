import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useAuth } from "../contexts/AuthContext";
import {
  acceptInvitation,
  unreadNotificationCount,
  type SiteRole,
  type SiteSummary,
} from "../lib/api";

type Destination = "SiteCreate" | "SiteManagement" | "PublicSiteSearch" | "Notifications";

type Props = {
  visible: boolean;
  onClose: () => void;
  onNavigate: (
    destination: Destination,
    params?: { siteId: string },
  ) => void;
};

const ROLE_LABEL: Record<SiteRole, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  USER: "Member",
  VIEWER: "Viewer",
};

export default function SiteSelectorModal({ visible, onClose, onNavigate }: Props) {
  const { state, refreshSites, setCurrentSite } = useAuth();
  const token = state.status === "authed" ? state.token : null;
  const [refreshing, setRefreshing] = useState(false);
  const [unread, setUnread] = useState<number>(0);
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinToken, setJoinToken] = useState("");
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const refreshUnread = useCallback(async () => {
    if (!token) return;
    const r = await unreadNotificationCount(token);
    if (r.ok) setUnread(r.data.count);
  }, [token]);

  useEffect(() => {
    if (!visible) return;
    // Pull fresh data each time the modal opens — covers external mutations
    // (a peer kicks you out, an invitation got accepted, etc.).
    refreshSites();
    refreshUnread();
    setJoinOpen(false);
    setJoinToken("");
    setJoinError(null);
  }, [visible, refreshSites, refreshUnread]);

  if (state.status !== "authed") return null;

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([refreshSites(), refreshUnread()]);
    setRefreshing(false);
  }

  const sites = state.sites;
  const currentId = state.currentSiteId;
  const hasCurrent = currentId != null;

  function pick(siteId: string) {
    setCurrentSite(siteId);
    onClose();
  }

  async function submitJoin() {
    if (!token) return;
    const t = joinToken.trim();
    if (!t) {
      setJoinError("Paste an invitation token to continue.");
      return;
    }
    setJoinError(null);
    setJoinBusy(true);
    const r = await acceptInvitation(token, t);
    setJoinBusy(false);
    if (!r.ok) {
      setJoinError(
        r.error === "invitation_not_found"
          ? "That token doesn't match any invitation."
          : r.error === "expired"
            ? "This invitation has expired."
            : r.error === "already_accepted"
              ? "This invitation has already been accepted."
              : r.error === "site_deleted"
                ? "The site for this invitation no longer exists."
                : "Could not accept the invitation.",
      );
      return;
    }
    await refreshSites();
    setCurrentSite(r.data.site.id);
    setJoinToken("");
    setJoinOpen(false);
    onClose();
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={() => {
        if (hasCurrent) onClose();
      }}
    >
      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={styles.titleRow}>
          <Text style={styles.h1}>Sites</Text>
          <View style={styles.titleActions}>
            <Pressable
              onPress={() => onNavigate("Notifications")}
              hitSlop={10}
              accessibilityLabel="Notifications"
              style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.5 }]}
            >
              <Ionicons name="notifications-outline" size={24} color="#171717" />
              {unread > 0 ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{unread > 99 ? "99+" : unread}</Text>
                </View>
              ) : null}
            </Pressable>
            {hasCurrent ? (
              <Pressable
                onPress={onClose}
                hitSlop={10}
                accessibilityLabel="Close"
                style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.5 }]}
              >
                <Ionicons name="close" size={26} color="#171717" />
              </Pressable>
            ) : null}
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <Pressable
            style={({ pressed }) => [styles.discoverRow, pressed && styles.pressed]}
            onPress={() => onNavigate("PublicSiteSearch")}
          >
            <Ionicons name="search-outline" size={22} color="#16a34a" />
            <View style={{ flex: 1 }}>
              <Text style={styles.discoverTitle}>Find public sites</Text>
              <Text style={styles.discoverHint}>Browse public gardens near you or by name.</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#a3a3a3" />
          </Pressable>

          <Text style={styles.sectionLabel}>MY SITES</Text>
          {sites.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                You're not part of any sites yet. Create one to get started.
              </Text>
            </View>
          ) : (
            sites.map((s) => (
              <SiteRow
                key={s.id}
                site={s}
                isCurrent={s.id === currentId}
                onSelect={() => pick(s.id)}
                onManage={() => onNavigate("SiteManagement", { siteId: s.id })}
              />
            ))
          )}

          <Pressable
            style={({ pressed }) => [styles.createBtn, pressed && styles.pressed]}
            onPress={() => onNavigate("SiteCreate")}
          >
            <Ionicons name="add" size={22} color="#fff" />
            <Text style={styles.createText}>Create a new site</Text>
          </Pressable>

          {joinOpen ? (
            <TextInput
              value={joinToken}
              placeholder="Paste invitation token"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!joinBusy}
              autoFocus
              style={styles.joinInput}
            />
          ) : null}
          {joinError ? <Text style={styles.joinError}>{joinError}</Text> : null}
          <Pressable
            disabled={joinBusy || (joinOpen && joinToken.trim().length === 0)}
            onPress={() => {
              if (!joinOpen) {
                setJoinOpen(true);
                return;
              }
              if (joinToken.trim().length > 0) submitJoin();
            }}
            style={({ pressed }) => [
              joinOpen && joinToken.trim().length > 0 ? styles.joinBtnReady : styles.joinBtn,
              pressed && styles.pressed,
            ]}
          >
            {joinBusy ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : joinOpen && joinToken.trim().length > 0 ? (
              <>
                <Ionicons name="log-in-outline" size={20} color="#fff" />
                <Text style={styles.joinBtnReadyText}>Join</Text>
              </>
            ) : (
              <>
                <Ionicons name="key-outline" size={20} color="#16a34a" />
                <Text style={styles.joinBtnText}>Join site with invitation token</Text>
              </>
            )}
          </Pressable>

          {sites.length === 0 ? (
            <Text style={styles.note}>
              New users start without any sites. Create one to plant your flag, or join a
              public site via search.
            </Text>
          ) : null}
        </ScrollView>
        {refreshing && sites.length === 0 && (
          <View pointerEvents="none" style={styles.spinner}>
            <ActivityIndicator />
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

function SiteRow({
  site,
  isCurrent,
  onSelect,
  onManage,
}: {
  site: SiteSummary;
  isCurrent: boolean;
  onSelect: () => void;
  onManage: () => void;
}) {
  return (
    <View style={[styles.siteRow, isCurrent && styles.siteRowActive]}>
      <Pressable
        onPress={onSelect}
        style={({ pressed }) => [styles.siteMain, pressed && { opacity: 0.7 }]}
      >
        <View style={[styles.dot, isCurrent ? styles.dotActive : styles.dotIdle]} />
        <View style={{ flex: 1 }}>
          <Text style={styles.siteName}>{site.name}</Text>
          <Text style={styles.siteMeta}>
            {ROLE_LABEL[site.role]} · {site.visibility === "PUBLIC" ? "Public" : "Private"}
          </Text>
        </View>
      </Pressable>
      <Pressable
        onPress={onManage}
        hitSlop={10}
        style={({ pressed }) => [styles.manageBtn, pressed && { opacity: 0.5 }]}
        accessibilityLabel={`Manage ${site.name}`}
      >
        <Ionicons name="settings-outline" size={20} color="#525252" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fafafa" },
  scroll: { padding: 16, paddingBottom: 40 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  titleActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  h1: { fontSize: 28, fontWeight: "600", color: "#171717" },
  iconBtn: { padding: 4 },
  badge: {
    position: "absolute",
    top: -2,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#dc2626",
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "600" },
  pressed: { opacity: 0.7 },
  discoverRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e5e5",
  },
  discoverTitle: { fontSize: 15, fontWeight: "500", color: "#171717" },
  discoverHint: { fontSize: 12, color: "#737373", marginTop: 2 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#737373",
    marginTop: 24,
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  empty: {
    padding: 16,
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e5e5",
  },
  emptyText: { color: "#737373", fontSize: 14, lineHeight: 20 },
  siteRow: {
    flexDirection: "row",
    alignItems: "stretch",
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e5e5",
    marginBottom: 8,
    overflow: "hidden",
  },
  siteRowActive: {
    borderColor: "#16a34a",
    borderWidth: 1.5,
  },
  siteMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotActive: { backgroundColor: "#16a34a" },
  dotIdle: { backgroundColor: "#d4d4d4" },
  siteName: { fontSize: 16, fontWeight: "500", color: "#171717" },
  siteMeta: { fontSize: 12, color: "#737373", marginTop: 2 },
  manageBtn: { paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  createBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    justifyContent: "center",
    backgroundColor: "#16a34a",
    borderRadius: 12,
    padding: 14,
    marginTop: 16,
  },
  createText: { color: "#fff", fontSize: 15, fontWeight: "500" },
  joinBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    justifyContent: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#16a34a",
  },
  joinBtnText: { color: "#16a34a", fontSize: 15, fontWeight: "500" },
  joinBtnReady: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    justifyContent: "center",
    backgroundColor: "#16a34a",
    borderRadius: 12,
    padding: 14,
    marginTop: 10,
  },
  joinBtnReadyText: { color: "#fff", fontSize: 15, fontWeight: "500" },
  joinInput: {
    marginTop: 10,
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d4d4d4",
    padding: 14,
    fontSize: 14,
    color: "#171717",
  },
  joinError: { color: "#dc2626", fontSize: 13, marginTop: 8 },
  note: { color: "#737373", fontSize: 12, marginTop: 16, lineHeight: 18 },
  spinner: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "center",
  },
});
