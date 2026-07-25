import React, { useEffect, useState } from 'react';
import { Tabs } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../../constants/colors';
import { getEmails } from '../../services/api';

function BadgeIcon({
  name,
  color,
  size,
  badge,
}: {
  name: React.ComponentProps<typeof Feather>['name'];
  color: string;
  size: number;
  badge?: number;
}) {
  return (
    <View style={styles.iconWrapper}>
      <Feather name={name} color={color} size={size} />
      {badge != null && badge > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
        </View>
      )}
    </View>
  );
}

export default function TabsLayout() {
  const [draftCount, setDraftCount] = useState(0);

  useEffect(() => {
    const fetchDraftCount = async () => {
      try {
        const emails = await getEmails('draft_ready');
        setDraftCount(emails.length);
      } catch {
        // silent fail
      }
    };

    fetchDraftCount();
    // Poll every 30 seconds for badge update
    const interval = setInterval(fetchDraftCount, 30_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textLight,
        tabBarStyle: {
          backgroundColor: Colors.surface,
          borderTopColor: Colors.border,
          borderTopWidth: 1,
          paddingTop: 6,
          paddingBottom: 4,
          height: 60,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500',
          marginBottom: 4,
        },
        headerStyle: {
          backgroundColor: Colors.background,
        },
        headerTintColor: Colors.text,
        headerTitleStyle: {
          fontWeight: '700',
          fontSize: 20,
        },
        headerShadowVisible: false,
      }}
    >
      <Tabs.Screen
        name="inbox"
        options={{
          title: 'Inbox',
          headerTitle: 'SkySale Inbox',
          tabBarIcon: ({ color, size }) => (
            <BadgeIcon name="mail" color={color} size={size} badge={draftCount} />
          ),
        }}
      />
      <Tabs.Screen
        name="followup"
        options={{
          title: 'Follow Up',
          headerTitle: 'Follow Up',
          tabBarIcon: ({ color, size }) => (
            <BadgeIcon name="clock" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="archived"
        options={{
          title: 'Archived',
          headerTitle: 'Archived',
          tabBarIcon: ({ color, size }) => (
            <BadgeIcon name="archive" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconWrapper: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -8,
    backgroundColor: Colors.danger,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '700',
  },
});
