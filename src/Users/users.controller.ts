import type { Context } from 'hono';
import { UsersService } from './users.service.js';

export class UsersController {
    constructor(private usersService: UsersService) { }

    async getAllUsers(c: Context) {
        try {
            const page = Number(c.req.query('page')) || 1;
            const limit = Number(c.req.query('limit')) || 10;
            const search = c.req.query('search') || '';

            const result = await this.usersService.getAllUsers(page, limit, search);
            return c.json(result);
        } catch (error: any) {
            return c.json({ error: error.message }, 500);
        }
    }

    async updateUserRole(c: Context) {
        try {
            const { id } = c.req.param();
            const { roles } = await c.req.json();

            if (!roles || !Array.isArray(roles)) {
                return c.json({ error: 'Roles must be an array' }, 400);
            }

            const result = await this.usersService.updateUserRole(id, roles);
            return c.json(result);
        } catch (error: any) {
            return c.json({ error: error.message }, 500);
        }
    }

    async updateUserStatus(c: Context) {
        try {
            const { id } = c.req.param();
            const { status } = await c.req.json();

            if (status === undefined) {
                return c.json({ error: 'Status is required' }, 400);
            }

            const result = await this.usersService.updateUserStatus(id, status);
            return c.json(result);
        } catch (error: any) {
            return c.json({ error: error.message }, 500);
        }
    }

    async deleteUser(c: Context) {
        try {
            const { id } = c.req.param();
            const result = await this.usersService.deleteUser(id);
            return c.json(result);
        } catch (error: any) {
            return c.json({ error: error.message }, 500);
        }
    }
}
