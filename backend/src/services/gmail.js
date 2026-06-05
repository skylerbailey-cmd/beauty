'use strict';

const { google } = require('googleapis');
const { updateUserTokens, updateUserHistoryId, getUser } = require('../db');

function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

/**
 * Returns an authenticated OAuth2 client for the given user,
 * automatically refreshing the access token if needed.
 */
async function refreshAndGetClient(user) {
  const oauth2Client = createOAuthClient();
  oauth2Client.setCredentials({
    access_token: user.access_token,
    refresh_token: user.refresh_token,
  });

  // Set up token refresh listener to persist new tokens
  oauth2Client.on('tokens', (tokens) => {
    updateUserTokens(
      user.id,
      tokens.access_token || user.access_token,
      tokens.refresh_token || null
    );
  });

  // Proactively refresh if the token looks expired or missing
  try {
    const tokenInfo = await oauth2Client.getTokenInfo(user.access_token);
    const expiryMs = tokenInfo.expiry_date;
    const bufferMs = 5 * 60 * 1000; // 5-minute buffer
    if (expiryMs && Date.now() > expiryMs - bufferMs) {
      const { credentials } = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(credentials);
      updateUserTokens(
        user.id,
        credentials.access_token,
        credentials.refresh_token || null
      );
    }
  } catch (_err) {
    // If getTokenInfo fails (e.g., network), attempt a refresh anyway
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(credentials);
      updateUserTokens(
        user.id,
        credentials.access_token,
        credentials.refresh_token || null
      );
    } catch (refreshErr) {
      console.error(`[gmail] Token refresh failed for user ${user.id}:`, refreshErr.message);
      throw refreshErr;
    }
  }

  return oauth2Client;
}

/**
 * Register Gmail push notifications via Google Cloud Pub/Sub.
 * Returns the historyId from the watch response.
 */
async function setupGmailWatch(userId) {
  const user = getUser(userId);
  if (!user) throw new Error(`User ${userId} not found`);

  const auth = await refreshAndGetClient(user);
  const gmail = google.gmail({ version: 'v1', auth });

  const res = await gmail.users.watch({
    userId: 'me',
    requestBody: {
      topicName: process.env.PUBSUB_TOPIC,
      labelIds: ['INBOX'],
      labelFilterBehavior: 'INCLUDE',
    },
  });

  const historyId = res.data.historyId;
  updateUserHistoryId(userId, historyId);
  console.log(`[gmail] Watch set up for user ${userId}, historyId=${historyId}`);
  return historyId;
}

/**
 * Fetch new messages since the given historyId.
 * Returns an array of { messageId, threadId }.
 */
async function getNewMessages(userId, historyId) {
  const user = getUser(userId);
  if (!user) throw new Error(`User ${userId} not found`);

  const auth = await refreshAndGetClient(user);
  const gmail = google.gmail({ version: 'v1', auth });

  const results = [];
  let pageToken;

  do {
    const res = await gmail.users.history.list({
      userId: 'me',
      startHistoryId: historyId,
      historyTypes: ['messageAdded'],
      labelId: 'INBOX',
      pageToken,
    });

    const history = res.data.history || [];
    for (const record of history) {
      for (const added of record.messagesAdded || []) {
        const msg = added.message;
        // Only include messages that are in INBOX (not sent by us)
        if (msg.labelIds && msg.labelIds.includes('INBOX') && !msg.labelIds.includes('SENT')) {
          results.push({ messageId: msg.id, threadId: msg.threadId });
        }
      }
    }

    pageToken = res.data.nextPageToken;

    // Update historyId to the latest seen
    if (res.data.historyId) {
      updateUserHistoryId(userId, res.data.historyId);
    }
  } while (pageToken);

  return results;
}

/**
 * Decode base64url-encoded Gmail message body.
 */
function decodeBody(data) {
  if (!data) return '';
  // Gmail uses base64url encoding
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf8');
}

