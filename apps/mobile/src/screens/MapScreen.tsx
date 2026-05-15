import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Dimensions,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, {
  type LongPressEvent,
  type MapPressEvent,
  Marker,
  Polygon,
  PROVIDER_DEFAULT,
  type Camera,
  type LatLng,
  type MarkerDragStartEndEvent,
  type Region,
} from "react-native-maps";
import * as Location from "expo-location";
import Ionicons from "@expo/vector-icons/Ionicons";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  CommonActions,
  useFocusEffect,
  useNavigation,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../contexts/AuthContext";
import { loadViewport, saveViewport } from "../lib/storage";
import {
  createLocationShape,
  deleteLocationShape,
  listLocationShapes,
  listPlants,
  patchLocationShape,
  type LocationShape,
  type PlantListItem,
} from "../lib/api";
import type { RootStackParamList } from "../navigation/types";

const METERS_PER_DEGREE_LAT = 111_320;
const CLUSTER_RADIUS_M = 5;
const MIN_HALF_M = 0.5; // minimum half-width/height in meters
const DOUBLE_TAP_MS = 300;
// Touches within this many pixels of the shape boundary trigger a resize
// (corner resize when within range of two adjacent edges); touches deeper
// inside trigger a move.
const EDGE_THRESHOLD_PX = 40;
// Action-icon position is computed in pixels and converted to meters using
// the current zoom. We enforce three pixel-space constraints; whichever
// requires the largest offset wins.
const RESIZE_BUBBLE_RADIUS_PX = 11; // visible bubble radius
const ACTION_ICON_RADIUS_PX = 17; // visible chip radius
const RESIZE_HIT_RADIUS_PX = 30; // half of 60pt resize hit area
const ACTION_HIT_RADIUS_PX = 28; // half of 56pt action hit area
const ICON_GAP_PX = 15;

// 1) Radial: action icon edge sits 15 px past the resize bubble's outer edge.
const RADIAL_OFFSET_PX =
  RESIZE_BUBBLE_RADIUS_PX + ICON_GAP_PX + ACTION_ICON_RADIUS_PX;
// 2) Adjacent action icons (90° apart) need 15 px between hit areas.
const REQUIRED_ACTION_DIAG_PX =
  (2 * ACTION_HIT_RADIUS_PX + ICON_GAP_PX) / Math.sqrt(2);
// 3) An action icon and the perpendicular resize bubble need 15 px between
//    their hit areas; the resize bubble sits on the shape edge.
const REQUIRED_RESIZE_PERP_PX =
  ACTION_HIT_RADIUS_PX + RESIZE_HIT_RADIUS_PX + ICON_GAP_PX;
// Web-Mercator metres-per-pixel at the equator at zoom 0.
const EARTH_CIRCUMFERENCE_M = 40_075_016.686;
const TILE_SIZE_PX = 256;

function metersPerPixel(zoom: number, lat: number): number {
  return (
    (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) /
    (TILE_SIZE_PX * Math.pow(2, zoom))
  );
}

// Apple Maps' getCamera() returns zoom=null on iOS, so we derive zoom from
// the visible region's longitudeDelta. Web Mercator: at zoom z the world
// spans 256·2^z pixels, so a viewport showing L° of longitude in W px gives
// zoom = log2(360·W / (L·256)). Latitude doesn't enter — longitudeDelta is
// already expressed in degrees.
function zoomFromLongitudeDelta(longitudeDelta: number): number {
  const screenWidth = Dimensions.get("window").width;
  return Math.log2((360 * screenWidth) / (longitudeDelta * TILE_SIZE_PX));
}

const COLOR_PALETTE = [
  "#16a34a",
  "#0ea5e9",
  "#eab308",
  "#f97316",
  "#dc2626",
  "#a855f7",
  "#ec4899",
  "#525252",
];

function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
) {
  const dLat = (a.lat - b.lat) * METERS_PER_DEGREE_LAT;
  const dLng =
    (a.lng - b.lng) * METERS_PER_DEGREE_LAT * Math.cos((a.lat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

// Convert a (x=east, y=north) meters offset, in the shape's local frame,
// to a world LatLng using the shape's center and rotation.
function localToLatLng(shape: LocationShape, xLocal: number, yLocal: number): LatLng {
  const cosLat = Math.cos((shape.centerLat * Math.PI) / 180);
  const theta = (shape.rotationDegrees * Math.PI) / 180;
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  const xWorld = xLocal * cosT - yLocal * sinT;
  const yWorld = xLocal * sinT + yLocal * cosT;
  return {
    latitude: shape.centerLat + yWorld / METERS_PER_DEGREE_LAT,
    longitude: shape.centerLng + xWorld / (METERS_PER_DEGREE_LAT * cosLat),
  };
}

// Inverse of localToLatLng: given a world LatLng, return (x, y) in the
// shape's local meters frame.
function latLngToLocal(
  shape: LocationShape,
  coord: LatLng,
): { x: number; y: number } {
  const cosLat = Math.cos((shape.centerLat * Math.PI) / 180);
  const xWorld =
    (coord.longitude - shape.centerLng) * METERS_PER_DEGREE_LAT * cosLat;
  const yWorld = (coord.latitude - shape.centerLat) * METERS_PER_DEGREE_LAT;
  const theta = (shape.rotationDegrees * Math.PI) / 180;
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  return {
    x: xWorld * cosT + yWorld * sinT,
    y: -xWorld * sinT + yWorld * cosT,
  };
}

function rectangleCorners(s: LocationShape): LatLng[] {
  const halfW = s.widthMeters / 2;
  const halfH = s.heightMeters / 2;
  return [
    localToLatLng(s, -halfW, -halfH),
    localToLatLng(s, halfW, -halfH),
    localToLatLng(s, halfW, halfH),
    localToLatLng(s, -halfW, halfH),
  ];
}

function ellipsePoints(s: LocationShape, segments = 48): LatLng[] {
  const halfW = s.widthMeters / 2;
  const halfH = s.heightMeters / 2;
  const pts: LatLng[] = [];
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * 2 * Math.PI;
    pts.push(localToLatLng(s, halfW * Math.cos(t), halfH * Math.sin(t)));
  }
  return pts;
}

function polygonCentroid(
  points: Array<{ lat: number; lng: number }>,
): { lat: number; lng: number } {
  const lat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const lng = points.reduce((s, p) => s + p.lng, 0) / points.length;
  return { lat, lng };
}

function polygonBoundingBox(
  points: Array<{ lat: number; lng: number }>,
): { widthMeters: number; heightMeters: number } {
  if (points.length === 0) return { widthMeters: 8, heightMeters: 8 };
  let minLat = points[0]!.lat, maxLat = points[0]!.lat;
  let minLng = points[0]!.lng, maxLng = points[0]!.lng;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  const cosLat = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const widthMeters = (maxLng - minLng) * METERS_PER_DEGREE_LAT * cosLat;
  const heightMeters = (maxLat - minLat) * METERS_PER_DEGREE_LAT;
  return { widthMeters: Math.max(1, widthMeters), heightMeters: Math.max(1, heightMeters) };
}

function splitLongestEdge(
  points: Array<{ lat: number; lng: number }>,
): Array<{ lat: number; lng: number }> {
  let maxLen = -1;
  let maxIdx = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const dLat = (a.lat - b.lat) * METERS_PER_DEGREE_LAT;
    const cosLat = Math.cos((a.lat * Math.PI) / 180);
    const dLng = (a.lng - b.lng) * METERS_PER_DEGREE_LAT * cosLat;
    const len = Math.sqrt(dLat * dLat + dLng * dLng);
    if (len > maxLen) { maxLen = len; maxIdx = i; }
  }
  const a = points[maxIdx]!;
  const b = points[(maxIdx + 1) % points.length]!;
  const mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
  return [...points.slice(0, maxIdx + 1), mid, ...points.slice(maxIdx + 1)];
}

function pointInPolygonLatLng(
  pts: Array<{ lat: number; lng: number }>,
  coord: LatLng,
): boolean {
  if (pts.length < 3) return false;
  const x = coord.longitude;
  const y = coord.latitude;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i]!.lng, yi = pts[i]!.lat;
    const xj = pts[j]!.lng, yj = pts[j]!.lat;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function defaultPolygonPoints(
  centerLat: number,
  centerLng: number,
): Array<{ lat: number; lng: number }> {
  const half = 4;
  const cosLat = Math.cos((centerLat * Math.PI) / 180);
  const dLat = half / METERS_PER_DEGREE_LAT;
  const dLng = half / (METERS_PER_DEGREE_LAT * cosLat);
  return [
    { lat: centerLat + dLat, lng: centerLng - dLng },
    { lat: centerLat + dLat, lng: centerLng + dLng },
    { lat: centerLat - dLat, lng: centerLng + dLng },
    { lat: centerLat - dLat, lng: centerLng - dLng },
  ];
}

function fitRegion(points: LatLng[]): Region | null {
  if (points.length === 0) return null;
  let minLat = points[0]!.latitude;
  let maxLat = points[0]!.latitude;
  let minLng = points[0]!.longitude;
  let maxLng = points[0]!.longitude;
  for (const p of points) {
    if (p.latitude < minLat) minLat = p.latitude;
    if (p.latitude > maxLat) maxLat = p.latitude;
    if (p.longitude < minLng) minLng = p.longitude;
    if (p.longitude > maxLng) maxLng = p.longitude;
  }
  const latDelta = Math.max((maxLat - minLat) * 1.4, 0.0008);
  const lngDelta = Math.max((maxLng - minLng) * 1.4, 0.0008);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: latDelta,
    longitudeDelta: lngDelta,
  };
}

