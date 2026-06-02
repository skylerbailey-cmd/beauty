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
import { useFocusEffect, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { EmailSummary, getEmails, unarchiveEmail } from '../../services/api';

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function ArchivedCard({
  email,
  onUnarchive,
  onPress,
}: {
  email: EmailSummary;
  onUnarchive: (id: string) => void;
  onPress: (id: string) => void;
}) {
  const handleUnarchive = () => {
    Alert.alert(
      'Move to Inbox',
      `Move this conversation with ${email.customerName} back to inbox?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Move to Inbox',
          onPress: () => onUnarchive(email.id),
        },
      ]
    );
  };

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => onPress(email.id)}
      activeOpacity={0.75}
    >
      <View style={styles.cardMain}>
        <View style={styles.avatarCircle}>
          <Text style={styles.avatarText}>{email.customerName.charAt(0).toUpperCase()}</Text>
        </View>

        <View style={styles.cardContent}>
          <View style={styles.topRow}>
            <Text style={styles.customerName} numberOfLines={1}>
              {email.customerName}
            </Text>
            <Text style={styles.dateText}>{formatDate(email.lastMessageAt)}</Text>
          </View>
          <Text style={styles.subject} numberOfLines={1}>
            {email.subject}
          </Text>
          <Text style={styles.snippet} numberOfLines={2}>
            {email.snippet}
          </Text>
        </View>
      </View>

      <TouchableOpacity style={styles.unarchiveButton} onPress={handleUnarchive}>
        <Feather name="inbox" size={18} color={Colors.secondary} />
        <Text style={styles.unarchiveText}>Restore</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

export default function ArchivedScreen() {
  const router = useRouter();
  const [emails, setEmails] = useState<EmailSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchArchived = useCallback(async () => {
    try {
      const data = await getEmails('archived');
      setEmails(data);
    } catch (err) {
      console.error('Failed to fetch archived emails:', err);
    }
  }, []);

  useEffect(() => {
    fetchArchived().finally(() => setLoading(false));
  }, [fetchArchived]);

  useFocusEffect(
    useCallback(() => {
      fetchArchived();
    }, [fetchArchived])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchArchived();
    setRefreshing(false);
  }, [fetchArchived]);

  const handleUnarchive = useCallback(async (id: string) => {
    try {
      await unarchiveEmail(id);
      setEmails((prev) => prev.filter((e) => e.id !== id));
    } catch (err) {
      console.error('Failed to unarchive:', err);
      Alert.alert('Error', 'Failed to restore email. Please try again.');
    }
  }, []);

  const handlePress = useCallback(
    (id: string) => {
      router.push(`/thread/${id}`);
    },
    [router]
  );

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
        <Text style={styles.emptyEmoji}>🗂️</Text>
        <Text style={styles.emptyTitle}>No archived emails</Text>
        <Text style={styles.emptySubtitle}>
          Emails you archive from your inbox will appear here.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={emails}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <ArchivedCard
          email={item}
          onUnarchive={handleUnarchive}
          onPress={handlePress}
        />
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
  );
}

const styles = StyleSheet.create({
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
  },
  emptySubtitle: {
    fontSize: 14,
    color: Colors.textLight,
    textAlign: 'center',
    lineHeight: 21,
  },
  list: {
    padding: 12,
    paddingBottom: 24,
    backgroundColor: Colors.background,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    shadowColor: Colors.shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
    opacity: 0.85,
  },
  cardMain: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  avatarCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textLight,
  },
  cardContent: {
    flex: 1,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 3,
  },
  customerName: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
    flex: 1,
    marginRight: 8,
  },
  dateText: {
    fontSize: 11,
    color: Colors.textLight,
  },
  subject: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.text,
    marginBottom: 3,
    opacity: 0.8,
  },
  snippet: {
    fontSize: 12,
    color: Colors.textLight,
    lineHeight: 17,
  },
  unarchiveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    width: '100%',
    gap: 6,
  },
  unarchiveText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.secondary,
  },
});
