import { Controller, Post, Body, Logger, UploadedFile, UseInterceptors } from '@nestjs/common';
import { VideoService, VideoGenerationResult } from './video.service';
import { CreateVideoDto } from './dto/create-video.dto';
import { FileInterceptor } from '@nestjs/platform-express';

@Controller()
export class VideoController {
  private readonly logger = new Logger(VideoController.name);

  constructor(private readonly videoService: VideoService) {}

  @Post('/video/generate')
  @UseInterceptors(FileInterceptor('image'))
  async generateVideo(
    @Body() createVideoDto: CreateVideoDto, 
    @UploadedFile() image?: Express.Multer.File,
  ): Promise<VideoGenerationResult> {
    this.logger.debug(`Received video generation request with prompt length: "${createVideoDto.prompt.length}" and image: "${image ? "provided": 'none'}"`);
    
    const result = await this.videoService.generateVideo(createVideoDto.prompt, image);
    
    this.logger.log(`Video generation completed successfully: ${result.videoId}`);
    
    return result;
  }
}
