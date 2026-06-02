import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  SafeAreaView,
  Alert,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import Constants from 'expo-constants';
import { Colors } from '../constants/colors';

const API_URL =
  (Constants.expoConfig?.extra?.apiUrl as string) ||
  process.env.EXPO_PUBLIC_API_URL ||
  'https://api.glowsf.com';

WebBrowser.maybeCompleteAuthSession();

export default function AuthScreen() {
  const [isLoading, setIsLoading] = useState(false);

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    try {
      const redirectUri = Linking.createURL('auth-success');
      const authUrl = `${API_URL}/auth/google?redirect_uri=${encodeURIComponent(redirectUri)}`;

      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);

      if (result.type === 'cancel' || result.type === 'dismiss') {
        // User dismissed — do nothing
      } else if (result.type === 'success') {
        // The deep link handler in _layout.tsx will pick up the URL
        // and call authState.login(token, userId)
      }
    } catch (err) {
      Alert.alert('Sign In Failed', 'Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Background decorative circles */}
      <View style={styles.circleTopRight} />
      <View style={styles.circleBottomLeft} />

      <View style={styles.content}>
        {/* Logo / Brand */}
        <View style={styles.logoContainer}>
          <View style={styles.logoRing}>
            <Text style={styles.logoEmoji}>🌸</Text>
          </View>
          <Text style={styles.brandName}>Glow SF</Text>
          <Text style={styles.tagline}>Beauty Store Management</Text>
        </View>

        {/* Welcome text */}
        <View style={styles.heroTextContainer}>
          <Text style={styles.heroTitle}>Welcome back</Text>
          <Text style={styles.heroSubtitle}>
            Sign in to manage your customer emails and AI-powered responses.
          </Text>
        </View>

        {/* Sign-in button */}
        <TouchableOpacity
          style={[styles.googleButton, isLoading && styles.googleButtonDisabled]}
          onPress={handleGoogleLogin}
          disabled={isLoading}
          activeOpacity={0.85}
        >
          {isLoading ? (
            <ActivityIndicator color={Colors.surface} size="small" />
          ) : (
            <>
              <View style={styles.googleIconWrapper}>
                <Text style={styles.googleIconText}>G</Text>
              </View>
              <Text style={styles.googleButtonText}>Sign in with Gmail</Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.disclaimer}>
          By signing in, you authorize Glow SF to access your Gmail inbox to manage customer
          emails.
        </Text>
      </View>

      {/* Footer */}
      <Text style={styles.footer}>Glow SF · San Francisco</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  circleTopRight: {
    position: 'absolute',
    top: -80,
    right: -80,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: Colors.accent,
    opacity: 0.4,
  },
  circleBottomLeft: {
    position: 'absolute',
    bottom: -60,
    left: -60,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: Colors.primary,
    opacity: 0.2,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 48,
  },
  logoRing: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    shadowColor: Colors.shadowColor,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 6,
  },
  logoEmoji: {
    fontSize: 40,
  },
  brandName: {
    fontSize: 34,
    fontWeight: '700',
    color: Colors.text,
    letterSpacing: 1,
  },
  tagline: {
    fontSize: 14,
    color: Colors.textLight,
    marginTop: 4,
    letterSpacing: 0.5,
  },
  heroTextContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  heroTitle: {
    fontSize: 26,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 10,
  },
  heroSubtitle: {
    fontSize: 15,
    color: Colors.textLight,
    textAlign: 'center',
    lineHeight: 22,
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary,
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 30,
    width: '100%',
    justifyContent: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 5,
  },
  googleButtonDisabled: {
    opacity: 0.65,
  },
  googleIconWrapper: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  googleIconText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.secondary,
  },
  googleButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.surface,
    letterSpacing: 0.3,
  },
  disclaimer: {
    fontSize: 12,
    color: Colors.textLight,
    textAlign: 'center',
    marginTop: 20,
    lineHeight: 18,
    paddingHorizontal: 8,
  },
  footer: {
    textAlign: 'center',
    fontSize: 12,
    color: Colors.textLight,
    paddingBottom: 20,
  },
});
