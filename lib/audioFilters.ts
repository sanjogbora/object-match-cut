/**
 * Audio Filtering Utilities for Multi-Band Onset Detection
 * 
 * Provides Web Audio API-based filtering to split audio into frequency bands.
 * Used for professional-grade beat detection that isolates kicks from hi-hats.
 */

export interface FilterConfig {
  type: 'lowpass' | 'highpass' | 'bandpass';
  frequency: number;
  Q?: number;
  sampleRate: number;
}

export class AudioFilter {
  /**
   * Apply a biquad filter to an audio buffer
   * 
   * Uses Web Audio API's OfflineAudioContext for efficient offline processing.
   * 
   * @param audioBuffer - Input audio buffer
   * @param config - Filter configuration
   * @returns Filtered audio buffer
   */
  static async applyFilter(
    audioBuffer: AudioBuffer,
    config: FilterConfig
  ): Promise<AudioBuffer> {
    try {
      // Create offline context for processing
      const offlineContext = new OfflineAudioContext(
        1, // Mono (we process first channel only)
        audioBuffer.length,
        audioBuffer.sampleRate
      );

      // Create source from input buffer
      const source = offlineContext.createBufferSource();
      
      // Copy first channel to mono buffer for filtering
      const monoBuffer = offlineContext.createBuffer(
        1,
        audioBuffer.length,
        audioBuffer.sampleRate
      );
      monoBuffer.copyToChannel(audioBuffer.getChannelData(0), 0);
      source.buffer = monoBuffer;

      // Create and configure biquad filter
      const filter = offlineContext.createBiquadFilter();
      filter.type = config.type;
      filter.frequency.value = config.frequency;
      filter.Q.value = config.Q || 0.7; // Default Q value for smooth rolloff

      // Connect audio graph: source → filter → destination
      source.connect(filter);
      filter.connect(offlineContext.destination);

      // Start playback and render
      source.start(0);
      const filteredBuffer = await offlineContext.startRendering();

      return filteredBuffer;
    } catch (error) {
      console.error('Filter application failed:', error);
      throw new Error(`Failed to apply ${config.type} filter at ${config.frequency}Hz: ${error}`);
    }
  }

  /**
   * Create a bandpass filter by cascading highpass and lowpass filters
   * 
   * This isolates a specific frequency range by:
   * 1. Removing frequencies below lowFreq (highpass)
   * 2. Removing frequencies above highFreq (lowpass)
   * 
   * Example: bandpass(audio, 20, 250) keeps only bass frequencies (kicks)
   * 
   * @param audioBuffer - Input audio buffer
   * @param lowFreq - Lower cutoff frequency (Hz)
   * @param highFreq - Upper cutoff frequency (Hz)
   * @returns Audio buffer containing only frequencies between lowFreq and highFreq
   */
  static async createBandpassFilter(
    audioBuffer: AudioBuffer,
    lowFreq: number,
    highFreq: number
  ): Promise<AudioBuffer> {
    try {
      // Validate frequency range
      if (lowFreq >= highFreq) {
        throw new Error(`Invalid frequency range: ${lowFreq}-${highFreq} Hz`);
      }

      const sampleRate = audioBuffer.sampleRate;
      const nyquist = sampleRate / 2;

      // Clamp frequencies to valid range
      const clampedLowFreq = Math.max(20, Math.min(lowFreq, nyquist));
      const clampedHighFreq = Math.max(20, Math.min(highFreq, nyquist));

      // Step 1: Apply highpass filter (removes everything below lowFreq)
      const highpassed = await this.applyFilter(audioBuffer, {
        type: 'highpass',
        frequency: clampedLowFreq,
        Q: 0.7,
        sampleRate
      });

      // Step 2: Apply lowpass filter (removes everything above highFreq)
      const bandpassed = await this.applyFilter(highpassed, {
        type: 'lowpass',
        frequency: clampedHighFreq,
        Q: 0.7,
        sampleRate
      });

      return bandpassed;
    } catch (error) {
      console.error('Bandpass filter creation failed:', error);
      throw new Error(`Failed to create bandpass filter ${lowFreq}-${highFreq}Hz: ${error}`);
    }
  }

  /**
   * Create a lowpass filter
   * Keeps frequencies below the cutoff, removes above
   * 
   * @param audioBuffer - Input audio buffer
   * @param cutoffFreq - Cutoff frequency (Hz)
   * @returns Filtered audio buffer
   */
  static async createLowpassFilter(
    audioBuffer: AudioBuffer,
    cutoffFreq: number
  ): Promise<AudioBuffer> {
    return this.applyFilter(audioBuffer, {
      type: 'lowpass',
      frequency: cutoffFreq,
      Q: 0.7,
      sampleRate: audioBuffer.sampleRate
    });
  }

  /**
   * Create a highpass filter
   * Keeps frequencies above the cutoff, removes below
   * 
   * @param audioBuffer - Input audio buffer
   * @param cutoffFreq - Cutoff frequency (Hz)
   * @returns Filtered audio buffer
   */
  static async createHighpassFilter(
    audioBuffer: AudioBuffer,
    cutoffFreq: number
  ): Promise<AudioBuffer> {
    return this.applyFilter(audioBuffer, {
      type: 'highpass',
      frequency: cutoffFreq,
      Q: 0.7,
      sampleRate: audioBuffer.sampleRate
    });
  }

  /**
   * Get human-readable description of a frequency range
   * 
   * @param lowFreq - Lower frequency bound
   * @param highFreq - Upper frequency bound
   * @returns Description of what instruments/sounds are in this range
   */
  static describeFrequencyRange(lowFreq: number, highFreq: number): string {
    if (highFreq <= 250) {
      return 'Sub-bass (kick drums, bass drops)';
    } else if (lowFreq >= 20 && highFreq <= 500) {
      return 'Bass (kicks, toms, bass guitar)';
    } else if (lowFreq >= 250 && highFreq <= 2000) {
      return 'Midrange (snares, vocals, guitars, piano)';
    } else if (lowFreq >= 2000 && highFreq <= 8000) {
      return 'High-mid (hi-hats, cymbals, high vocals)';
    } else if (lowFreq >= 8000) {
      return 'High (cymbals, air, sparkle)';
    } else {
      return 'Mixed frequency range';
    }
  }
}
