import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { OpenAiVideoService } from './services/openai-video.service';
import { KieVideoService } from './services/kie-video.service';
import { VideoStorageService } from './services/video-storage.service';

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

    constructor(
        private readonly openAiVideoService: OpenAiVideoService,
        private readonly kieVideoService: KieVideoService,
        private readonly videoStorageService: VideoStorageService,
    ) {}

    async generateVideo(prompt: string, image?: Express.Multer.File): Promise<VideoGenerationResult> {
        this.logger.log(`Starting video generation for prompt: "${prompt}" and image: "${image ? image.originalname : 'none'}"`);
        try {
            if (image) {
                await this.videoStorageService.uploadImage(image);
            }

            const video = await this.openAiVideoService.createVideo(prompt, image);

            const pollResult = await this.openAiVideoService.pollForCompletion(
                video.id,
                5 * 60 * 1000,
                5000,
            );

            if (pollResult.status === 'completed') {
                const downloadUrl = await this.openAiVideoService.streamVideoToBucket(video.id);
                this.logger.log(`Video ${video.id} completed and saved to: ${downloadUrl}`);

                return {
                    videoId: video.id,
                    status: pollResult.status,
                    createdAt: video.created_at,
                    downloadUrl,
                    model: video.model,
                    size: video.size,
                    seconds: video.seconds,
                };
            }

            if (pollResult.status === 'failed') {
                this.logger.error(`Video generation failed for ID: ${video.id}`);
                this.logger.error(`Error: ${pollResult.error?.message || 'Unknown error'}`);
                throw new HttpException('Video generation failed', HttpStatus.INTERNAL_SERVER_ERROR);
            }

            throw new HttpException('Unknown error during video generation', HttpStatus.INTERNAL_SERVER_ERROR);
        } catch (error) {
            this.logger.error(`Error in video generation: ${(error as Error).message}`);
            if (error instanceof HttpException) {
                throw error;
            }
            throw new HttpException('Failed to generate video', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    async generateVideoWithKie(prompt: string, image?: Express.Multer.File): Promise<VideoGenerationResult> {
        this.logger.log(`Starting Kie video generation for prompt: "${prompt}" and image: "${image ? image.originalname : 'none'}"`);
        try {
            const imageUrls: string[] = [];
            if (image) {
                imageUrls.push(await this.videoStorageService.uploadImage(image));
            }

            const taskId = await this.kieVideoService.createVideo(prompt, imageUrls);
            this.logger.log(`Kie video task created with ID: ${taskId}`);

            const pollResult = await this.kieVideoService.pollForCompletion(
                taskId,
                10 * 60 * 1000,
                10000,
            );

            if (pollResult.status === 'completed') {
                const [videoUrl] = pollResult.videoUrls || [];
                if (!videoUrl) {
                    throw new HttpException('Kie video URL not available', HttpStatus.INTERNAL_SERVER_ERROR);
                }
                const downloadUrl = await this.kieVideoService.downloadToBucket(videoUrl, taskId);
                this.logger.log(`Kie video ${taskId} completed and saved to: ${downloadUrl}`);

                return {
                    videoId: taskId,
                    status: pollResult.status,
                    createdAt: Date.now(),
                    downloadUrl,
                    model: 'veo3_fast',
                    size: 'unknown',
                    seconds: 'unknown',
                };
            }

            if (pollResult.status === 'failed') {
                this.logger.error(`Kie video generation failed for ID: ${taskId}`);
                this.logger.error(`Error: ${pollResult.error || 'Unknown error'}`);
                throw new HttpException('Kie video generation failed', HttpStatus.INTERNAL_SERVER_ERROR);
            }

            throw new HttpException('Unknown error during Kie video generation', HttpStatus.INTERNAL_SERVER_ERROR);
        } catch (error) {
            this.logger.error(`Error in Kie video generation: ${(error as Error).message}`);
            if (error instanceof HttpException) {
                throw error;
            }
            throw new HttpException('Failed to generate video with Kie', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
