import { Controller, Post, Body, Logger } from '@nestjs/common';
import { VideoService, VideoGenerationResult } from './video.service';
import { CreateVideoDto } from './dto/create-video.dto';

@Controller()
export class VideoController {
  private readonly logger = new Logger(VideoController.name);

  constructor(private readonly videoService: VideoService) {}

  @Post('/video/generate')
  async generateVideo(@Body() createVideoDto: CreateVideoDto): Promise<VideoGenerationResult> {
    this.logger.log(`Received video generation request with prompt: "${createVideoDto.prompt}"`);
    
    const result = await this.videoService.generateVideo(createVideoDto.prompt);
    
    this.logger.log(`Video generation completed successfully: ${result.videoId}`);
    
    return result;
  }
}
