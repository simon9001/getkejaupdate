/**
 * users.controller.ts
 *
 * Handles both self-service (authenticated user managing their own profile)
 * and admin routes (staff / super_admin managing any user).
 */
export class UsersController {
    usersService;
    constructor(usersService) {
        this.usersService = usersService;
    }
    // -------------------------------------------------------------------------
    // GET /users/me
    // -------------------------------------------------------------------------
    async getMyProfile(c) {
        try {
            const user = c.get('user');
            const profile = await this.usersService.getMyProfile(user.userId);
            return c.json({ user: profile, code: 'PROFILE_FETCHED' });
        }
        catch (error) {
            console.error('getMyProfile error:', error);
            return c.json({ message: 'Failed to fetch profile', code: 'SERVER_ERROR' }, 500);
        }
    }
    // -------------------------------------------------------------------------
    // PUT /users/me
    // -------------------------------------------------------------------------
    async updateMyProfile(c) {
        try {
            const user = c.get('user');
            const body = await c.req.json();
            const result = await this.usersService.updateMyProfile(user.userId, body);
            return c.json({ ...result, code: 'PROFILE_UPDATED' });
        }
        catch (error) {
            console.error('updateMyProfile error:', error);
            return c.json({ message: error.message || 'Failed to update profile', code: 'SERVER_ERROR' }, 500);
        }
    }
    // -------------------------------------------------------------------------
    // PUT /users/me/seeker
    // -------------------------------------------------------------------------
    async updateSeekerProfile(c) {
        try {
            const user = c.get('user');
            const body = await c.req.json();
            const result = await this.usersService.upsertSeekerProfile(user.userId, body);
            return c.json({ ...result, code: 'SEEKER_PROFILE_UPDATED' });
        }
        catch (error) {
            console.error('updateSeekerProfile error:', error);
            return c.json({ message: error.message || 'Failed to update seeker profile', code: 'SERVER_ERROR' }, 500);
        }
    }
    // -------------------------------------------------------------------------
    // PUT /users/me/landlord
    // -------------------------------------------------------------------------
    async updateLandlordProfile(c) {
        try {
            const user = c.get('user');
            const body = await c.req.json();
            const result = await this.usersService.upsertLandlordProfile(user.userId, body);
            return c.json({ ...result, code: 'LANDLORD_PROFILE_UPDATED' });
        }
        catch (error) {
            console.error('updateLandlordProfile error:', error);
            return c.json({ message: error.message || 'Failed to update landlord profile', code: 'SERVER_ERROR' }, 500);
        }
    }
    // -------------------------------------------------------------------------
    // PUT /users/me/agent
    // -------------------------------------------------------------------------
    async updateAgentProfile(c) {
        try {
            const user = c.get('user');
            const body = await c.req.json();
            const result = await this.usersService.upsertAgentProfile(user.userId, body);
            return c.json({ ...result, code: 'AGENT_PROFILE_UPDATED' });
        }
        catch (error) {
            console.error('updateAgentProfile error:', error);
            return c.json({ message: error.message || 'Failed to update agent profile', code: 'SERVER_ERROR' }, 500);
        }
    }
    // -------------------------------------------------------------------------
    // PUT /users/me/caretaker
    // -------------------------------------------------------------------------
    async updateCaretakerProfile(c) {
        try {
            const user = c.get('user');
            const body = await c.req.json();
            const result = await this.usersService.upsertCaretakerProfile(user.userId, body);
            return c.json({ ...result, code: 'CARETAKER_PROFILE_UPDATED' });
        }
        catch (error) {
            console.error('updateCaretakerProfile error:', error);
            return c.json({ message: error.message || 'Failed to update caretaker profile', code: 'SERVER_ERROR' }, 500);
        }
    }
    // -------------------------------------------------------------------------
    // PUT /users/me/developer
    // -------------------------------------------------------------------------
    async updateDeveloperProfile(c) {
        try {
            const user = c.get('user');
            const body = await c.req.json();
            const result = await this.usersService.upsertDeveloperProfile(user.userId, body);
            return c.json({ ...result, code: 'DEVELOPER_PROFILE_UPDATED' });
        }
        catch (error) {
            console.error('updateDeveloperProfile error:', error);
            return c.json({ message: error.message || 'Failed to update developer profile', code: 'SERVER_ERROR' }, 500);
        }
    }
    // -------------------------------------------------------------------------
    // GET /users/me/verification
    // Return the user's latest verification request (or null if none).
    // -------------------------------------------------------------------------
    async getMyVerification(c) {
        try {
            const user = c.get('user');
            const verification = await this.usersService.getMyVerification(user.userId);
            return c.json({ verification, code: 'VERIFICATION_FETCHED' });
        }
        catch (error) {
            console.error('getMyVerification error:', error);
            return c.json({ message: 'Failed to fetch verification status', code: 'SERVER_ERROR' }, 500);
        }
    }
    // -------------------------------------------------------------------------
    // POST /users/me/verification
    // Submit an ID / role verification request for staff review.
    // -------------------------------------------------------------------------
    async submitVerification(c) {
        try {
            const user = c.get('user');
            const body = await c.req.json();
            await this.usersService.submitVerification(user.userId, body);
            return c.json({ message: 'Verification request submitted. Our team will review it within 1–2 business days.', code: 'VERIFICATION_SUBMITTED' });
        }
        catch (error) {
            console.error('submitVerification error:', error);
            const isPending = error.message?.includes('pending');
            return c.json({ message: error.message || 'Failed to submit verification', code: isPending ? 'ALREADY_PENDING' : 'SERVER_ERROR' }, isPending ? 409 : 500);
        }
    }
    // -------------------------------------------------------------------------
    // GET /users  (admin)
    // -------------------------------------------------------------------------
    async getAllUsers(c) {
        try {
            const page = Math.max(1, Number(c.req.query('page')) || 1);
            const limit = Math.min(100, Math.max(1, Number(c.req.query('limit')) || 20));
            const search = c.req.query('search') || '';
            const result = await this.usersService.getAllUsers(page, limit, search);
            return c.json({ ...result, code: 'USERS_FETCHED' });
        }
        catch (error) {
            console.error('getAllUsers error:', error);
            return c.json({ message: 'Failed to fetch users', code: 'SERVER_ERROR' }, 500);
        }
    }
    // -------------------------------------------------------------------------
    // GET /users/:id  (admin)
    // -------------------------------------------------------------------------
    async getUserById(c) {
        try {
            const id = c.req.param('id');
            const profile = await this.usersService.getUserById(id);
            return c.json({ user: profile, code: 'USER_FETCHED' });
        }
        catch (error) {
            console.error('getUserById error:', error);
            return c.json({ message: 'User not found', code: 'NOT_FOUND' }, 404);
        }
    }
    // -------------------------------------------------------------------------
    // PATCH /users/:id/status  (admin)
    // Body: { status: 'active' | 'suspended' | 'banned' | 'pending_verify' }
    // -------------------------------------------------------------------------
    async updateUserStatus(c) {
        try {
            const id = c.req.param('id');
            const { status } = await c.req.json();
            if (!status) {
                return c.json({ message: 'status is required', code: 'MISSING_STATUS' }, 400);
            }
            const result = await this.usersService.updateUserStatus(id, status);
            return c.json({ ...result, code: 'STATUS_UPDATED' });
        }
        catch (error) {
            console.error('updateUserStatus error:', error);
            const isValidation = error.message?.includes('Invalid status');
            return c.json({ message: error.message || 'Failed to update status', code: isValidation ? 'INVALID_STATUS' : 'SERVER_ERROR' }, isValidation ? 400 : 500);
        }
    }
    // -------------------------------------------------------------------------
    // PATCH /users/:id/roles  (admin)
    // Body: { assign?: string[], revoke?: string[] }
    // -------------------------------------------------------------------------
    async updateUserRoles(c) {
        try {
            const id = c.req.param('id');
            const body = await c.req.json();
            if (!body.assign && !body.revoke) {
                return c.json({ message: 'Provide at least one of: assign, revoke', code: 'MISSING_DATA' }, 400);
            }
            const result = await this.usersService.updateUserRoles(id, body);
            return c.json({ ...result, code: 'ROLES_UPDATED' });
        }
        catch (error) {
            console.error('updateUserRoles error:', error);
            return c.json({ message: error.message || 'Failed to update roles', code: 'SERVER_ERROR' }, 500);
        }
    }
    // -------------------------------------------------------------------------
    // DELETE /users/:id  (admin — soft delete)
    // -------------------------------------------------------------------------
    async deleteUser(c) {
        try {
            const id = c.req.param('id');
            const actor = c.get('user');
            if (id === actor.userId) {
                return c.json({ message: 'You cannot delete your own account this way', code: 'SELF_DELETE' }, 400);
            }
            const result = await this.usersService.deleteUser(id);
            return c.json({ ...result, code: 'USER_DELETED' });
        }
        catch (error) {
            console.error('deleteUser error:', error);
            return c.json({ message: 'Failed to delete user', code: 'SERVER_ERROR' }, 500);
        }
    }
}
