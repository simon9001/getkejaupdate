/**
 * chat.service.ts
 *
 * Tables: conversations, messages, message_reports
 *
 * Security rules enforced at service layer:
 *   - A user can only read/send messages in conversations they belong to
 *   - Blocked conversations reject new messages from the blocked party
 *   - Deleted messages return tombstone {"deleted":true} — content wiped
 *   - Media URLs must be Cloudinary URLs (validated at insert)
 *   - Read receipts are only updated by the recipient — never the sender
 */

import { supabaseAdmin } from '../utils/supabase.js';
import { logger }        from '../utils/logger.js';
import type {
  StartConversationInput,
  SendMessageInput,
} from '../types/shared.types.js';

export class ChatService {

  // ─────────────────────────────────────────────────────────────────────────
  // CONVERSATIONS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Start or retrieve a conversation between two users about a property.
   * Idempotent — returns existing conversation if one already exists.
   */
  async startConversation(initiatorId: string, input: StartConversationInput) {
    const { property_id, recipient_id, type, initial_message } = input;

    if (initiatorId === recipient_id) {
      throw new Error('Cannot start a conversation with yourself');
    }

    // Check for existing conversation (either direction)
    const { data: existing } = await supabaseAdmin
      .from('conversations')
      .select('id, is_blocked, blocked_by')
      .eq('property_id', property_id)
      .or(
        `and(participant_a.eq.${initiatorId},participant_b.eq.${recipient_id}),` +
        `and(participant_a.eq.${recipient_id},participant_b.eq.${initiatorId})`,
      )
      .maybeSingle();

    if (existing) {
      if (existing.is_blocked && existing.blocked_by !== initiatorId) {
        throw new Error('This conversation has been blocked');
      }
      // Send the initial message into the existing conversation
      await this.sendMessage(initiatorId, existing.id, { body: initial_message, type: 'text' });
      return this.getConversationById(existing.id, initiatorId);
    }

    // Create new conversation
    const { data: conv, error } = await supabaseAdmin
      .from('conversations')
      .insert({
        property_id,
        type,
        participant_a: initiatorId,
        participant_b: recipient_id,
      })
      .select('id')
      .single();

    if (error) throw new Error(`Failed to start conversation: ${error.message}`);

    // Send first message
    await this.sendMessage(initiatorId, conv.id, { body: initial_message, type: 'text' });

    logger.info({ convId: conv.id, initiatorId, recipientId: recipient_id }, 'conversation.started');
    return this.getConversationById(conv.id, initiatorId);
  }

  /**
   * Get all conversations for a user, ordered by last message time.
   */
  async getMyConversations(userId: string, page = 1, limit = 30) {
    const from = (page - 1) * limit;

    const { data, count, error } = await supabaseAdmin
      .from('conversations')
      .select(`
        id, type, last_message_at, last_message_text,
        unread_a, unread_b, archived_by_a, archived_by_b, is_blocked, created_at,
        participant_a, participant_b,
        properties ( id, title, listing_type,
          property_locations ( county, area ),
          property_media ( url, thumbnail_url, is_cover, sort_order )
        )
      `, { count: 'exact' })
      .or(`participant_a.eq.${userId},participant_b.eq.${userId}`)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .range(from, from + limit - 1);

    if (error) throw new Error(`Failed to fetch conversations: ${error.message}`);

    // Attach unread count from the user's perspective
    const result = (data ?? []).map((c: any) => ({
      ...c,
      unread_count: c.participant_a === userId ? c.unread_a : c.unread_b,
      is_archived:  c.participant_a === userId ? c.archived_by_a : c.archived_by_b,
      other_participant_id: c.participant_a === userId ? c.participant_b : c.participant_a,
    }));

    return { conversations: result, total: count ?? 0, page, limit };
  }

  async getConversationById(convId: string, requestingUserId: string) {
    const { data, error } = await supabaseAdmin
      .from('conversations')
      .select(`
        id, type, participant_a, participant_b,
        last_message_at, unread_a, unread_b, is_blocked, created_at,
        properties ( id, title, listing_type,
          property_locations ( county, area, estate_name )
        )
      `)
      .eq('id', convId)
      .maybeSingle();

    if (error || !data) throw new Error('Conversation not found');
    this._assertParticipant(data, requestingUserId);

    // Mark messages as read
    await this._markRead(convId, requestingUserId, data);

    return data;
  }

  async archiveConversation(convId: string, userId: string) {
    const { data: conv } = await supabaseAdmin
      .from('conversations').select('participant_a, participant_b').eq('id', convId).maybeSingle();
    if (!conv) throw new Error('Conversation not found');
    this._assertParticipant(conv, userId);

    const field = conv.participant_a === userId ? 'archived_by_a' : 'archived_by_b';
    await supabaseAdmin.from('conversations').update({ [field]: true }).eq('id', convId);
    return { success: true };
  }