type SubModal =
  | { kind: "name"; shapeId: string; value: string }
  | { kind: "color"; shapeId: string }
  | { kind: "delete"; shapeId: string }
  | null;

export default function MapScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { state } = useAuth();
  const mapRef = useRef<MapView>(null);
  const [plants, setPlants] = useState<PlantListItem[]>([]);
  const [shapes, setShapes] = useState<LocationShape[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [picker, setPicker] = useState<PlantListItem[] | null>(null);
  const [subModal, setSubModal] = useState<SubModal>(null);
  const [initialCamera, setInitialCamera] = useState<Camera | null>(null);
  const [initialReady, setInitialReady] = useState(false);
  const [viewportZoom, setViewportZoom] = useState<number | null>(null);
  // Bumped whenever the map viewport changes so MoveOverlay re-projects the
  // editing shape's screen-space center.
  const [viewportRev, setViewportRev] = useState(0);
  const hasSavedViewRef = useRef(false);
  const lastFitCountRef = useRef(0);

  const token = state.status === "authed" ? state.token : null;

  const reload = useCallback(async () => {
    if (!token) return;
    const [pRes, sRes] = await Promise.all([
      listPlants(token),
      listLocationShapes(token),
    ]);
    if (pRes.ok) setPlants(pRes.data.plants);
    if (sRes.ok) setShapes(sRes.data.shapes);
  }, [token]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await reload();
      setLoading(false);
    })();
  }, [reload]);

  // Resolve the initial camera once: prefer the last saved viewport;
  // otherwise center on the user's current GPS; otherwise fall back to
  // auto-fitting plants/shapes after they load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await loadViewport();
      if (cancelled) return;
      if (saved) {
        hasSavedViewRef.current = true;
        setInitialCamera({
          center: saved.center,
          pitch: saved.pitch,
          heading: saved.heading,
          zoom: saved.zoom ?? 18,
          altitude: saved.altitude ?? 200,
        });
        setInitialReady(true);
        return;
      }
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (!cancelled && perm.status === "granted") {
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          if (cancelled) return;
          hasSavedViewRef.current = true;
          setInitialCamera({
            center: {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
            },
            pitch: 0,
            heading: 0,
            zoom: 18,
            altitude: 200,
          });
        }
      } catch {
        // ignore — fall through to auto-fit
      }
      if (!cancelled) setInitialReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const plantsWithGps = useMemo(
    () => plants.filter((p) => p.gpsLat != null && p.gpsLng != null),
    [plants],
  );

  const editing = useMemo(
    () => (editingId ? shapes.find((s) => s.id === editingId) ?? null : null),
    [editingId, shapes],
  );

  // Auto-fit on first load and whenever the set of plant pins grows —
  // but only if we don't have a saved/GPS-derived initial view that we
  // explicitly want to respect.
  useEffect(() => {
    if (loading || !mapRef.current) return;
    if (hasSavedViewRef.current) return;
    const count = plantsWithGps.length;
    if (count > 0 && count <= lastFitCountRef.current) return;

    const coords: LatLng[] =
      count > 0
        ? plantsWithGps.map((p) => ({
            latitude: p.gpsLat as number,
            longitude: p.gpsLng as number,
          }))
        : shapes.map((s) => ({
            latitude: s.centerLat,
            longitude: s.centerLng,
          }));

    if (coords.length === 0) return;

    if (coords.length === 1) {
      const region = fitRegion(coords);
      if (region) mapRef.current.animateToRegion(region, 400);
    } else {
      mapRef.current.fitToCoordinates(coords, {
        edgePadding: { top: 80, right: 60, bottom: 80, left: 60 },
        animated: true,
      });
    }
    lastFitCountRef.current = count;
  }, [loading, plantsWithGps, shapes]);

  function chooseShapeKind(): Promise<
    "rectangle" | "ellipse" | "property" | "polygon" | null
  > {
    return new Promise((resolve) => {
      if (Platform.OS === "ios") {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: ["Cancel", "Rectangle", "Ellipse", "Property", "Polygon"],
            cancelButtonIndex: 0,
            title: "Add a location",
          },
          (i) =>
            resolve(
              i === 1
                ? "rectangle"
                : i === 2
                  ? "ellipse"
                  : i === 3
                    ? "property"
                    : i === 4
                      ? "polygon"
                      : null,
            ),
        );
      } else {
        Alert.alert("Add a location", undefined, [
          { text: "Cancel", style: "cancel", onPress: () => resolve(null) },
          { text: "Rectangle", onPress: () => resolve("rectangle") },
          { text: "Ellipse", onPress: () => resolve("ellipse") },
          { text: "Property", onPress: () => resolve("property") },
          { text: "Polygon", onPress: () => resolve("polygon") },
        ]);
      }
    });
  }

  async function addShapeAtCenter() {
    if (!token) return;
    const camera = await mapRef.current?.getCamera();
    if (!camera) {
      Alert.alert("Map not ready");
      return;
    }
    const kind = await chooseShapeKind();
    if (!kind) return;
    const isProperty = kind === "property";
    const isPolygon = kind === "polygon";
    const polygonPoints = isPolygon
      ? defaultPolygonPoints(camera.center.latitude, camera.center.longitude)
      : undefined;
    const r = await createLocationShape(token, {
      kind,
      color: COLOR_PALETTE[shapes.length % COLOR_PALETTE.length] ?? COLOR_PALETTE[0]!,
      centerLat: camera.center.latitude,
      centerLng: camera.center.longitude,
      widthMeters: isProperty ? 40 : 8,
      heightMeters: isProperty ? 40 : 8,
      name: null,
      polygonPoints,
    });
    if (!r.ok) {
      Alert.alert("Failed to create location", r.error);
      return;
    }
    setShapes((cur) => [...cur, r.data.shape]);
    setEditingId(r.data.shape.id);
  }

  // Double-tap on a shape opens its plant list. We track the last tap so a
  // second tap on the same shape within DOUBLE_TAP_MS triggers navigation;
  // otherwise the tap behaves as a "tap to lock" gesture.
  const lastTapRef = useRef<{ time: number; shapeId: string | null }>({
    time: 0,
    shapeId: null,
  });

  function handleTap(coord: LatLng) {
    const now = Date.now();
    const s = findShapeAt(coord);
    const last = lastTapRef.current;
    lastTapRef.current = { time: now, shapeId: s?.id ?? null };

    if (s && last.shapeId === s.id && now - last.time < DOUBLE_TAP_MS) {
      lastTapRef.current = { time: 0, shapeId: null };
      viewPlantsAtShape(s);
      return;
    }
    setEditingId(null);
  }

  function onMapPress(e: MapPressEvent) {
    handleTap(e.nativeEvent.coordinate);
  }

  function pointInShape(s: LocationShape, coord: LatLng): boolean {
    if (s.kind === "polygon") {
      return pointInPolygonLatLng(s.polygonPoints ?? [], coord);
    }
    const local = latLngToLocal(s, coord);
    const halfW = s.widthMeters / 2;
    const halfH = s.heightMeters / 2;
    if (s.kind === "ellipse") {
      const rx = local.x / halfW;
      const ry = local.y / halfH;
      return rx * rx + ry * ry <= 1;
    }
    return Math.abs(local.x) <= halfW && Math.abs(local.y) <= halfH;
  }

  function findShapeAt(coord: LatLng): LocationShape | null {
    // Match the render order: non-property shapes are drawn on top, so they
    // win the hit-test; property shapes are checked last.
    for (const s of shapes) {
      if (s.kind !== "property" && pointInShape(s, coord)) return s;
    }
    for (const s of shapes) {
      if (s.kind === "property" && pointInShape(s, coord)) return s;
    }
    return null;
  }

  function viewPlantsAtShape(s: LocationShape) {
    const label = s.name?.trim() || "(unnamed)";
    nav.dispatch(
      CommonActions.navigate({
        name: "Tabs",
        params: {
          screen: "Browse",
          params: {
            state: {
              routes: [
                { name: "BrowseHome" },
                {
                  name: "BrowseEntries",
                  params: { category: "location" },
                },
                {
                  name: "PlantList",
                  params: {
                    filter: { kind: "location", shapeId: s.id, label },
                    title: label,
                  },
                },
              ],
            },
          },
        },
      }),
    );
  }

  function onMapLongPress(e: LongPressEvent) {
    const s = findShapeAt(e.nativeEvent.coordinate);
    if (s) setEditingId(s.id);
  }

  function onMarkerPress(p: PlantListItem) {
    const here = { lat: p.gpsLat as number, lng: p.gpsLng as number };
    const nearby = plantsWithGps.filter((other) => {
      const o = { lat: other.gpsLat as number, lng: other.gpsLng as number };
      return distanceMeters(here, o) <= CLUSTER_RADIUS_M;
    });
    if (nearby.length > 1) {
      setPicker(nearby);
    } else {
      nav.navigate("PlantDetail", { plantId: p.id });
    }
  }

  function pickFromCluster(plantId: string) {
    setPicker(null);
    nav.navigate("PlantDetail", { plantId });
  }

  async function recenterOnUser() {
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") {
        Alert.alert(
          "Location not available",
          "Enable location access for PlantR in Settings to recenter on your position.",
        );
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Highest,
      });
      const cam = await mapRef.current?.getCamera();
      mapRef.current?.animateCamera(
        {
          center: {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          },
          zoom: cam?.zoom ?? 18,
          altitude: cam?.altitude ?? 200,
          pitch: cam?.pitch ?? 0,
          heading: cam?.heading ?? 0,
        },
        { duration: 400 },
      );
    } catch (err) {
      console.warn("recenter failed", err);
    }
  }

  async function persistViewport(region: Region) {
    if (!mapRef.current) return;
    const cam = await mapRef.current.getCamera();
    if (!cam?.center) return;
    hasSavedViewRef.current = true;
    const zoom = cam.zoom ?? zoomFromLongitudeDelta(region.longitudeDelta);
    setViewportZoom(zoom);
    setViewportRev((n) => n + 1);
    saveViewport({
      center: cam.center,
      pitch: cam.pitch ?? 0,
      heading: cam.heading ?? 0,
      zoom,
      altitude: cam.altitude,
    });
  }

  // Pull the initial zoom so EditOverlay can size the action-icon offsets
  // before the user has moved the map. Apple Maps' getCamera() returns
  // zoom=null, so we read the visible region via getMapBoundaries() and
  // derive zoom from longitudeDelta.
  useEffect(() => {
    if (!initialReady) return;
    let cancelled = false;
    (async () => {
      while (!mapRef.current) {
        await new Promise((r) => setTimeout(r, 50));
      }
      const bounds = await mapRef.current!.getMapBoundaries();
      if (cancelled || !bounds) return;
      const longitudeDelta =
        bounds.northEast.longitude - bounds.southWest.longitude;
      if (longitudeDelta > 0) {
        setViewportZoom(zoomFromLongitudeDelta(longitudeDelta));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialReady]);

  const editingHalfDims = useMemo(() => {
    if (!editing) return { halfW: 4, halfH: 4 };
    if (editing.kind === "polygon" && editing.polygonPoints?.length) {
      const bbox = polygonBoundingBox(editing.polygonPoints);
      return { halfW: bbox.widthMeters / 2, halfH: bbox.heightMeters / 2 };
    }
    return { halfW: editing.widthMeters / 2, halfH: editing.heightMeters / 2 };
  }, [editing]);

  const iconOffsetM = useMemo(() => {
    if (viewportZoom == null) return 6; // safe fallback before the camera is known
    const lat = editing?.centerLat ?? initialCamera?.center.latitude ?? 0;
    const mpp = metersPerPixel(viewportZoom, lat);
    if (!editing) return RADIAL_OFFSET_PX * mpp;

    const { halfW, halfH } = editingHalfDims;
    // Smaller axis governs the worst case for both diagonal constraints.
    const minHalfPx = Math.min(halfW * 2, halfH * 2) / 2 / mpp;

    const diagActionPx = Math.max(
      0,
      REQUIRED_ACTION_DIAG_PX - minHalfPx,
    );
    let resizePerpPx = 0;
    if (minHalfPx < REQUIRED_RESIZE_PERP_PX) {
      resizePerpPx =
        Math.sqrt(
          REQUIRED_RESIZE_PERP_PX * REQUIRED_RESIZE_PERP_PX -
            minHalfPx * minHalfPx,
        ) - minHalfPx;
    }

    const offsetPx = Math.max(RADIAL_OFFSET_PX, diagActionPx, resizePerpPx);
    return offsetPx * mpp;
  }, [
    viewportZoom,
    editing?.centerLat,
    editingHalfDims,
    initialCamera?.center.latitude,
  ]);

  // --- move / resize / rotate handlers --------------------------------------

  function applyMove(coord: LatLng) {
    if (!editing) return;
    if (editing.kind === "polygon" && editing.polygonPoints) {
      const dLat = coord.latitude - editing.centerLat;
      const dLng = coord.longitude - editing.centerLng;
      const newPoints = editing.polygonPoints.map((p) => ({
        lat: p.lat + dLat,
        lng: p.lng + dLng,
      }));
      setShapes((cur) =>
        cur.map((s) =>
          s.id === editing.id
            ? { ...s, centerLat: coord.latitude, centerLng: coord.longitude, polygonPoints: newPoints }
            : s,
        ),
      );
      return;
    }
    setShapes((cur) =>
      cur.map((s) =>
        s.id === editing.id
          ? { ...s, centerLat: coord.latitude, centerLng: coord.longitude }
          : s,
      ),
    );
  }

  async function persistMove() {
    if (!editing || !token) return;
    const patch: Partial<LocationShape> = {
      centerLat: editing.centerLat,
      centerLng: editing.centerLng,
    };
    if (editing.kind === "polygon") patch.polygonPoints = editing.polygonPoints;
    const r = await patchLocationShape(token, editing.id, patch);
    if (!r.ok) {
      Alert.alert("Move failed", r.error);
      reload();
    } else {
      setShapes((cur) =>
        cur.map((s) => (s.id === r.data.shape.id ? r.data.shape : s)),
      );
    }
  }

  function applyResize(next: {
    centerLat: number;
    centerLng: number;
    widthMeters: number;
    heightMeters: number;
  }) {
    if (!editing) return;
    setShapes((cur) =>
      cur.map((s) => (s.id === editing.id ? { ...s, ...next } : s)),
    );
  }

  async function persistResize() {
    if (!editing || !token) return;
    const r = await patchLocationShape(token, editing.id, {
      widthMeters: editing.widthMeters,
      heightMeters: editing.heightMeters,
      centerLat: editing.centerLat,
      centerLng: editing.centerLng,
    });
    if (!r.ok) {
      Alert.alert("Resize failed", r.error);
      reload();
    } else {
      setShapes((cur) =>
        cur.map((s) => (s.id === r.data.shape.id ? r.data.shape : s)),
      );
    }
  }

  function applyRotate(coord: LatLng) {
    if (!editing) return;
    // Direction from shape center to drag point, in world meters.
    const cosLat = Math.cos((editing.centerLat * Math.PI) / 180);
    const xWorld =
      (coord.longitude - editing.centerLng) * METERS_PER_DEGREE_LAT * cosLat;
    const yWorld =
      (coord.latitude - editing.centerLat) * METERS_PER_DEGREE_LAT;
    if (xWorld === 0 && yWorld === 0) return;
    // angleFromEast in degrees, atan2(north, east).
    const angleFromEast = (Math.atan2(yWorld, xWorld) * 180) / Math.PI;
    // Natural position of the rotate handle is at local +y (north),
    // i.e. 90° from east. So new rotation = angle - 90°.
    let next = angleFromEast - 90;
    // Normalize to [-180, 180].
    while (next > 180) next -= 360;
    while (next < -180) next += 360;
    setShapes((cur) =>
      cur.map((s) =>
        s.id === editing.id ? { ...s, rotationDegrees: next } : s,
      ),
    );
  }

  async function persistRotate() {
    if (!editing || !token) return;
    const r = await patchLocationShape(token, editing.id, {
      rotationDegrees: editing.rotationDegrees,
    });
    if (!r.ok) {
      Alert.alert("Rotate failed", r.error);
      reload();
    } else {
      setShapes((cur) =>
        cur.map((s) => (s.id === r.data.shape.id ? r.data.shape : s)),
      );
    }
  }

  // --- polygon vertex / point-count handlers ----------------------------------

  function applyPolygonVertex(idx: number, coord: LatLng) {
    if (!editing || editing.kind !== "polygon" || !editing.polygonPoints) return;
    const newPoints = editing.polygonPoints.map((p, i) =>
      i === idx ? { lat: coord.latitude, lng: coord.longitude } : p,
    );
    const centroid = polygonCentroid(newPoints);
    setShapes((cur) =>
      cur.map((s) =>
        s.id === editing.id
          ? { ...s, centerLat: centroid.lat, centerLng: centroid.lng, polygonPoints: newPoints }
          : s,
      ),
    );
  }

  async function persistPolygonVertex() {
    if (!editing || !token || editing.kind !== "polygon") return;
    const r = await patchLocationShape(token, editing.id, {
      centerLat: editing.centerLat,
      centerLng: editing.centerLng,
      polygonPoints: editing.polygonPoints,
    });
    if (!r.ok) {
      Alert.alert("Move failed", r.error);
      reload();
    } else {
      setShapes((cur) =>
        cur.map((s) => (s.id === r.data.shape.id ? r.data.shape : s)),
      );
    }
  }

  async function addPolygonPoint() {
    if (!editing || editing.kind !== "polygon" || !editing.polygonPoints || !token) return;
    const newPoints = splitLongestEdge(editing.polygonPoints);
    const centroid = polygonCentroid(newPoints);
    const bbox = polygonBoundingBox(newPoints);
    setShapes((cur) =>
      cur.map((s) =>
        s.id === editing.id
          ? { ...s, centerLat: centroid.lat, centerLng: centroid.lng, polygonPoints: newPoints, ...bbox }
          : s,
      ),
    );
    const r = await patchLocationShape(token, editing.id, {
      centerLat: centroid.lat,
      centerLng: centroid.lng,
      polygonPoints: newPoints,
      ...bbox,
    });
    if (!r.ok) {
      Alert.alert("Failed to add point", r.error);
      reload();
    } else {
      setShapes((cur) =>
        cur.map((s) => (s.id === r.data.shape.id ? r.data.shape : s)),
      );
    }
  }

  async function removePolygonPoint() {
    if (!editing || editing.kind !== "polygon" || !editing.polygonPoints || !token) return;
    if (editing.polygonPoints.length <= 3) return;
    const newPoints = editing.polygonPoints.slice(0, -1);
    const centroid = polygonCentroid(newPoints);
    const bbox = polygonBoundingBox(newPoints);
    setShapes((cur) =>
      cur.map((s) =>
        s.id === editing.id
          ? { ...s, centerLat: centroid.lat, centerLng: centroid.lng, polygonPoints: newPoints, ...bbox }
          : s,
      ),
    );
    const r = await patchLocationShape(token, editing.id, {
      centerLat: centroid.lat,
      centerLng: centroid.lng,
      polygonPoints: newPoints,
      ...bbox,
    });
    if (!r.ok) {
      Alert.alert("Failed to remove point", r.error);
      reload();
    } else {
      setShapes((cur) =>
        cur.map((s) => (s.id === r.data.shape.id ? r.data.shape : s)),
      );
    }
  }

  // --- name / color / delete --------------------------------------------------

  async function saveName() {
    if (!token || subModal?.kind !== "name") return;
    const next = subModal.value.trim() || null;
    const r = await patchLocationShape(token, subModal.shapeId, { name: next });
    if (!r.ok) {
      Alert.alert("Save failed", r.error);
      return;
    }
    setShapes((cur) =>
      cur.map((s) => (s.id === r.data.shape.id ? r.data.shape : s)),
    );
    setSubModal(null);
  }

  async function pickColor(color: string) {
    if (!token || subModal?.kind !== "color") return;
    const r = await patchLocationShape(token, subModal.shapeId, { color });
    if (!r.ok) {
      Alert.alert("Save failed", r.error);
      return;
    }
    setShapes((cur) =>
      cur.map((s) => (s.id === r.data.shape.id ? r.data.shape : s)),
    );
    setSubModal(null);
  }

  async function confirmDelete() {
    if (!token || subModal?.kind !== "delete") return;
    const id = subModal.shapeId;
    const r = await deleteLocationShape(token, id);
    if (!r.ok) {
      Alert.alert("Delete failed", r.error);
      return;
    }
    setShapes((cur) => cur.filter((s) => s.id !== id));
    setSubModal(null);
    setEditingId(null);
    reload(); // refresh plants in case some were attached
  }

  if (loading || !initialReady) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_DEFAULT}
        mapType="hybrid"
        style={StyleSheet.absoluteFill}
        onPress={onMapPress}
        onLongPress={onMapLongPress}
        onRegionChangeComplete={persistViewport}
        showsUserLocation
        {...(initialCamera ? { initialCamera } : {})}
      >
        {/* Property shapes first so location shapes render above. */}
        {shapes
          .filter((s) => s.kind === "property")
          .map((s) => (
            <Polygon
              key={s.id}
              coordinates={rectangleCorners(s)}
              strokeColor={s.color}
              fillColor="rgba(0,0,0,0)"
              strokeWidth={2}
              lineDashPattern={[8, 6]}
            />
          ))}
        {shapes
          .filter((s) => s.kind !== "property")
          .map((s) => (
            <Polygon
              key={s.id}
              coordinates={
                s.kind === "ellipse"
                  ? ellipsePoints(s)
                  : s.kind === "polygon"
                    ? (s.polygonPoints ?? []).map((p) => ({ latitude: p.lat, longitude: p.lng }))
                    : rectangleCorners(s)
              }
              strokeColor={s.color}
              fillColor={`${s.color}33`}
              strokeWidth={2}
            />
          ))}
        {shapes
          .filter((s) => s.name?.trim())
          .map((s) => {
            const labelCoord =
              s.kind === "polygon" && s.polygonPoints?.length
                ? (() => { const c = polygonCentroid(s.polygonPoints); return { latitude: c.lat, longitude: c.lng }; })()
                : { latitude: s.centerLat, longitude: s.centerLng };
            return (
            <Marker
              key={`label-${s.id}-${s.name}`}
              coordinate={labelCoord}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
              onPress={(e) => handleTap(e.nativeEvent.coordinate)}
            >
              <Text
                style={[styles.watermarkText, { color: s.color }]}
                numberOfLines={2}
              >
                {s.name!.trim()}
              </Text>
            </Marker>
            );
          })}
        {plantsWithGps.map((p) => (
          <Marker
            key={p.id}
            coordinate={{
              latitude: p.gpsLat as number,
              longitude: p.gpsLng as number,
            }}
            onPress={() => onMarkerPress(p)}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={styles.dotOuter}>
              <View style={styles.dotInner} />
            </View>
          </Marker>
        ))}

        {editing && editing.kind === "polygon"
          ? <PolygonEditOverlay
              shape={editing}
              iconOffsetM={iconOffsetM}
              halfW={editingHalfDims.halfW}
              halfH={editingHalfDims.halfH}
              onVertexDrag={applyPolygonVertex}
              onVertexDragEnd={persistPolygonVertex}
              onAddPoint={addPolygonPoint}
              onRemovePoint={removePolygonPoint}
              onTapName={() =>
                setSubModal({ kind: "name", shapeId: editing.id, value: editing.name ?? "" })
              }
              onTapColor={() => setSubModal({ kind: "color", shapeId: editing.id })}
              onTapDelete={() => setSubModal({ kind: "delete", shapeId: editing.id })}
            />
          : editing && <EditOverlay
              shape={editing}
              iconOffsetM={iconOffsetM}
              zoom={viewportZoom}
              onMove={(lat, lng) =>
                applyMove({ latitude: lat, longitude: lng })
              }
              onMoveEnd={persistMove}
              onResize={applyResize}
              onResizeEnd={persistResize}
              onRotateDrag={(e) => applyRotate(e.nativeEvent.coordinate)}
              onRotateEnd={persistRotate}
              onTapName={() =>
                setSubModal({
                  kind: "name",
                  shapeId: editing.id,
                  value: editing.name ?? "",
                })
              }
              onTapColor={() => setSubModal({ kind: "color", shapeId: editing.id })}
              onTapDelete={() => setSubModal({ kind: "delete", shapeId: editing.id })}
            />
        }
      </MapView>

      {editing && (
        <MoveOverlay
          mapRef={mapRef}
          shape={editing}
          viewportRev={viewportRev}
          onMove={(lat, lng) => applyMove({ latitude: lat, longitude: lng })}
          onMoveEnd={persistMove}
          onTap={handleTap}
        />
      )}

      <SafeAreaView style={styles.fabSafe} edges={["bottom"]} pointerEvents="box-none">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Recenter on my location"
          style={styles.recenterButton}
          onPress={recenterOnUser}
        >
          <Ionicons name="locate" size={22} color="#171717" />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add location"
          style={styles.fab}
          onPress={addShapeAtCenter}
        >
          <Ionicons name="add" size={28} color="#fff" />
        </Pressable>
      </SafeAreaView>

      <SafeAreaView style={styles.helpSafe} edges={["top"]} pointerEvents="box-none">
        <View style={styles.helpPill}>
          <Text style={styles.helpText}>
            {editing
              ? editing.kind === "polygon"
                ? "Drag vertices to reshape · drag inside to move · +/− to add or remove points · tap map to finish"
                : "Drag inside to move · drag the edge to resize · rotator to rotate · tap map to finish"
              : "Long-press a location to edit · Double-tap to view its plants"}
          </Text>
        </View>
      </SafeAreaView>

      <NamePickerModal
        sub={subModal}
        onChange={(v) =>
          setSubModal((cur) =>
            cur && cur.kind === "name" ? { ...cur, value: v } : cur,
          )
        }
        onCancel={() => setSubModal(null)}
        onSave={saveName}
      />
      <ColorPickerModal
        sub={subModal}
        currentColor={editing?.color ?? null}
        onCancel={() => setSubModal(null)}
        onPick={pickColor}
      />
      <DeleteConfirmModal
        sub={subModal}
        onCancel={() => setSubModal(null)}
        onConfirm={confirmDelete}
      />

      <ClusterPickerModal
        picker={picker}
        onCancel={() => setPicker(null)}
        onPick={pickFromCluster}
      />
    </View>
  );
}

