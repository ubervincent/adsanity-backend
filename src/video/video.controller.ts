import { Controller, Post, Body, Logger, UploadedFile, UseInterceptors, BadRequestException } from '@nestjs/common';
import { VideoService, VideoGenerationResult } from './video.service';
import { CreateVideoDto } from './dto/create-video.dto';
import { FileInterceptor } from '@nestjs/platform-express';

@Controller('video')
export class VideoController {
  private readonly logger = new Logger(VideoController.name);

  constructor(private readonly videoService: VideoService) {}

  @Post('openai/generate')
  @UseInterceptors(FileInterceptor('image'))
  async generateVideo(
    @Body() createVideoDto: CreateVideoDto, 
    @UploadedFile() image?: Express.Multer.File,
  ): Promise<VideoGenerationResult> {
    this.logger.debug(`Received video generation request with prompt length: "${createVideoDto.prompt.length}" and image: "${image ? "provided": 'none'}"`);
    
      // Validate image size if provided
    if (image) {
      const MAX_IMAGE_SIZE = 30 * 1024 * 1024;
      if (image.size > MAX_IMAGE_SIZE) {
        throw new BadRequestException(`Image file too large. Maximum size is 30MB.`);
      }
    }
    
    const result = await this.videoService.generateVideo(createVideoDto.prompt, image);
    
    this.logger.log(`Video generation completed successfully: ${result.videoId}`);
    
    return result;
  }

  @Post('veo/generate')
  @UseInterceptors(FileInterceptor('image'))
  async generateVideoWithKie(
    @Body() createVideoDto: CreateVideoDto, 
    @UploadedFile() image?: Express.Multer.File,
  ): Promise<VideoGenerationResult> {
    this.logger.debug(`Received Kie video generation request with prompt length: "${createVideoDto.prompt.length}" and image: "${image ? "provided": 'none'}"`);
    
    // Validate image size if provided
    if (image) {
      const MAX_IMAGE_SIZE = 30 * 1024 * 1024;
      if (image.size > MAX_IMAGE_SIZE) {
        throw new BadRequestException(`Image file too large. Maximum size is 30MB.`);
      }
    }
    
    const result = await this.videoService.generateVideoWithKie(createVideoDto.prompt, image);
    
    this.logger.log(`Kie video generation completed successfully: ${result.videoId}`);
    
    return result;
  }
}
