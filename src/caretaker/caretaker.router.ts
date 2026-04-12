/**
 * caretaker.router.ts
 *
 * Caretaker routes for GETKEJA.
 *
 * All routes require: authenticate + requireCaretakerRole
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ROUTE SUMMARY:
 *
 * DASHBOARD
 *   GET  /api/caretaker/dashboard                    → KPI cards
 *
 * PROPERTIES
 *   GET  /api/caretaker/properties                   → assigned properties
 *   GET  /api/caretaker/properties/:id/units         → property units
 *
 * TENANTS
 *   GET  /api/caretaker/tenants                      → list tenants
 *   GET  /api/caretaker/tenants/:tenantId            → tenant details
 *
 * RENT COLLECTION
 *   GET    /api/caretaker/rent/collections           → rent collections
 *   POST   /api/caretaker/rent/record                → record payment
 *   GET    /api/caretaker/rent/overview              → collection overview
 *
 * MAINTENANCE
 *   GET    /api/caretaker/maintenance                → list requests
 *   POST   /api/caretaker/maintenance                → create request
 *   PATCH  /api/caretaker/maintenance/:id/status     → update status
 *   POST   /api/caretaker/maintenance/:id/complete   → complete request
 *
 * COMPLAINTS
 *   GET    /api/caretaker/complaints                 → list complaints
 *   POST   /api/caretaker/complaints/:id/resolve     → resolve complaint
 *
 * MOVE-INS & MOVE-OUTS
 *   GET    /api/caretaker/move-ins                   → upcoming move-ins
 *   GET    /api/caretaker/move-outs                  → upcoming move-outs
 *   POST   /api/caretaker/move-ins/:bookingId/confirm   → confirm move-in
 *   POST   /api/caretaker/move-outs/:bookingId/confirm  → confirm move-out
 *
 * ACTIVITY LOGS
 *   GET    /api/caretaker/activity-log               → get logs
 *   POST   /api/caretaker/activity-log               → create log
 *
 * INVENTORY
 *   GET    /api/caretaker/inventory                  → list inventory
 *   POST   /api/caretaker/inventory                  → add item
 *   PATCH  /api/caretaker/inventory/:itemId          → update item
 *
 * VISITORS
 *   GET    /api/caretaker/visitors                   → visitor logs
 *   POST   /api/caretaker/visitors                   → log visitor
 *   PATCH  /api/caretaker/visitors/:visitorId/checkout → checkout
 *
 * UTILITIES
 *   GET    /api/caretaker/utilities                  → utility readings
 *   POST   /api/caretaker/utilities                  → submit reading
 *
 * NOTIFICATIONS
 *   GET    /api/caretaker/notifications              → list notifications
 *   PATCH  /api/caretaker/notifications/:id/read     → mark read
 *
 * PROFILE
 *   GET    /api/caretaker/profile                    → get profile
 *   PATCH  /api/caretaker/profile                    → update profile
 *   POST   /api/caretaker/profile/verify             → submit verification
 */

import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { authenticate } from '../middleware/auth.middleware.js';
import { caretakerController } from './caretaker.controller.js';

const caretakerRouter = new Hono();

// ─────────────────────────────────────────────────────────────────────────────
// Guards
// ─────────────────────────────────────────────────────────────────────────────

/** Caretaker role required (caretaker, or super_admin) */
const requireCaretakerRole: MiddlewareHandler = async (c, next) => {
  const roles = (c.get('user')?.roles ?? []) as string[];
  const allowedRoles = ['caretaker', 'super_admin'];
  if (!roles.some(r => allowedRoles.includes(r))) {
    return c.json({ message: 'Forbidden: caretaker access required', code: 'FORBIDDEN' }, 403);
  }
  await next();
};

// Apply auth + caretaker guard to every route
caretakerRouter.use('*', authenticate, requireCaretakerRole);

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────

caretakerRouter.get('/dashboard', (c) => caretakerController.getDashboard(c));

// ─────────────────────────────────────────────────────────────────────────────
// PROPERTIES
// ─────────────────────────────────────────────────────────────────────────────

caretakerRouter.get('/properties', (c) => caretakerController.getAssignedProperties(c));
caretakerRouter.get('/properties/:id/units', (c) => caretakerController.getPropertyUnits(c));

