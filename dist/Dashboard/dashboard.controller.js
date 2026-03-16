import { dashboardService } from './dashboard.service.js';
import { logger } from '../utils/logger.js';
export class DashboardController {
    async getStats(c) {
        try {
            const user = c.get('user');
            if (!user) {
                return c.json({ message: 'Unauthorized' }, 401);
            }
            const role = user.roles[0];
            let stats = {};
            switch (role) {
                case 'admin':
                    stats = await dashboardService.getAdminStats();
                    break;
                case 'verifier':
                    stats = await dashboardService.getVerifierStats();
                    break;
                case 'landlord':
                case 'agent':
                    stats = await dashboardService.getOwnerStats(user.userId);
                    break;
                case 'caretaker':
                    stats = await dashboardService.getCaretakerStats(user.userId);
                    break;
                default:
                    return c.json({ message: 'Invalid role for dashboard' }, 403);
            }
            return c.json(stats);
        }
        catch (error) {
            logger.error({ error: error.message }, 'Get dashboard stats error');
            return c.json({ message: 'Failed to fetch dashboard statistics' }, 500);
        }
    }
}
export const dashboardController = new DashboardController();
