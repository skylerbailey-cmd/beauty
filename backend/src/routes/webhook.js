'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getAllUsers, getUser, updateUserHistoryId, saveEmail, saveEmailDraft, getEmailByMessageId } = require('../db');
const { getNewMessages, getMessage, getThread, createDraft } = require('../services/gmail');
const { generateEmailResponse, extractProductQuestions } = require('../services/claude');
const { sendDraftReadyNotification } = require('../services/notifications');
const { searchProductInfo } = require('../services/products');

const router = express.Router();

// ─── POST /webhook/gmail ───────────────────────────────────────────────────────
// Receives Pub/Sub push notifications from Gmail

router.post('/gmail', async (req, res) => {
  // Acknowledge receipt immediately — Pub/Sub will retry if we don't respond 200 quickly
  res.status(200).json({ received: true });

  try {
    const body = req.body;

    // Pub/Sub wraps the notification in a message envelope
    if (!body || !body.message) {
      console.warn('[webhook] Received Pub/Sub message with no message field');
      return;
    }

    // Decode base64-encoded Pub/Sub data
    let data;
    try {
      const decoded = Buffer.from(body.message.data, 'base64').toString('utf8');
      data = JSON.parse(decoded);
    } catch (decodeErr) {
      console.error('[webhook] Failed to decode Pub/Sub message:', decodeErr.message);
      return;
    }

    // data has: { emailAddress, historyId }
    const { emailAddress, historyId } = data;
    if (!emailAddress || !historyId) {
      console.warn('[webhook] Missing emailAddress or historyId in Pub/Sub data:', data);
      return;
    }

    console.log(`[webhook] Received notification for ${emailAddress}, historyId=${historyId}`);

    // Find the matching user
    const users = getAllUsers();
    const user = users.find(u => u.email && u.email.toLowerCase() === emailAddress.toLowerCase());

    if (!user) {
      console.warn(`[webhook] No user found for email ${emailAddress}`);
      return;
    }

    // Get messages added since the last known historyId
    const lastHistoryId = user.gmail_history_id;
    if (!lastHistoryId) {
      // First-time — just update historyId and wait for next notification
      updateUserHistoryId(user.id, historyId);
      return;
    }

    let newMessages;
    try {
      newMessages = await getNewMessages(user.id, lastHistoryId);
    } catch (err) {
      console.error(`[webhook] Failed to fetch new messages for ${emailAddress}:`, err.message);
      updateUserHistoryId(user.id, historyId);
      return;
    }

    console.log(`[webhook] Found ${newMessages.length} new message(s) for ${emailAddress}`);

    // Update historyId now (even if processing fails below)
    updateUserHistoryId(user.id, historyId);

    // Process each new message
    for (const { messageId, threadId } of newMessages) {
      await processNewMessage(user, messageId, threadId);
    }
  } catch (err) {
    console.error('[webhook] Unexpected error processing Pub/Sub notification:', err);
  }
});

/**
 * Process a single new inbound message:
 * 1. Skip if already processed
 * 2. Fetch full message + thread
 * 3. Generate Claude draft
 * 4. Save Gmail draft + DB record
 * 5. Push notification to iOS
 */
async function processNewMessage(user, messageId, threadId) {
  try {
    // Idempotency: skip if we've already seen this message
    const existing = getEmailByMessageId(messageId);
    if (existing) {
      console.log(`[webhook] Message ${messageId} already processed, skipping`);
      return;
    }

    // Fetch the full message
    let parsedMsg;
    try {
      parsedMsg = await getMessage(user.id, messageId);
    } catch (err) {
      console.error(`[webhook] Failed to fetch message ${messageId}:`, err.message);
      return;
    }

    // Skip emails we sent ourselves
    if (parsedMsg.labelIds.includes('SENT')) {
      console.log(`[webhook] Skipping sent message ${messageId}`);
      return;
    }

    // Fetch the full thread for context
    let thread;
    try {
      thread = await getThread(user.id, threadId);
    } catch (err) {
      console.warn(`[webhook] Failed to fetch thread ${threadId}, using single message:`, err.message);
      thread = { threadId, messages: [parsedMsg] };
    }

    // Detect product-related questions for context lookup
    const productQuestions = extractProductQuestions(parsedMsg.body || parsedMsg.snippet || '');
    let productContext = '';
    if (productQuestions.length > 0) {
      try {
        const searchQuery = parsedMsg.body || parsedMsg.snippet || '';
        productContext = await searchProductInfo(searchQuery);
      } catch (prodErr) {
        console.warn('[webhook] Product search failed (non-fatal):', prodErr.message);
      }
    }

    // Generate a draft response with Claude
    let draftText;
    try {
      draftText = await generateEmailResponse(thread, productContext);
    } catch (claudeErr) {
      console.error(`[webhook] Claude generation failed for message ${messageId}:`, claudeErr.message);
      draftText = null;
    }

    // Create Gmail draft (if Claude succeeded)
    let gmailDraftId = null;
    if (draftText) {
      try {
        const draft = await createDraft(
          user.id,
          parsedMsg.fromEmail,
          parsedMsg.subject,
          draftText,
          threadId
        );
        gmailDraftId = draft.id;
      } catch (draftErr) {
        console.error(`[webhook] Failed to create Gmail draft for message ${messageId}:`, draftErr.message);
      }
    }

    // Save to DB
    const emailId = uuidv4();
    const status = draftText ? 'draft_ready' : 'pending';

    saveEmail({
      id: emailId,
      user_id: user.id,
      gmail_thread_id: threadId,
      gmail_message_id: messageId,
      subject: parsedMsg.subject,
      from_email: parsedMsg.fromEmail,
      from_name: parsedMsg.fromName,
      snippet: parsedMsg.snippet,
      body: parsedMsg.body,
      received_at: parsedMsg.receivedAt,
      status,
      draft_content: draftText || null,
      gmail_draft_id: gmailDraftId,
    });

    console.log(`[webhook] Saved email ${emailId} (status=${status}) for user ${user.email}`);

    // Send Expo push notification if we have a push token and a draft
    if (user.push_token && draftText) {
      try {
        await sendDraftReadyNotification(
          user.push_token,
          emailId,
          parsedMsg.subject,
          parsedMsg.fromName || parsedMsg.fromEmail
        );
      } catch (pushErr) {
        console.warn(`[webhook] Push notification failed (non-fatal):`, pushErr.message);
      }
    }
  } catch (err) {
    console.error(`[webhook] Failed to process message ${messageId}:`, err);
  }
}

module.exports = router;
