import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage } from '@google-cloud/storage';
import * as path from 'path';

@Injectable()
export class VideoStorageService {
    private static readonly MAX_VIDEO_SIZE = 100 * 1024 * 1024;

    private readonly logger = new Logger(VideoStorageService.name);
    private readonly storage: Storage;
    private readonly bucketName: string;

    constructor(private readonly configService: ConfigService) {
        this.bucketName = this.getRequiredConfig('GCP_STORAGE_BUCKET_NAME');
        const projectId = this.getRequiredConfig('GCP_PROJECT_ID');
        const credentialsPath = this.getRequiredConfig('GCP_CREDENTIALS');

        let gcpCredentials: Record<string, unknown>;
        try {
            gcpCredentials = require(path.resolve(credentialsPath));
        } catch (error: any) {
            throw new Error(
                `Failed to load GCP credentials from ${credentialsPath}: ${error?.message || error}`,
            );
        }

        this.storage = new Storage({
            projectId,
            credentials: gcpCredentials,
        });
    }

    async uploadImage(image: Express.Multer.File): Promise<string> {
        try {
            const fileName = `images/${Date.now()}-${image.originalname}`;
            const bucket = this.storage.bucket(this.bucketName);
            const file = bucket.file(fileName);

            await file.save(image.buffer, {
                metadata: {
                    contentType: image.mimetype,
                    metadata: {
                        uploadedAt: new Date().toISOString(),
                    },
                },
            });

            const imageUrl = `https://storage.googleapis.com/${this.bucketName}/${fileName}`;
            this.logger.log(`Image uploaded to bucket: ${imageUrl}`);

            return imageUrl;
        } catch (error) {
            this.logger.error(`Error uploading image: ${(error as Error).message}`);
            throw new HttpException('Failed to upload image', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    async saveVideo(
        buffer: Buffer,
        fileName: string,
        metadata: Record<string, string> = {},
    ): Promise<string> {
        if (buffer.length > VideoStorageService.MAX_VIDEO_SIZE) {
            throw new HttpException(
                'Video generated is too large. Maximum size is 100MB.',
                HttpStatus.PAYLOAD_TOO_LARGE,
            );
        }

        try {
            const bucket = this.storage.bucket(this.bucketName);
            const file = bucket.file(fileName);

            await file.save(buffer, {
                metadata: {
                    contentType: 'video/mp4',
                    metadata: {
                        uploadedAt: new Date().toISOString(),
                        ...metadata,
                    },
                },
            });

            const videoUrl = `https://storage.googleapis.com/${this.bucketName}/${fileName}`;
            this.logger.log(`Video saved to bucket: ${videoUrl}`);

            return videoUrl;
        } catch (error) {
            this.logger.error(`Error saving video ${fileName}: ${(error as Error).message}`);
            throw new HttpException(
                'Failed to upload video to storage',
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }

    private getRequiredConfig(key: string): string {
        const value = this.configService.get<string>(key);
        if (!value) {
            throw new Error(`Missing required environment variable: ${key}`);
        }
        return value;
    }
}
