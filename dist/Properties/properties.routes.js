import { Hono } from 'hono';
import { propertiesController } from './properties.controller.js';
import { authenticate, requireRoles } from '../middleware/auth.middleware.js';
const propertiesRouter = new Hono();
// ──────────────────────────────────
// Public routes (specific paths BEFORE /:id wildcard)
// ──────────────────────────────────
// Search routes
propertiesRouter.get('/search/natural', (c) => propertiesController.naturalLanguageSearch(c));
propertiesRouter.get('/search/location', (c) => propertiesController.searchByLocation(c));
// Category-based search
propertiesRouter.get('/category/:category', (c) => propertiesController.searchByCategory(c));
// Properties near landmark
propertiesRouter.get('/near/:landmark', (c) => propertiesController.getPropertiesNearLandmark(c));
// ──────────────────────────────────
// Protected routes (specific paths BEFORE /:id wildcard)
// ──────────────────────────────────
propertiesRouter.get('/my-properties', authenticate, (c) => propertiesController.getMyProperties(c));
// Admin/Verifier routes
propertiesRouter.get('/admin/unverified', authenticate, requireRoles('admin', 'verifier'), (c) => propertiesController.getUnverifiedProperties(c));
propertiesRouter.get('/admin/all', authenticate, requireRoles('admin'), (c) => propertiesController.getAllProperties(c));
propertiesRouter.get('/admin/statistics/categories', authenticate, requireRoles('admin'), (c) => propertiesController.getCategoryStatistics(c));
// ──────────────────────────────────
// Public listing & single property (/:id wildcard LAST among GETs)
// ──────────────────────────────────
propertiesRouter.get('/', (c) => propertiesController.listProperties(c));
propertiesRouter.get('/:id', (c) => propertiesController.getProperty(c));
// ──────────────────────────────────
// Create property
// ──────────────────────────────────
propertiesRouter.post('/', authenticate, requireRoles('landlord', 'agent', 'caretaker'), (c) => propertiesController.createProperty(c));
// ──────────────────────────────────
// Property images
// ──────────────────────────────────
propertiesRouter.post('/:id/images', authenticate, (c) => propertiesController.addPropertyImages(c));
propertiesRouter.delete('/images/:imageId', authenticate, (c) => propertiesController.deletePropertyImage(c));
// ──────────────────────────────────
// Update & Delete property
// ──────────────────────────────────
propertiesRouter.patch('/:id/verify', authenticate, requireRoles('admin', 'verifier'), (c) => propertiesController.verifyProperty(c));
propertiesRouter.patch('/:id/reject', authenticate, requireRoles('admin', 'verifier'), (c) => propertiesController.rejectProperty(c));
propertiesRouter.patch('/:id/boost', authenticate, requireRoles('admin'), (c) => propertiesController.boostProperty(c));
propertiesRouter.patch('/:id/strike', authenticate, requireRoles('admin'), (c) => propertiesController.strikeProperty(c));
propertiesRouter.patch('/:id', authenticate, (c) => propertiesController.updateProperty(c));
propertiesRouter.delete('/:id', authenticate, (c) => propertiesController.deleteProperty(c));
export { propertiesRouter };
