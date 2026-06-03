import axios, { AxiosInstance } from 'axios';
import Constants from 'expo-constants';

const BASE_URL =
  (Constants.expoConfig?.extra?.apiUrl as string) ||
  process.env.EXPO_PUBLIC_API_URL ||
  'https://beauty-production-5140.up.railway.app';

// User ID set once after connecting Gmail via browser — see setup instructions
const USER_ID = process.env.EXPO_PUBLIC_USER_ID || '';

const apiClient: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Send user ID header with every request
apiClient.interceptors.request.use((config) => {
  if (USER_ID) {
    config.headers['X-User-Id'] = USER_ID;
  }
  return config;
});

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
