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


    constructor(private readonly configService: ConfigService) {
        const envKeys = [
            'OPENAI_API_KEY',
            'GCP_STORAGE_BUCKET_NAME',
            'GCP_PROJECT_ID',
            'GCP_CREDENTIALS',
            'KIE_API_KEY',
            'KIE_VEO_URL',
            'KIE_STATUS_URL',
        ];

        const config = Object.fromEntries(
            envKeys.map(key => {
                const value = this.configService.get<string>(key);
                if (!value) {
                    throw new Error(`Missing required environment variable: ${key}`);
                }
                return [key, value];
            }),
        ) as Record<string, string>;

        this.openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });
        this.bucketName = config.GCP_STORAGE_BUCKET_NAME;

        let gcpCredentials;
        try {
            gcpCredentials = require(path.resolve(config.GCP_CREDENTIALS));
        } catch (error: any) {
            throw new Error(
                `Failed to load GCP credentials from ${config.GCP_CREDENTIALS}: ${error?.message || error}`,
            );
        }

        this.storage = new Storage({
            projectId: config.GCP_PROJECT_ID,
            credentials: gcpCredentials,
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

            const pollResult = await this.pollForVideoCompletion(video.id, 5 * 60 * 1000, 5000);

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
                this.logger.error(`Error: ${pollResult.error.message || 'Unknown error'}`);
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

    async generateVideoWithKie(prompt: string, image?: Express.Multer.File): Promise<VideoGenerationResult> {
        this.logger.log(`Starting Kie video generation for prompt: "${prompt}" and image: "${image ? image.originalname : 'none'}"`);
        try {
            const taskId = await this.createVideoWithKie(prompt, image);
            this.logger.log(`Kie video task created with ID: ${taskId}`);

            const pollResult = await this.pollForKieVideoCompletion(taskId, 10 * 60 * 1000, 10000);

            if (pollResult.status === 'completed') {
                const downloadUrl = await this.downloadKieVideoToBucket(pollResult.videoUrls[0], taskId);
                this.logger.log(`Kie video ${taskId} completed and saved to: ${downloadUrl}`);

                const payload: VideoGenerationResult = {
                    videoId: taskId,
                    status: pollResult.status,
                    createdAt: Date.now(),
                    downloadUrl: downloadUrl,
                    model: 'veo3_fast',
                    size: 'unknown',
                    seconds: 'unknown',
                };

                return payload;
            }

            if (pollResult.status === 'failed') {
                this.logger.error(`Kie video generation failed for ID: ${taskId}`);
                this.logger.error(`Error: ${pollResult.error || 'Unknown error'}`);
                throw new HttpException('Kie video generation failed', HttpStatus.INTERNAL_SERVER_ERROR);
            }

            // Should never reach here unless timeout logic in pollForKieVideoCompletion fails
            throw new HttpException('Unknown error during Kie video generation', HttpStatus.INTERNAL_SERVER_ERROR);

        } catch (error) {
            this.logger.error(`Error in Kie video generation: ${error.message}`);
            if (error instanceof HttpException) {
                throw error;
            }
            throw new HttpException('Failed to generate video with Kie', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    private async createVideoWithKie(prompt: string, image?: Express.Multer.File): Promise<string> {
        try {
            const kieApiKey = this.configService.get<string>('KIE_API_KEY');
            if (!kieApiKey) {
                throw new HttpException('Kie API key is not set', HttpStatus.INTERNAL_SERVER_ERROR);
            }
            const kieVeoUrl = this.configService.get<string>('KIE_VEO_URL');
            if (!kieVeoUrl) {
                throw new HttpException('Kie video URL is not set', HttpStatus.INTERNAL_SERVER_ERROR);
            }

            let imageUrls: string[] = [];
            if (image) {
                imageUrls.push(await this.uploadImageToBucket(image));
            }

            const requestBody = {
                prompt: prompt,
                imageUrls: imageUrls.length > 0 ? imageUrls : null,
                model: 'veo3_fast',
                aspect_ratio: '9:16',
            };

            const response = await fetch(kieVeoUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${kieApiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
            });

            if (!response.ok) {
                throw new HttpException(`Kie API error: ${response.statusText}`, HttpStatus.INTERNAL_SERVER_ERROR);
            }

            const result = await response.json();
            
            if (result.code !== 200) {
                throw new HttpException(`Kie API error: ${result.msg}`, HttpStatus.INTERNAL_SERVER_ERROR);
            }

            return result.data.taskId;

        } catch (error) {
            this.logger.error(`Error creating video with Kie: ${error.message}`);
            if (error instanceof HttpException) {
                throw error;
            }
            throw new HttpException('Failed to create video with Kie', HttpStatus.INTERNAL_SERVER_ERROR);
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

    private async pollForKieVideoCompletion(
        taskId: string,
        maxWaitTime: number,
        pollInterval: number,
    ): Promise<any> {
        const deadline = Date.now() + maxWaitTime;

        while (Date.now() < deadline) {
            try {
                const result = await this.checkKieVideoStatus(taskId);

                if (result?.code !== 200) {
                    this.logger.error(`Status check failed: ${result?.msg || 'Unknown error'}`);
                    await this.delay(pollInterval);
                    continue;
                }

                const { successFlag, response } = result.data;

                if (successFlag === 0) {
                    this.logger.log(`Kie video ${taskId} generating...`);
                } else if (successFlag === 1) {
                    this.logger.log(`Kie video ${taskId} generation successful!`);
                    this.logger.log(`Video URLs: ${JSON.stringify(response?.resultUrls)}`);
                    return { status: 'completed', videoUrls: response?.resultUrls };
                } else if (successFlag === 2 || successFlag === 3) {
                    this.logger.error(`Kie video ${taskId} generation failed: ${result.msg}`);
                    return { status: 'failed', error: result.msg };
                } else {
                    this.logger.warn(`Unknown successFlag: ${successFlag}`);
                }

                await this.delay(pollInterval);
            } catch (error: any) {
                this.logger.error(`Error checking Kie video status: ${error.message}`);
                await this.delay(pollInterval);
            }
        }

        this.logger.error(`Kie video generation timeout for ID: ${taskId}`);
        throw new HttpException(
            'Kie video generation timeout - please try again',
            HttpStatus.REQUEST_TIMEOUT,
        );
    }

    private async checkKieVideoStatus(taskId: string): Promise<any> {
        const kieApiKey = this.configService.get<string>('KIE_API_KEY');
        const kieStatusUrl = this.configService.get<string>('KIE_STATUS_URL');
        
        if (!kieApiKey) {
            throw new HttpException('Kie API key is not set', HttpStatus.INTERNAL_SERVER_ERROR);
        }
        if (!kieStatusUrl) {
            throw new HttpException('Kie status URL is not set', HttpStatus.INTERNAL_SERVER_ERROR);
        }

        try {
            const response = await fetch(`${kieStatusUrl}?taskId=${taskId}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${kieApiKey}`,
                },
            });
            
            const result = await response.json();
            
            if (response.ok && result.code === 200) {
                return result;
            } else {
                this.logger.error(`Status check failed: ${result.msg || 'Unknown error'}`);
                return null;
            }
        } catch (error) {
            this.logger.error(`Status check failed: ${error.message}`);
            return null;
        }
    }

    private async streamVideoToBucket(videoId: string): Promise<string> {
        try {
            const content = await this.openai.videos.downloadContent(videoId);
            const buffer = Buffer.from(await content.arrayBuffer());

            const MAX_VIDEO_SIZE = 100 * 1024 * 1024;
            if (buffer.length > MAX_VIDEO_SIZE) {
                throw new HttpException(
                    'Video generated is too large. Maximum size is 100MB.',
                    HttpStatus.PAYLOAD_TOO_LARGE,
                );
            }

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

    private async downloadKieVideoToBucket(videoUrl: string, taskId: string): Promise<string> {
        try {
            const response = await fetch(videoUrl);
            if (!response.ok) {
                throw new HttpException(`Failed to download video: ${response.statusText}`, HttpStatus.INTERNAL_SERVER_ERROR);
            }

            const buffer = Buffer.from(await response.arrayBuffer());

            const MAX_VIDEO_SIZE = 100 * 1024 * 1024;
            if (buffer.length > MAX_VIDEO_SIZE) {
                throw new HttpException(
                    'Video generated is too large. Maximum size is 100MB.',
                    HttpStatus.PAYLOAD_TOO_LARGE,
                );
            }

            // Upload to GCP bucket
            const fileName = `videos/kie-${taskId}.mp4`;
            const bucket = this.storage.bucket(this.bucketName);
            const file = bucket.file(fileName);

            await file.save(buffer, {
                metadata: {
                    contentType: 'video/mp4',
                    metadata: {
                        videoId: taskId,
                        uploadedAt: new Date().toISOString(),
                        source: 'kie-veo3'
                    }
                }
            });

            return `https://storage.googleapis.com/${this.bucketName}/${fileName}`;

        } catch (error) {
            this.logger.error(`Error downloading and uploading Kie video ${taskId}: ${error.message}`);
            throw new HttpException(
                'Failed to download and upload video from Kie',
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }

    private async uploadImageToBucket(image: Express.Multer.File): Promise<string> {
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

            const imageUrl = `https://storage.googleapis.com/${this.bucketName}/${fileName}`;
            
            return imageUrl;
    
        } catch (error) {
            this.logger.error(`Error uploading image: ${error.message}`);
            throw new HttpException('Failed to upload image', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
