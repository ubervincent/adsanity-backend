import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage } from '@google-cloud/storage';
import OpenAI from 'openai';
import * as path from 'path';
export interface VideoGenerationResult {
    videoId: string;
    status: string;
    createdAt: number;
    downloadUrl: string;
    model: string;
    size: string;
    seconds: string;
}
@Injectable()
export class VideoService {
    private readonly logger = new Logger(VideoService.name);
    private readonly openai: OpenAI;
    private readonly storage: Storage;
    private readonly bucketName: string;


    constructor(private configService: ConfigService) {
        const requiredEnvVars = [
            'OPENAI_API_KEY',
            'GCP_STORAGE_BUCKET_NAME',
            'GCP_PROJECT_ID',
            'GCP_CREDENTIALS',
        ];

        const configValues = requiredEnvVars.reduce((values, key) => {
            const value = this.configService.get<string>(key);
            if (!value) {
                throw new Error(`Missing required environment variable: ${key}`);
            }
            return { ...values, [key]: value };
        }, {} as Record<string, string>);

        this.openai = new OpenAI({
            apiKey: configValues.OPENAI_API_KEY,
        });

        this.bucketName = configValues.GCP_STORAGE_BUCKET_NAME;

        this.storage = new Storage({
            projectId: configValues.GCP_PROJECT_ID,
            credentials: require(path.resolve(configValues.GCP_CREDENTIALS)),
        });
    }

    async generateVideo(prompt: string, image?: Express.Multer.File): Promise<VideoGenerationResult> {
        this.logger.log(`Starting video generation for prompt: "${prompt}" and image: "${image ? image.originalname : 'none'}"`);
        try {

            let video;
            if (image) {
                await this.uploadImageToBucket(image);
                video = await this.createVideoWithOpenAI(prompt, image);
            } else {
                video = await this.createVideoWithOpenAI(prompt);
            }

            const pollResult = await this.pollForVideoCompletion(video.id, 5 * 60 * 1000, 2000);

            if (pollResult.status === 'completed') {
                const downloadUrl = await this.streamVideoToBucket(video.id);
                this.logger.log(`Video ${video.id} completed and saved to: ${downloadUrl}`);

                const payload: VideoGenerationResult = {
                    videoId: video.id,
                    status: pollResult.status,
                    createdAt: video.created_at,
                    downloadUrl: downloadUrl,
                    model: video.model,
                    size: video.size,
                    seconds: video.seconds,
                };

                return payload;
            }

            if (pollResult.status === 'failed') {
                this.logger.error(`Video generation failed for ID: ${video.id}`);
                this.logger.error(`Error: ${pollResult.error.message}`);
                throw new HttpException('Video generation failed', HttpStatus.INTERNAL_SERVER_ERROR);
            }

            // Should never reach here unless timeout logic in pollForVideoCompletion fails
            throw new HttpException('Unknown error during video generation', HttpStatus.INTERNAL_SERVER_ERROR);

        } catch (error) {
            this.logger.error(`Error in video generation: ${error.message}`);
            if (error instanceof HttpException) {
                throw error;
            }
            throw new HttpException('Failed to generate video', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    private async createVideoWithOpenAI(prompt: string, image?: Express.Multer.File) {
        const params: OpenAI.VideoCreateParams = {
            model: 'sora-2',
            seconds: '4',
            prompt,
        };

        if (image) {
            const imageFile = new File([new Uint8Array(image.buffer)], image.originalname, {
                type: image.mimetype
            });
            this.logger.log(`Image converted to File: ${image.originalname}`);
            params.input_reference = imageFile;
        }

        const video = await this.openai.videos.create(params);
        this.logger.log(`Video created with ID: ${video.id}, status: ${video.status}`);
        return video;
    }

    private async pollForVideoCompletion(
        videoId: string,
        maxWaitTime: number,
        pollInterval: number,
    ): Promise<any> {
        const endTime = Date.now() + maxWaitTime;

        while (Date.now() < endTime) {
            const { status, progress, ...videoStatus } = await this.openai.videos.retrieve(videoId);

            this.logger.log(`Video ${videoId} status: ${status}, progress: ${progress}%`);

            if (status === 'completed' || status === 'failed') {
                return { status, progress, ...videoStatus };
            }

            await this.delay(pollInterval);
        }

        this.logger.error(`Video generation timeout for ID: ${videoId}`);
        throw new HttpException(
            'Video generation timeout - please try again',
            HttpStatus.REQUEST_TIMEOUT,
        );
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private async streamVideoToBucket(videoId: string): Promise<string> {
        try {
            // Get the video content stream from OpenAI
            const content = await this.openai.videos.downloadContent(videoId);
            const buffer = Buffer.from(await content.arrayBuffer());

            // Upload directly to GCP bucket (true streaming)
            const fileName = `videos/${videoId}.mp4`;
            const bucket = this.storage.bucket(this.bucketName);
            const file = bucket.file(fileName);

            // Save buffer to GCP
            await file.save(buffer, {
                metadata: {
                    contentType: 'video/mp4',
                    metadata: {
                        videoId: videoId,
                        uploadedAt: new Date().toISOString(),
                    }
                }
            });

            return `https://storage.googleapis.com/${this.bucketName}/${fileName}`;

        } catch (error) {
            this.logger.error(`Error uploading video ${videoId} to GCP: ${error.message}`);
            throw new HttpException(
                'Failed to upload video to storage',
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }

    private async uploadImageToBucket(image: Express.Multer.File): Promise<void> {
        try {
            const fileName = `images/${Date.now()}-${image.originalname}`;
            const bucket = this.storage.bucket(this.bucketName);
            const file = bucket.file(fileName);
    
            await file.save(image.buffer, {
                metadata: {
                    contentType: image.mimetype,
                    metadata: {
                        uploadedAt: new Date().toISOString(),
                    }
                }
            });
    
        } catch (error) {
            this.logger.error(`Error uploading image: ${error.message}`);
            throw new HttpException('Failed to upload image', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