/**
 * Recursively extract body from MIME parts.
 * Returns { text, html } — prefers HTML for display, text as fallback.
 */
function extractBody(payload) {
  if (!payload) return '';

  // Direct body — check mimeType to decide format
  if (payload.body && payload.body.data) {
    const decoded = decodeBody(payload.body.data);
    if (payload.mimeType === 'text/html') return decoded;
    return decoded;
  }

  if (!payload.parts || payload.parts.length === 0) return '';

  // Prefer text/html for rich display
  const htmlPart = payload.parts.find(p => p.mimeType === 'text/html');
  if (htmlPart && htmlPart.body && htmlPart.body.data) {
    return decodeBody(htmlPart.body.data);
  }

  // Fall back to text/plain
  const plainPart = payload.parts.find(p => p.mimeType === 'text/plain');
  if (plainPart && plainPart.body && plainPart.body.data) {
    return decodeBody(plainPart.body.data);
  }

  // Recurse into multipart
  for (const part of payload.parts) {
    if (part.mimeType && part.mimeType.startsWith('multipart/')) {
      const body = extractBody(part);
      if (body) return body;
    }
  }

  return '';
}

/**
 * Parse a single Gmail message resource into a clean object.
 */
function parseMessage(msg) {
  const headers = {};
  for (const h of (msg.payload?.headers || [])) {
    headers[h.name.toLowerCase()] = h.value;
  }

  const fromHeader = headers['from'] || '';
  // Parse "Name <email>" format
  const fromMatch = fromHeader.match(/^(.+?)\s*<(.+?)>$/) ||
                    fromHeader.match(/^(.+)$/);
  const fromName = fromMatch?.[1]?.trim().replace(/^"|"$/g, '') || '';
  const fromEmail = fromMatch?.[2]?.trim() || fromHeader.trim();

  const body = extractBody(msg.payload);
  const receivedAt = msg.internalDate
    ? new Date(parseInt(msg.internalDate)).toISOString()
    : new Date().toISOString();

  return {
    messageId: msg.id,
    threadId: msg.threadId,
    subject: headers['subject'] || '(no subject)',
    fromEmail,
    fromName,
    snippet: msg.snippet || '',
    body,
    receivedAt,
    labelIds: msg.labelIds || [],
  };
}

/**
 * Fetch a single Gmail message.
 */
async function getMessage(userId, messageId) {
  const user = getUser(userId);
  if (!user) throw new Error(`User ${userId} not found`);

  const auth = await refreshAndGetClient(user);
  const gmail = google.gmail({ version: 'v1', auth });

  const res = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });

  return parseMessage(res.data);
}

/**
 * Fetch a full Gmail thread with all messages.
 * Returns { threadId, messages: [...] }
 */
async function getThread(userId, threadId) {
  const user = getUser(userId);
  if (!user) throw new Error(`User ${userId} not found`);

  const auth = await refreshAndGetClient(user);
  const gmail = google.gmail({ version: 'v1', auth });

  const res = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'full',
  });

  const messages = (res.data.messages || []).map(parseMessage);
  return { threadId, messages };
}

/**
 * Create a Gmail draft reply in an existing thread.
 * Returns the draft object { id, message }.
 */
