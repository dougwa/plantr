import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import TabNavigator from "./TabNavigator";
import ScanScreen from "../screens/ScanScreen";
import PlantDetailScreen from "../screens/PlantDetailScreen";
import type { RootStackParamList } from "./types";

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Tabs" component={TabNavigator} />
        <Stack.Screen
          name="Scan"
          component={ScanScreen}
          options={{ presentation: "fullScreenModal" }}
        />
        <Stack.Screen name="PlantDetail" component={PlantDetailScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
