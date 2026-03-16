// backend/src/cron/cleanup.cron.ts
// This would be triggered by your cron service (e.g., GitHub Actions, AWS Lambda, etc.)
import { cleanupService } from '../services/cleanup.service.js';
export async function scheduledCleanup() {
    console.log('🕐 Running scheduled cleanup job...');
    try {
        // First send reminders to 12-hour old users
        await cleanupService.sendReminderEmails();
        // Then delete 24-hour old unverified users
        await cleanupService.deleteUnverifiedUsers();
        console.log('✅ Scheduled cleanup completed');
    }
    catch (error) {
        console.error('❌ Scheduled cleanup failed:', error);
    }
}
// Export for different cron triggers
export const handler = scheduledCleanup;
