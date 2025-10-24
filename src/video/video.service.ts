import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { promises as fs } from 'fs';
import { join } from 'path';

export interface VideoGenerationResult {
  videoId: string;
  status: string;
  createdAt: number;
  model: string;
  size: string;
  seconds: string;
}

@Injectable()
export class VideoService {
  private readonly logger = new Logger(VideoService.name);
  private readonly openai: OpenAI;
  private readonly dataDir: string;

  constructor(private configService: ConfigService) {
    this.openai = new OpenAI({
      apiKey: this.configService.get<string>('OPENAI_API_KEY'),
    });
    this.dataDir = join(process.cwd(), 'data');
  }

  async generateVideo(prompt: string): Promise<VideoGenerationResult> {
    try {
      this.logger.log(`Starting video generation for prompt: "${prompt}"`);
      
      // Create video with OpenAI
      const video = await this.openai.videos.create({
        model: 'sora-2',
        prompt: prompt,
      });

      this.logger.log(`Video created with ID: ${video.id}, status: ${video.status}`);

      // Poll for completion with timeout
      const maxWaitTime = 5 * 60 * 1000; // 5 minutes
      const pollInterval = 2000; // 2 seconds
      const startTime = Date.now();

      while (Date.now() - startTime < maxWaitTime) {
        const videoStatus = await this.openai.videos.retrieve(video.id);
        
        this.logger.log(`Video ${video.id} status: ${videoStatus.status}, progress: ${videoStatus.progress}%`);

        if (videoStatus.status === 'completed') {
          // Download and save video
          const filePath = await this.downloadAndSaveVideo(video.id);
          
          this.logger.log(`Video ${video.id} completed and saved to: ${filePath}`);
        
          const payload: VideoGenerationResult = {
            videoId: video.id,
            status: videoStatus.status,
            createdAt: video.created_at,
            model: video.model,
            size: video.size,
            seconds: video.seconds,
          };

          return payload;
        }

        if (videoStatus.status === 'failed') {
          this.logger.error(`Video generation failed for ID: ${video.id}`);
          throw new HttpException(
            'Video generation failed',
            HttpStatus.INTERNAL_SERVER_ERROR,
          );
        }

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }

      // Timeout reached
      this.logger.error(`Video generation timeout for ID: ${video.id}`);
      throw new HttpException(
        'Video generation timeout - please try again',
        HttpStatus.REQUEST_TIMEOUT,
      );

    } catch (error) {
      this.logger.error(`Error in video generation: ${error.message}`);
      
      if (error instanceof HttpException) {
        throw error;
      }
      
      throw new HttpException(
        'Failed to generate video',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private async downloadAndSaveVideo(videoId: string): Promise<string> {
    try {
      // Ensure data directory exists
      await fs.mkdir(this.dataDir, { recursive: true });

      // Download video content
      const content = await this.openai.videos.downloadContent(videoId);
      const buffer = Buffer.from(await content.arrayBuffer());

      // Save to file
      const fileName = `${videoId}.mp4`;
      const filePath = join(this.dataDir, fileName);
      await fs.writeFile(filePath, buffer);

      return filePath;
    } catch (error) {
      this.logger.error(`Error downloading video ${videoId}: ${error.message}`);
      throw new HttpException(
        'Failed to download video',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
