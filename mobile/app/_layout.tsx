import React, { useEffect, useRef } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native';

import { AuthContext, useAuthState } from '../services/auth';
import { setupNotifications, handleNotificationResponse } from '../services/notifications';
import { Colors } from '../constants/colors';

function NavigationGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = React.useContext(AuthContext);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === 'auth';

    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/auth');
    } else if (isAuthenticated && inAuthGroup) {
      router.replace('/(tabs)/inbox');
    }
  }, [isAuthenticated, isLoading, segments]);

  return <>{children}</>;
}

export default function RootLayout() {
  const authState = useAuthState();
  const router = useRouter();
  const notificationListener = useRef<Notifications.Subscription | null>(null);
  const responseListener = useRef<Notifications.Subscription | null>(null);

  // Setup push notifications after authenticated
  useEffect(() => {
    if (!authState.isAuthenticated) return;

    setupNotifications(router);

    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        handleNotificationResponse(response, router);
      }
    );

    return () => {
      responseListener.current?.remove();
    };
  }, [authState.isAuthenticated]);

  // Handle deep links for OAuth callback
  useEffect(() => {
    const handleUrl = (event: { url: string }) => {
      const parsed = Linking.parse(event.url);
      // glowsf://auth-success?token=xxx&userId=xxx
      if (parsed.path === 'auth-success') {
        const token = parsed.queryParams?.token as string | undefined;
        const userId = parsed.queryParams?.userId as string | undefined;
        if (token && userId) {
          authState.login(token, userId);
        }
      }
    };

    const subscription = Linking.addEventListener('url', handleUrl);

    // Check initial URL (app opened via deep link)
    Linking.getInitialURL().then((url) => {
      if (url) handleUrl({ url });
    });

    return () => {
      subscription.remove();
    };
  }, []);

  return (
    <GestureHandlerRootView style={styles.container}>
      <AuthContext.Provider value={authState}>
        <NavigationGuard>
          <StatusBar style="dark" backgroundColor={Colors.background} />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: Colors.background },
              headerTintColor: Colors.text,
              headerTitleStyle: { fontWeight: '600' },
              contentStyle: { backgroundColor: Colors.background },
              headerShadowVisible: false,
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="auth" options={{ headerShown: false }} />
            <Stack.Screen
              name="thread/[id]"
              options={{
                headerTitle: 'Thread',
                headerBackTitle: 'Inbox',
                presentation: 'card',
              }}
            />
          </Stack>
        </NavigationGuard>
      </AuthContext.Provider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
