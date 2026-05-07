import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import Ionicons from "@expo/vector-icons/Ionicons";
import AuthImage from "../../components/AuthImage";
import { useAuth } from "../../contexts/AuthContext";
import {
  listLocationShapes,
  listPlants,
  listTags,
  type LocationShape,
  type PlantListItem,
  type Tag,
} from "../../lib/api";
import { shapeIdsForPlant } from "../../lib/geometry";
import type { RootStackParamList } from "../../navigation/types";

type RootNav = NativeStackNavigationProp<RootStackParamList>;

type Field = "name" | "location" | "tag" | "species" | "id";
const FIELDS: Field[] = ["name", "location", "tag", "species", "id"];

type Token = { field: Field | null; value: string };

function isField(s: string): s is Field {
  return (FIELDS as string[]).includes(s);
}

// Walks the input character-by-character, splitting on whitespace but treating
// quoted runs as a single value. Recognized field prefixes ("tag:", etc.) are
// pulled out; everything else becomes a bare term that matches any field.
function parseInput(input: string): {
  tokens: Token[];
  lastTokenStart: number;
  lastTokenRaw: string;
} {
  const tokens: Token[] = [];
  let i = 0;
  let lastStart = input.length;
  while (i < input.length) {
    while (i < input.length && /\s/.test(input[i]!)) i++;
    if (i >= input.length) break;
    lastStart = i;
    let raw = "";
    while (i < input.length) {
      const c = input[i]!;
      if (/\s/.test(c)) break;
      if (c === '"') {
        i++;
        while (i < input.length && input[i] !== '"') {
          raw += input[i];
          i++;
        }
        if (i < input.length) i++;
      } else {
        raw += c;
        i++;
      }
    }
    const colonIdx = raw.indexOf(":");
    if (colonIdx > 0) {
      const fld = raw.slice(0, colonIdx).toLowerCase();
      if (isField(fld)) {
        tokens.push({ field: fld, value: raw.slice(colonIdx + 1) });
        continue;
      }
    }
    tokens.push({ field: null, value: raw });
  }
  if (input.length > 0 && /\s$/.test(input)) {
    return { tokens, lastTokenStart: input.length, lastTokenRaw: "" };
  }
  return {
    tokens,
    lastTokenStart: lastStart,
    lastTokenRaw: input.slice(lastStart),
  };
}

function quoteIfNeeded(v: string): string {
  return /\s/.test(v) ? `"${v}"` : v;
}

