'use strict';

const express = require('express');
const {
  getEmails,
  getEmail,
  updateEmailStatus,
  archiveEmail,
  updateDraftContent,
  markEmailSent,
  saveEmailDraft,
  getFollowUpEmails,
  getUser,
} = require('../db');
const { sendDraft, deleteDraft, createDraft, archiveThread } = require('../services/gmail');

const router = express.Router();

// ─── Auth middleware ───────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const userId = req.session?.userId || req.headers['x-user-id'];
  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const user = getUser(userId);
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }
  req.userId = userId;
  req.user = user;
  next();
}

router.use(requireAuth);

// ─── POST /api/emails/sync ────────────────────────────────────────────────────
// Pull recent inbox messages from Gmail and save them to the local DB

router.post('/sync', async (req, res) => {
  const { v4: uuidv4 } = require('uuid');
  const { listRecentInbox } = require('../services/gmail');
  const { saveEmail, getEmailByMessageId, getEmailsByThreadId } = require('../db');

  try {
    const maxResults = parseInt(req.query.max) || 25;
    const messages = await listRecentInbox(req.userId, maxResults);

    // Group messages by thread — only keep the latest message per thread
    const threadLatest = new Map();
    for (const msg of messages) {
      const existing = threadLatest.get(msg.threadId);
      if (!existing || new Date(msg.receivedAt) > new Date(existing.receivedAt)) {
        threadLatest.set(msg.threadId, msg);
      }
    }

    let imported = 0;
    const { db } = require('../db');
    for (const msg of threadLatest.values()) {
      // Check if we already have this thread
      const existingThread = getEmailsByThreadId(req.userId, msg.threadId);
      if (existingThread.length > 0) {
        // Keep only one record per thread — update the latest and delete duplicates
        const latest = existingThread[existingThread.length - 1]; // last = latest by received_at ASC
        db.prepare(`
          UPDATE emails SET
            subject = ?, from_email = ?, from_name = ?,
            snippet = ?, body = ?, received_at = ?,
            gmail_message_id = ?
          WHERE id = ?
        `).run(msg.subject, msg.fromEmail, msg.fromName,
               msg.snippet, msg.body, msg.receivedAt,
               msg.messageId, latest.id);

        // Delete duplicate rows for this thread
        if (existingThread.length > 1) {
          const dupeIds = existingThread
            .filter(e => e.id !== latest.id)
            .map(e => e.id);
          for (const dupeId of dupeIds) {
            db.prepare('DELETE FROM emails WHERE id = ?').run(dupeId);
          }
        }
        continue;
      }

      saveEmail({
        id: uuidv4(),
        user_id: req.userId,
        gmail_thread_id: msg.threadId,
        gmail_message_id: msg.messageId,
        subject: msg.subject,
        from_email: msg.fromEmail,
        from_name: msg.fromName,
        snippet: msg.snippet,
        body: msg.body,
        received_at: msg.receivedAt,
        status: 'pending',
        draft_content: null,
        gmail_draft_id: null,
      });
      imported++;
    }

    res.json({ success: true, imported, total: threadLatest.size });
  } catch (err) {
    console.error('[emails] Sync error:', err.message);
    res.status(500).json({ error: 'Failed to sync inbox: ' + err.message });
  }
});

// ─── GET /api/emails/followup ──────────────────────────────────────────────────
// Must be before /:id to avoid route collision

router.get('/followup', (req, res) => {
  const hours = parseInt(req.query.hours) || 48;
  try {
    const emails = getFollowUpEmails(req.userId, hours);
    res.json({ emails });
  } catch (err) {
    console.error('[emails] Error fetching follow-up emails:', err);
    res.status(500).json({ error: 'Failed to fetch follow-up emails' });
  }
});

// ─── GET /api/emails ───────────────────────────────────────────────────────────
// List emails with optional status filter and pagination

