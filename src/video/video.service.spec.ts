import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { VideoService, VideoGenerationResult } from './video.service';


describe('VideoService', () => {
  let service: VideoService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({ isGlobal: true }),
        ],
        providers: [VideoService],
      }).compile();

    service = module.get<VideoService>(VideoService);
  });

  it('should upload video to bucket', async () => {
    const result = await service['streamVideoToBucket']('video_68fc1c944cc48198852699ce1caaa42105761222ce0f1270');

    expect(result).toMatch("https://storage.googleapis.com/adsanity-videos/videos/video_68fc1c944cc48198852699ce1caaa42105761222ce0f1270.mp4");
  }, 60000);

  it('should generate video and return video generation result', async () => {
    const result = await service.generateVideo('A short 3 second video of a cat playing with a ball');

    expect(result).toMatchObject({
      videoId: expect.any(String),
      status: 'completed',
      createdAt: expect.any(Number),
      downloadUrl: expect.any(String),
      model: 'sora-2',
    } as VideoGenerationResult);
  }, 120000);
});