import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VideoStorageService } from './video-storage.service';

interface KieStatusResponse {
    code: number;
    msg: string;
    data: {
        successFlag: number;
        response?: {
            resultUrls?: string[];
        };
    };
}

@Injectable()
export class KieVideoService {
    private readonly logger = new Logger(KieVideoService.name);
    private readonly kieApiKey: string;
    private readonly kieVeoUrl: string;
    private readonly kieStatusUrl: string;

    constructor(
        private readonly configService: ConfigService,
        private readonly storageService: VideoStorageService,
    ) {
        this.kieApiKey = this.getRequiredConfig('KIE_API_KEY');
        this.kieVeoUrl = this.getRequiredConfig('KIE_VEO_URL');
        this.kieStatusUrl = this.getRequiredConfig('KIE_STATUS_URL');
    }

    async createVideo(prompt: string, imageUrls: string[] = []): Promise<string> {
        const requestBody = {
            prompt,
            imageUrls: imageUrls.length > 0 ? imageUrls : null,
            model: 'veo3_fast',
            aspect_ratio: '9:16',
        };

        const response = await fetch(this.kieVeoUrl, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.kieApiKey}`,
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

        return result.data.taskId as string;
    }

    async pollForCompletion(taskId: string, maxWaitTime: number, pollInterval: number): Promise<any> {
        const deadline = Date.now() + maxWaitTime;

        while (Date.now() < deadline) {
            try {
                const result = await this.checkStatus(taskId);

                if (!result) {
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
            } catch (error) {
                this.logger.error(`Error checking Kie video status: ${(error as Error).message}`);
                await this.delay(pollInterval);
            }
        }

        this.logger.error(`Kie video generation timeout for ID: ${taskId}`);
        throw new HttpException('Kie video generation timeout - please try again', HttpStatus.REQUEST_TIMEOUT);
    }

    async downloadToBucket(videoUrl: string, taskId: string): Promise<string> {
        try {
            const response = await fetch(videoUrl);
            if (!response.ok) {
                throw new HttpException(
                    `Failed to download video: ${response.statusText}`,
                    HttpStatus.INTERNAL_SERVER_ERROR,
                );
            }

            const buffer = Buffer.from(await response.arrayBuffer());

            return this.storageService.saveVideo(buffer, `videos/kie-${taskId}.mp4`, {
                videoId: taskId,
                source: 'kie-veo3',
            });
        } catch (error) {
            this.logger.error(`Error downloading and uploading Kie video ${taskId}: ${(error as Error).message}`);
            throw new HttpException(
                'Failed to download and upload video from Kie',
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }

    private async checkStatus(taskId: string): Promise<KieStatusResponse | null> {
        try {
            const response = await fetch(`${this.kieStatusUrl}?taskId=${taskId}`, {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${this.kieApiKey}`,
                },
            });

            const result: KieStatusResponse = await response.json();

            if (response.ok && result.code === 200) {
                return result;
            }

            this.logger.error(`Status check failed: ${result?.msg || 'Unknown error'}`);
            return null;
        } catch (error) {
            this.logger.error(`Status check failed: ${(error as Error).message}`);
            return null;
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
