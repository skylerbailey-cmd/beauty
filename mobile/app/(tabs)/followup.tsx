import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { EmailSummary, getFollowUps, resolveFollowUp } from '../../services/api';

function daysSince(dateString: string): number {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function FollowUpCard({
  email,
  onResolve,
}: {
  email: EmailSummary;
  onResolve: (id: string) => void;
}) {
  const days = daysSince(email.lastMessageAt);

  const handleResolve = () => {
    Alert.alert(
      'Mark as Resolved',
      `Mark the conversation with ${email.customerName} as resolved?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Resolve',
          onPress: () => onResolve(email.id),
        },
      ]
    );
  };

  return (
    <View style={styles.card}>
      <View style={styles.cardLeft}>
        <View style={styles.avatarCircle}>
          <Text style={styles.avatarText}>{email.customerName.charAt(0).toUpperCase()}</Text>
        </View>
      </View>

      <View style={styles.cardContent}>
        <View style={styles.cardTopRow}>
          <Text style={styles.customerName} numberOfLines={1}>
            {email.customerName}
          </Text>
          <View style={[styles.daysBadge, days >= 3 ? styles.daysBadgeUrgent : styles.daysBadgeNormal]}>
            <Text style={[styles.daysText, days >= 3 ? styles.daysTextUrgent : styles.daysTextNormal]}>
              {days === 0 ? 'Today' : days === 1 ? '1 day ago' : `${days} days ago`}
            </Text>
          </View>
        </View>

        <Text style={styles.subject} numberOfLines={1}>
          {email.subject}
        </Text>
        <Text style={styles.snippet} numberOfLines={2}>
          {email.snippet}
        </Text>
      </View>

      <TouchableOpacity style={styles.resolveButton} onPress={handleResolve}>
        <Feather name="check-circle" size={22} color={Colors.success} />
      </TouchableOpacity>
    </View>
  );
}

export default function FollowUpScreen() {
  const [emails, setEmails] = useState<EmailSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchFollowUps = useCallback(async () => {
    try {
      const data = await getFollowUps();
      // Sort oldest first
      const sorted = [...data].sort(
        (a, b) => new Date(a.lastMessageAt).getTime() - new Date(b.lastMessageAt).getTime()
      );
      setEmails(sorted);
    } catch (err) {
      console.error('Failed to fetch follow-ups:', err);
    }
  }, []);

  useEffect(() => {
    fetchFollowUps().finally(() => setLoading(false));
  }, [fetchFollowUps]);

  useFocusEffect(
    useCallback(() => {
      fetchFollowUps();
    }, [fetchFollowUps])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchFollowUps();
    setRefreshing(false);
  }, [fetchFollowUps]);

  const handleResolve = useCallback(async (id: string) => {
    try {
      await resolveFollowUp(id);
      setEmails((prev) => prev.filter((e) => e.id !== id));
    } catch (err) {
      console.error('Failed to resolve follow-up:', err);
      Alert.alert('Error', 'Failed to resolve. Please try again.');
    }
  }, []);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (emails.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyEmoji}>🌟</Text>
        <Text style={styles.emptyTitle}>No follow-ups needed right now!</Text>
        <Text style={styles.emptySubtitle}>
          Emails you've sent that haven't received a reply will appear here.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.infoBar}>
        <Feather name="info" size={13} color={Colors.textLight} />
        <Text style={styles.infoText}>Sorted by oldest first — tap ✓ to mark resolved</Text>
      </View>

      <FlatList
        data={emails}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <FollowUpCard email={item} onResolve={handleResolve} />
        )}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.primary}
            colors={[Colors.primary]}
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
    paddingHorizontal: 40,
  },
  emptyEmoji: {
    fontSize: 56,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 10,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    color: Colors.textLight,
    textAlign: 'center',
    lineHeight: 21,
  },
  infoBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: Colors.accent,
    gap: 6,
  },
  infoText: {
    fontSize: 12,
    color: Colors.textLight,
  },
  list: {
    padding: 12,
    paddingBottom: 24,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    shadowColor: Colors.shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 2,
  },
  cardLeft: {
    marginRight: 12,
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.primary,
  },
  cardContent: {
    flex: 1,
    marginRight: 8,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  customerName: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
    flex: 1,
    marginRight: 8,
  },
  daysBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  daysBadgeNormal: {
    backgroundColor: Colors.background,
  },
  daysBadgeUrgent: {
    backgroundColor: '#FFF0F0',
  },
  daysText: {
    fontSize: 11,
    fontWeight: '600',
  },
  daysTextNormal: {
    color: Colors.textLight,
  },
  daysTextUrgent: {
    color: Colors.danger,
  },
  subject: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.text,
    marginBottom: 3,
  },
  snippet: {
    fontSize: 12,
    color: Colors.textLight,
    lineHeight: 17,
  },
  resolveButton: {
    padding: 6,
  },
});