// ---- edit-mode overlay (handles + action icons) ----------------------------

type EditOverlayProps = {
  shape: LocationShape;
  iconOffsetM: number;
  zoom: number | null;
  onMove: (centerLat: number, centerLng: number) => void;
  onMoveEnd: () => void;
  onResize: (next: {
    centerLat: number;
    centerLng: number;
    widthMeters: number;
    heightMeters: number;
  }) => void;
  onResizeEnd: () => void;
  onRotateDrag: (e: MarkerDragStartEndEvent) => void;
  onRotateEnd: () => void;
  onTapName: () => void;
  onTapColor: () => void;
  onTapDelete: () => void;
};

function EditOverlay({
  shape,
  iconOffsetM,
  zoom,
  onMove,
  onMoveEnd,
  onResize,
  onResizeEnd,
  onRotateDrag,
  onRotateEnd,
  onTapName,
  onTapColor,
  onTapDelete,
}: EditOverlayProps) {
  const halfW = shape.widthMeters / 2;
  const halfH = shape.heightMeters / 2;

  const rotateAt = localToLatLng(shape, 0, halfH + iconOffsetM);
  const nameAt = localToLatLng(shape, halfW + iconOffsetM, 0);
  const colorAt = localToLatLng(shape, -halfW - iconOffsetM, 0);
  const deleteAt = localToLatLng(shape, 0, -halfH - iconOffsetM);

  const center: LatLng = { latitude: shape.centerLat, longitude: shape.centerLng };
  return (
    <>
      <ShapeBodyEditor
        shape={shape}
        zoom={zoom}
        onMove={onMove}
        onMoveEnd={onMoveEnd}
        onResize={onResize}
        onResizeEnd={onResizeEnd}
      />

      <Marker
        coordinate={rotateAt}
        anchor={{ x: 0.5, y: 0.5 }}
        draggable
        tracksViewChanges={false}
        onDrag={onRotateDrag}
        onDragEnd={onRotateEnd}
      >
        <View style={styles.hitLarge}>
          <View style={styles.actionChip}>
            <Ionicons name="sync-outline" size={18} color="#171717" />
          </View>
        </View>
      </Marker>

      <Marker
        coordinate={nameAt}
        anchor={{ x: 0.5, y: 0.5 }}
        tracksViewChanges={false}
        onPress={onTapName}
      >
        <View style={styles.hitLarge}>
          <View style={styles.actionChip}>
            <Ionicons name="text-outline" size={18} color="#171717" />
          </View>
        </View>
      </Marker>

      <Marker
        coordinate={colorAt}
        anchor={{ x: 0.5, y: 0.5 }}
        tracksViewChanges={false}
        onPress={onTapColor}
      >
        <View style={styles.hitLarge}>
          <View style={[styles.actionChip, { backgroundColor: shape.color }]}>
            <Ionicons name="color-palette-outline" size={18} color="#fff" />
          </View>
        </View>
      </Marker>

      <Marker
        coordinate={deleteAt}
        anchor={{ x: 0.5, y: 0.5 }}
        tracksViewChanges={false}
        onPress={onTapDelete}
      >
        <View style={styles.hitLarge}>
          <View style={[styles.actionChip, styles.actionChipDanger]}>
            <Ionicons name="trash-outline" size={18} color="#fff" />
          </View>
        </View>
      </Marker>
    </>
  );
}

