import React, { useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  PanResponder,
  Dimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { EmailSummary } from '../services/api';

const SCREEN_WIDTH = Dimensions.get('window').width;
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.3;
const ACTION_WIDTH = 80;

function formatTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface EmailCardProps {
  email: EmailSummary;
  onPress: () => void;
  onArchive: () => void;
}

export default function EmailCard({ email, onPress, onArchive }: EmailCardProps) {
  const translateX = useRef(new Animated.Value(0)).current;
  const archiveOpacity = useRef(new Animated.Value(0)).current;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dx) > 10 && Math.abs(gestureState.dy) < 20;
      },
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dx < 0) {
          translateX.setValue(gestureState.dx);
          archiveOpacity.setValue(Math.min(1, Math.abs(gestureState.dx) / ACTION_WIDTH));
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx < -SWIPE_THRESHOLD) {
          // Animate off screen
          Animated.timing(translateX, {
            toValue: -SCREEN_WIDTH,
            duration: 250,
            useNativeDriver: true,
          }).start(() => {
            onArchive();
          });
        } else {
          // Snap back
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
            tension: 100,
            friction: 8,
          }).start();
          Animated.timing(archiveOpacity, {
            toValue: 0,
            duration: 150,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  const isDraftReady = email.status === 'draft_ready';

  return (
    <View style={styles.wrapper}>
      {/* Archive background action */}
      <Animated.View style={[styles.archiveAction, { opacity: archiveOpacity }]}>
        <Feather name="archive" size={22} color="#FFFFFF" />
        <Text style={styles.archiveActionText}>Archive</Text>
      </Animated.View>

      {/* Card */}
      <Animated.View
        style={[styles.cardAnimated, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        <TouchableOpacity
          style={[styles.card, isDraftReady && styles.cardDraftReady]}
          onPress={onPress}
          activeOpacity={0.8}
        >
          {/* Left accent */}
          {isDraftReady && <View style={styles.draftAccentBar} />}

          <View style={styles.cardInner}>
            {/* Avatar */}
            <View style={[styles.avatar, isDraftReady && styles.avatarDraftReady]}>
              <Text style={styles.avatarText}>
                {email.customerName.charAt(0).toUpperCase()}
              </Text>
            </View>

            {/* Content */}
            <View style={styles.content}>
              <View style={styles.topRow}>
                <Text style={styles.senderName} numberOfLines={1}>
                  {email.customerName}
                </Text>
                <Text style={styles.timeText}>{formatTime(email.lastMessageAt)}</Text>
              </View>

              <View style={styles.subjectRow}>
                <Text style={styles.subject} numberOfLines={1}>
                  {email.subject}
                </Text>
                {isDraftReady && (
                  <View style={styles.draftBadge}>
                    <Text style={styles.draftBadgeText}>Draft Ready</Text>
                  </View>
                )}
              </View>

              <Text style={styles.snippet} numberOfLines={2}>
                {email.snippet}
              </Text>
            </View>

            {/* Chevron */}
            <Feather name="chevron-right" size={16} color={Colors.border} style={styles.chevron} />
          </View>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginHorizontal: 12,
    marginBottom: 10,
  },
  archiveAction: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: ACTION_WIDTH + 20,
    backgroundColor: Colors.danger,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  archiveActionText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },
  cardAnimated: {
    borderRadius: 14,
    shadowColor: Colors.shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 3,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    overflow: 'hidden',
  },
  cardDraftReady: {
    backgroundColor: '#FFFBF9',
  },
  draftAccentBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: Colors.primary,
  },
  cardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    paddingLeft: 18,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarDraftReady: {
    backgroundColor: Colors.primary,
  },
  avatarText: {
    fontSize: 19,
    fontWeight: '700',
    color: Colors.surface,
  },
  content: {
    flex: 1,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  senderName: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
    flex: 1,
    marginRight: 8,
  },
  timeText: {
    fontSize: 11,
    color: Colors.textLight,
  },
  subjectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 8,
  },
  subject: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.text,
    flex: 1,
  },
  draftBadge: {
    backgroundColor: Colors.primary,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  draftBadgeText: {
    color: Colors.surface,
    fontSize: 10,
    fontWeight: '700',
  },
  snippet: {
    fontSize: 12,
    color: Colors.textLight,
    lineHeight: 17,
  },
  chevron: {
    marginLeft: 6,
  },
});