  async blockConversation(convId: string, userId: string) {
    const { data: conv } = await supabaseAdmin
      .from('conversations').select('participant_a, participant_b').eq('id', convId).maybeSingle();
    if (!conv) throw new Error('Conversation not found');
    this._assertParticipant(conv, userId);

    await supabaseAdmin
      .from('conversations')
      .update({ is_blocked: true, blocked_by: userId })
      .eq('id', convId);
    return { success: true };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MESSAGES
  // ─────────────────────────────────────────────────────────────────────────

  async sendMessage(senderId: string, convId: string, input: SendMessageInput) {
    // Verify sender is a participant
    const { data: conv } = await supabaseAdmin
      .from('conversations')
      .select('participant_a, participant_b, is_blocked, blocked_by')
      .eq('id', convId)
      .maybeSingle();

    if (!conv) throw new Error('Conversation not found');
    this._assertParticipant(conv, senderId);

    if (conv.is_blocked && conv.blocked_by !== senderId) {
      throw new Error('This conversation has been blocked');
    }

    // Validate Cloudinary URL for media
    if (input.media_url && !input.media_url.includes('res.cloudinary.com')) {
      throw new Error('media_url must be a Cloudinary URL');
    }

    const { data: message, error } = await supabaseAdmin
      .from('messages')
      .insert({
        conversation_id: convId,
        sender_id:       senderId,
        type:            input.type,
        body:            input.body           ?? null,
        media_url:       input.media_url      ?? null,
        media_mime_type: input.media_mime_type ?? null,
        media_filename:  input.media_filename  ?? null,
        reply_to_id:     input.reply_to_id    ?? null,
        metadata:        input.metadata       ?? null,
      })
      .select('id, type, body, media_url, created_at, sender_id')
      .single();

    if (error) throw new Error(`Failed to send message: ${error.message}`);
    return message;
  }

  /**
   * Get messages in a conversation (paginated, newest first).
   */
  async getMessages(convId: string, userId: string, page = 1, limit = 50) {
    const { data: conv } = await supabaseAdmin
      .from('conversations')
      .select('participant_a, participant_b')
      .eq('id', convId)
      .maybeSingle();

    if (!conv) throw new Error('Conversation not found');
    this._assertParticipant(conv, userId);

    const from = (page - 1) * limit;

    const { data, count, error } = await supabaseAdmin
      .from('messages')
      .select(`
        id, sender_id, type, body, media_url, media_mime_type, media_filename,
        read_by_recipient, read_at, is_deleted, edited_at, reply_to_id,
        metadata, created_at
      `, { count: 'exact' })
      .eq('conversation_id', convId)
      .order('created_at', { ascending: false })
      .range(from, from + limit - 1);

    if (error) throw new Error(`Failed to fetch messages: ${error.message}`);

    // Wipe content of deleted messages (tombstone pattern)
    const sanitised = (data ?? []).map((m: any) =>
      m.is_deleted
        ? { id: m.id, sender_id: m.sender_id, is_deleted: true, created_at: m.created_at, type: 'text' }
        : m,
    );

    // Mark unread as read
    await supabaseAdmin
      .from('messages')
      .update({ read_by_recipient: true, read_at: new Date().toISOString() })
      .eq('conversation_id', convId)
      .neq('sender_id', userId)
      .eq('read_by_recipient', false);

    // Reset unread counter for this participant
    const field = conv.participant_a === userId ? 'unread_a' : 'unread_b';
    await supabaseAdmin.from('conversations').update({ [field]: 0 }).eq('id', convId);

    return { messages: sanitised, total: count ?? 0, page, limit };
  }

  /**
   * Soft-delete a message (sender only, within 5 minutes).
   */
  async deleteMessage(messageId: string, senderId: string) {
    const { data: msg } = await supabaseAdmin
      .from('messages')
      .select('sender_id, created_at, is_deleted')
      .eq('id', messageId)
      .maybeSingle();

    if (!msg) throw new Error('Message not found');
    if (msg.sender_id !== senderId) throw new Error('Forbidden: you did not send this message');
    if (msg.is_deleted) throw new Error('Message already deleted');

    const ageMinutes = (Date.now() - new Date(msg.created_at).getTime()) / 60000;
    if (ageMinutes > 5) throw new Error('Messages can only be deleted within 5 minutes of sending');

    await supabaseAdmin
      .from('messages')
      .update({ is_deleted: true, deleted_at: new Date().toISOString(), body: null, media_url: null })
      .eq('id', messageId);

    return { success: true };
  }

  async reportMessage(messageId: string, reportedBy: string, reason: string) {
    const { error } = await supabaseAdmin
      .from('message_reports')
      .upsert({ message_id: messageId, reported_by: reportedBy, reason }, { onConflict: 'message_id,reported_by' });
    if (error) throw new Error(`Failed to report message: ${error.message}`);
    return { success: true };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  private _assertParticipant(conv: any, userId: string) {
    if (conv.participant_a !== userId && conv.participant_b !== userId) {
      throw new Error('Forbidden: you are not part of this conversation');
    }
  }

  private async _markRead(convId: string, userId: string, conv: any) {
    await supabaseAdmin
      .from('messages')
      .update({ read_by_recipient: true, read_at: new Date().toISOString() })
      .eq('conversation_id', convId)
      .neq('sender_id', userId)
      .eq('read_by_recipient', false);

    const field = conv.participant_a === userId ? 'unread_a' : 'unread_b';
    await supabaseAdmin.from('conversations').update({ [field]: 0 }).eq('id', convId);
  }
}

export const chatService = new ChatService();