import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { Output, BufferTarget, Mp4OutputFormat } from 'mediabunny';
import { ExportSettings, AnimationFrame, VideoExportProgress, ResolutionConfig } from './types';
import { downloadFile } from './utils';

export class VideoExporter {
  private ffmpeg: FFmpeg | null = null;
  private isFFmpegLoaded = false;
  private supportsWebCodecs = false;

  constructor() {
    this.checkWebCodecsSupport();
  }

  private checkWebCodecsSupport(): void {
    this.supportsWebCodecs = 
      'VideoEncoder' in window && 
      'VideoDecoder' in window &&
      'VideoFrame' in window;
  }

  // Generate click audio using Web Audio API
  private async generateClickAudio(
    frameCount: number,
    frameDuration: number,
    volume: number
  ): Promise<Blob> {
    const audioContext = new AudioContext();
    const sampleRate = audioContext.sampleRate;
    const totalDuration = frameCount * frameDuration;
    const bufferLength = Math.ceil(totalDuration * sampleRate);
    const audioBuffer = audioContext.createBuffer(1, bufferLength, sampleRate);
    const channelData = audioBuffer.getChannelData(0);
    
    // Generate clicks at frame boundaries
    const clickDuration = 0.05; // 50ms per click
    const clickSamples = Math.floor(clickDuration * sampleRate);
    const clickFreq = 1200; // Hz
    
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
      const clickStartTime = frameIndex * frameDuration;
      const clickStartSample = Math.floor(clickStartTime * sampleRate);
      
      // Generate a short click sound (exponentially decaying sine wave)
      for (let i = 0; i < clickSamples && (clickStartSample + i) < bufferLength; i++) {
        const t = i / sampleRate;
        const envelope = Math.exp(-t * 20); // Exponential decay
        const sample = Math.sin(2 * Math.PI * clickFreq * t) * envelope * volume;
        channelData[clickStartSample + i] = sample;
      }
    }
    
    // Convert AudioBuffer to WAV blob
    const wavBlob = await this.audioBufferToWav(audioBuffer);
    audioContext.close();
    
