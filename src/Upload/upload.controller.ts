import type { Context } from 'hono';
import { cloudinaryService } from '../services/cloudinary.service.js';
import { logger } from '../utils/logger.js';

export class UploadController {
    /**
     * Upload one or more property images
     * Accepts multipart/form-data with field name "images"
     */
    async uploadPropertyImages(c: Context) {
        try {
            const user = c.get('user');
            if (!user) {
                return c.json({ message: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
            }

            const body = await c.req.parseBody({ all: true });
            const rawFiles = body['images'];

            // Normalise to array
            const files: File[] = Array.isArray(rawFiles)
                ? (rawFiles as File[])
                : rawFiles
                    ? [rawFiles as File]
                    : [];

            if (files.length === 0) {
                return c.json({ message: 'No images provided', code: 'NO_FILES' }, 400);
            }

            // 10 MB max per file
            const MAX_SIZE = 10 * 1024 * 1024;
            const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/avif'];

            const results: { url: string; public_id: string }[] = [];

            for (const file of files) {
                if (!ALLOWED_TYPES.includes(file.type)) {
                    return c.json({
                        message: `Invalid file type: ${file.type}. Allowed: jpg, png, webp`,
                        code: 'INVALID_FILE_TYPE',
                    }, 400);
                }

                if (file.size > MAX_SIZE) {
                    return c.json({
                        message: `File too large (max 10MB): ${file.name}`,
                        code: 'FILE_TOO_LARGE',
                    }, 400);
                }

                const arrayBuffer = await file.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);

                const uploaded = await cloudinaryService.uploadImage(buffer, {
                    folder: `getkeja/properties/${user.userId}`,
                });

                results.push({ url: uploaded.secure_url, public_id: uploaded.public_id });
            }

            logger.info({ userId: user.userId, count: results.length }, 'Images uploaded successfully');

            return c.json({
                message: 'Images uploaded successfully',
                code: 'IMAGES_UPLOADED',
                images: results,
            }, 201);

        } catch (error: any) {
            logger.error({ error: error.message }, 'Image upload error');
            return c.json({
                message: error.message || 'Failed to upload images',
                code: 'UPLOAD_FAILED',
            }, 500);
        }
    }
}

export const uploadController = new UploadController();