// ---- shape body: nine draggable handles (1 move + 4 edges + 4 corners) -----

// One handle per (sx, sy). sx,sy ∈ {-1, 0, 1} — sx=±1 means the gesture
// involves the corresponding east/west edge, sy=±1 the north/south edge,
// and (0, 0) is the interior move handle.
type Sign = -1 | 0 | 1;
type HandleSpec = { sx: Sign; sy: Sign };

// Order matters: handles are stacked, and the last one rendered is on top
// for hit-testing. Move sits at the bottom (covers the whole shape), edges
// over it, corners on top so the corner zone wins inside its square.
const HANDLES: HandleSpec[] = [
  { sx: 0, sy: 0 }, // move (interior)
  { sx: 1, sy: 0 }, // east edge
  { sx: -1, sy: 0 }, // west edge
  { sx: 0, sy: 1 }, // north edge
  { sx: 0, sy: -1 }, // south edge
  { sx: 1, sy: 1 }, // NE corner
  { sx: -1, sy: 1 }, // NW corner
  { sx: 1, sy: -1 }, // SE corner
  { sx: -1, sy: -1 }, // SW corner
];

// Floor on the per-axis hit zone so handles stay tappable on small shapes.
const MIN_HANDLE_PX = 24;

function ShapeBodyEditor({
  shape,
  zoom,
  onMove,
  onMoveEnd,
  onResize,
  onResizeEnd,
}: {
  shape: LocationShape;
  zoom: number | null;
  onMove: (centerLat: number, centerLng: number) => void;
  onMoveEnd: () => void;
  onResize: (next: {
    centerLat: number;
    centerLng: number;
    widthMeters: number;
    heightMeters: number;
  }) => void;
  onResizeEnd: () => void;
}) {
  // Snapshot of the shape at gesture start. Resize maths reference this so
  // the unmoved edges stay anchored even as the shape state updates mid-drag.
  const dragOriginRef = useRef<LocationShape | null>(null);
  const shapeRef = useRef(shape);
  shapeRef.current = shape;

  function handleDragStart() {
    dragOriginRef.current = shapeRef.current;
  }

  function handleDrag(sx: Sign, sy: Sign, coord: LatLng) {
    const orig = dragOriginRef.current;
    if (!orig) return;

    if (sx === 0 && sy === 0) {
      onMove(coord.latitude, coord.longitude);
      return;
    }

    // Where did the user drag the corner/edge handle to, in the original
    // shape's local frame? That position becomes the new edge x or y.
    const newLocal = latLngToLocal(orig, coord);
    const oldHalfW = orig.widthMeters / 2;
    const oldHalfH = orig.heightMeters / 2;
    let westX = -oldHalfW;
    let eastX = oldHalfW;
    let southY = -oldHalfH;
    let northY = oldHalfH;

    if (sx === 1) eastX = Math.max(westX + 2 * MIN_HALF_M, newLocal.x);
    if (sx === -1) westX = Math.min(eastX - 2 * MIN_HALF_M, newLocal.x);
    if (sy === 1) northY = Math.max(southY + 2 * MIN_HALF_M, newLocal.y);
    if (sy === -1) southY = Math.min(northY - 2 * MIN_HALF_M, newLocal.y);

    const widthMeters = eastX - westX;
    const heightMeters = northY - southY;
    const cxLocal = (eastX + westX) / 2;
    const cyLocal = (northY + southY) / 2;
    const theta = (orig.rotationDegrees * Math.PI) / 180;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    // Local-frame center offset back to world frame, then to lat/lng.
    const shiftX = cxLocal * cosT - cyLocal * sinT;
    const shiftY = cxLocal * sinT + cyLocal * cosT;
    const cosLat = Math.cos((orig.centerLat * Math.PI) / 180);
    const newCenterLat = orig.centerLat + shiftY / METERS_PER_DEGREE_LAT;
    const newCenterLng =
      orig.centerLng + shiftX / (METERS_PER_DEGREE_LAT * cosLat);

    onResize({
      centerLat: newCenterLat,
      centerLng: newCenterLng,
      widthMeters,
      heightMeters,
    });
  }

  function handleDragEnd(sx: Sign, sy: Sign) {
    dragOriginRef.current = null;
    if (sx === 0 && sy === 0) onMoveEnd();
    else onResizeEnd();
  }

  if (zoom == null) return null;
  const mpp = metersPerPixel(zoom, shape.centerLat);
  const widthPx = Math.max(1, shape.widthMeters / mpp);
  const heightPx = Math.max(1, shape.heightMeters / mpp);

  const halfW = shape.widthMeters / 2;
  const halfH = shape.heightMeters / 2;

  return (
    <>
      {HANDLES.map(({ sx, sy }) => {
        const coord = localToLatLng(shape, sx * halfW, sy * halfH);
        const isMove = sx === 0 && sy === 0;
        const isCorner = sx !== 0 && sy !== 0;
        const isVerticalEdge = sx !== 0 && sy === 0;

        // The shape's rotationDegrees is CCW (math convention). RN's CSS
        // rotate is CW-positive, so we negate. We rotate the View directly
        // because react-native-maps' Marker `rotation` prop doesn't reach
        // custom child views on iOS MapKit.
        const rotate = `${-shape.rotationDegrees}deg`;

        if (isMove) {
          // Move handle covers the whole shape with a transparent hit area.
          // tracksViewChanges defaults to true so the hit area resizes with
          // zoom and re-snapshots when rotation changes.
          return (
            <Marker
              key="handle-move"
              coordinate={coord}
              anchor={{ x: 0.5, y: 0.5 }}
              zIndex={1}
              draggable
              onDragStart={handleDragStart}
              onDrag={(e) => handleDrag(0, 0, e.nativeEvent.coordinate)}
              onDragEnd={() => handleDragEnd(0, 0)}
            >
              <View
                style={{
                  width: Math.max(MIN_HANDLE_PX, widthPx),
                  height: Math.max(MIN_HANDLE_PX, heightPx),
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "transparent",
                  transform: [{ rotate }],
                }}
              >
                <View style={styles.handleDot} />
              </View>
            </Marker>
          );
        }

        // Resize handles: fixed-size opaque rectangles wrapped in a transparent
        // hit-area View. The wrapper-around-visual structure matches the
        // working action-chip markers; a bare single-View child can render as
        // an empty snapshot on iOS MapKit.
        //
        // tracksViewChanges={false} means iOS captures the view as a marker
        // image once and never updates it. To pick up rotation changes (from
        // the rotate handle drag), include the rotation in the React key —
        // changing it remounts the Marker and forces a fresh snapshot.
        // Quantized to 5° so a smooth rotate drag doesn't churn 8 markers per
        // frame.
        const visualStyle = isCorner
          ? styles.handleCorner
          : isVerticalEdge
            ? styles.handleEdgeVertical
            : styles.handleEdgeHorizontal;
        const rotKey = Math.round(shape.rotationDegrees / 5) * 5;
        return (
          <Marker
            key={`handle-${sx}-${sy}-${rotKey}`}
            coordinate={coord}
            anchor={{ x: 0.5, y: 0.5 }}
            zIndex={isCorner ? 3 : 2}
            draggable
            tracksViewChanges={false}
            onDragStart={handleDragStart}
            onDrag={(e) => handleDrag(sx, sy, e.nativeEvent.coordinate)}
            onDragEnd={() => handleDragEnd(sx, sy)}
          >
            <View style={styles.handleHit}>
              <View style={[visualStyle, { transform: [{ rotate }] }]} />
            </View>
          </Marker>
        );
      })}
    </>
  );
}

