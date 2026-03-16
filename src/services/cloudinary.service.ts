import { v2 as cloudinary } from 'cloudinary';
import { logger } from '../utils/logger.js';
import { env } from '../config/environment.js';

// Configure Cloudinary with server-side credentials (never exposed to frontend)
cloudinary.config({
    cloud_name: env.cloudinary.cloudName,
    api_key: env.cloudinary.apiKey,
    api_secret: env.cloudinary.apiSecret,
    secure: true,
});

export interface UploadResult {
    url: string;
    public_id: string;
    secure_url: string;
    width: number;
    height: number;
    format: string;
    bytes: number;
}

export class CloudinaryService {
    /**
     * Upload an image buffer to Cloudinary
     */
    async uploadImage(
        fileBuffer: Buffer,
        options?: {
            folder?: string;
            public_id?: string;
            transformation?: Record<string, any>[];
        }
    ): Promise<UploadResult> {
        try {
            const uploadOptions: Record<string, any> = {
                folder: options?.folder || 'getkeja/properties',
                resource_type: 'image',
                allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'avif'],
                transformation: options?.transformation || [
                    { quality: 'auto:good' },
                    { fetch_format: 'auto' },
                    { width: 1920, height: 1080, crop: 'limit' },
                ],
            };

            if (options?.public_id) {
                uploadOptions.public_id = options.public_id;
            }

            const result = await new Promise<any>((resolve, reject) => {
                const uploadStream = cloudinary.uploader.upload_stream(
                    uploadOptions,
                    (error, result) => {
                        if (error) return reject(error);
                        resolve(result);
                    }
                );
                uploadStream.end(fileBuffer);
            });

            logger.info(
                { public_id: result.public_id, bytes: result.bytes },
                'Image uploaded to Cloudinary'
            );

            return {
                url: result.secure_url,
                public_id: result.public_id,
                secure_url: result.secure_url,
                width: result.width,
                height: result.height,
                format: result.format,
                bytes: result.bytes,
            };
        } catch (error: any) {
            logger.error({ error: error.message }, 'Cloudinary upload failed');
            throw new Error(`Image upload failed: ${error.message}`);
        }
    }

    /**
     * Delete an image from Cloudinary by public_id
     */
    async deleteImage(publicId: string): Promise<void> {
        try {
            await cloudinary.uploader.destroy(publicId);
            logger.info({ public_id: publicId }, 'Image deleted from Cloudinary');
        } catch (error: any) {
            logger.error({ error: error.message, publicId }, 'Failed to delete image from Cloudinary');
            throw new Error(`Failed to delete image: ${error.message}`);
        }
    }
}

export const cloudinaryService = new CloudinaryService();
