import { Hono } from 'hono';
import { UsersService, usersService } from './users.service.js';
import { UsersController } from './users.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
const usersRouter = new Hono();
const usersController = new UsersController(usersService);
// All user management routes require authentication
usersRouter.use('*', authenticate);
// Middleware to check for administrative roles (admin or verifier)
const authorizeAdmin = async (c, next) => {
    const user = c.get('user');
    const roles = (user?.roles || []);
    if (!roles.includes('admin') && !roles.includes('verifier')) {
        return c.json({ error: 'Unauthorized: Admin or Verifier role required' }, 403);
    }
    await next();
};
usersRouter.get('/', authorizeAdmin, (c) => usersController.getAllUsers(c));
usersRouter.patch('/:id/role', authorizeAdmin, (c) => usersController.updateUserRole(c));
usersRouter.patch('/:id/status', authorizeAdmin, (c) => usersController.updateUserStatus(c));
export { usersRouter };
