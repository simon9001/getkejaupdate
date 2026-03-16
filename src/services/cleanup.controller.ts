// backend/src/controllers/cleanup.controller.ts
import type { Context } from 'hono';
import { cleanupService } from './cleanup.service.js';
import { supabaseAdmin } from '../utils/supabase.js';

export class CleanupController {
  /**
   * Endpoint to trigger cleanup manually (protected, admin only)
   */
  async triggerCleanup(c: Context) {
    try {
      // Check if user is admin (you'll need to add admin check)
      const user = c.get('user');
      if (!user || !user.roles.includes('admin')) {
        return c.json({ 
          message: 'Unauthorized',
          code: 'UNAUTHORIZED'
        }, 403);
      }

      const result = await cleanupService.deleteUnverifiedUsers();
      
      if (result.success) {
        return c.json({
          message: `Cleanup completed. Deleted ${result.deletedCount} unverified users.`,
          code: 'CLEANUP_SUCCESS',
          data: result
        });
      } else {
        return c.json({
          message: 'Cleanup failed',
          code: 'CLEANUP_FAILED',
          error: result.error
        }, 500);
      }
    } catch (error) {
      console.error('Cleanup error:', error);
      return c.json({
        message: 'Cleanup failed',
        code: 'SERVER_ERROR'
      }, 500);
    }
  }

  /**
   * Endpoint to trigger reminder emails manually
   */
  async triggerReminders(c: Context) {
    try {
      const user = c.get('user');
      if (!user || !user.roles.includes('admin')) {
        return c.json({ 
          message: 'Unauthorized',
          code: 'UNAUTHORIZED'
        }, 403);
      }

      const result = await cleanupService.sendReminderEmails();
      
      return c.json({
        message: `Reminders sent to ${result.reminderCount || 0} users`,
        code: 'REMINDERS_SUCCESS',
        data: result
      });
    } catch (error) {
      console.error('Reminder error:', error);
      return c.json({
        message: 'Failed to send reminders',
        code: 'SERVER_ERROR'
      }, 500);
    }
  }

  /**
   * Get cleanup statistics
   */
  async getCleanupStats(c: Context) {
    try {
      const user = c.get('user');
      if (!user || !user.roles.includes('admin')) {
        return c.json({ 
          message: 'Unauthorized',
          code: 'UNAUTHORIZED'
        }, 403);
      }

      // Get count of unverified users older than 24 hours
      const cutoffTime = new Date();
      cutoffTime.setHours(cutoffTime.getHours() - 24);

      const { count, error } = await supabaseAdmin
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('email_verified', false)
        .lt('created_at', cutoffTime.toISOString());

      if (error) {
        return c.json({
          message: 'Failed to get stats',
          code: 'DATABASE_ERROR'
        }, 500);
      }

      return c.json({
        unverifiedCount: count || 0,
        cutoffTime: cutoffTime.toISOString()
      });
    } catch (error) {
      console.error('Stats error:', error);
      return c.json({
        message: 'Failed to get stats',
        code: 'SERVER_ERROR'
      }, 500);
    }
  }
}

export const cleanupController = new CleanupController();