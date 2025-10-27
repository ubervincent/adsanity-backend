import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { VideoStorageService } from './video-storage.service';

@Injectable()
export class OpenAiVideoService {
    private readonly logger = new Logger(OpenAiVideoService.name);
    private readonly openai: OpenAI;

    constructor(
        private readonly configService: ConfigService,
        private readonly storageService: VideoStorageService,
    ) {
        const apiKey = this.getRequiredConfig('OPENAI_API_KEY');
        this.openai = new OpenAI({ apiKey });
    }

    async createVideo(prompt: string, image?: Express.Multer.File) {
        const params: OpenAI.VideoCreateParams = {
            model: 'sora-2',
            seconds: '4',
            prompt,
        };

        if (image) {
            const imageFile = new File([new Uint8Array(image.buffer)], image.originalname, {
                type: image.mimetype,
            });
            this.logger.log(`Image converted to File: ${image.originalname}`);
            params.input_reference = imageFile;
        }

        const video = await this.openai.videos.create(params);
        this.logger.log(`Video created with ID: ${video.id}, status: ${video.status}`);
        return video;
    }

    async pollForCompletion(
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

    async streamVideoToBucket(videoId: string): Promise<string> {
        try {
            const content = await this.openai.videos.downloadContent(videoId);
            const buffer = Buffer.from(await content.arrayBuffer());

            return this.storageService.saveVideo(buffer, `videos/${videoId}.mp4`, {
                videoId,
                source: 'openai-sora',
            });
        } catch (error) {
            this.logger.error(`Error uploading video ${videoId} to GCP: ${(error as Error).message}`);
            throw new HttpException(
                'Failed to upload video to storage',
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }

    private async delay(ms: number): Promise<void> {
        await new Promise(resolve => setTimeout(resolve, ms));
    }

    private getRequiredConfig(key: string): string {
        const value = this.configService.get<string>(key);
        if (!value) {
            throw new Error(`Missing required environment variable: ${key}`);
        }
        return value;
    }
}
