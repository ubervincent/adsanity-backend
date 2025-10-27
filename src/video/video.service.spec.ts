import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { VideoService } from './video.service';
import OpenAI from 'openai';

jest.mock('openai');

describe('pollForVideoCompletion', () => {
    let service: VideoService;
    let mockConfigService: jest.Mocked<ConfigService>;
    let mockOpenAI: jest.Mocked<OpenAI>;

  beforeEach(() => {
    mockConfigService = {
        get: jest.fn((key: string) => {
            const config = {
                OPENAI_API_KEY: 'test',
                GCP_STORAGE_BUCKET_NAME: 'test',
                GCP_PROJECT_ID: 'test',
                GCP_CREDENTIALS: './credentials/key.json',
            };
            return config[key];
        }),
    } as any;

    mockOpenAI = {
        videos: {
            retrieve: jest.fn(),
        },
    } as any;

    service = new VideoService(mockConfigService);

    (service as any).openai = mockOpenAI;
  });

  it('should poll for video completion', async () => {

    (mockOpenAI.videos.retrieve as jest.Mock).mockResolvedValue({
      status: 'completed',
      progress: 100,
    });

    const result = await service['pollForVideoCompletion']('video_68fc1c944cc48198852699ce1caaa42105761222ce0f1270', 60000, 1000);

    expect(result).toMatchObject({
      status: 'completed',
      progress: 100,
    });
  });

  it('should return the failed status if the video generation fails', async () => {
    (mockOpenAI.videos.retrieve as jest.Mock).mockResolvedValue({
      status: 'failed',
    });

    const result = await service['pollForVideoCompletion']('video_68fc1c944cc48198852699ce1caaa42105761222ce0f1270', 60000, 1000);

    expect(result).toMatchObject({
      status: 'failed',
    });
  });

  it('should run for a retrieve 3 times before throwing an error', async () => {
    (mockOpenAI.videos.retrieve as jest.Mock).mockResolvedValue({
      status: 'in_progress',
      progress: 50,
    });
  
    const promise = service['pollForVideoCompletion']('video_123', 3000, 1000);
        
    await expect(promise).rejects.toThrow('Video generation timeout - please try again');
    
    expect(mockOpenAI.videos.retrieve).toHaveBeenCalledTimes(3);
  });
});

describe('generateVideo', () => {
  let service: VideoService;
  let mockConfigService: jest.Mocked<ConfigService>

  beforeEach(() => {
    mockConfigService = {
      get: jest.fn((key: string) => {
          const config = {
              OPENAI_API_KEY: 'test',
              GCP_STORAGE_BUCKET_NAME: 'test',
              GCP_PROJECT_ID: 'test',
              GCP_CREDENTIALS: './credentials/key.json',
          };
          return config[key];
      }),
  } as any;

    service = new VideoService(mockConfigService);
  })

  it('should generate a video without an image', async () => {
    const mockVideo = {
      id: 'video_123',
      created_at: new Date(),
      model: 'sora-2',
      size: '100MB',
      seconds: '4',
    } as any;

    const mockPollResult = { status: 'completed' };
    const mockDownloadUrl = 'https://storage.googleapis.com/bucket/video.mp4';
    
    jest.spyOn(service as any, 'createVideoWithOpenAI').mockResolvedValue(mockVideo);
    jest.spyOn(service as any, 'pollForVideoCompletion').mockResolvedValue(mockPollResult);
    jest.spyOn(service as any, 'streamVideoToBucket').mockResolvedValue(mockDownloadUrl);

    const result = await service.generateVideo('test prompt');

    expect(result).toMatchObject({
      videoId: 'video_123',
      status: 'completed',
      createdAt: mockVideo.created_at,
      downloadUrl: mockDownloadUrl,
      model: mockVideo.model,
      size: mockVideo.size,
      seconds: mockVideo.seconds,
    });
  });
});