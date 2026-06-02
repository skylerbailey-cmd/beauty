import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Colors } from '../../constants/colors';
import { EmailThread, getEmail, sendEmail, updateDraft } from '../../services/api';
import ThreadMessage from '../../components/ThreadMessage';
import DraftEditor from '../../components/DraftEditor';

export default function ThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const scrollViewRef = useRef<ScrollView>(null);

  const [thread, setThread] = useState<EmailThread | null>(null);
  const [draftContent, setDraftContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchThread = useCallback(async () => {
    if (!id) return;
    try {
      setError(null);
      const data = await getEmail(id);
      setThread(data);
      setDraftContent(data.draftContent ?? '');
    } catch (err) {
      console.error('Failed to fetch thread:', err);
      setError('Failed to load thread. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchThread();
  }, [fetchThread]);

  const handleDraftChange = useCallback(
    async (text: string) => {
      setDraftContent(text);
    },
    []
  );

  const handleSaveDraft = useCallback(async () => {
    if (!id) return;
    setSavingDraft(true);
    try {
      await updateDraft(id, draftContent);
    } catch (err) {
      console.error('Failed to save draft:', err);
    } finally {
      setSavingDraft(false);
    }
  }, [id, draftContent]);

  const handleSend = useCallback(() => {
    if (!thread || !id) return;

    Alert.alert(
      'Send Response',
      `Send this response to ${thread.customerName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send',
          style: 'default',
          onPress: async () => {
            setSending(true);
            try {
              // Save latest draft content first
              await updateDraft(id, draftContent);
              await sendEmail(id);
              Alert.alert(
                'Sent!',
                `Your response to ${thread.customerName} has been sent.`,
                [
                  {
                    text: 'OK',
                    onPress: () => router.replace('/(tabs)/inbox'),
                  },
                ]
              );
            } catch (err) {
              console.error('Failed to send email:', err);
              Alert.alert('Send Failed', 'Could not send the email. Please try again.');
            } finally {
              setSending(false);
            }
          },
        },
      ]
    );
  }, [thread, id, draftContent, router]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (error || !thread) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorEmoji}>⚠️</Text>
        <Text style={styles.errorText}>{error ?? 'Thread not found.'}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={fetchThread}>
          <Text style={styles.retryText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const hasDraft = thread.status === 'draft_ready' || !!thread.draftContent;

  return (
    <>
      <Stack.Screen
        options={{
          headerTitle: thread.customerName,
          headerBackTitle: 'Inbox',
        }}
      />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={90}
      >
        <ScrollView
          ref={scrollViewRef}
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: false })}
        >
          {/* Thread header */}
          <View style={styles.threadHeader}>
            <Text style={styles.subjectText}>{thread.subject}</Text>
            <Text style={styles.participantText}>
              {thread.customerEmail}
            </Text>
          </View>

          {/* Messages */}
          {thread.messages.map((message, index) => (
            <ThreadMessage
              key={message.id}
              message={message}
              isLast={index === thread.messages.length - 1}
            />
          ))}

          {/* Draft editor */}
          {hasDraft && (
            <DraftEditor
              value={draftContent}
              onChange={handleDraftChange}
              onSave={handleSaveDraft}
              onSend={handleSend}
              isSaving={savingDraft}
              isSending={sending}
            />
          )}

          {/* No draft state */}
          {!hasDraft && (
            <View style={styles.noDraftCard}>
              <Text style={styles.noDraftEmoji}>🤖</Text>
              <Text style={styles.noDraftTitle}>AI Draft Pending</Text>
              <Text style={styles.noDraftSubtitle}>
                The AI is preparing a draft response. Check back shortly.
              </Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
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
    padding: 24,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  threadHeader: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: Colors.primary,
    shadowColor: Colors.shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 2,
  },
  subjectText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 4,
    lineHeight: 22,
  },
  participantText: {
    fontSize: 13,
    color: Colors.textLight,
  },
  noDraftCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 24,
    alignItems: 'center',
    marginTop: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    borderStyle: 'dashed',
  },
  noDraftEmoji: {
    fontSize: 36,
    marginBottom: 12,
  },
  noDraftTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 8,
  },
  noDraftSubtitle: {
    fontSize: 13,
    color: Colors.textLight,
    textAlign: 'center',
    lineHeight: 19,
  },
  errorEmoji: {
    fontSize: 40,
    marginBottom: 12,
  },
  errorText: {
    fontSize: 15,
    color: Colors.text,
    textAlign: 'center',
    marginBottom: 20,
  },
  retryButton: {
    backgroundColor: Colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 24,
  },
  retryText: {
    color: Colors.surface,
    fontWeight: '600',
    fontSize: 15,
  },
});
