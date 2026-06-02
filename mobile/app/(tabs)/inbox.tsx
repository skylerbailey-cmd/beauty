import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  SectionList,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Colors } from '../../constants/colors';
import { EmailSummary, getEmails, archiveEmail } from '../../services/api';
import EmailCard from '../../components/EmailCard';

export default function InboxScreen() {
  const router = useRouter();
  const [draftReady, setDraftReady] = useState<EmailSummary[]>([]);
  const [pending, setPending] = useState<EmailSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchEmails = useCallback(async () => {
    try {
      const [drafts, newEmails] = await Promise.all([
        getEmails('draft_ready'),
        getEmails('pending'),
      ]);
      setDraftReady(drafts);
      setPending(newEmails);
    } catch (err) {
      console.error('Failed to fetch emails:', err);
    }
  }, []);

  useEffect(() => {
    fetchEmails().finally(() => setLoading(false));
  }, [fetchEmails]);

  useFocusEffect(
    useCallback(() => {
      fetchEmails();
    }, [fetchEmails])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchEmails();
    setRefreshing(false);
  }, [fetchEmails]);

  const handleArchive = useCallback(async (id: string) => {
    try {
      await archiveEmail(id);
      setDraftReady((prev) => prev.filter((e) => e.id !== id));
      setPending((prev) => prev.filter((e) => e.id !== id));
    } catch (err) {
      console.error('Failed to archive email:', err);
    }
  }, []);

  const handlePress = useCallback(
    (id: string) => {
      router.push(`/thread/${id}`);
    },
    [router]
  );

  const sections = [
    ...(draftReady.length > 0
      ? [{ title: 'Drafts Ready', data: draftReady }]
      : []),
    ...(pending.length > 0
      ? [{ title: 'New', data: pending }]
      : []),
  ];

  const isEmpty = draftReady.length === 0 && pending.length === 0;

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (isEmpty) {
    return (
      <View style={styles.emptyContainer}>
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        <Text style={styles.emptyEmoji}>✨</Text>
        <Text style={styles.emptyTitle}>You're all caught up!</Text>
        <Text style={styles.emptySubtitle}>No emails waiting for your attention.</Text>
      </View>
    );
  }

  return (
    <SectionList
      sections={sections}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <EmailCard
          email={item}
          onPress={() => handlePress(item.id)}
          onArchive={() => handleArchive(item.id)}
        />
      )}
      renderSectionHeader={({ section: { title } }) => (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {title === 'Drafts Ready' && (
            <View style={styles.sectionBadge}>
              <Text style={styles.sectionBadgeText}>{draftReady.length}</Text>
            </View>
          )}
        </View>
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
      stickySectionHeadersEnabled={false}
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
    fontSize: 22,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 15,
    color: Colors.textLight,
    textAlign: 'center',
    lineHeight: 22,
  },
  list: {
    paddingBottom: 24,
    backgroundColor: Colors.background,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textLight,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  sectionBadge: {
    marginLeft: 8,
    backgroundColor: Colors.primary,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  sectionBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
});