// ---- screen-space tap-and-drag move overlay --------------------------------
// react-native-maps' Marker.draggable requires a long-press to begin dragging
// on iOS (MapKit), so the existing interior move Marker can't satisfy a plain
// tap-and-drag. This overlay sits above the MapView in RN's view hierarchy
// and uses a PanResponder to capture pans inside the editing shape, then
// ---- polygon body: one draggable vertex handle per point -------------------

function PolygonBodyEditor({
  shape,
  onVertexDrag,
  onVertexDragEnd,
}: {
  shape: LocationShape;
  onVertexDrag: (idx: number, coord: LatLng) => void;
  onVertexDragEnd: () => void;
}) {
  const pts = shape.polygonPoints ?? [];
  return (
    <>
      {pts.map((p, idx) => (
        <Marker
          key={`vertex-${idx}`}
          coordinate={{ latitude: p.lat, longitude: p.lng }}
          anchor={{ x: 0.5, y: 0.5 }}
          zIndex={3}
          draggable
          tracksViewChanges={false}
          onDrag={(e) => onVertexDrag(idx, e.nativeEvent.coordinate)}
          onDragEnd={onVertexDragEnd}
        >
          <View style={styles.handleHit}>
            <View style={styles.handleCorner} />
          </View>
        </Marker>
      ))}
    </>
  );
}

