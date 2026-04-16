/**
 * users.router.ts
 *
 * Route layout:
 *
 *  Self-service (any authenticated user):
 *    GET    /users/me                → own full profile
 *    PUT    /users/me                → update base profile fields
 *    PUT    /users/me/seeker         → upsert seeker_profiles
 *    PUT    /users/me/landlord       → upsert landlord_profiles
 *    PUT    /users/me/agent          → upsert agent_profiles
 *    PUT    /users/me/caretaker      → upsert caretaker_profiles
 *    PUT    /users/me/developer      → upsert developer_profiles
 *
 *  Admin (super_admin or staff):
 *    GET    /users                   → paginated list
 *    GET    /users/:id               → single user full profile
 *    PATCH  /users/:id/status        → change account_status
 *    PATCH  /users/:id/roles         → assign / revoke roles
 *    DELETE /users/:id               → soft-delete
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { usersService } from './users.service.js';
import { UsersController } from './users.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
const usersRouter = new Hono();
const usersController = new UsersController(usersService);
// ---------------------------------------------------------------------------
// All routes require a valid JWT
// ---------------------------------------------------------------------------
usersRouter.use('*', authenticate);
// ---------------------------------------------------------------------------
// Role guard — staff or super_admin only
// ---------------------------------------------------------------------------
const authorizeAdmin = async (c, next) => {
    const user = c.get('user');
    const roles = (user?.roles ?? []);
    if (!roles.includes('super_admin') && !roles.includes('staff')) {
        return c.json({ message: 'Forbidden: staff or super_admin role required', code: 'FORBIDDEN' }, 403);
    }
    await next();
};
// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------
const updateBaseProfileSchema = z.object({
    full_name: z.string().min(2).max(150).optional(),
    display_name: z.string().max(80).optional(),
    avatar_url: z.string().url().optional(),
    county: z.string().max(60).optional(),
    whatsapp_number: z.string().regex(/^\+?[\d\s\-()]{7,15}$/).optional(),
    preferred_language: z.string().length(2).optional(),
    notification_prefs: z.object({
        sms: z.boolean().optional(),
        email: z.boolean().optional(),
        push: z.boolean().optional(),
    }).optional(),
}).strict();
const updateSeekerProfileSchema = z.object({
    intent: z.enum(['buying', 'renting_long', 'renting_short']).optional(),
    budget_min: z.number().nonnegative().optional(),
    budget_max: z.number().nonnegative().optional(),
    preferred_counties: z.array(z.string()).optional(),
    preferred_areas: z.array(z.string()).optional(),
    preferred_types: z.array(z.string()).optional(),
    min_bedrooms: z.number().int().min(0).max(20).optional(),
    alert_frequency: z.enum(['instant', 'daily', 'weekly']).optional(),
}).strict();
const updateLandlordProfileSchema = z.object({
    id_type: z.enum(['national_id', 'passport', 'company_reg']).optional(),
    id_number: z.string().max(30).optional(),
    is_company: z.boolean().optional(),
    company_name: z.string().max(200).optional(),
    kra_pin: z.string().max(20).optional(),
}).strict();
const updateAgentProfileSchema = z.object({
    earb_license_no: z.string().max(60).optional(),
    agency_name: z.string().max(200).optional(),
    years_experience: z.number().int().min(0).max(50).optional(),
    specialisations: z.array(z.string()).optional(),
    service_counties: z.array(z.string()).optional(),
    commission_rate_pct: z.number().min(0).max(100).optional(),
}).strict();
const updateCaretakerProfileSchema = z.object({
    lives_on_compound: z.boolean().optional(),
    work_hours: z.string().max(100).optional(),
    emergency_contact: z.string().regex(/^\+?[\d\s\-()]{7,15}$/).optional(),
}).strict();
const updateDeveloperProfileSchema = z.object({
    company_name: z.string().min(2).max(200).optional(),
    company_reg_no: z.string().max(60).optional(),
    kra_pin: z.string().max(20).optional(),
    nca_reg_no: z.string().max(60).optional(),
    years_in_operation: z.number().int().min(0).optional(),
    website_url: z.string().url().optional(),
    logo_url: z.string().url().optional(),
}).strict();
const adminUpdateStatusSchema = z.object({
    status: z.enum(['active', 'suspended', 'banned', 'pending_verify']),
});
const VALID_ROLES = [
    'super_admin', 'staff', 'landlord', 'caretaker',
    'agent', 'developer', 'seeker',
];
const adminUpdateRolesSchema = z.object({
    assign: z.array(z.enum(VALID_ROLES)).optional(),
    revoke: z.array(z.enum(VALID_ROLES)).optional(),
}).refine((v) => v.assign || v.revoke, {
    message: 'Provide at least one of: assign, revoke',
});
// ---------------------------------------------------------------------------
// Self-service routes  (authenticated, no admin required)
// ---------------------------------------------------------------------------
usersRouter.get('/me', (c) => usersController.getMyProfile(c));
usersRouter.put('/me', zValidator('json', updateBaseProfileSchema), (c) => usersController.updateMyProfile(c));
usersRouter.put('/me/seeker', zValidator('json', updateSeekerProfileSchema), (c) => usersController.updateSeekerProfile(c));
usersRouter.put('/me/landlord', zValidator('json', updateLandlordProfileSchema), (c) => usersController.updateLandlordProfile(c));
usersRouter.put('/me/agent', zValidator('json', updateAgentProfileSchema), (c) => usersController.updateAgentProfile(c));
usersRouter.put('/me/caretaker', zValidator('json', updateCaretakerProfileSchema), (c) => usersController.updateCaretakerProfile(c));
usersRouter.put('/me/developer', zValidator('json', updateDeveloperProfileSchema), (c) => usersController.updateDeveloperProfile(c));
const submitVerificationSchema = z.object({
    doc_type: z.enum(['national_id', 'passport', 'company_cert', 'earb_license', 'nca_cert']),
    doc_number: z.string().max(60).optional(),
    front_image: z.string().optional(), // base64 dataUrl or URL
    back_image: z.string().optional(),
    selfie: z.string().optional(),
    company_name: z.string().max(200).optional(),
    kra_pin: z.string().max(20).optional(),
    nca_reg_number: z.string().max(60).optional(),
});
// GET — check own verification status
usersRouter.get('/me/verification', (c) => usersController.getMyVerification(c));
// POST — submit a new verification request
usersRouter.post('/me/verification', zValidator('json', submitVerificationSchema), (c) => usersController.submitVerification(c));
// ---------------------------------------------------------------------------
// Admin routes  (staff / super_admin only)
// ---------------------------------------------------------------------------
usersRouter.get('/', authorizeAdmin, (c) => usersController.getAllUsers(c));
usersRouter.get('/:id', authorizeAdmin, (c) => usersController.getUserById(c));
usersRouter.patch('/:id/status', authorizeAdmin, zValidator('json', adminUpdateStatusSchema), (c) => usersController.updateUserStatus(c));
usersRouter.patch('/:id/roles', authorizeAdmin, zValidator('json', adminUpdateRolesSchema), (c) => usersController.updateUserRoles(c));
usersRouter.delete('/:id', authorizeAdmin, (c) => usersController.deleteUser(c));
export { usersRouter };
