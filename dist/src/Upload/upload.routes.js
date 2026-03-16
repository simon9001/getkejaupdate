import { Hono } from 'hono';
import { uploadController } from './upload.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
const uploadRouter = new Hono();
// POST /api/upload/images  — requires auth, accepts multipart form
uploadRouter.post('/images', authenticate, (c) => uploadController.uploadPropertyImages(c));
export { uploadRouter };