// ---- polygon edit overlay: vertex handles + action chips (no rotation) -----

function PolygonEditOverlay({
  shape,
  iconOffsetM,
  halfW,
  halfH,
  onVertexDrag,
  onVertexDragEnd,
  onAddPoint,
  onRemovePoint,
  onTapName,
  onTapColor,
  onTapDelete,
}: {
  shape: LocationShape;
  iconOffsetM: number;
  halfW: number;
  halfH: number;
  onVertexDrag: (idx: number, coord: LatLng) => void;
  onVertexDragEnd: () => void;
  onAddPoint: () => void;
  onRemovePoint: () => void;
  onTapName: () => void;
  onTapColor: () => void;
  onTapDelete: () => void;
}) {
  const nameAt = localToLatLng(shape, halfW + iconOffsetM, 0);
  const colorAt = localToLatLng(shape, -halfW - iconOffsetM, 0);
  const deleteAt = localToLatLng(shape, 0, -halfH - iconOffsetM);
  const addAt = localToLatLng(shape, iconOffsetM * 1.5, halfH + iconOffsetM);
  const removeAt = localToLatLng(shape, -iconOffsetM * 1.5, halfH + iconOffsetM);
  const canRemove = (shape.polygonPoints?.length ?? 0) > 3;

  return (
    <>
      <PolygonBodyEditor
        shape={shape}
        onVertexDrag={onVertexDrag}
        onVertexDragEnd={onVertexDragEnd}
      />

      <Marker coordinate={addAt} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} onPress={onAddPoint}>
        <View style={styles.hitLarge}>
          <View style={styles.actionChip}>
            <Ionicons name="add" size={20} color="#171717" />
          </View>
        </View>
      </Marker>

      <Marker coordinate={removeAt} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} onPress={canRemove ? onRemovePoint : undefined}>
        <View style={styles.hitLarge}>
          <View style={[styles.actionChip, !canRemove && styles.actionChipDisabled]}>
            <Ionicons name="remove" size={20} color={canRemove ? "#171717" : "#a3a3a3"} />
          </View>
        </View>
      </Marker>

      <Marker coordinate={nameAt} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} onPress={onTapName}>
        <View style={styles.hitLarge}>
          <View style={styles.actionChip}>
            <Ionicons name="text-outline" size={18} color="#171717" />
          </View>
        </View>
      </Marker>

      <Marker coordinate={colorAt} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} onPress={onTapColor}>
        <View style={styles.hitLarge}>
          <View style={[styles.actionChip, { backgroundColor: shape.color }]}>
            <Ionicons name="color-palette-outline" size={18} color="#fff" />
          </View>
        </View>
      </Marker>

      <Marker coordinate={deleteAt} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} onPress={onTapDelete}>
        <View style={styles.hitLarge}>
          <View style={[styles.actionChip, styles.actionChipDanger]}>
            <Ionicons name="trash-outline" size={18} color="#fff" />
          </View>
        </View>
      </Marker>
    </>
  );
}

