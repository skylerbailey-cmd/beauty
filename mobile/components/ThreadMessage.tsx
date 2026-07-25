import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { ThreadMessage as ThreadMessageType } from '../services/api';

function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

interface ThreadMessageProps {
  message: ThreadMessageType;
  isLast: boolean;
}

export default function ThreadMessage({ message, isLast }: ThreadMessageProps) {
  const [expanded, setExpanded] = useState(isLast);
  const isOutbound = message.isOutbound;

  const preview = message.body.length > 120 && !expanded
    ? message.body.slice(0, 120).trim() + '…'
    : message.body;

  return (
    <View style={[styles.container, isOutbound ? styles.containerOutbound : styles.containerInbound]}>
      {/* Header */}
      <TouchableOpacity
        style={styles.header}
        onPress={() => setExpanded((v) => !v)}
        activeOpacity={0.7}
      >
        <View style={[styles.avatar, isOutbound ? styles.avatarOutbound : styles.avatarInbound]}>
          {isOutbound ? (
            <Feather name="send" size={14} color={Colors.surface} />
          ) : (
            <Text style={styles.avatarText}>{message.from.charAt(0).toUpperCase()}</Text>
          )}
        </View>

        <View style={styles.headerInfo}>
          <Text style={[styles.fromName, isOutbound && styles.fromNameOutbound]}>
            {isOutbound ? 'SkySale (You)' : message.from}
          </Text>
          <Text style={styles.dateText}>{formatDateTime(message.sentAt)}</Text>
        </View>

        <Feather
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={Colors.textLight}
        />
      </TouchableOpacity>

      {/* Body */}
      {expanded && (
        <View style={styles.body}>
          <Text style={styles.bodyText}>{message.body}</Text>
        </View>
      )}

      {/* Collapsed preview */}
      {!expanded && (
        <TouchableOpacity onPress={() => setExpanded(true)}>
          <Text style={styles.previewText} numberOfLines={2}>
            {preview}
          </Text>
        </TouchableOpacity>
      )}

      {/* Outbound label */}
      {isOutbound && (
        <View style={styles.sentBadge}>
          <Feather name="check" size={11} color={Colors.success} />
          <Text style={styles.sentBadgeText}>Sent</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 14,
    marginBottom: 10,
    overflow: 'hidden',
    shadowColor: Colors.shadowColor,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  containerInbound: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  containerOutbound: {
    backgroundColor: '#F6F0FB',
    borderWidth: 1,
    borderColor: '#E2D4F0',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    paddingBottom: 10,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  avatarInbound: {
    backgroundColor: Colors.accent,
  },
  avatarOutbound: {
    backgroundColor: Colors.secondary,
  },
  avatarText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.primary,
  },
  headerInfo: {
    flex: 1,
  },
  fromName: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 2,
  },
  fromNameOutbound: {
    color: '#6B4F8A',
  },
  dateText: {
    fontSize: 11,
    color: Colors.textLight,
  },
  body: {
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  bodyText: {
    fontSize: 14,
    color: Colors.text,
    lineHeight: 22,
  },
  previewText: {
    fontSize: 13,
    color: Colors.textLight,
    lineHeight: 19,
    paddingHorizontal: 14,
    paddingBottom: 14,
    fontStyle: 'italic',
  },
  sentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    paddingHorizontal: 14,
    paddingBottom: 10,
    gap: 4,
  },
  sentBadgeText: {
    fontSize: 11,
    color: Colors.success,
    fontWeight: '600',
  },
});
