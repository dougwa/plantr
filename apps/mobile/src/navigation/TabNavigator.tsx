import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import MapScreen from "../screens/MapScreen";
import BrowseScreen from "../screens/BrowseScreen";
import ReportsScreen from "../screens/ReportsScreen";
import SettingsScreen from "../screens/SettingsScreen";
import type { RootStackParamList, TabParamList } from "./types";

const Tab = createBottomTabNavigator<TabParamList>();

function ScanPlaceholder() {
  return null;
}

function ScanTabButton() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <View style={styles.scanWrap} pointerEvents="box-none">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Scan QR code"
        onPress={() => nav.navigate("Scan")}
        style={({ pressed }) => [
          styles.scanButton,
          pressed && { transform: [{ scale: 0.96 }], opacity: 0.9 },
        ]}
      >
        <Ionicons name="qr-code-outline" size={28} color="#fff" />
      </Pressable>
    </View>
  );
}

export default function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarActiveTintColor: "#171717",
        tabBarInactiveTintColor: "#a3a3a3",
        tabBarStyle: { borderTopColor: "#e5e5e5" },
      }}
    >
      <Tab.Screen
        name="Map"
        component={MapScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="map-outline" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Browse"
        component={BrowseScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="grid-outline" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="ScanTab"
        component={ScanPlaceholder}
        options={{
          tabBarButton: () => <ScanTabButton />,
        }}
      />
      <Tab.Screen
        name="Reports"
        component={ReportsScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="bar-chart-outline" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" size={size} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  scanWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  scanButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#16a34a",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
});