// ---- screen-space tap-and-drag move overlay --------------------------------
// react-native-maps' Marker.draggable requires a long-press to begin dragging
// on iOS (MapKit), so the existing interior move Marker can't satisfy a plain
// tap-and-drag. This overlay sits above the MapView in RN's view hierarchy
// and uses a PanResponder to capture pans inside the editing shape, then
// projects touch points to map coords via mapRef.coordinateForPoint. The
// catcher is shrunk by EDGE_THRESHOLD_PX so the resize-handle Markers at the
// shape boundary still receive their touches.
function MoveOverlay({
  mapRef,
  shape,
  viewportRev,
  onMove,
  onMoveEnd,
  onTap,
}: {
  mapRef: React.RefObject<MapView | null>;
  shape: LocationShape;
  viewportRev: number;
  onMove: (lat: number, lng: number) => void;
  onMoveEnd: () => void;
  onTap: (coord: LatLng) => void;
}) {
  // Screen-space AABB of the shape's bounding rectangle. We get this by
  // projecting each of the shape's four local-frame corners through the
  // map. This avoids depending on a zoom value (Apple Maps doesn't always
  // report `Camera.zoom`, so deriving meters-per-pixel from zoom would
  // leave the overlay un-rendered on iOS).
  const [aabb, setAabb] = useState<{
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!mapRef.current) return;
      try {
        const corners: LatLng[] =
          shape.kind === "polygon" && shape.polygonPoints?.length
            ? shape.polygonPoints.map((p) => ({ latitude: p.lat, longitude: p.lng }))
            : (() => {
                const halfW = shape.widthMeters / 2;
                const halfH = shape.heightMeters / 2;
                return [
                  localToLatLng(shape, -halfW, -halfH),
                  localToLatLng(shape, halfW, -halfH),
                  localToLatLng(shape, halfW, halfH),
                  localToLatLng(shape, -halfW, halfH),
                ];
              })();
        const pts = await Promise.all(
          corners.map((c) => mapRef.current!.pointForCoordinate(c)),
        );
        if (cancelled) return;
        let minX = pts[0]!.x;
        let maxX = pts[0]!.x;
        let minY = pts[0]!.y;
        let maxY = pts[0]!.y;
        for (const p of pts) {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
        setAabb({ minX, maxX, minY, maxY });
      } catch {
        // ignore — projection can fail briefly during map setup
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    shape,
    viewportRev,
    mapRef,
  ]);

  // Shrink the catcher by EDGE_THRESHOLD_PX so the boundary resize-handle
  // Markers still receive their touches.
  const layout = useMemo(() => {
    if (!aabb) return null;
    const left = aabb.minX + EDGE_THRESHOLD_PX;
    const top = aabb.minY + EDGE_THRESHOLD_PX;
    const width = aabb.maxX - aabb.minX - 2 * EDGE_THRESHOLD_PX;
    const height = aabb.maxY - aabb.minY - 2 * EDGE_THRESHOLD_PX;
    if (width <= 0 || height <= 0) return null;
    return { left, top, width, height };
  }, [aabb]);

  // PanResponder reads layout/callbacks via refs so we never re-create it
  // mid-gesture (which would break in-progress drags).
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const onMoveEndRef = useRef(onMoveEnd);
  onMoveEndRef.current = onMoveEnd;
  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;
  const movedRef = useRef(false);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          movedRef.current = false;
        },
        onPanResponderMove: (evt, gesture) => {
          if (
            !movedRef.current &&
            (Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4)
          ) {
            movedRef.current = true;
          }
          if (!movedRef.current) return;
          const l = layoutRef.current;
          if (!l) return;
          const point = {
            x: l.left + evt.nativeEvent.locationX,
            y: l.top + evt.nativeEvent.locationY,
          };
          mapRef.current
            ?.coordinateForPoint(point)
            .then((coord) =>
              onMoveRef.current(coord.latitude, coord.longitude),
            )
            .catch(() => {});
        },
        onPanResponderRelease: (evt) => {
          if (movedRef.current) {
            onMoveEndRef.current();
          } else {
            const l = layoutRef.current;
            if (!l) return;
            const point = {
              x: l.left + evt.nativeEvent.locationX,
              y: l.top + evt.nativeEvent.locationY,
            };
            mapRef.current
              ?.coordinateForPoint(point)
              .then((coord) => onTapRef.current(coord))
              .catch(() => {});
          }
          movedRef.current = false;
        },
        onPanResponderTerminate: () => {
          if (movedRef.current) onMoveEndRef.current();
          movedRef.current = false;
        },
        onPanResponderTerminationRequest: () => false,
      }),
    [mapRef],
  );

  if (!layout) return null;

  return (
    <View
      pointerEvents="auto"
      collapsable={false}
      style={{
        position: "absolute",
        left: layout.left,
        top: layout.top,
        width: layout.width,
        height: layout.height,
        backgroundColor: "transparent",
      }}
      {...panResponder.panHandlers}
    />
  );
}

