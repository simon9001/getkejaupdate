// backend/src/services/cleanup.service.ts
import { supabaseAdmin } from '../utils/supabase.js';
import { emailService } from '../utils/email.service.js';

export class CleanupService {
  /**
   * Delete users who haven't verified their email within 24 hours
   * Also deletes all related records (user_roles, user_tokens, email_verifications)
   */
  async deleteUnverifiedUsers() {
    console.log('🧹 Starting cleanup of unverified users...');

    const cutoffTime = new Date();
    cutoffTime.setHours(cutoffTime.getHours() - 24); // 24 hours ago

    try {
      // First, find users to delete
      const { data: unverifiedUsers, error: fetchError } = await supabaseAdmin
        .from('profiles')
        .select(`
          id,
          email,
          full_name,
          created_at,
          email_verified
        `)
        .eq('email_verified', false)
        .lt('created_at', cutoffTime.toISOString());

      if (fetchError) {
        console.error('Error fetching unverified users:', fetchError);
        return { success: false, error: fetchError };
      }

      if (!unverifiedUsers || unverifiedUsers.length === 0) {
        console.log('✅ No unverified users found to delete');
        return { success: true, deletedCount: 0 };
      }

      console.log(`📊 Found ${unverifiedUsers.length} unverified users to delete`);

      // Log users that will be deleted (for audit purposes)
      console.log('Users to be deleted:', unverifiedUsers.map(u => ({
        id: u.id,
        email: u.email,
        created_at: u.created_at
      })));

      // Delete in a transaction (Supabase doesn't have transactions, so we'll do sequential deletes)
      const deletedIds = [];
      const failedIds = [];

      for (const user of unverifiedUsers) {
        try {
          // Delete in correct order to avoid foreign key violations
          
          // 1. Delete user_tokens
          const { error: tokensError } = await supabaseAdmin
            .from('user_tokens')
            .delete()
            .eq('user_id', user.id);

          if (tokensError) {
            console.error(`Error deleting tokens for user ${user.id}:`, tokensError);
          }

          // 2. Delete email_verifications
          const { error: verificationError } = await supabaseAdmin
            .from('email_verifications')
            .delete()
            .eq('user_id', user.id);

          if (verificationError) {
            console.error(`Error deleting verifications for user ${user.id}:`, verificationError);
          }

          // 3. Delete user_roles
          const { error: rolesError } = await supabaseAdmin
            .from('user_roles')
            .delete()
            .eq('user_id', user.id);

          if (rolesError) {
            console.error(`Error deleting roles for user ${user.id}:`, rolesError);
          }

          // 4. Finally delete the profile
          const { error: profileError } = await supabaseAdmin
            .from('profiles')
            .delete()
            .eq('id', user.id);

          if (profileError) {
            console.error(`Error deleting profile for user ${user.id}:`, profileError);
            failedIds.push(user.id);
          } else {
            deletedIds.push(user.id);
            console.log(`✅ Deleted unverified user: ${user.email} (${user.id})`);
          }
        } catch (error) {
          console.error(`Error during deletion for user ${user.id}:`, error);
          failedIds.push(user.id);
        }
      }

      // Log summary
      console.log('🧹 Cleanup summary:');
      console.log(`   - Total found: ${unverifiedUsers.length}`);
      console.log(`   - Successfully deleted: ${deletedIds.length}`);
      console.log(`   - Failed to delete: ${failedIds.length}`);

      if (failedIds.length > 0) {
        console.log('   - Failed IDs:', failedIds);
      }

      // Optionally: Save to audit table
      await this.logCleanupToAudit(deletedIds, failedIds, unverifiedUsers.length);

      return {
        success: true,
        deletedCount: deletedIds.length,
        failedCount: failedIds.length,
        deletedIds,
        failedIds
      };

    } catch (error) {
      console.error('Error in cleanup service:', error);
      return { success: false, error };
    }
  }

  /**
   * Send reminder emails to users who registered 12 hours ago but haven't verified
   */
  async sendReminderEmails() {
    console.log('📧 Checking for users to send verification reminders...');

    const now = new Date();
    const reminderStartTime = new Date(now.getTime() - 12 * 60 * 60 * 1000); // 12 hours ago
    const reminderEndTime = new Date(reminderStartTime.getTime() - 1 * 60 * 1000); // 12 hours + 1 minute ago

    try {
      // Find users who registered ~12 hours ago and haven't verified
      const { data: usersToRemind, error: fetchError } = await supabaseAdmin
        .from('profiles')
        .select(`
          id,
          email,
          full_name,
          created_at
        `)
        .eq('email_verified', false)
        .gte('created_at', reminderEndTime.toISOString())
        .lte('created_at', reminderStartTime.toISOString());

      if (fetchError) {
        console.error('Error fetching users for reminders:', fetchError);
        return { success: false, error: fetchError };
      }

      if (!usersToRemind || usersToRemind.length === 0) {
        console.log('✅ No users need reminders at this time');
        return { success: true, reminderCount: 0 };
      }

      console.log(`📧 Sending reminders to ${usersToRemind.length} users`);

      let sentCount = 0;
      let failedCount = 0;

      for (const user of usersToRemind) {
        try {
          // Check if there's a valid verification token
          const { data: verification } = await supabaseAdmin
            .from('email_verifications')
            .select('token, expires_at')
            .eq('user_id', user.id)
            .is('verified_at', null)
            .gt('expires_at', now.toISOString())
            .maybeSingle();

          if (verification) {
            // Send reminder email with existing token
            await emailService.sendVerificationReminderEmail(
              user.email,
              user.full_name
            );
            console.log(`✅ Reminder sent to: ${user.email}`);
            sentCount++;
          } else {
            // Generate new token if expired
            console.log(`⚠️ No valid token for ${user.email}, skipping reminder`);
            failedCount++;
          }
        } catch (emailError) {
          console.error(`Error sending reminder to ${user.email}:`, emailError);
          failedCount++;
        }
      }

      console.log(`📧 Reminder summary: Sent: ${sentCount}, Failed: ${failedCount}`);

      return {
        success: true,
        reminderCount: sentCount,
        failedCount
      };

    } catch (error) {
      console.error('Error in reminder service:', error);
      return { success: false, error };
    }
  }

  /**
   * Log cleanup operations to an audit table (optional)
   */
  private async logCleanupToAudit(deletedIds: string[], failedIds: string[], totalFound: number) {
    try {
      // Check if audit table exists, create if not
      await this.ensureAuditTable();

      // Log the cleanup operation
      const { error } = await supabaseAdmin
        .from('cleanup_audit')
        .insert({
          operation: 'delete_unverified_users',
          deleted_count: deletedIds.length,
          failed_count: failedIds.length,
          total_found: totalFound,
          deleted_ids: deletedIds,
          failed_ids: failedIds,
          executed_at: new Date().toISOString()
        });

      if (error) {
        console.error('Error logging to audit table:', error);
      }
    } catch (error) {
      console.error('Error in audit logging:', error);
    }
  }

  /**
   * Ensure audit table exists
   */
  private async ensureAuditTable() {
    const { error } = await supabaseAdmin.rpc('create_cleanup_audit_table_if_not_exists');
    if (error) {
      console.error('Error creating audit table:', error);
    }
  }
}

export const cleanupService = new CleanupService();