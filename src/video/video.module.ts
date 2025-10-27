import { Module } from '@nestjs/common';
import { VideoController } from './video.controller';
import { VideoService } from './video.service';
import { OpenAiVideoService } from './services/openai-video.service';
import { KieVideoService } from './services/kie-video.service';
import { VideoStorageService } from './services/video-storage.service';

@Module({
  controllers: [VideoController],
  providers: [VideoService, OpenAiVideoService, KieVideoService, VideoStorageService],
})
export class VideoModule {}