// ---- modals ----------------------------------------------------------------

function NamePickerModal({
  sub,
  onChange,
  onCancel,
  onSave,
}: {
  sub: SubModal;
  onChange: (v: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const visible = sub?.kind === "name";
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel}>
      {visible && (
        <Pressable style={styles.modalBackdrop} onPress={onCancel}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <Text style={styles.modalTitle}>Location name</Text>
            <TextInput
              style={styles.modalInput}
              value={sub.value}
              onChangeText={onChange}
              placeholder="e.g. Big Rose Garden"
              autoFocus
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity onPress={onCancel} style={styles.cancelBtn}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={onSave} style={styles.saveBtn}>
                <Text style={styles.saveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      )}
    </Modal>
  );
}

function ColorPickerModal({
  sub,
  currentColor,
  onCancel,
  onPick,
}: {
  sub: SubModal;
  currentColor: string | null;
  onCancel: () => void;
  onPick: (c: string) => void;
}) {
  const visible = sub?.kind === "color";
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel}>
      {visible && (
        <Pressable style={styles.modalBackdrop} onPress={onCancel}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <Text style={styles.modalTitle}>Pick a color</Text>
            <View style={styles.swatchRow}>
              {COLOR_PALETTE.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => onPick(c)}
                  style={[
                    styles.swatch,
                    { backgroundColor: c },
                    currentColor === c && styles.swatchActive,
                  ]}
                />
              ))}
            </View>
            <View style={styles.modalButtons}>
              <TouchableOpacity onPress={onCancel} style={styles.cancelBtn}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      )}
    </Modal>
  );
}

function DeleteConfirmModal({
  sub,
  onCancel,
  onConfirm,
}: {
  sub: SubModal;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const visible = sub?.kind === "delete";
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel}>
      {visible && (
        <Pressable style={styles.modalBackdrop} onPress={onCancel}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <Text style={styles.modalTitle}>Delete location?</Text>
            <Text style={styles.modalBody}>This cannot be undone.</Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity onPress={onCancel} style={styles.cancelBtn}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={onConfirm} style={styles.deleteBtn}>
                <Text style={styles.deleteBtnText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      )}
    </Modal>
  );
}

function ClusterPickerModal({
  picker,
  onCancel,
  onPick,
}: {
  picker: PlantListItem[] | null;
  onCancel: () => void;
  onPick: (id: string) => void;
}) {
  return (
    <Modal
      transparent
      visible={picker !== null}
      animationType="fade"
      onRequestClose={onCancel}
    >
      {picker && (
        <Pressable style={styles.modalBackdrop} onPress={onCancel}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <Text style={styles.modalTitle}>{picker.length} plants here</Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              {picker.map((p) => (
                <TouchableOpacity
                  key={p.id}
                  style={styles.pickerRow}
                  onPress={() => onPick(p.id)}
                >
                  <View style={styles.pickerDot}>
                    <View style={styles.dotInner} />
                  </View>
                  <View style={styles.pickerText}>
                    <Text style={styles.pickerName}>
                      {p.name?.trim() || p.qrCode}
                    </Text>
                    <Text style={styles.pickerType}>
                      {[
                        p.name?.trim() ? p.qrCode : null,
                        p.tags.map((t) => t.name).join(", ") || null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#a3a3a3" />
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={styles.modalButtons}>
              <TouchableOpacity onPress={onCancel} style={styles.cancelBtn}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  dotOuter: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  dotInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#16a34a" },

  hitLarge: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  handleDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.55)",
  },
  handleHit: {
    width: 60,
    height: 60,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  handleEdgeVertical: {
    width: 16,
    height: 56,
    borderRadius: 8,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#171717",
  },
  handleEdgeHorizontal: {
    width: 56,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#171717",
  },
  handleCorner: {
    width: 20,
    height: 20,
    borderRadius: 4,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#171717",
  },
  actionChip: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#e5e5e5",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  actionChipDanger: { backgroundColor: "#dc2626", borderColor: "#dc2626" },
  actionChipDisabled: { opacity: 0.4 },

  fabSafe: { position: "absolute", right: 16, bottom: 16, gap: 12, alignItems: "flex-end" },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#16a34a",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  recenterButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e5e5",
  },
  helpSafe: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  helpPill: {
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  helpText: { color: "#fafafa", fontSize: 12 },

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
  modalBody: { fontSize: 14, color: "#525252", marginBottom: 12 },
  modalInput: {
    borderWidth: 1,
    borderColor: "#d4d4d4",
    borderRadius: 6,
    padding: 10,
    fontSize: 15,
  },
  swatchRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  swatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: "#fff",
  },
  swatchActive: { borderColor: "#171717" },
  modalButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 16,
    gap: 8,
  },
  cancelBtn: { paddingVertical: 8, paddingHorizontal: 14 },
  cancelText: { color: "#525252", fontSize: 15 },
  saveBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: "#171717",
    borderRadius: 6,
  },
  saveText: { color: "#fff", fontSize: 15, fontWeight: "500" },
  deleteBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: "#dc2626",
    borderRadius: 6,
  },
  deleteBtnText: { color: "#fff", fontSize: 15, fontWeight: "500" },

  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e5e5",
    gap: 12,
  },
  pickerDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#d4d4d4",
    alignItems: "center",
    justifyContent: "center",
  },
  pickerText: { flex: 1 },
  pickerName: { fontSize: 15, color: "#171717", fontWeight: "500" },
  pickerType: { fontSize: 12, color: "#737373", marginTop: 2 },
  watermarkText: {
    fontSize: 11,
    fontWeight: "600",
    textAlign: "center",
    opacity: 0.8,
    textShadowColor: "rgba(0,0,0,0.85)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 3,
    maxWidth: 120,
  },
});
