import { supabase } from '../utils/supabase.js';
import { logger } from '../utils/logger.js';
export class ChatService {
    async getOrCreateConversation(propertyId, guestId, hostId) {
        try {
            // Check if conversation exists
            const { data: existing, error: findError } = await supabase
                .from('conversations')
                .select('*')
                .eq('property_id', propertyId)
                .eq('guest_id', guestId)
                .eq('host_id', hostId)
                .maybeSingle();
            if (findError)
                throw findError;
            if (existing)
                return existing;
            // Create new conversation
            const { data: created, error: createError } = await supabase
                .from('conversations')
                .insert([{ property_id: propertyId, guest_id: guestId, host_id: hostId }])
                .select()
                .single();
            if (createError)
                throw createError;
            return created;
        }
        catch (error) {
            logger.error({ error, propertyId, guestId }, 'Error in getOrCreateConversation');
            throw error;
        }
    }
    async getConversationMessages(conversationId) {
        try {
            const { data, error } = await supabase
                .from('messages')
                .select('*')
                .eq('conversation_id', conversationId)
                .order('created_at', { ascending: true });
            if (error)
                throw error;
            return data;
        }
        catch (error) {
            logger.error({ error, conversationId }, 'Error in getConversationMessages');
            throw error;
        }
    }
    async sendMessage(conversationId, senderId, message) {
        try {
            const { data, error } = await supabase
                .from('messages')
                .insert([{ conversation_id: conversationId, sender_id: senderId, message }])
                .select()
                .single();
            if (error)
                throw error;
            return data;
        }
        catch (error) {
            logger.error({ error, conversationId, senderId }, 'Error in sendMessage');
            throw error;
        }
    }
    async getUserConversations(userId) {
        try {
            const { data, error } = await supabase
                .from('conversations')
                .select(`
                    *,
                    property:properties(id, title),
                    guest:profiles!guest_id(id, full_name, avatar_url),
                    host:profiles!host_id(id, full_name, avatar_url),
                    messages(message, created_at)
                `)
                .or(`guest_id.eq.${userId},host_id.eq.${userId}`)
                .order('created_at', { ascending: false });
            if (error)
                throw error;
            return data;
        }
        catch (error) {
            logger.error({ error, userId }, 'Error in getUserConversations');
            throw error;
        }
    }
    async getUnreadCount(userId) {
        try {
            // This is a simple implementation. A better one would track read/unread status per message/user.
            // For now, let's assume 'sent' means unread if sender is not current user.
            const { data: conversations } = await supabase
                .from('conversations')
                .select('id')
                .or(`guest_id.eq.${userId},host_id.eq.${userId}`);
            if (!conversations || conversations.length === 0)
                return 0;
            const convIds = conversations.map(c => c.id);
            const { count, error } = await supabase
                .from('messages')
                .select('*', { count: 'exact', head: true })
                .in('conversation_id', convIds)
                .neq('sender_id', userId)
                .eq('status', 'sent');
            if (error)
                throw error;
            return count || 0;
        }
        catch (error) {
            logger.error({ error, userId }, 'Error in getUnreadCount');
            return 0;
        }
    }
    async markMessagesAsRead(conversationId, userId) {
        try {
            const { error } = await supabase
                .from('messages')
                .update({ status: 'read' })
                .eq('conversation_id', conversationId)
                .neq('sender_id', userId)
                .eq('status', 'sent');
            if (error)
                throw error;
            return true;
        }
        catch (error) {
            logger.error({ error, conversationId, userId }, 'Error in markMessagesAsRead');
            throw error;
        }
    }
}
export const chatService = new ChatService();
