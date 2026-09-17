import React, { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import * as SecureStore from "expo-secure-store";

import { LoginScreen } from "./src/screens/LoginScreen";
import Home from "./src/screens/HomeScreen";

export type RootStackParamList = {
  Login: undefined;
  Home: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const [initialRoute, setInitialRoute] = useState<"Login" | "Home" | null>(null);

  useEffect(() => {
    let isMounted = true;

    const checkToken = async () => {
      try {
        // Establecemos un tiempo límite por si SecureStore se congela en el dispositivo
        const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 2000));
        const tokenPromise = SecureStore.getItemAsync("userToken");

        const token = await Promise.race([tokenPromise, timeout]);

        if (isMounted) {
          setInitialRoute(token ? "Home" : "Login");
        }
      } catch (error) {
        console.error("Error al leer SecureStore:", error);
        if (isMounted) setInitialRoute("Login");
      }
    };

    checkToken();

    return () => {
      isMounted = false;
    };
  }, []);

  // Si aún no se ha determinado la ruta inicial, muestra el indicador
  if (!initialRoute) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#22242e" }}>
        <ActivityIndicator size="large" color="#eefa07" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName={initialRoute}
        screenOptions={{ headerShown: false }}
      >
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Home" component={Home} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}