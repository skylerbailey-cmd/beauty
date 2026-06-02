import React, { useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors } from '../constants/colors';

const MAX_CHARS = 2000;

interface DraftEditorProps {
  value: string;
  onChange: (text: string) => void;
  onSave: () => void;
  onSend: () => void;
  isSaving: boolean;
  isSending: boolean;
}

export default function DraftEditor({
  value,
  onChange,
  onSave,
  onSend,
  isSaving,
  isSending,
}: DraftEditorProps) {
  const inputRef = useRef<TextInput>(null);
  const charCount = value.length;
  const isOverLimit = charCount > MAX_CHARS;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.aiDot} />
          <Text style={styles.headerLabel}>Editing AI Draft</Text>
        </View>
        <TouchableOpacity
          style={styles.saveButton}
          onPress={onSave}
          disabled={isSaving || isSending}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color={Colors.secondary} />
          ) : (
            <>
              <Feather name="save" size={14} color={Colors.secondary} />
              <Text style={styles.saveButtonText}>Save</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Divider */}
      <View style={styles.divider} />

      {/* Text input */}
      <TouchableOpacity
        activeOpacity={1}
        onPress={() => inputRef.current?.focus()}
        style={styles.inputWrapper}
      >
        <TextInput
          ref={inputRef}
          style={styles.textInput}
          value={value}
          onChangeText={onChange}
          multiline
          scrollEnabled={false}
          placeholder="Your AI-generated response will appear here…"
          placeholderTextColor={Colors.textLight}
          textAlignVertical="top"
          maxLength={MAX_CHARS + 100}
          editable={!isSending}
        />
      </TouchableOpacity>

      {/* Footer row */}
      <View style={styles.footer}>
        <Text style={[styles.charCount, isOverLimit && styles.charCountOver]}>
          {charCount} / {MAX_CHARS}
        </Text>

        <TouchableOpacity
          style={[styles.sendButton, (isSending || isOverLimit) && styles.sendButtonDisabled]}
          onPress={onSend}
          disabled={isSending || isOverLimit || !value.trim()}
          activeOpacity={0.85}
        >
          {isSending ? (
            <ActivityIndicator size="small" color={Colors.surface} />
          ) : (
            <>
              <Text style={styles.sendButtonText}>Send Response</Text>
              <Feather name="send" size={16} color={Colors.surface} style={styles.sendIcon} />
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    marginTop: 16,
    shadowColor: Colors.shadowColor,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 12,
    elevation: 4,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: Colors.accent,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  aiDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.primary,
  },
  headerLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.text,
    letterSpacing: 0.3,
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: Colors.surface,
  },
  saveButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.secondary,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
  },
  inputWrapper: {
    padding: 16,
    minHeight: 160,
  },
  textInput: {
    fontSize: 15,
    color: Colors.text,
    lineHeight: 23,
    minHeight: 140,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.background,
  },
  charCount: {
    fontSize: 12,
    color: Colors.textLight,
  },
  charCountOver: {
    color: Colors.danger,
    fontWeight: '600',
  },
  sendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 24,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  sendButtonDisabled: {
    opacity: 0.5,
    shadowOpacity: 0,
    elevation: 0,
  },
  sendButtonText: {
    color: Colors.surface,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  sendIcon: {
    marginLeft: 8,
  },
});