function includesCi(haystack: string | null | undefined, needle: string): boolean {
  if (!haystack) return false;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function plantMatchesToken(
  p: PlantListItem,
  shapesById: Map<string, LocationShape>,
  shapeIds: Set<string>,
  token: Token,
): boolean {
  const v = token.value.trim();
  if (!v) return true;
  switch (token.field) {
    case "name":
      return includesCi(p.name, v);
    case "id":
      return includesCi(p.qrCode, v);
    case "species":
      return includesCi(p.species, v);
    case "tag":
      return p.tags.some((t) => includesCi(t.name, v));
    case "location": {
      for (const id of shapeIds) {
        const s = shapesById.get(id);
        if (s && includesCi(s.name, v)) return true;
      }
      return false;
    }
    case null: {
      if (includesCi(p.name, v)) return true;
      if (includesCi(p.qrCode, v)) return true;
      if (includesCi(p.species, v)) return true;
      if (p.tags.some((t) => includesCi(t.name, v))) return true;
      for (const id of shapeIds) {
        const s = shapesById.get(id);
        if (s && includesCi(s.name, v)) return true;
      }
      return false;
    }
  }
}

type Suggestion = { display: string; replacement: string };

function buildSuggestions(
  lastRaw: string,
  tags: Tag[],
  shapes: LocationShape[],
  speciesValues: string[],
): Suggestion[] {
  if (!lastRaw) return [];
  const colonIdx = lastRaw.indexOf(":");

  // No colon yet: maybe the user is typing a field name. Suggest "field:"
  // completions when the partial matches.
  if (colonIdx < 0) {
    const lower = lastRaw.toLowerCase();
    return FIELDS.filter((f) => f.startsWith(lower) && f !== lower).map((f) => ({
      display: `${f}:`,
      replacement: `${f}:`,
    }));
  }

  const fieldRaw = lastRaw.slice(0, colonIdx).toLowerCase();
  if (!isField(fieldRaw)) return [];
  const field = fieldRaw;
  const valuePart = lastRaw.slice(colonIdx + 1);
  // Strip any leading quote and treat what's after as the partial value.
  const partial = valuePart.startsWith('"')
    ? valuePart.slice(1).replace(/"$/, "")
    : valuePart;
  const lower = partial.toLowerCase();

  let candidates: string[] = [];
  if (field === "tag") {
    candidates = tags.map((t) => t.name);
  } else if (field === "location") {
    candidates = shapes.map((s) => s.name?.trim() ?? "").filter(Boolean);
  } else if (field === "species") {
    candidates = speciesValues;
  } else {
    return [];
  }

  const seen = new Set<string>();
  const matches: string[] = [];
  for (const c of candidates) {
    if (seen.has(c)) continue;
    seen.add(c);
    if (lower === "" || c.toLowerCase().includes(lower)) {
      matches.push(c);
    }
  }
  matches.sort((a, b) => a.localeCompare(b));
  return matches.slice(0, 8).map((c) => ({
    display: `${field}:${c}`,
    replacement: `${field}:${quoteIfNeeded(c)}`,
  }));
}

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

export default function BrowseSearchScreen() {
  const rootNav = useNavigation<RootNav>();
  const { state } = useAuth();
  const token = state.status === "authed" ? state.token : null;

  const [plants, setPlants] = useState<PlantListItem[]>([]);
  const [shapes, setShapes] = useState<LocationShape[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  const reload = useCallback(async () => {
    if (!token) return;
    const [pRes, sRes, tRes] = await Promise.all([
      listPlants(token),
      listLocationShapes(token),
      listTags(token),
    ]);
    if (pRes.ok) setPlants(pRes.data.plants);
    if (sRes.ok) setShapes(sRes.data.shapes);
    if (tRes.ok) setTags(tRes.data.tags);
  }, [token]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await reload();
      setLoading(false);
    })();
  }, [reload]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const shapesById = useMemo(() => {
    const m = new Map<string, LocationShape>();
    for (const s of shapes) m.set(s.id, s);
    return m;
  }, [shapes]);

  const speciesValues = useMemo(() => {
    const set = new Set<string>();
    for (const p of plants) {
      const s = p.species?.trim();
      if (s) set.add(s);
    }
    return [...set];
  }, [plants]);

  const parsed = useMemo(() => parseInput(query), [query]);

  const results = useMemo(() => {
    if (parsed.tokens.length === 0) return plants;
    const plantShapes = new Map<string, Set<string>>();
    for (const p of plants) {
      plantShapes.set(p.id, shapeIdsForPlant(p, shapes));
    }
    return plants.filter((p) => {
      const ids = plantShapes.get(p.id) ?? new Set<string>();
      return parsed.tokens.every((t) =>
        plantMatchesToken(p, shapesById, ids, t),
      );
    });
  }, [parsed, plants, shapes, shapesById]);

  const suggestions = useMemo(
    () => buildSuggestions(parsed.lastTokenRaw, tags, shapes, speciesValues),
    [parsed.lastTokenRaw, tags, shapes, speciesValues],
  );

  function applySuggestion(s: Suggestion) {
    const head = query.slice(0, parsed.lastTokenStart);
    setQuery(head + s.replacement);
  }

  function open(plantId: string) {
    rootNav.navigate("PlantDetail", { plantId });
  }

  return (
    <View style={styles.root}>
      <View style={styles.searchBox}>
        <Ionicons name="search" size={18} color="#737373" />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder='Search — try "tag:orchid" or location:"front bed"'
          placeholderTextColor="#a3a3a3"
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          style={styles.searchInput}
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery("")} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color="#a3a3a3" />
          </Pressable>
        )}
      </View>

      {suggestions.length > 0 && (
        <View style={styles.suggestRow}>
          <FlatList
            horizontal
            data={suggestions}
            keyExtractor={(s) => s.display}
            keyboardShouldPersistTaps="always"
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.suggestContent}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => applySuggestion(item)}
                style={({ pressed }) => [
                  styles.suggestChip,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text style={styles.suggestText} numberOfLines={1}>
                  {item.display}
                </Text>
              </Pressable>
            )}
          />
        </View>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : query.trim() === "" ? (
        <View style={styles.center}>
          <Text style={styles.hint}>
            Type to search across name, location, tag, species, and ID. Use
            field prefixes like {`"tag:orchid"`} or{" "}
            {`location:"indoor plants"`}. Multiple terms are combined with AND.
          </Text>
        </View>
      ) : results.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.empty}>No matches.</Text>
        </View>
      ) : (
        <FlatList
          style={styles.list}
          data={results}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [
                styles.row,
                pressed && { backgroundColor: "#f5f5f5" },
              ]}
              onPress={() => open(item.id)}
            >
              <View style={styles.thumb}>
                {item.coverPhotoThumbUrl ? (
                  <AuthImage
                    path={item.coverPhotoThumbUrl}
                    style={styles.thumbImg}
                  />
                ) : (
                  <Ionicons
                    name={iconForTags(item.tags.map((t) => t.name))}
                    size={24}
                    color="#16a34a"
                  />
                )}
              </View>
              <View style={styles.text}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.name?.trim() || item.qrCode}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {[
                    item.name?.trim() ? item.qrCode : null,
                    item.species,
                    item.tags.map((t) => t.name).join(", ") || null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#a3a3a3" />
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fff" },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    margin: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "#f5f5f5",
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: "#171717",
    paddingVertical: 0,
  },
  suggestRow: {
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e5e5",
  },
  suggestContent: { paddingHorizontal: 12, gap: 8 },
  suggestChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#ecfccb",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#bef264",
  },
  suggestText: { fontSize: 13, color: "#365314", fontWeight: "500" },
  list: { flex: 1 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  empty: { color: "#737373" },
  hint: { color: "#737373", fontSize: 14, textAlign: "center", lineHeight: 20 },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e5e5",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  thumb: {
    width: 48,
    height: 48,
    borderRadius: 6,
    backgroundColor: "#f5f5f5",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  thumbImg: { width: 48, height: 48 },
  text: { flex: 1 },
  name: { fontSize: 15, fontWeight: "500", color: "#171717" },
  meta: { fontSize: 12, color: "#737373", marginTop: 2 },
});
