import { HttpException } from '@nestjs/common';
import { VideoService } from './video.service';
import { OpenAiVideoService } from './services/openai-video.service';
import { KieVideoService } from './services/kie-video.service';
import { VideoStorageService } from './services/video-storage.service';

describe('VideoService', () => {
    let service: VideoService;
    let openAiService: jest.Mocked<OpenAiVideoService>;
    let kieService: jest.Mocked<KieVideoService>;
    let storageService: jest.Mocked<VideoStorageService>;

    beforeEach(() => {
        openAiService = {
            createVideo: jest.fn(),
            pollForCompletion: jest.fn(),
            streamVideoToBucket: jest.fn(),
        } as any;

        kieService = {
            createVideo: jest.fn(),
            pollForCompletion: jest.fn(),
            downloadToBucket: jest.fn(),
        } as any;

        storageService = {
            uploadImage: jest.fn(),
            saveVideo: jest.fn(),
        } as any;

        service = new VideoService(openAiService, kieService, storageService);
    });

    describe('generateVideo', () => {
        it('should generate a video without an image', async () => {
            const mockVideo = {
                id: 'video_123',
                created_at: 1700000000,
                model: 'sora-2',
                size: '100MB',
                seconds: '4',
            } as any;

            openAiService.createVideo.mockResolvedValue(mockVideo);
            openAiService.pollForCompletion.mockResolvedValue({ status: 'completed' });
            openAiService.streamVideoToBucket.mockResolvedValue('https://storage.googleapis.com/bucket/video.mp4');

            const result = await service.generateVideo('test prompt');

            expect(result).toMatchObject({
                videoId: 'video_123',
                status: 'completed',
                createdAt: mockVideo.created_at,
                downloadUrl: 'https://storage.googleapis.com/bucket/video.mp4',
                model: 'sora-2',
                size: '100MB',
                seconds: '4',
            });
            expect(storageService.uploadImage).not.toHaveBeenCalled();
        });

        it('should upload the image when provided', async () => {
            const mockVideo = {
                id: 'video_456',
                created_at: 1700000001,
                model: 'sora-2',
                size: '50MB',
                seconds: '4',
            } as any;

            openAiService.createVideo.mockResolvedValue(mockVideo);
            openAiService.pollForCompletion.mockResolvedValue({ status: 'completed' });
            openAiService.streamVideoToBucket.mockResolvedValue('https://url');
            storageService.uploadImage.mockResolvedValue('https://image');

            const image = { originalname: 'image.png' } as Express.Multer.File;

            await service.generateVideo('prompt', image);

            expect(storageService.uploadImage).toHaveBeenCalledWith(image);
        });

        it('should throw when polling ends with failure', async () => {
            const mockVideo = {
                id: 'video_789',
                created_at: 1700000002,
                model: 'sora-2',
                size: '70MB',
                seconds: '6',
            } as any;

            openAiService.createVideo.mockResolvedValue(mockVideo);
            openAiService.pollForCompletion.mockResolvedValue({
                status: 'failed',
                error: { message: 'boom' },
            });

            await expect(service.generateVideo('prompt')).rejects.toBeInstanceOf(HttpException);
        });
    });

    describe('generateVideoWithKie', () => {
        it('should generate a video with Kie', async () => {
            storageService.uploadImage.mockResolvedValue('https://image');
            kieService.createVideo.mockResolvedValue('task-123');
            kieService.pollForCompletion.mockResolvedValue({
                status: 'completed',
                videoUrls: ['https://remote/video.mp4'],
            });
            kieService.downloadToBucket.mockResolvedValue('https://storage.googleapis.com/bucket/kie.mp4');

            const image = { originalname: 'image.png' } as Express.Multer.File;

            const result = await service.generateVideoWithKie('prompt', image);

            expect(storageService.uploadImage).toHaveBeenCalledWith(image);
            expect(kieService.createVideo).toHaveBeenCalledWith('prompt', ['https://image']);
            expect(kieService.downloadToBucket).toHaveBeenCalledWith('https://remote/video.mp4', 'task-123');
            expect(result).toMatchObject({
                videoId: 'task-123',
                status: 'completed',
                downloadUrl: 'https://storage.googleapis.com/bucket/kie.mp4',
            });
        });

        it('should throw when polling ends with failure', async () => {
            kieService.createVideo.mockResolvedValue('task-321');
            kieService.pollForCompletion.mockResolvedValue({
                status: 'failed',
                error: 'failed',
            });

            await expect(service.generateVideoWithKie('prompt')).rejects.toBeInstanceOf(HttpException);
        });

        it('should throw when video URL is missing', async () => {
            kieService.createVideo.mockResolvedValue('task-999');
            kieService.pollForCompletion.mockResolvedValue({
                status: 'completed',
                videoUrls: [],
            });

            await expect(service.generateVideoWithKie('prompt')).rejects.toBeInstanceOf(HttpException);
        });
    });
});