    return wavBlob;
  }
  
  // Convert AudioBuffer to WAV format
  private async audioBufferToWav(audioBuffer: AudioBuffer): Promise<Blob> {
    const numberOfChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;
    
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numberOfChannels * bytesPerSample;
    
    const data = audioBuffer.getChannelData(0);
    const dataLength = data.length * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(buffer);
    
    // WAV header
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // fmt chunk size
    view.setUint16(20, format, true);
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(36, 'data');
    view.setUint32(40, dataLength, true);
    
    // Write audio data
    let offset = 44;
    for (let i = 0; i < data.length; i++) {
      const sample = Math.max(-1, Math.min(1, data[i]));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
    
    return new Blob([buffer], { type: 'audio/wav' });
  }

  async checkWebCodecsCapabilities(): Promise<{
    supported: boolean;
    supportedCodecs: string[];
  }> {
    if (!this.supportsWebCodecs) {
      return { supported: false, supportedCodecs: [] };
    }

    const testCodecs = [
      'avc1.42E01E', // H.264 Baseline
      'avc1.42001E', // H.264 Baseline alternative
      'avc1.640028', // H.264 High
      'vp8',         // VP8
      'vp09.00.10.08' // VP9
    ];

    const supportedCodecs: string[] = [];
    
    for (const codec of testCodecs) {
      try {
        const config = {
          codec,
          width: 640,
          height: 480,
          bitrate: 1_000_000,
          framerate: 30,
        };
        
        const support = await VideoEncoder.isConfigSupported(config);
        if (support.supported) {
          supportedCodecs.push(codec);
        }
      } catch (error) {
        console.log(`Error testing codec ${codec}:`, error);
      }
    }

    return {
      supported: supportedCodecs.length > 0,
      supportedCodecs
    };
  }

  async initialize(): Promise<void> {
    try {
      console.log('Initializing video exporter...');
      console.log('WebCodecs support:', this.supportsWebCodecs);
      
      // Test WebCodecs capabilities
      if (this.supportsWebCodecs) {
        const capabilities = await this.checkWebCodecsCapabilities();
        console.log('WebCodecs capabilities:', capabilities);
        this.supportsWebCodecs = capabilities.supported;
      }
      
      // Check network connectivity first
      if (!navigator.onLine) {
        console.warn('No internet connection - FFmpeg loading may fail');
      }
      
      // Initialize FFmpeg
      this.ffmpeg = new FFmpeg();
      
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
      
      console.log('Loading FFmpeg from:', baseURL);
      await this.ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });

      this.isFFmpegLoaded = true;
      console.log('FFmpeg loaded successfully');
      console.log('Available export formats:', this.getSupportedFormats());
    } catch (error) {
      console.error('Failed to initialize FFmpeg:', error);
      if (error instanceof Error && error.message.includes('fetch')) {
        console.error('Network error loading FFmpeg - check your internet connection');
      }
      console.log('Continuing without FFmpeg - MP4 support may be limited to WebCodecs');
      // Continue without FFmpeg - we can still use WebCodecs for MP4
    }
  }

  async exportAnimation(
    frames: AnimationFrame[],
    settings: ExportSettings,
    resolution: ResolutionConfig,
    onProgress?: (progress: VideoExportProgress) => void,
    audioManager?: import('./audioManager').AudioManager
  ): Promise<Blob> {
    if (frames.length === 0) {
      throw new Error('No frames to export');
    }

    console.log(`Exporting ${frames.length} frames as ${settings.format}`);
    console.log('Export settings:', settings);
    console.log('Resolution:', resolution);
    console.log('FFmpeg loaded:', this.isFFmpegLoaded);
    console.log('WebCodecs supported:', this.supportsWebCodecs);

    if (settings.format === 'gif') {
      if (!this.isFFmpegLoaded) {
        throw new Error('GIF export requires FFmpeg, but it is not available. Please try MP4 format instead.');
      }
      return this.exportGIF(frames, settings, resolution, onProgress);
    } else if (settings.format === 'mp4') {
      // For now, use FFmpeg for MP4 to ensure proper container format
      // WebCodecs produces raw chunks that need complex muxing
      if (this.isFFmpegLoaded) {
        console.log('Using FFmpeg for MP4 export (reliable container format)');
        return this.exportMP4FFmpeg(frames, settings, resolution, onProgress, audioManager);
      } else {
        // Try WebCodecs as fallback, but it may produce unplayable files
        if (this.supportsWebCodecs) {
          console.log('Attempting WebCodecs for MP4 export (may need proper muxing)');
          try {
            return await this.exportMP4WebCodecs(frames, settings, resolution, onProgress);
          } catch (error) {
            console.warn('WebCodecs failed:', error);
            throw new Error('MP4 export requires FFmpeg for proper container format. Please check your internet connection and try refreshing the page.');
          }
        } else {
          throw new Error('MP4 export requires either FFmpeg or WebCodecs support. Please try a different browser or check your internet connection.');
        }
      }
    } else {
      throw new Error(`Unsupported format: ${settings.format}`);
    }
  }

  private async exportGIF(
    frames: AnimationFrame[],
    settings: ExportSettings,
    resolution: ResolutionConfig,
    onProgress?: (progress: VideoExportProgress) => void
  ): Promise<Blob> {
    if (!this.isFFmpegLoaded || !this.ffmpeg) {
      throw new Error('FFmpeg not available for GIF export');
    }

    onProgress?.({ phase: 'preparing', progress: 0 });

    try {
      // Write frames to FFmpeg
      for (let i = 0; i < frames.length; i++) {
        const canvas = frames[i].canvas;
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Failed to create blob from canvas'));
            }
          }, 'image/png');
        });
        
        await this.ffmpeg.writeFile(`frame${i.toString().padStart(3, '0')}.png`, await fetchFile(blob!));
        
        onProgress?.({ 
          phase: 'preparing', 
          progress: (i + 1) / frames.length * 0.3,
          frameCount: frames.length,
          currentFrame: i + 1
        });
      }

      // Create GIF with FFmpeg
      const framerate = 1 / settings.frameDuration;
      const loop = settings.loop ? '0' : '-1';
      const totalDuration = frames.reduce((sum, frame) => sum + frame.duration, 0);
      
      // Set up progress tracking for GIF encoding
      let encodingStarted = false;
      const gifProgressHandler = ({ progress, time }: { progress: number; time: number }) => {
        if (!encodingStarted) {
          encodingStarted = true;
          onProgress?.({ phase: 'encoding', progress: 0.3 });
        }
        
        const currentTime = time / 1000000; // Convert microseconds to seconds
        const encodingProgress = Math.min(currentTime / totalDuration, 1);
        const overallProgress = 0.3 + (encodingProgress * 0.6); // 30% to 90%
        
        onProgress?.({ 
          phase: 'encoding', 
          progress: overallProgress,
          message: `Encoding GIF: ${currentTime.toFixed(1)}s / ${totalDuration.toFixed(1)}s`
        });
      };
      
      this.ffmpeg.on('progress', gifProgressHandler);
      
      try {
        await this.ffmpeg.exec([
          '-framerate', framerate.toString(),
          '-i', 'frame%03d.png',
          '-vf', `fps=${framerate},scale=${resolution.width}:${resolution.height}:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`,
          '-loop', loop,
          'output.gif'
        ]);
      } finally {
        this.ffmpeg.off('progress', gifProgressHandler);
      }

      onProgress?.({ phase: 'finalizing', progress: 0.9 });

      // Read the output
      const data = await this.ffmpeg.readFile('output.gif');
      // Convert to standard Uint8Array for Blob compatibility
      const uint8Array = new Uint8Array(data as Uint8Array);
      const blob = new Blob([uint8Array], { type: 'image/gif' });

      // Cleanup
      for (let i = 0; i < frames.length; i++) {
        await this.ffmpeg.deleteFile(`frame${i.toString().padStart(3, '0')}.png`);
      }
      await this.ffmpeg.deleteFile('output.gif');

      onProgress?.({ phase: 'complete', progress: 1 });

      return blob;
    } catch (error) {
      console.error('GIF export failed:', error);
      throw new Error('Failed to export GIF');
    }
  }

  private async exportMP4WebCodecs(
    frames: AnimationFrame[],
    settings: ExportSettings,
    resolution: ResolutionConfig,
    onProgress?: (progress: VideoExportProgress) => void
  ): Promise<Blob> {
    onProgress?.({ phase: 'preparing', progress: 0 });

    try {
      console.log('Creating MP4 output with Mediabunny...');
      
      // Create the output
      const output = new Output({
        format: new Mp4OutputFormat(),
        target: new BufferTarget(),
      });

      // Create a canvas source for the video track
      // We'll use a temporary canvas to render frames
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = resolution.width;
      tempCanvas.height = resolution.height;
      const tempCtx = tempCanvas.getContext('2d')!;

      // For Mediabunny, we need to create our own manual encoding approach
      // Since we have pre-rendered frames, let's fall back to raw chunk collection
      // and manual muxing approach
      
      console.log('Falling back to manual MP4 creation...');
      
      return new Promise(async (resolve, reject) => {
        const chunks: Uint8Array[] = [];
        let frameCount = 0;
        let encoderClosed = false;
        let encoder: VideoEncoder | null = null;

        try {
          encoder = new VideoEncoder({
            output: (chunk, metadata) => {
              console.log('Received encoded chunk:', {
                byteLength: chunk.byteLength,
                type: chunk.type,
                timestamp: chunk.timestamp,
                duration: chunk.duration
              });
              
              // Convert EncodedVideoChunk to Uint8Array
              const buffer = new ArrayBuffer(chunk.byteLength);
              chunk.copyTo(buffer);
              chunks.push(new Uint8Array(buffer));
            },
            error: (error) => {
              console.error('VideoEncoder error:', error);
              if (!encoderClosed) {
                encoderClosed = true;
                encoder!.close();
              }
              reject(new Error('Video encoding failed: ' + error.message));
            }
          });

          // Try codec configurations in order of preference  
          const codecConfigs = [
            {
              codec: 'avc1.42001f', // H.264 Baseline Profile Level 3.1
              width: resolution.width,
              height: resolution.height,
              bitrate: 2_000_000,
              framerate: 1 / settings.frameDuration,
            },
            {
              codec: 'avc1.42E01E', // H.264 Baseline
              width: resolution.width,
              height: resolution.height,
              bitrate: 2_000_000,
              framerate: 1 / settings.frameDuration,
            },
            {
              codec: 'avc1.640028', // H.264 High
              width: resolution.width,
              height: resolution.height,
              bitrate: 2_000_000,
              framerate: 1 / settings.frameDuration,
            }
          ];

          let config = null;
          for (const testConfig of codecConfigs) {
            console.log(`Testing codec support: ${testConfig.codec}`);
            const support = await VideoEncoder.isConfigSupported(testConfig);
            if (support.supported) {
              config = testConfig;
              console.log(`Using supported codec: ${testConfig.codec}`);
              break;
            } else {
              console.log(`Codec not supported: ${testConfig.codec}`);
            }
          }

          if (!config) {
            throw new Error('No supported video codec found for WebCodecs');
          }

          encoder.configure(config);
          onProgress?.({ phase: 'encoding', progress: 0.1 });
          console.log('VideoEncoder configured with codec:', config.codec);

          // Encode frames
          for (let i = 0; i < frames.length; i++) {
            if (encoderClosed || encoder.state === 'closed') {
              throw new Error('Encoder was closed during processing');
            }
            
            const canvas = frames[i].canvas;
            
            // Debug: Check if canvas has content before encoding
            const ctx = canvas.getContext('2d')!;
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const hasContent = imageData.data.some((value, index) => {
              return index % 4 === 3 && value > 0; // Check alpha channel for non-transparent pixels
            });
            
            console.log(`Encoding frame ${i + 1}:`, {
              canvasSize: { width: canvas.width, height: canvas.height },
              hasContent,
              imageId: frames[i].imageId,
              frameIndex: i
            });
            
            if (!hasContent) {
              console.warn(`WARNING: Frame ${i + 1} being encoded appears to be empty!`);
              console.warn('Frame details:', frames[i]);
            }
            
            // Create VideoFrame with proper timestamp
            const timestamp = i * settings.frameDuration * 1_000_000; // microseconds
            const videoFrame = new VideoFrame(canvas, {
              timestamp,
              duration: settings.frameDuration * 1_000_000, // microseconds
            });

            console.log(`Encoding frame ${i + 1} with timestamp: ${timestamp}`);
            encoder.encode(videoFrame, { keyFrame: i === 0 });
            videoFrame.close();

            frameCount++;
            onProgress?.({ 
              phase: 'encoding', 
              progress: 0.1 + (i + 1) / frames.length * 0.8,
              frameCount: frames.length,
              currentFrame: i + 1
            });
          }

          console.log('Flushing encoder...');
          // Finish encoding
          if (!encoderClosed && encoder.state !== 'closed') {
            await encoder.flush();
          }
          
          if (!encoderClosed) {
            encoderClosed = true;
            encoder.close();
          }

          onProgress?.({ phase: 'finalizing', progress: 0.95 });
          console.log('Creating MP4 from chunks...');

          // For now, let's create a basic MP4 structure
          // This is a simplified approach - in reality we'd need proper MP4 muxing
          if (chunks.length === 0) {
            throw new Error('No video chunks were generated');
          }

          console.log(`Generated ${chunks.length} video chunks`);
          
          // Combine chunks into a single blob
          // Note: This won't create a proper MP4 file, but let's see what we get
          const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
          const combined = new Uint8Array(totalLength);
          let offset = 0;
          
          for (const chunk of chunks) {
            combined.set(chunk, offset);
            offset += chunk.length;
          }

          // Try creating with MP4 MIME type
          const blob = new Blob([combined], { type: 'video/mp4' });
          onProgress?.({ phase: 'complete', progress: 1 });
          
          console.log('Raw chunks MP4 export completed, blob size:', blob.size);
          
          // Since raw chunks won't work, let's actually fall back to FFmpeg
          console.warn('Raw chunks approach will not work - falling back to FFmpeg');
          throw new Error('WebCodecs chunks need proper muxing - falling back to FFmpeg');
          
        } catch (error) {
          console.error('WebCodecs MP4 export failed:', error);
          if (!encoderClosed && encoder) {
            encoderClosed = true;
            encoder.close();
          }
          throw error; // Re-throw to trigger FFmpeg fallback
        }
      });
      
    } catch (error) {
      console.error('WebCodecs MP4 export failed:', error);
      throw new Error('Failed to export MP4 with WebCodecs: ' + (error as Error).message);
    }
  }

  private async exportMP4FFmpeg(
    frames: AnimationFrame[],
    settings: ExportSettings,
    resolution: ResolutionConfig,
    onProgress?: (progress: VideoExportProgress) => void,
    audioManager?: import('./audioManager').AudioManager
  ): Promise<Blob> {
    if (!this.isFFmpegLoaded || !this.ffmpeg) {
      throw new Error('FFmpeg not available for MP4 export');
    }

    onProgress?.({ phase: 'preparing', progress: 0 });

    try {
      // Write frames to FFmpeg
      for (let i = 0; i < frames.length; i++) {
        const canvas = frames[i].canvas;
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Failed to create blob from canvas'));
            }
          }, 'image/png');
        });
        
        await this.ffmpeg.writeFile(`frame${i.toString().padStart(3, '0')}.png`, await fetchFile(blob!));
        
        onProgress?.({ 
          phase: 'preparing', 
          progress: (i + 1) / frames.length * 0.3,
          frameCount: frames.length,
          currentFrame: i + 1
        });
      }

      // Create MP4 with FFmpeg
      const totalDuration = frames.reduce((sum, frame) => sum + frame.duration, 0);
      
      // Set up FFmpeg progress monitoring
      let encodingStarted = false;
      const progressHandler = ({ progress, time }: { progress: number; time: number }) => {
        if (!encodingStarted) {
          encodingStarted = true;
          onProgress?.({ phase: 'encoding', progress: 0.3 });
        }
        
        // FFmpeg reports time in microseconds, convert to seconds
        const currentTime = time / 1000000;
        
        // Calculate progress: 30% to 90% range for encoding
        // progress is 0-1 from FFmpeg, time is more reliable for our use case
        const encodingProgress = Math.min(currentTime / totalDuration, 1);
        const overallProgress = 0.3 + (encodingProgress * 0.6); // 30% to 90%
        
        onProgress?.({ 
          phase: 'encoding', 
          progress: overallProgress,
          message: `Encoding: ${currentTime.toFixed(1)}s / ${totalDuration.toFixed(1)}s`
        });
      };
      
      this.ffmpeg.on('progress', progressHandler);
      
      // Check if we have variable frame durations (beat sync mode)
      const hasVariableDurations = frames.some((f, i) => 
        i > 0 && Math.abs(f.duration - frames[0].duration) > 0.01
      );
      
      console.log('Video Export Configuration:', {
        frameCount: frames.length,
        totalDuration: totalDuration.toFixed(2) + 's',
        hasVariableDurations,
        frameDurations: frames.slice(0, 5).map(f => f.duration.toFixed(3)),
        beatSyncEnabled: settings.beatSync.enabled
      });
      
      let ffmpegArgs: string[] = [];
      
      if (hasVariableDurations) {
        // VARIABLE DURATION MODE (Beat Sync): Use concat demuxer
        console.log('🎵 Using concat demuxer for variable frame durations (beat sync)');
        
        // Create concat demuxer file listing each frame with its duration
        let concatFileContent = 'ffconcat version 1.0\n';
        for (let i = 0; i < frames.length; i++) {
          concatFileContent += `file 'frame${i.toString().padStart(3, '0')}.png'\n`;
          concatFileContent += `duration ${frames[i].duration}\n`;
        }
        // Add last frame again with duration 0 (required by concat demuxer)
        concatFileContent += `file 'frame${(frames.length - 1).toString().padStart(3, '0')}.png'\n`;
        
        await this.ffmpeg.writeFile('concat_list.txt', new TextEncoder().encode(concatFileContent));
        console.log('Concat file created:', concatFileContent.split('\n').slice(0, 10).join('\n'));
        
        ffmpegArgs = [
          '-f', 'concat',
          '-safe', '0',
          '-i', 'concat_list.txt',
        ];
      } else {
        // FIXED DURATION MODE: Use simple framerate
        console.log('⏱️ Using fixed framerate (normal mode)');
        const framerate = 1 / settings.frameDuration;
        
        ffmpegArgs = [
          '-framerate', framerate.toString(),
          '-i', 'frame%03d.png',
        ];
      }

      // Handle audio: Beat sync takes priority over sound effects
      // Add audio INPUT first (before encoding options)
      let hasAudio = false;
      
      if (settings.beatSync.enabled && settings.beatSync.musicFile) {
        // BEAT SYNC: Include the actual music file
        const musicFileName = 'music.' + settings.beatSync.musicFile.name.split('.').pop();
        await this.ffmpeg.writeFile(musicFileName, await fetchFile(settings.beatSync.musicFile));
        
        // Add music input (input stream 1)
        ffmpegArgs.push('-i', musicFileName);
        hasAudio = true;
        
        console.log(`Beat sync: Including music file with ${totalDuration}s duration, ${settings.beatSync.beatOffset}s offset`);
        
      } else if (settings.addSound) {
        const volumeLevel = 0.7; // Fixed volume
        
        if (settings.soundType === 'custom' && settings.customAudioFile) {
          // CUSTOM AUDIO: Use AudioManager to create synchronized track (like clicks)
          console.log('Generating custom audio sound effects using AudioManager');
          
          if (audioManager) {
            try {
              // Load the custom audio into AudioManager
              await audioManager.loadCustomSound(settings.customAudioFile);
              
              // Create synchronized track - audio trimmed to frame duration and repeated
              const frameDurations = frames.map(f => f.duration);
              const audioBuffer = await audioManager.createSynchronizedAudioTrack(
                {
                  enabled: true,
                  type: 'custom',
                  builtinSound: 'click',
                  customFile: settings.customAudioFile,
                  volume: volumeLevel,
                  syncMode: 'frame-start'
                },
                frameDurations,
                'frame-start'
              );
              
              if (audioBuffer) {
                const customAudioBlob = audioManager.audioBufferToWav(audioBuffer);
                const customAudioData = await fetchFile(customAudioBlob);
                
                const customFileName = 'custom_audio.wav';
                await this.ffmpeg.writeFile(customFileName, customAudioData);
                
                ffmpegArgs.push('-i', customFileName);
                hasAudio = true;
                
                console.log(`Generated ${frames.length} custom audio effects at each frame transition`);
              } else {
                throw new Error('AudioManager failed to create synchronized track');
              }
            } catch (error) {
              console.error('Custom audio synchronization failed:', error);
              // Fallback to clicks
              console.log('Falling back to built-in clicks');
              const clickAudioBlob = await this.generateClickAudio(frames.length, settings.frameDuration, volumeLevel);
              const clickAudioData = await fetchFile(clickAudioBlob);
              
              const clickFileName = 'click_audio.wav';
              await this.ffmpeg.writeFile(clickFileName, clickAudioData);
              
              ffmpegArgs.push('-i', clickFileName);
              hasAudio = true;
            }
          } else {
            // No AudioManager - use synthetic clicks
            console.warn('No AudioManager available, using synthetic clicks');
            const clickAudioBlob = await this.generateClickAudio(frames.length, settings.frameDuration, volumeLevel);
            const clickAudioData = await fetchFile(clickAudioBlob);
            
            const clickFileName = 'click_audio.wav';
            await this.ffmpeg.writeFile(clickFileName, clickAudioData);
            
            ffmpegArgs.push('-i', clickFileName);
            hasAudio = true;
          }
          
        } else {
          // BUILT-IN AUDIO: Use AudioManager to create synchronized clicks
          console.log('Generating click sounds using AudioManager');
          const volumeLevel = 0.7; // Fixed volume
          
          if (audioManager) {
            // Use AudioManager's synchronized audio track (matches preview sound)
            const frameDurations = frames.map(f => f.duration);
            const audioBuffer = await audioManager.createSynchronizedAudioTrack(
              {
                enabled: true,
                type: 'builtin',
                builtinSound: 'click',
                volume: volumeLevel,
                syncMode: 'frame-start'
              },
              frameDurations,
              'frame-start'
            );
            
            if (audioBuffer) {
              const clickAudioBlob = audioManager.audioBufferToWav(audioBuffer);
              const clickAudioData = await fetchFile(clickAudioBlob);
              
              const clickFileName = 'click_audio.wav';
              await this.ffmpeg.writeFile(clickFileName, clickAudioData);
              
              ffmpegArgs.push('-i', clickFileName);
              hasAudio = true;
              
              console.log(`Generated ${frames.length} synchronized clicks using AudioManager`);
            } else {
              // Fallback to synthetic clicks if AudioManager fails
              console.warn('AudioManager failed, using synthetic clicks');
              const clickAudioBlob = await this.generateClickAudio(frames.length, settings.frameDuration, volumeLevel);
              const clickAudioData = await fetchFile(clickAudioBlob);
              
              const clickFileName = 'click_audio.wav';
              await this.ffmpeg.writeFile(clickFileName, clickAudioData);
              
              ffmpegArgs.push('-i', clickFileName);
              hasAudio = true;
            }
          } else {
            // Fallback: Generate clicks using Web Audio API
            console.warn('No AudioManager available, using synthetic clicks');
            const clickAudioBlob = await this.generateClickAudio(frames.length, settings.frameDuration, volumeLevel);
            const clickAudioData = await fetchFile(clickAudioBlob);
            
            const clickFileName = 'click_audio.wav';
            await this.ffmpeg.writeFile(clickFileName, clickAudioData);
            
            ffmpegArgs.push('-i', clickFileName);
            hasAudio = true;
          }
        }
      }
      
      // Now add encoding options (after all inputs)
      ffmpegArgs.push(
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-crf', '23',
        '-preset', 'faster'  // Faster export, slightly larger file size
      );
      
      // Add audio mapping and encoding if we have audio
      if (hasAudio) {
        ffmpegArgs.push(
          '-map', '0:v',
          '-map', '1:a',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-shortest'
        );
        
        // Special handling for beat sync offset
        if (settings.beatSync.enabled && settings.beatSync.musicFile) {
          const startOffset = Math.max(0, settings.beatSync.beatOffset);
          if (startOffset > 0) {
            // Insert offset before mapping
            const mapIndex = ffmpegArgs.indexOf('-map');
            ffmpegArgs.splice(mapIndex, 0, '-ss', startOffset.toString());
          }
        }
      }
      
      // Finally add output filename
      ffmpegArgs.push('output.mp4');
      
      // Log the FFmpeg command for debugging
      console.log('FFmpeg command:', ffmpegArgs.join(' '));
      
      // Execute FFmpeg with error handling
      try {
        await this.ffmpeg.exec(ffmpegArgs);
        console.log('FFmpeg exec completed successfully');
      } catch (execError: any) {
        console.error('FFmpeg execution failed:', execError);
        console.error('FFmpeg stderr:', execError.message || execError);
        
        // Remove progress listener on error
        this.ffmpeg.off('progress', progressHandler);
        
        // List files in case exec partially succeeded
        try {
          const files = await this.ffmpeg.listDir('/');
          console.log('Files after failed exec:', files.map((f: any) => f.name));
        } catch (listErr) {
          console.error('Cannot list files:', listErr);
        }
        
        throw new Error(`FFmpeg execution failed: ${execError.message || execError}`);
      }
      
      // Remove progress listener after successful encoding
      this.ffmpeg.off('progress', progressHandler);
      
      onProgress?.({ phase: 'finalizing', progress: 0.9 });

      // Read the output
      const fileData = await this.ffmpeg.readFile('output.mp4');
      // Convert to standard Uint8Array for Blob compatibility
      const data = new Uint8Array(fileData as Uint8Array);
      const blob = new Blob([data], { type: 'video/mp4' });

      // Cleanup
      for (let i = 0; i < frames.length; i++) {
        await this.ffmpeg.deleteFile(`frame${i.toString().padStart(3, '0')}.png`);
      }
      await this.ffmpeg.deleteFile('output.mp4');
      
      // Cleanup concat file if it was used (beat sync with variable durations)
      if (hasVariableDurations) {
        try {
          await this.ffmpeg.deleteFile('concat_list.txt');
        } catch (e) {
          // File might not exist, ignore cleanup error
        }
      }
      
      // Cleanup music file if it was used
      if (settings.beatSync.enabled && settings.beatSync.musicFile) {
        const musicFileName = 'music.' + settings.beatSync.musicFile.name.split('.').pop();
        try {
          await this.ffmpeg.deleteFile(musicFileName);
        } catch (e) {
          // File might not exist, ignore cleanup error
        }
      }
      
      // Cleanup sound effect files if they were used
      if (settings.addSound) {
        try {
          if (settings.soundType === 'custom' && settings.customAudioFile) {
            // Clean up custom audio file
            await this.ffmpeg.deleteFile('custom_audio.wav');
          } else {
            // Clean up generated click audio
            await this.ffmpeg.deleteFile('click_audio.wav');
          }
        } catch (e) {
          // Files might not exist, ignore cleanup error
          console.warn('Audio cleanup failed:', e);
        }
      }

      onProgress?.({ phase: 'complete', progress: 1 });

      return blob;
    } catch (error) {
      console.error('FFmpeg MP4 export failed:', error);
      throw new Error('Failed to export MP4');
    }
  }


  // Add sound to MP4 (placeholder for future implementation)
  private async addSoundToMP4(
    videoBlob: Blob,
    soundFile: File,
    frameCount: number,
    frameDuration: number
  ): Promise<Blob> {
    // This would use Web Audio API to generate click sounds
    // and then mux with the video using FFmpeg
    // For now, return the original video
    return videoBlob;
  }

  async exportAndDownload(
    frames: AnimationFrame[],
    settings: ExportSettings,
    resolution: ResolutionConfig,
    filename: string,
    onProgress?: (progress: VideoExportProgress) => void,
    audioManager?: import('./audioManager').AudioManager
  ): Promise<void> {
    try {
      const blob = await this.exportAnimation(frames, settings, resolution, onProgress, audioManager);
      const extension = settings.format === 'gif' ? 'gif' : 'mp4';
      const fullFilename = filename.includes('.') ? filename : `${filename}.${extension}`;
      
      downloadFile(blob, fullFilename);
    } catch (error) {
      console.error('Export and download failed:', error);
      throw error;
    }
  }

  cleanup(): void {
    // Cleanup resources if needed
    this.ffmpeg = null;
    this.isFFmpegLoaded = false;
  }

  isReady(): boolean {
    return this.isFFmpegLoaded || this.supportsWebCodecs;
  }

  getSupportedFormats(): string[] {
    const formats = [];
    if (this.isFFmpegLoaded) {
      formats.push('gif', 'mp4');
    } else if (this.supportsWebCodecs) {
      formats.push('mp4');
    }
    return formats;
  }
}