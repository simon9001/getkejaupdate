/**
 * caretaker.controller.ts
 *
 * Caretaker HTTP adapter — validates input, calls caretakerService.
 * Caretakers can:
 *   - View assigned properties/buildings
 *   - Manage tenant requests and complaints
 *   - Track rent collection (if permitted)
 *   - Report maintenance issues
 *   - View upcoming move-ins/move-outs
 *   - Submit daily activity logs
 */

import type { Context } from 'hono';
import { caretakerService } from './caretaker.service.js';
import { logger } from '../utils/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Error mapper
// ─────────────────────────────────────────────────────────────────────────────
function resolveStatus(err: Error): 400 | 403 | 404 | 422 | 500 {
  const msg = err.message.toLowerCase();
  if (msg.includes('not found')) return 404;
  if (msg.includes('forbidden')) return 403;
  if (msg.includes('invalid') || msg.includes('must')) return 400;
  if (msg.includes('cannot')) return 422;
  return 500;
}

function fail(c: Context, err: unknown, code: string) {
  const error = err instanceof Error ? err : new Error(String(err));
  const status = resolveStatus(error);
  logger.error({ requestId: c.get('requestId'), code, message: error.message }, 'caretaker.error');
  return c.json({ message: error.message || 'Request failed', code }, status);
}

// =============================================================================
// CaretakerController
// =============================================================================
export class CaretakerController {

