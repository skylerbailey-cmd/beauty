import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { registerPushToken } from './api';
import { Router } from 'expo-router';

// Configure how notifications appear when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function setupNotifications(router: Router): Promise<string | null> {
  if (!Device.isDevice) {
    console.warn('Push notifications require a physical device');
    return null;
  }

  // Request permissions
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.warn('Push notification permission not granted');
    return null;
  }

  // Android channel
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Glow SF',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#D4A0A0',
    });
  }

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync();
    const pushToken = tokenData.data;

    // Register with backend
    await registerPushToken(pushToken);

    return pushToken;
  } catch (err) {
    console.error('Failed to get push token:', err);
    return null;
  }
}

export function handleNotificationResponse(
  response: Notifications.NotificationResponse,
  router: Router
): void {
  const data = response.notification.request.content.data as Record<string, unknown>;
  const emailId = data?.emailId as string | undefined;

  if (emailId) {
    router.push(`/thread/${emailId}`);
  }
}

export function useNotificationListener(router: Router): void {
  // This is called from _layout.tsx inside a useEffect
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    handleNotificationResponse(response, router);
  });

  return () => {
    subscription.remove();
  };
}
