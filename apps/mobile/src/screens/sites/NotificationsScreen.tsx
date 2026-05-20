import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { useAuth } from "../../contexts/AuthContext";
import {
  acceptInvitation,
  listNotifications,
  markNotificationsRead,
  type NotificationItem,
} from "../../lib/api";

type Nav = NativeStackNavigationProp<RootStackParamList, "Notifications">;

type InvitationPayload = {
  invitationId?: string;
  siteId?: string;
  siteName?: string;
  role?: string;
  token?: string;
  inviterName?: string;
};

type AcceptedPayload = {
  siteId?: string;
  siteName?: string;
  accepterName?: string;
  role?: string;
};

function asInvitation(n: NotificationItem): InvitationPayload {
  return (n.data ?? {}) as InvitationPayload;
}

function asAccepted(n: NotificationItem): AcceptedPayload {
  return (n.data ?? {}) as AcceptedPayload;
}

export default function NotificationsScreen() {
  const nav = useNavigation<Nav>();
  const { state, refreshSites, setCurrentSite } = useAuth();
  const token = state.status === "authed" ? state.token : null;

  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    const r = await listNotifications(token);
    if (r.ok) setItems(r.data.notifications);
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Mark everything as read on exit so the bell badge clears.
  useEffect(() => {
    return () => {
      if (!token) return;
      markNotificationsRead(token, { all: true }).catch(() => {});
    };
  }, [token]);

  if (!token) return null;

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function onAccept(n: NotificationItem) {
    const payload = asInvitation(n);
    if (!payload.token) {
      Alert.alert("Invitation expired or invalid.");
      return;
    }
    setActingId(n.id);
    const r = await acceptInvitation(token!, payload.token);
    setActingId(null);
    if (!r.ok) {
      Alert.alert(
        "Could not accept",
        r.error === "expired"
          ? "This invitation has expired."
          : r.error === "already_accepted"
            ? "This invitation has already been accepted."
            : r.error,
      );
      return;
    }
    await markNotificationsRead(token!, { ids: [n.id] }).catch(() => {});
    await refreshSites();
    setCurrentSite(r.data.site.id);
    nav.goBack();
  }

  async function onDecline(n: NotificationItem) {
    setActingId(n.id);
    await markNotificationsRead(token!, { ids: [n.id] }).catch(() => {});
    setActingId(null);
    await load();
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => nav.goBack()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color="#171717" />
        </Pressable>
        <Text style={styles.title}>Notifications</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {items === null ? (
          <View style={{ paddingVertical: 40 }}>
            <ActivityIndicator />
          </View>
        ) : items.length === 0 ? (
          <Text style={styles.empty}>No notifications yet.</Text>
        ) : (
          items.map((n) => (
            <NotificationRow
              key={n.id}
              item={n}
              acting={actingId === n.id}
              onAccept={() => onAccept(n)}
              onDecline={() => onDecline(n)}
            />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function NotificationRow({
  item,
  acting,
  onAccept,
  onDecline,
}: {
  item: NotificationItem;
  acting: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const unread = !item.readAt;
  if (item.kind === "invitation_received" || item.kind === "ownership_offer") {
    const p = asInvitation(item);
    const isOwnershipOffer = item.kind === "ownership_offer";
    return (
      <View style={[styles.card, unread && styles.cardUnread]}>
        <Text style={styles.cardTitle}>
          {p.inviterName ?? "Someone"}{" "}
          {isOwnershipOffer ? "wants to transfer" : "invited you to"} {p.siteName ?? "a site"}
        </Text>
        <Text style={styles.cardBody}>
          {isOwnershipOffer
            ? `Accept to take over as the owner of ${p.siteName ?? "the site"}.`
            : `You'll join as ${p.role ?? "a member"}.`}
        </Text>
        <View style={styles.cardActions}>
          <Pressable
            onPress={onDecline}
            disabled={acting}
            style={[styles.btnGhost, acting && { opacity: 0.5 }]}
          >
            <Text style={styles.btnGhostText}>Dismiss</Text>
          </Pressable>
          <Pressable
            onPress={onAccept}
            disabled={acting}
            style={[styles.btnPrimary, acting && { opacity: 0.5 }]}
          >
            {acting ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.btnPrimaryText}>Accept</Text>
            )}
          </Pressable>
        </View>
        <Text style={styles.cardMeta}>{formatWhen(item.createdAt)}</Text>
      </View>
    );
  }

  if (item.kind === "invitation_accepted") {
    const p = asAccepted(item);
    return (
      <View style={[styles.card, unread && styles.cardUnread]}>
        <Text style={styles.cardTitle}>
          {p.accepterName ?? "Someone"} joined {p.siteName ?? "your site"}
        </Text>
        {p.role ? <Text style={styles.cardBody}>Role: {p.role}</Text> : null}
        <Text style={styles.cardMeta}>{formatWhen(item.createdAt)}</Text>
      </View>
    );
  }

  // Fallback for unknown kinds — render a compact JSON dump.
  return (
    <View style={[styles.card, unread && styles.cardUnread]}>
      <Text style={styles.cardTitle}>{item.kind}</Text>
      <Text style={styles.cardBody}>{JSON.stringify(item.data)}</Text>
      <Text style={styles.cardMeta}>{formatWhen(item.createdAt)}</Text>
    </View>
  );
}

function formatWhen(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days}d ago`;
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
  body: { padding: 16, gap: 12 },
  empty: { color: "#737373", fontSize: 14, paddingVertical: 40, textAlign: "center" },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e5e5",
  },
  cardUnread: { borderColor: "#16a34a", backgroundColor: "#f0fdf4" },
  cardTitle: { fontSize: 15, fontWeight: "500", color: "#171717" },
  cardBody: { fontSize: 13, color: "#525252", marginTop: 6, lineHeight: 18 },
  cardMeta: { fontSize: 12, color: "#a3a3a3", marginTop: 8 },
  cardActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 10 },
  btnGhost: { paddingVertical: 8, paddingHorizontal: 14 },
  btnGhostText: { color: "#525252", fontSize: 14 },
  btnPrimary: {
    backgroundColor: "#16a34a",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 6,
    minWidth: 80,
    alignItems: "center",
  },
  btnPrimaryText: { color: "#fff", fontSize: 14, fontWeight: "500" },
});
