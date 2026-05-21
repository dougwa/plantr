import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp, NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { useAuth } from "../../contexts/AuthContext";
import {
  deleteInvitation,
  deleteSite,
  leaveSite,
  listInvitations,
  listSiteMembers,
  patchSite,
  transferSiteOwnership,
  type InvitationSummary,
  type SiteMember,
  type SiteRole,
  type SiteSummary,
} from "../../lib/api";

type Nav = NativeStackNavigationProp<RootStackParamList, "SiteManagement">;
type Route = NativeStackScreenProps<RootStackParamList, "SiteManagement">["route"];

const ROLE_LABEL: Record<SiteRole, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  USER: "Member",
  VIEWER: "Viewer",
};

export default function SiteManagementScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { siteId } = route.params;
  const { state, refreshSites, setCurrentSite } = useAuth();
  const token = state.status === "authed" ? state.token : null;
  const userId = state.status === "authed" ? state.user.id : null;

  const [members, setMembers] = useState<SiteMember[] | null>(null);
  const [invitations, setInvitations] = useState<InvitationSummary[] | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [nextName, setNextName] = useState("");
  const [working, setWorking] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);

  const site: SiteSummary | undefined =
    state.status === "authed" ? state.sites.find((s) => s.id === siteId) : undefined;
  const canManageMembers = site?.role === "OWNER" || site?.role === "ADMIN";

  const loadMembers = useCallback(async () => {
    if (!token) return;
    const r = await listSiteMembers(token, siteId);
    if (r.ok) setMembers(r.data.members);
  }, [siteId, token]);

  const loadInvitations = useCallback(async () => {
    if (!token || !canManageMembers) {
      setInvitations(null);
      return;
    }
    const r = await listInvitations(token, siteId);
    if (r.ok) setInvitations(r.data.invitations);
  }, [siteId, token, canManageMembers]);

  useFocusEffect(
    useCallback(() => {
      loadMembers();
      loadInvitations();
    }, [loadMembers, loadInvitations]),
  );

  if (state.status !== "authed") return null;
  if (!site) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={styles.header}>
          <Pressable onPress={() => nav.goBack()} hitSlop={10} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={26} color="#171717" />
          </Pressable>
          <Text style={styles.title}>Site</Text>
          <View style={styles.backBtn} />
        </View>
        <Text style={styles.empty}>This site is no longer available.</Text>
      </SafeAreaView>
    );
  }

  const isOwner = site.role === "OWNER";
  const isAdmin = site.role === "ADMIN";
  const canRename = isOwner || isAdmin;

  function openRename() {
    setNextName(site!.name);
    setRenaming(true);
  }

  async function submitRename() {
    if (!token) return;
    if (!nextName.trim() || nextName.trim() === site!.name) {
      setRenaming(false);
      return;
    }
    setWorking(true);
    const r = await patchSite(token, site!.id, { name: nextName.trim() });
    setWorking(false);
    setRenaming(false);
    if (!r.ok) {
      Alert.alert("Could not rename", r.error);
      return;
    }
    await refreshSites();
  }

  function toggleVisibility() {
    if (!isOwner) return;
    const target = site!.visibility === "PUBLIC" ? "PRIVATE" : "PUBLIC";
    const message =
      target === "PUBLIC"
        ? "Anyone on the internet will be able to view this site's plants and photos. Treatment notes stay hidden."
        : "Existing members keep access; nobody else will be able to view this site.";
    Alert.alert(`Make site ${target.toLowerCase()}?`, message, [
      { text: "Cancel", style: "cancel" },
      {
        text: `Make ${target.toLowerCase()}`,
        style: target === "PUBLIC" ? "destructive" : "default",
        onPress: async () => {
          if (!token) return;
          setWorking(true);
          const r = await patchSite(token, site!.id, { visibility: target });
          setWorking(false);
          if (!r.ok) {
            Alert.alert("Could not change visibility", r.error);
            return;
          }
          await refreshSites();
        },
      },
    ]);
  }

  const transferTargets =
    members?.filter((m) => m.user.id !== site!.owner.id) ?? [];
  const pendingOwnerOffer =
    invitations?.find((inv) => inv.role === "OWNER" && !inv.acceptedAt) ?? null;

  function confirmTransfer(member: SiteMember) {
    setTransferOpen(false);
    const display = member.user.name ?? member.user.username;
    Alert.alert(
      `Transfer ownership to ${display}?`,
      "They'll receive an ownership offer that expires in 7 days. Once they accept, they become the owner and you switch to Admin. You keep full access until then.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Send offer",
          style: "destructive",
          onPress: async () => {
            if (!token) return;
            setWorking(true);
            const r = await transferSiteOwnership(token, siteId, member.user.id);
            setWorking(false);
            if (!r.ok) {
              Alert.alert(
                "Could not transfer",
                r.error === "target_not_member"
                  ? "That person needs to be a member of the site before you can transfer to them."
                  : r.error === "already_owner"
                    ? "That person is already the owner."
                    : r.error,
              );
              return;
            }
            await loadInvitations();
            Alert.alert(
              "Offer sent",
              `${display} will see the ownership offer next time they sign in. You'll keep full access until they accept.`,
            );
          },
        },
      ],
    );
  }

  async function revokeOwnerOffer() {
    if (!token || !pendingOwnerOffer) return;
    Alert.alert(
      "Cancel ownership offer?",
      "The pending offer will be revoked. You can send a new one later.",
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Cancel offer",
          style: "destructive",
          onPress: async () => {
            setWorking(true);
            const r = await deleteInvitation(token, siteId, pendingOwnerOffer.id);
            setWorking(false);
            if (!r.ok) {
              Alert.alert("Could not cancel", r.error);
              return;
            }
            await loadInvitations();
          },
        },
      ],
    );
  }

  function confirmDelete() {
    Alert.alert(
      `Delete "${site!.name}"?`,
      "The site will be soft-deleted for 30 days. You can restore it during that window — after that it's gone for good.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete site",
          style: "destructive",
          onPress: async () => {
            if (!token) return;
            setWorking(true);
            const r = await deleteSite(token, site!.id);
            setWorking(false);
            if (!r.ok) {
              Alert.alert("Could not delete", r.error);
              return;
            }
            await refreshSites();
            setCurrentSite(null);
            nav.goBack();
          },
        },
      ],
    );
  }

  function confirmLeave() {
    Alert.alert(
      `Leave "${site!.name}"?`,
      "You'll lose access to this site. You can re-join if it's public, or wait for a new invitation.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Leave",
          style: "destructive",
          onPress: async () => {
            if (!token || !userId) return;
            setWorking(true);
            const r = await leaveSite(token, site!.id, userId);
            setWorking(false);
            if (!r.ok) {
              Alert.alert("Could not leave", r.error);
              return;
            }
            await refreshSites();
            setCurrentSite(null);
            nav.goBack();
          },
        },
      ],
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => nav.goBack()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color="#171717" />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {site.name}
        </Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.card}>
          <SiteRow
            label="Name"
            value={site.name}
            actionLabel={canRename ? "Rename" : undefined}
            onAction={canRename ? openRename : undefined}
          />
          <SiteRow
            label="Visibility"
            value={site.visibility === "PUBLIC" ? "Public" : "Private"}
            actionLabel={isOwner ? "Change" : undefined}
            onAction={isOwner ? toggleVisibility : undefined}
          />
          <SiteRow label="Your role" value={ROLE_LABEL[site.role]} />
          <SiteRow
            label="Owner"
            value={site.owner.name ?? site.owner.username}
          />
          {site.address ? <SiteRow label="Address" value={site.address} /> : null}
          {site.deletedAt ? (
            <SiteRow
              label="Deleted"
              value={`Soft-deleted ${formatDate(site.deletedAt)} — within 30d window`}
            />
          ) : null}
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionLabel}>MEMBERS</Text>
          {canManageMembers ? (
            <Pressable
              onPress={() => nav.push("SiteInvite", { siteId })}
              hitSlop={6}
              style={({ pressed }) => [styles.inlineBtn, pressed && { opacity: 0.5 }]}
            >
              <Ionicons name="add" size={16} color="#16a34a" />
              <Text style={styles.inlineBtnText}>Invite</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={styles.card}>
          {members === null ? (
            <View style={{ padding: 16 }}>
              <ActivityIndicator />
            </View>
          ) : members.length === 0 ? (
            <Text style={styles.muted}>No members yet.</Text>
          ) : (
            members.map((m) => (
              <View key={m.id} style={styles.memberRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.memberName}>
                    {m.user.name ?? m.user.username}
                    {m.user.id === userId ? " (you)" : ""}
                  </Text>
                  <Text style={styles.memberMeta}>
                    {m.user.email ?? m.user.username} · {ROLE_LABEL[m.role]}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>

        {canManageMembers && invitations && invitations.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>PENDING INVITATIONS</Text>
            <View style={styles.card}>
              {invitations.map((inv) => (
                <View key={inv.id} style={styles.memberRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.memberName}>
                      {inv.email ?? inv.phone ?? "Unknown invitee"}
                    </Text>
                    <Text style={styles.memberMeta}>
                      {inv.role === "OWNER"
                        ? "Ownership transfer"
                        : ROLE_LABEL[inv.role]}{" "}
                      · expires {formatDate(inv.expiresAt)}
                    </Text>
                  </View>
                  <Pressable
                    onPress={async () => {
                      if (!token) return;
                      setWorking(true);
                      const r = await deleteInvitation(token, siteId, inv.id);
                      setWorking(false);
                      if (!r.ok) {
                        Alert.alert("Could not revoke", r.error);
                        return;
                      }
                      await loadInvitations();
                    }}
                    hitSlop={8}
                    accessibilityLabel="Revoke invitation"
                  >
                    <Ionicons name="trash-outline" size={18} color="#dc2626" />
                  </Pressable>
                </View>
              ))}
            </View>
          </>
        ) : null}

        {isOwner ? (
          <>
            {pendingOwnerOffer ? (
              <View style={styles.offerBanner}>
                <Ionicons name="swap-horizontal" size={18} color="#92400e" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.offerTitle}>Ownership offer pending</Text>
                  <Text style={styles.offerBody}>
                    {pendingOwnerOffer.email ?? "The invitee"} hasn't accepted
                    yet. You stay the owner until they do.
                  </Text>
                </View>
                <Pressable onPress={revokeOwnerOffer} hitSlop={8}>
                  <Text style={styles.offerCancel}>Cancel</Text>
                </Pressable>
              </View>
            ) : null}
            <Pressable
              onPress={() => {
                if (transferTargets.length === 0) {
                  Alert.alert(
                    "No eligible members",
                    "Invite someone to the site first, then you can transfer ownership to them.",
                  );
                  return;
                }
                setTransferOpen(true);
              }}
              disabled={working}
              style={({ pressed }) => [
                styles.neutralAction,
                (pressed || working) && { opacity: 0.7 },
              ]}
            >
              <Ionicons name="swap-horizontal" size={18} color="#525252" />
              <Text style={styles.neutralActionText}>Transfer ownership</Text>
            </Pressable>
            <Pressable
              onPress={confirmDelete}
              disabled={working}
              style={({ pressed }) => [styles.danger, (pressed || working) && { opacity: 0.7 }]}
            >
              <Ionicons name="trash-outline" size={18} color="#dc2626" />
              <Text style={styles.dangerText}>Delete site</Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            onPress={confirmLeave}
            disabled={working}
            style={({ pressed }) => [styles.danger, (pressed || working) && { opacity: 0.7 }]}
          >
            <Ionicons name="exit-outline" size={18} color="#dc2626" />
            <Text style={styles.dangerText}>Leave site</Text>
          </Pressable>
        )}
      </ScrollView>

      <Modal
        visible={transferOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setTransferOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setTransferOpen(false)}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <Text style={styles.modalTitle}>Transfer ownership</Text>
            <Text style={styles.modalHint}>
              Pick a current member. They'll receive an ownership offer that
              expires in 7 days. They become the owner once they accept —
              you'll switch to Admin then.
            </Text>
            <ScrollView style={styles.transferList}>
              {transferTargets.length === 0 ? (
                <Text style={styles.muted}>
                  Invite a member first, then you can transfer to them.
                </Text>
              ) : (
                transferTargets.map((m) => (
                  <Pressable
                    key={m.id}
                    onPress={() => confirmTransfer(m)}
                    style={({ pressed }) => [
                      styles.pickerRow,
                      pressed && { backgroundColor: "#f5f5f5" },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.memberName}>
                        {m.user.name ?? m.user.username}
                      </Text>
                      <Text style={styles.memberMeta}>
                        {m.user.email ?? m.user.username} · {ROLE_LABEL[m.role]}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color="#a3a3a3" />
                  </Pressable>
                ))
              )}
            </ScrollView>
            <View style={styles.modalButtons}>
              <Pressable
                onPress={() => setTransferOpen(false)}
                style={styles.modalCancel}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={renaming}
        transparent
        animationType="fade"
        onRequestClose={() => setRenaming(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setRenaming(false)}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <Text style={styles.modalTitle}>Rename site</Text>
            <TextInput
              value={nextName}
              onChangeText={setNextName}
              style={styles.modalInput}
              autoFocus
            />
            <View style={styles.modalButtons}>
              <Pressable
                onPress={() => setRenaming(false)}
                disabled={working}
                style={styles.modalCancel}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={submitRename}
                disabled={working}
                style={[styles.modalSave, working && { opacity: 0.5 }]}
              >
                <Text style={styles.modalSaveText}>Save</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function SiteRow({
  label,
  value,
  actionLabel,
  onAction,
}: {
  label: string;
  value: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue}>{value}</Text>
      </View>
      {actionLabel ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text style={styles.rowAction}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fafafa" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: "#fff",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e5e5",
  },
  backBtn: { width: 40, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 17, fontWeight: "600", color: "#171717", textAlign: "center" },
  body: { padding: 16, paddingBottom: 40 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e5e5",
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#f5f5f5",
  },
  rowLabel: { fontSize: 12, color: "#737373", textTransform: "uppercase", letterSpacing: 0.5 },
  rowValue: { fontSize: 15, color: "#171717", marginTop: 2 },
  rowAction: { color: "#16a34a", fontSize: 14, fontWeight: "500" },

  sectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#737373",
    marginTop: 24,
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  inlineBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "#f0fdf4",
  },
  inlineBtnText: { color: "#16a34a", fontSize: 13, fontWeight: "500" },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#f5f5f5",
  },
  memberName: { fontSize: 15, fontWeight: "500", color: "#171717" },
  memberMeta: { fontSize: 12, color: "#737373", marginTop: 2 },
  muted: { color: "#737373", fontSize: 13, padding: 12 },
  empty: { color: "#737373", fontSize: 14, padding: 32, textAlign: "center" },
  note: { color: "#737373", fontSize: 12, marginTop: 8, lineHeight: 18 },

  danger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 12,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#fca5a5",
    backgroundColor: "#fff",
  },
  dangerText: { color: "#dc2626", fontSize: 15, fontWeight: "500" },

  neutralAction: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 32,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d4d4d4",
    backgroundColor: "#fff",
  },
  neutralActionText: { color: "#525252", fontSize: 15, fontWeight: "500" },

  offerBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 32,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#fcd34d",
    backgroundColor: "#fffbeb",
  },
  offerTitle: { color: "#92400e", fontSize: 14, fontWeight: "600" },
  offerBody: { color: "#92400e", fontSize: 12, marginTop: 2, lineHeight: 16 },
  offerCancel: { color: "#92400e", fontSize: 13, fontWeight: "500" },

  modalHint: { color: "#525252", fontSize: 13, lineHeight: 18, marginBottom: 12 },
  transferList: { maxHeight: 320 },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#f5f5f5",
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: 24,
  },
  modalSheet: { backgroundColor: "#fff", borderRadius: 12, padding: 16 },
  modalTitle: { fontSize: 18, fontWeight: "600", color: "#171717", marginBottom: 12 },
  modalInput: {
    borderWidth: 1,
    borderColor: "#d4d4d4",
    borderRadius: 6,
    padding: 10,
    fontSize: 15,
    color: "#171717",
  },
  modalButtons: { flexDirection: "row", justifyContent: "flex-end", marginTop: 16, gap: 8 },
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
