'use strict';

const { Expo } = require('expo-server-sdk');

const expo = new Expo();

/**
 * Send an Expo push notification to the iOS app indicating a draft is ready.
 *
 * @param {string} pushToken  - The Expo push token for the user's device
 * @param {string} emailId    - The internal email ID (for deep linking in the app)
 * @param {string} subject    - Email subject line
 * @param {string} fromName   - Sender display name or email
 */
async function sendDraftReadyNotification(pushToken, emailId, subject, fromName) {
  if (!pushToken) {
    console.warn('[notifications] No push token provided, skipping');
    return;
  }

  // Validate the token format
  if (!Expo.isExpoPushToken(pushToken)) {
    console.warn('[notifications] Invalid Expo push token:', pushToken);
    return;
  }

  const displayFrom = fromName || 'Someone';
  const displaySubject = subject || '(no subject)';

  const message = {
    to: pushToken,
    sound: 'default',
    title: '✨ Draft Ready — SkySale',
    body: `New email from ${displayFrom}: "${displaySubject}"`,
    data: {
      type: 'draft_ready',
      emailId,
      subject: displaySubject,
      fromName: displayFrom,
    },
    badge: 1,
    priority: 'high',
    channelId: 'email-drafts', // Android notification channel
  };

  try {
    const chunks = expo.chunkPushNotifications([message]);
    const tickets = [];

    for (const chunk of chunks) {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...ticketChunk);
    }

    // Check for errors in the tickets
    for (const ticket of tickets) {
      if (ticket.status === 'error') {
        console.error('[notifications] Push notification error:', ticket.message, ticket.details);

        // If the token is invalid/not registered, log it — the app should re-register
        if (ticket.details?.error === 'DeviceNotRegistered') {
          console.warn('[notifications] Device not registered — push token should be refreshed:', pushToken);
        }
      } else {
        console.log(`[notifications] Push notification sent, ticket id: ${ticket.id}`);
      }
    }

    return tickets;
  } catch (err) {
    console.error('[notifications] Failed to send push notification:', err);
    throw err;
  }
}

/**
 * Send a follow-up reminder push notification.
 *
 * @param {string} pushToken - Expo push token
 * @param {string} emailId   - The internal email ID
 * @param {string} subject   - Original email subject
 * @param {string} fromName  - Customer name
 */
async function sendFollowUpNotification(pushToken, emailId, subject, fromName) {
  if (!pushToken || !Expo.isExpoPushToken(pushToken)) {
    console.warn('[notifications] Invalid or missing push token for follow-up');
    return;
  }

  const displayFrom = fromName || 'a customer';
  const displaySubject = subject || '(no subject)';

  const message = {
    to: pushToken,
    sound: 'default',
    title: '🔔 Follow-Up Needed — SkySale',
    body: `No reply from ${displayFrom} in 48h. Topic: "${displaySubject}"`,
    data: {
      type: 'follow_up',
      emailId,
      subject: displaySubject,
      fromName: displayFrom,
    },
    badge: 1,
    priority: 'normal',
    channelId: 'email-followup',
  };

  try {
    const chunks = expo.chunkPushNotifications([message]);
    for (const chunk of chunks) {
      await expo.sendPushNotificationsAsync(chunk);
    }
  } catch (err) {
    console.error('[notifications] Failed to send follow-up notification:', err);
    throw err;
  }
}

module.exports = {
  sendDraftReadyNotification,
  sendFollowUpNotification,
};