router.get('/', (req, res) => {
  const { status, limit = '50', offset = '0' } = req.query;

  const validStatuses = ['pending', 'draft_ready', 'sent', 'archived', 'ignored'];
  const statusFilter = validStatuses.includes(status) ? status : null;
  const limitInt = Math.min(Math.max(parseInt(limit) || 50, 1), 200);
  const offsetInt = Math.max(parseInt(offset) || 0, 0);

  try {
    const emails = getEmails(req.userId, statusFilter, limitInt, offsetInt);
    res.json({
      emails,
      limit: limitInt,
      offset: offsetInt,
      status: statusFilter,
    });
  } catch (err) {
    console.error('[emails] Error listing emails:', err);
    res.status(500).json({ error: 'Failed to list emails' });
  }
});

// ─── GET /api/emails/:id ───────────────────────────────────────────────────────
// Get single email with full details

router.get('/:id', (req, res) => {
  try {
    const email = getEmail(req.params.id);
    if (!email) {
      return res.status(404).json({ error: 'Email not found' });
    }
    if (email.user_id !== req.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json({ email });
  } catch (err) {
    console.error('[emails] Error fetching email:', err);
    res.status(500).json({ error: 'Failed to fetch email' });
  }
});

// ─── POST /api/emails/:id/send ─────────────────────────────────────────────────
// Send the draft via Gmail API

router.post('/:id/send', async (req, res) => {
  try {
    const email = getEmail(req.params.id);
    if (!email) {
      return res.status(404).json({ error: 'Email not found' });
    }
    if (email.user_id !== req.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // If there's a draft ID, send through Gmail drafts API
    if (email.gmail_draft_id) {
      // If draft content was updated, we need to recreate the draft first
      if (req.body.draft_content && req.body.draft_content !== email.draft_content) {
        // Delete old draft and create a new one
        try {
          await deleteDraft(req.userId, email.gmail_draft_id);
        } catch (delErr) {
          console.warn('[emails] Could not delete old draft:', delErr.message);
        }
        const newDraft = await createDraft(
          req.userId,
          email.from_email,
          email.subject,
          req.body.draft_content,
          email.gmail_thread_id
        );
        saveEmailDraft(email.id, req.body.draft_content, newDraft.id);
        await sendDraft(req.userId, newDraft.id);
      } else {
        await sendDraft(req.userId, email.gmail_draft_id);
      }
    } else if (email.draft_content) {
      // No draft ID stored — create and immediately send
      const draft = await createDraft(
        req.userId,
        email.from_email,
        email.subject,
        req.body.draft_content || email.draft_content,
        email.gmail_thread_id
      );
      await sendDraft(req.userId, draft.id);
    } else {
      return res.status(400).json({ error: 'No draft content available to send' });
    }

    markEmailSent(email.id);
    res.json({ success: true, status: 'sent' });
  } catch (err) {
    console.error('[emails] Error sending email:', err);
    res.status(500).json({ error: 'Failed to send email: ' + err.message });
  }
});

// ─── POST /api/emails/:id/archive ─────────────────────────────────────────────
// Archive / ignore the email

router.post('/:id/archive', async (req, res) => {
  try {
    const email = getEmail(req.params.id);
    if (!email) {
      return res.status(404).json({ error: 'Email not found' });
    }
    if (email.user_id !== req.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Archive in Gmail as well
    if (email.gmail_thread_id) {
      try {
        await archiveThread(req.userId, email.gmail_thread_id);
      } catch (gmailErr) {
        console.warn('[emails] Gmail archive failed (continuing):', gmailErr.message);
      }
    }

    archiveEmail(email.id);
    res.json({ success: true, status: 'archived' });
  } catch (err) {
    console.error('[emails] Error archiving email:', err);
    res.status(500).json({ error: 'Failed to archive email' });
  }
});

// ─── PUT /api/emails/:id/draft ─────────────────────────────────────────────────
// Update draft content (user edits before sending)

router.put('/:id/draft', async (req, res) => {
  try {
    const email = getEmail(req.params.id);
    if (!email) {
      return res.status(404).json({ error: 'Email not found' });
    }
    if (email.user_id !== req.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { draft_content } = req.body;
    if (!draft_content || typeof draft_content !== 'string') {
      return res.status(400).json({ error: 'draft_content is required' });
    }

    // Update local DB
    updateDraftContent(email.id, draft_content);

    // Sync to Gmail: delete old draft and create a new one
    if (email.gmail_draft_id) {
      try {
        await deleteDraft(req.userId, email.gmail_draft_id);
      } catch (delErr) {
        console.warn('[emails] Could not delete old Gmail draft:', delErr.message);
      }
    }

    const newDraft = await createDraft(
      req.userId,
      email.from_email,
      email.subject,
      draft_content,
      email.gmail_thread_id
    );
    saveEmailDraft(email.id, draft_content, newDraft.id);

    res.json({ success: true, gmail_draft_id: newDraft.id });
  } catch (err) {
    console.error('[emails] Error updating draft:', err);
    res.status(500).json({ error: 'Failed to update draft: ' + err.message });
  }
});

// ─── POST /api/emails/:id/generate-draft ──────────────────────────────────────
// Generate an AI draft reply using Claude

router.post('/:id/generate-draft', async (req, res) => {
  try {
    const email = getEmail(req.params.id);
    if (!email) {
      return res.status(404).json({ error: 'Email not found' });
    }
    if (email.user_id !== req.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { getThread } = require('../services/gmail');
    const { generateEmailResponse } = require('../services/claude');

    // Fetch the full thread from Gmail for context
    let thread;
    try {
      thread = await getThread(req.userId, email.gmail_thread_id);
    } catch (threadErr) {
      // Fall back to just the single email if thread fetch fails
      thread = {
        threadId: email.gmail_thread_id,
        messages: [{
          fromEmail: email.from_email,
          fromName: email.from_name,
          subject: email.subject,
          body: email.body,
          receivedAt: email.received_at,
        }],
      };
    }

    // Build product context from the catalog
    const { PRODUCTS } = require('./welcome');
    const allProducts = [...(PRODUCTS.avologi || []), ...(PRODUCTS.hydrasphere || [])];
    const productContext = allProducts.map(p => {
      const lines = [`${p.brand} — ${p.name}`];
      if (p.description) lines.push(`Description: ${p.description}`);
      if (p.benefits) lines.push(`Benefits: ${p.benefits}`);
      if (p.ingredients) lines.push(`Ingredients: ${p.ingredients}`);
      if (p.howToUse) lines.push(`How to use: ${p.howToUse}`);
      if (p.url) lines.push(`Product page: ${p.url}`);
      return lines.join('\n');
    }).join('\n\n');

    // Add website context
    const websites = JSON.parse(req.user?.websites || '[]');
    let fullContext = productContext;
    if (websites.length > 0) {
      fullContext += '\n\nCOMPANY WEBSITES:\n' + websites.map(w => `- ${w}`).join('\n');
    }

    // Generate the draft with Claude, using the user's company name, products, and websites
    const companyName = req.user?.company_name || '';
    const draftText = await generateEmailResponse(thread, fullContext, companyName);

    if (!draftText) {
      return res.status(500).json({ error: 'AI failed to generate a draft' });
    }

    // Save to DB and create Gmail draft
    const { createDraft: createGmailDraft } = require('../services/gmail');
    let gmailDraftId = null;
    try {
      const draft = await createGmailDraft(
        req.userId,
        email.from_email,
        email.subject,
        draftText,
        email.gmail_thread_id
      );
      gmailDraftId = draft.id;
    } catch (draftErr) {
      console.warn('[emails] Could not create Gmail draft:', draftErr.message);
    }

    saveEmailDraft(email.id, draftText, gmailDraftId);

    res.json({
      success: true,
      draft_content: draftText,
      gmail_draft_id: gmailDraftId,
    });
  } catch (err) {
    console.error('[emails] Error generating draft:', err);
    res.status(500).json({ error: 'Failed to generate draft: ' + err.message });
  }
});

module.exports = router;