  // ─────────────────────────────────────────────────────────────────────────
  // DASHBOARD OVERVIEW
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/caretaker/dashboard
   * Main dashboard KPI cards for caretaker.
   */
  async getDashboard(c: Context) {
    try {
      const userId = c.get('user').userId;
      const data = await caretakerService.getDashboardStats(userId);
      return c.json({ ...data, code: 'DASHBOARD_FETCHED' });
    } catch (err) { return fail(c, err, 'DASHBOARD_FAILED'); }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ASSIGNED PROPERTIES
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/caretaker/properties
   * List properties/buildings assigned to caretaker.
   */
  async getAssignedProperties(c: Context) {
    try {
      const userId = c.get('user').userId;
      const data = await caretakerService.getAssignedProperties(userId);
      return c.json({ properties: data, code: 'PROPERTIES_FETCHED' });
    } catch (err) { return fail(c, err, 'PROPERTIES_FETCH_FAILED'); }
  }

  /**
   * GET /api/caretaker/properties/:id/units
   * List units in a building or property.
   */
  async getPropertyUnits(c: Context) {
    try {
      const userId = c.get('user').userId;
      const propertyId = c.req.param('id');
      const data = await caretakerService.getPropertyUnits(userId, propertyId);
      return c.json({ units: data, code: 'UNITS_FETCHED' });
    } catch (err) { return fail(c, err, 'UNITS_FETCH_FAILED'); }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TENANT MANAGEMENT
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/caretaker/tenants?property_id=&unit_id=
   * List current tenants in assigned properties.
   */
  async getTenants(c: Context) {
    try {
      const userId = c.get('user').userId;
      const propertyId = c.req.query('property_id');
      const unitId = c.req.query('unit_id');
      const data = await caretakerService.getTenants(userId, propertyId, unitId);
      return c.json({ tenants: data, code: 'TENANTS_FETCHED' });
    } catch (err) { return fail(c, err, 'TENANTS_FETCH_FAILED'); }
  }

  /**
   * GET /api/caretaker/tenants/:tenantId
   * Get specific tenant details.
   */
  async getTenantDetails(c: Context) {
    try {
      const userId = c.get('user').userId;
      const tenantId = c.req.param('tenantId');
      const data = await caretakerService.getTenantDetails(userId, tenantId);
      return c.json({ tenant: data, code: 'TENANT_DETAILS_FETCHED' });
    } catch (err) { return fail(c, err, 'TENANT_DETAILS_FETCH_FAILED'); }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENT COLLECTION (if permitted)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/caretaker/rent/collections?property_id=&month=
   * List rent collections for assigned properties.
   */
  async getRentCollections(c: Context) {
    try {
      const userId = c.get('user').userId;
      const propertyId = c.req.query('property_id');
      const month = c.req.query('month');
      const data = await caretakerService.getRentCollections(userId, propertyId, month);
      return c.json({ collections: data, code: 'RENT_COLLECTIONS_FETCHED' });
    } catch (err) { return fail(c, err, 'RENT_COLLECTIONS_FETCH_FAILED'); }
  }

  /**
   * POST /api/caretaker/rent/record
   * Record rent payment from tenant.
   * Body: { "tenant_id": "uuid", "amount_kes": 25000, "payment_method": "mpesa", "mpesa_ref": "ABC123" }
   */
  async recordRentPayment(c: Context) {
    try {
      const userId = c.get('user').userId;
      const body = await c.req.json();
      const data = await caretakerService.recordRentPayment(userId, body);
      return c.json({ payment: data, code: 'RENT_RECORDED' }, 201);
    } catch (err) { return fail(c, err, 'RENT_RECORD_FAILED'); }
  }

  /**
   * GET /api/caretaker/rent/overview
   * Rent collection overview (paid/pending totals).
   */
  async getRentOverview(c: Context) {
    try {
      const userId = c.get('user').userId;
      const data = await caretakerService.getRentOverview(userId);
      return c.json({ ...data, code: 'RENT_OVERVIEW_FETCHED' });
    } catch (err) { return fail(c, err, 'RENT_OVERVIEW_FAILED'); }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MAINTENANCE REQUESTS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/caretaker/maintenance?status=&property_id=
   * List maintenance requests for assigned properties.
   */
  async getMaintenanceRequests(c: Context) {
    try {
      const userId = c.get('user').userId;
      const status = c.req.query('status');
      const propertyId = c.req.query('property_id');
      const data = await caretakerService.getMaintenanceRequests(userId, status, propertyId);
      return c.json({ requests: data, code: 'MAINTENANCE_FETCHED' });
    } catch (err) { return fail(c, err, 'MAINTENANCE_FETCH_FAILED'); }
  }

  /**
   * POST /api/caretaker/maintenance
   * Create a maintenance request.
   * Body: { "property_id": "uuid", "unit_id": "uuid", "title": "Leaky faucet", "description": "...", "priority": "high" }
   */
  async createMaintenanceRequest(c: Context) {
    try {
      const userId = c.get('user').userId;
      const body = await c.req.json();
      const data = await caretakerService.createMaintenanceRequest(userId, body);
      return c.json({ request: data, code: 'MAINTENANCE_CREATED' }, 201);
    } catch (err) { return fail(c, err, 'MAINTENANCE_CREATE_FAILED'); }
  }

  /**
   * PATCH /api/caretaker/maintenance/:id/status
   * Update maintenance request status.
   * Body: { "status": "in_progress", "notes": "Plumber called" }
   */
  async updateMaintenanceStatus(c: Context) {
    try {
      const userId = c.get('user').userId;
      const requestId = c.req.param('id');
      const { status, notes } = await c.req.json();
      const data = await caretakerService.updateMaintenanceStatus(userId, requestId, status, notes);
      return c.json({ ...data, code: 'MAINTENANCE_STATUS_UPDATED' });
    } catch (err) { return fail(c, err, 'MAINTENANCE_STATUS_UPDATE_FAILED'); }
  }

  /**
   * POST /api/caretaker/maintenance/:id/complete
   * Mark maintenance request as completed.
   * Body: { "resolution_notes": "Fixed leaky faucet", "cost_kes": 1500 }
   */
  async completeMaintenance(c: Context) {
    try {
      const userId = c.get('user').userId;
      const requestId = c.req.param('id');
      const body = await c.req.json();
      const data = await caretakerService.completeMaintenance(userId, requestId, body);
      return c.json({ ...data, code: 'MAINTENANCE_COMPLETED' });
    } catch (err) { return fail(c, err, 'MAINTENANCE_COMPLETE_FAILED'); }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // COMPLAINTS & ISSUES
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/caretaker/complaints?status=&property_id=
   * List tenant complaints.
   */
  async getComplaints(c: Context) {
    try {
      const userId = c.get('user').userId;
      const status = c.req.query('status');
      const propertyId = c.req.query('property_id');
      const data = await caretakerService.getComplaints(userId, status, propertyId);
      return c.json({ complaints: data, code: 'COMPLAINTS_FETCHED' });
    } catch (err) { return fail(c, err, 'COMPLAINTS_FETCH_FAILED'); }
  }

  /**
   * POST /api/caretaker/complaints/:id/resolve
   * Mark a complaint as resolved.
   * Body: { "resolution_notes": "Noise issue resolved" }
   */
  async resolveComplaint(c: Context) {
    try {
      const userId = c.get('user').userId;
      const complaintId = c.req.param('id');
      const { resolution_notes } = await c.req.json();
      const data = await caretakerService.resolveComplaint(userId, complaintId, resolution_notes);
      return c.json({ ...data, code: 'COMPLAINT_RESOLVED' });
    } catch (err) { return fail(c, err, 'COMPLAINT_RESOLVE_FAILED'); }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MOVE-INS & MOVE-OUTS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/caretaker/move-ins?upcoming_days=30
   * List upcoming move-ins for assigned properties.
   */
  async getUpcomingMoveIns(c: Context) {
    try {
      const userId = c.get('user').userId;
      const upcomingDays = Number(c.req.query('upcoming_days')) || 30;
      const data = await caretakerService.getUpcomingMoveIns(userId, upcomingDays);
      return c.json({ move_ins: data, code: 'MOVE_INS_FETCHED' });
    } catch (err) { return fail(c, err, 'MOVE_INS_FETCH_FAILED'); }
  }

  /**
   * GET /api/caretaker/move-outs?upcoming_days=30
   * List upcoming move-outs for assigned properties.
   */
  async getUpcomingMoveOuts(c: Context) {
    try {
      const userId = c.get('user').userId;
      const upcomingDays = Number(c.req.query('upcoming_days')) || 30;
      const data = await caretakerService.getUpcomingMoveOuts(userId, upcomingDays);
      return c.json({ move_outs: data, code: 'MOVE_OUTS_FETCHED' });
    } catch (err) { return fail(c, err, 'MOVE_OUTS_FETCH_FAILED'); }
  }

  /**
   * POST /api/caretaker/move-ins/:bookingId/confirm
   * Confirm a move-in (hand over keys, initial inspection).
   * Body: { "inspection_notes": "Unit clean, all appliances working", "photos": ["url1", "url2"] }
   */
  async confirmMoveIn(c: Context) {
    try {
      const userId = c.get('user').userId;
      const bookingId = c.req.param('bookingId');
      const body = await c.req.json();
      const data = await caretakerService.confirmMoveIn(userId, bookingId, body);
      return c.json({ ...data, code: 'MOVE_IN_CONFIRMED' });
    } catch (err) { return fail(c, err, 'MOVE_IN_CONFIRM_FAILED'); }
  }

  /**
   * POST /api/caretaker/move-outs/:bookingId/confirm
   * Confirm a move-out (final inspection, key return).
   * Body: { "inspection_notes": "Minor paint damage", "damage_deduction_kes": 5000, "photos": ["url1"] }
   */
  async confirmMoveOut(c: Context) {
    try {
      const userId = c.get('user').userId;
      const bookingId = c.req.param('bookingId');
      const body = await c.req.json();
      const data = await caretakerService.confirmMoveOut(userId, bookingId, body);
      return c.json({ ...data, code: 'MOVE_OUT_CONFIRMED' });
    } catch (err) { return fail(c, err, 'MOVE_OUT_CONFIRM_FAILED'); }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DAILY ACTIVITY LOG
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/caretaker/activity-log?date=&property_id=
   * Get activity logs for a specific date/property.
   */
  async getActivityLogs(c: Context) {
    try {
      const userId = c.get('user').userId;
      const date = c.req.query('date');
      const propertyId = c.req.query('property_id');
      const data = await caretakerService.getActivityLogs(userId, date, propertyId);
      return c.json({ logs: data, code: 'ACTIVITY_LOGS_FETCHED' });
    } catch (err) { return fail(c, err, 'ACTIVITY_LOGS_FETCH_FAILED'); }
  }

  /**
   * POST /api/caretaker/activity-log
   * Log daily activities.
   * Body: { "property_id": "uuid", "date": "2024-01-15", "activities": [{"type": "inspection", "notes": "..."}] }
   */
  async createActivityLog(c: Context) {
    try {
      const userId = c.get('user').userId;
      const body = await c.req.json();
      const data = await caretakerService.createActivityLog(userId, body);
      return c.json({ log: data, code: 'ACTIVITY_LOG_CREATED' }, 201);
    } catch (err) { return fail(c, err, 'ACTIVITY_LOG_CREATE_FAILED'); }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // INVENTORY & ASSETS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/caretaker/inventory?property_id=&unit_id=
   * List inventory items for a property/unit.
   */
  async getInventory(c: Context) {
    try {
      const userId = c.get('user').userId;
      const propertyId = c.req.query('property_id');
      const unitId = c.req.query('unit_id');
      const data = await caretakerService.getInventory(userId, propertyId, unitId);
      return c.json({ inventory: data, code: 'INVENTORY_FETCHED' });
    } catch (err) { return fail(c, err, 'INVENTORY_FETCH_FAILED'); }
  }

  /**
   * POST /api/caretaker/inventory
   * Add inventory item.
   * Body: { "property_id": "uuid", "unit_id": "uuid", "item_name": "Refrigerator", "condition": "good", "quantity": 1 }
   */
  async addInventoryItem(c: Context) {
    try {
      const userId = c.get('user').userId;
      const body = await c.req.json();
      const data = await caretakerService.addInventoryItem(userId, body);
      return c.json({ item: data, code: 'INVENTORY_ADDED' }, 201);
    } catch (err) { return fail(c, err, 'INVENTORY_ADD_FAILED'); }
  }

  /**
   * PATCH /api/caretaker/inventory/:itemId
   * Update inventory item status/condition.
   */
  async updateInventoryItem(c: Context) {
    try {
      const userId = c.get('user').userId;
      const itemId = c.req.param('itemId');
      const body = await c.req.json();
      const data = await caretakerService.updateInventoryItem(userId, itemId, body);
      return c.json({ item: data, code: 'INVENTORY_UPDATED' });
    } catch (err) { return fail(c, err, 'INVENTORY_UPDATE_FAILED'); }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // VISITOR MANAGEMENT
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/caretaker/visitors?property_id=&date=
   * List visitor logs.
   */
  async getVisitorLogs(c: Context) {
    try {
      const userId = c.get('user').userId;
      const propertyId = c.req.query('property_id');
      const date = c.req.query('date');
      const data = await caretakerService.getVisitorLogs(userId, propertyId, date);
      return c.json({ visitors: data, code: 'VISITOR_LOGS_FETCHED' });
    } catch (err) { return fail(c, err, 'VISITOR_LOGS_FETCH_FAILED'); }
  }

  /**
   * POST /api/caretaker/visitors
   * Log a visitor.
   * Body: { "property_id": "uuid", "unit_id": "uuid", "visitor_name": "John", "purpose": "guest", "check_in": "2024-01-15T14:00:00Z" }
   */
  async logVisitor(c: Context) {
    try {
      const userId = c.get('user').userId;
      const body = await c.req.json();
      const data = await caretakerService.logVisitor(userId, body);
      return c.json({ visitor: data, code: 'VISITOR_LOGGED' }, 201);
    } catch (err) { return fail(c, err, 'VISITOR_LOG_FAILED'); }
  }

  /**
   * PATCH /api/caretaker/visitors/:visitorId/checkout
   * Record visitor checkout time.
   */
  async visitorCheckout(c: Context) {
    try {
      const userId = c.get('user').userId;
      const visitorId = c.req.param('visitorId');
      const data = await caretakerService.visitorCheckout(userId, visitorId);
      return c.json({ ...data, code: 'VISITOR_CHECKOUT_RECORDED' });
    } catch (err) { return fail(c, err, 'VISITOR_CHECKOUT_FAILED'); }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // UTILITY READINGS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/caretaker/utilities?property_id=&unit_id=&month=
   * List utility readings (water, electricity).
   */
  async getUtilityReadings(c: Context) {
    try {
      const userId = c.get('user').userId;
      const propertyId = c.req.query('property_id');
      const unitId = c.req.query('unit_id');
      const month = c.req.query('month');
      const data = await caretakerService.getUtilityReadings(userId, propertyId, unitId, month);
      return c.json({ readings: data, code: 'UTILITY_READINGS_FETCHED' });
    } catch (err) { return fail(c, err, 'UTILITY_READINGS_FETCH_FAILED'); }
  }

  /**
   * POST /api/caretaker/utilities
   * Submit utility reading.
   * Body: { "property_id": "uuid", "unit_id": "uuid", "utility_type": "water", "reading": 1234, "reading_date": "2024-01-15" }
   */
  async submitUtilityReading(c: Context) {
    try {
      const userId = c.get('user').userId;
      const body = await c.req.json();
      const data = await caretakerService.submitUtilityReading(userId, body);
      return c.json({ reading: data, code: 'UTILITY_READING_SUBMITTED' }, 201);
    } catch (err) { return fail(c, err, 'UTILITY_READING_SUBMIT_FAILED'); }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // NOTIFICATIONS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/caretaker/notifications?unread_only=true
   * Get notifications for caretaker.
   */
  async getNotifications(c: Context) {
    try {
      const userId = c.get('user').userId;
      const unreadOnly = c.req.query('unread_only') === 'true';
      const data = await caretakerService.getNotifications(userId, unreadOnly);
      return c.json({ notifications: data, code: 'NOTIFICATIONS_FETCHED' });
    } catch (err) { return fail(c, err, 'NOTIFICATIONS_FETCH_FAILED'); }
  }

  /**
   * PATCH /api/caretaker/notifications/:id/read
   * Mark notification as read.
   */
  async markNotificationRead(c: Context) {
    try {
      const userId = c.get('user').userId;
      const notificationId = c.req.param('id');
      const data = await caretakerService.markNotificationRead(userId, notificationId);
      return c.json({ ...data, code: 'NOTIFICATION_MARKED_READ' });
    } catch (err) { return fail(c, err, 'NOTIFICATION_READ_FAILED'); }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PROFILE
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/caretaker/profile
   * Get caretaker profile.
   */
  async getProfile(c: Context) {
    try {
      const userId = c.get('user').userId;
      const data = await caretakerService.getProfile(userId);
      return c.json({ profile: data, code: 'PROFILE_FETCHED' });
    } catch (err) { return fail(c, err, 'PROFILE_FETCH_FAILED'); }
  }

  /**
   * PATCH /api/caretaker/profile
   * Update caretaker profile.
   */
  async updateProfile(c: Context) {
    try {
      const userId = c.get('user').userId;
      const body = await c.req.json();
      const data = await caretakerService.updateProfile(userId, body);
      return c.json({ profile: data, code: 'PROFILE_UPDATED' });
    } catch (err) { return fail(c, err, 'PROFILE_UPDATE_FAILED'); }
  }

  /**
   * POST /api/caretaker/profile/verify
   * Submit verification documents.
   */
  async submitVerification(c: Context) {
    try {
      const userId = c.get('user').userId;
      const body = await c.req.json();
      const data = await caretakerService.submitVerification(userId, body);
      return c.json({ ...data, code: 'VERIFICATION_SUBMITTED' });
    } catch (err) { return fail(c, err, 'VERIFICATION_SUBMIT_FAILED'); }
  }
}

export const caretakerController = new CaretakerController();