// ─────────────────────────────────────────────────────────────────────────────
// TENANTS
// ─────────────────────────────────────────────────────────────────────────────

caretakerRouter.get('/tenants', (c) => caretakerController.getTenants(c));
caretakerRouter.get('/tenants/:tenantId', (c) => caretakerController.getTenantDetails(c));

// ─────────────────────────────────────────────────────────────────────────────
// RENT COLLECTION
// ─────────────────────────────────────────────────────────────────────────────

caretakerRouter.get('/rent/collections', (c) => caretakerController.getRentCollections(c));
caretakerRouter.post('/rent/record', (c) => caretakerController.recordRentPayment(c));
caretakerRouter.get('/rent/overview', (c) => caretakerController.getRentOverview(c));

// ─────────────────────────────────────────────────────────────────────────────
// MAINTENANCE
// ─────────────────────────────────────────────────────────────────────────────

caretakerRouter.get('/maintenance', (c) => caretakerController.getMaintenanceRequests(c));
caretakerRouter.post('/maintenance', (c) => caretakerController.createMaintenanceRequest(c));
caretakerRouter.patch('/maintenance/:id/status', (c) => caretakerController.updateMaintenanceStatus(c));
caretakerRouter.post('/maintenance/:id/complete', (c) => caretakerController.completeMaintenance(c));

// ─────────────────────────────────────────────────────────────────────────────
// COMPLAINTS
// ─────────────────────────────────────────────────────────────────────────────

caretakerRouter.get('/complaints', (c) => caretakerController.getComplaints(c));
caretakerRouter.post('/complaints/:id/resolve', (c) => caretakerController.resolveComplaint(c));

// ─────────────────────────────────────────────────────────────────────────────
// MOVE-INS & MOVE-OUTS
// ─────────────────────────────────────────────────────────────────────────────

caretakerRouter.get('/move-ins', (c) => caretakerController.getUpcomingMoveIns(c));
caretakerRouter.get('/move-outs', (c) => caretakerController.getUpcomingMoveOuts(c));
caretakerRouter.post('/move-ins/:bookingId/confirm', (c) => caretakerController.confirmMoveIn(c));
caretakerRouter.post('/move-outs/:bookingId/confirm', (c) => caretakerController.confirmMoveOut(c));

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVITY LOGS
// ─────────────────────────────────────────────────────────────────────────────

caretakerRouter.get('/activity-log', (c) => caretakerController.getActivityLogs(c));
caretakerRouter.post('/activity-log', (c) => caretakerController.createActivityLog(c));

// ─────────────────────────────────────────────────────────────────────────────
// INVENTORY
// ─────────────────────────────────────────────────────────────────────────────

caretakerRouter.get('/inventory', (c) => caretakerController.getInventory(c));
caretakerRouter.post('/inventory', (c) => caretakerController.addInventoryItem(c));
caretakerRouter.patch('/inventory/:itemId', (c) => caretakerController.updateInventoryItem(c));

// ─────────────────────────────────────────────────────────────────────────────
// VISITORS
// ─────────────────────────────────────────────────────────────────────────────

caretakerRouter.get('/visitors', (c) => caretakerController.getVisitorLogs(c));
caretakerRouter.post('/visitors', (c) => caretakerController.logVisitor(c));
caretakerRouter.patch('/visitors/:visitorId/checkout', (c) => caretakerController.visitorCheckout(c));

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

caretakerRouter.get('/utilities', (c) => caretakerController.getUtilityReadings(c));
caretakerRouter.post('/utilities', (c) => caretakerController.submitUtilityReading(c));

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICATIONS
// ─────────────────────────────────────────────────────────────────────────────

caretakerRouter.get('/notifications', (c) => caretakerController.getNotifications(c));
caretakerRouter.patch('/notifications/:id/read', (c) => caretakerController.markNotificationRead(c));

// ─────────────────────────────────────────────────────────────────────────────
// PROFILE
// ─────────────────────────────────────────────────────────────────────────────

caretakerRouter.get('/profile', (c) => caretakerController.getProfile(c));
caretakerRouter.patch('/profile', (c) => caretakerController.updateProfile(c));
caretakerRouter.post('/profile/verify', (c) => caretakerController.submitVerification(c));

export { caretakerRouter };