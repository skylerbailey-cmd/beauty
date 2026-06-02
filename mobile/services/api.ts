import axios, { AxiosInstance } from 'axios';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';

const BASE_URL =
  (Constants.expoConfig?.extra?.apiUrl as string) ||
  process.env.EXPO_PUBLIC_API_URL ||
  'https://api.glowsf.com';

const apiClient: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Inject auth token from SecureStore before every request
apiClient.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ---------- Auth ----------

export async function login(token: string): Promise<void> {
  await SecureStore.setItemAsync('auth_token', token);
}

export async function logout(): Promise<void> {
  await SecureStore.deleteItemAsync('auth_token');
  await SecureStore.deleteItemAsync('user_id');
}

// ---------- User ----------

export interface User {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

export async function getMe(): Promise<User> {
  const { data } = await apiClient.get<User>('/me');
  return data;
}

// ---------- Push tokens ----------

export async function registerPushToken(expoPushToken: string): Promise<void> {
  await apiClient.post('/push-tokens', { token: expoPushToken });
}

// ---------- Emails ----------

export type EmailStatus = 'pending' | 'draft_ready' | 'sent' | 'archived' | 'resolved';

export interface EmailThread {
  id: string;
  subject: string;
  customerName: string;
  customerEmail: string;
  status: EmailStatus;
  snippet: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  messages: ThreadMessage[];
  draftContent?: string;
}

export interface ThreadMessage {
  id: string;
  from: string;
  fromEmail: string;
  body: string;
  sentAt: string;
  isOutbound: boolean;
}

export interface EmailSummary {
  id: string;
  subject: string;
  customerName: string;
  customerEmail: string;
  status: EmailStatus;
  snippet: string;
  lastMessageAt: string;
  hasDraft: boolean;
}

export async function getEmails(status?: EmailStatus): Promise<EmailSummary[]> {
  const params = status ? { status } : undefined;
  const { data } = await apiClient.get<EmailSummary[]>('/emails', { params });
  return data;
}

export async function getEmail(id: string): Promise<EmailThread> {
  const { data } = await apiClient.get<EmailThread>(`/emails/${id}`);
  return data;
}

export async function updateDraft(id: string, content: string): Promise<void> {
  await apiClient.patch(`/emails/${id}/draft`, { content });
}

export async function sendEmail(id: string): Promise<void> {
  await apiClient.post(`/emails/${id}/send`);
}

export async function archiveEmail(id: string): Promise<void> {
  await apiClient.post(`/emails/${id}/archive`);
}

export async function unarchiveEmail(id: string): Promise<void> {
  await apiClient.post(`/emails/${id}/unarchive`);
}

export async function resolveFollowUp(id: string): Promise<void> {
  await apiClient.post(`/emails/${id}/resolve`);
}

export async function getFollowUps(): Promise<EmailSummary[]> {
  const { data } = await apiClient.get<EmailSummary[]>('/emails/follow-ups');
  return data;
}