async function createDraft(userId, to, subject, body, threadId) {
  const user = getUser(userId);
  if (!user) throw new Error(`User ${userId} not found`);

  const auth = await refreshAndGetClient(user);
  const gmail = google.gmail({ version: 'v1', auth });

  // Ensure subject has Re: prefix
  const reSubject = subject.toLowerCase().startsWith('re:')
    ? subject
    : `Re: ${subject}`;

  // Build RFC 2822 message
  const messageParts = [
    `To: ${to}`,
    `Subject: ${reSubject}`,
    `Content-Type: text/plain; charset=utf-8`,
    `MIME-Version: 1.0`,
    '',
    body,
  ];
  const rawMessage = messageParts.join('\r\n');
  const encodedMessage = Buffer.from(rawMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const requestBody = {
    message: {
      raw: encodedMessage,
    },
  };

  if (threadId) {
    requestBody.message.threadId = threadId;
  }

  const res = await gmail.users.drafts.create({
    userId: 'me',
    requestBody,
  });

  return res.data;
}

/**
 * Send an existing Gmail draft by draft ID.
 */
async function sendDraft(userId, draftId) {
  const user = getUser(userId);
  if (!user) throw new Error(`User ${userId} not found`);

  const auth = await refreshAndGetClient(user);
  const gmail = google.gmail({ version: 'v1', auth });

  const res = await gmail.users.drafts.send({
    userId: 'me',
    requestBody: { id: draftId },
  });

  return res.data;
}

/**
 * Delete an existing Gmail draft.
 */
async function deleteDraft(userId, draftId) {
  const user = getUser(userId);
  if (!user) throw new Error(`User ${userId} not found`);

  const auth = await refreshAndGetClient(user);
  const gmail = google.gmail({ version: 'v1', auth });

  await gmail.users.drafts.delete({
    userId: 'me',
    id: draftId,
  });
}

/**
 * Archive (remove INBOX label) from a Gmail message thread.
 */
async function archiveThread(userId, threadId) {
  const user = getUser(userId);
  if (!user) throw new Error(`User ${userId} not found`);

  const auth = await refreshAndGetClient(user);
  const gmail = google.gmail({ version: 'v1', auth });

  await gmail.users.threads.modify({
    userId: 'me',
    id: threadId,
    requestBody: {
      removeLabelIds: ['INBOX'],
    },
  });
}

/**
 * Send a new email directly (not a draft, not a reply).
 */
async function sendNewEmail(userId, to, subject, body, fromName) {
  const user = getUser(userId);
  if (!user) throw new Error(`User ${userId} not found`);

  const auth = await refreshAndGetClient(user);
  const gmail = google.gmail({ version: 'v1', auth });

  const fromHeader = fromName
    ? `From: ${fromName} <${user.email}>`
    : `From: ${user.email}`;

  const messageParts = [
    fromHeader,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Content-Type: text/html; charset=utf-8`,
    `MIME-Version: 1.0`,
    '',
    body,
  ];
  const rawMessage = messageParts.join('\r\n');
  const encodedMessage = Buffer.from(rawMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encodedMessage },
  });

  return res.data;
}

/**
 * Fetch recent inbox messages from Gmail and return parsed message objects.
 * @param {string} userId
 * @param {number} maxResults - how many messages to fetch (default 25)
 * @returns {Array} parsed message objects
 */
async function listRecentInbox(userId, maxResults = 100) {
  const user = getUser(userId);
  if (!user) throw new Error(`User ${userId} not found`);

  const auth = await refreshAndGetClient(user);
  const gmail = google.gmail({ version: 'v1', auth });

  // List recent inbox messages — only Primary category (skip promotions, social, updates, forums)
  const listRes = await gmail.users.messages.list({
    userId: 'me',
    labelIds: ['INBOX', 'CATEGORY_PERSONAL'],
    maxResults,
  });

  const messageRefs = listRes.data.messages || [];
  if (messageRefs.length === 0) return [];

  // Fetch each message in full
  const messages = [];
  for (const ref of messageRefs) {
    try {
      const msgRes = await gmail.users.messages.get({
        userId: 'me',
        id: ref.id,
        format: 'full',
      });
      messages.push(parseMessage(msgRes.data));
    } catch (err) {
      console.warn(`[gmail] Failed to fetch message ${ref.id}:`, err.message);
    }
  }

  return messages;
}

module.exports = {
  createOAuthClient,
  refreshAndGetClient,
  setupGmailWatch,
  getNewMessages,
  getMessage,
  getThread,
  listRecentInbox,
  createDraft,
  sendDraft,
  sendNewEmail,
  deleteDraft,
  archiveThread,
};
