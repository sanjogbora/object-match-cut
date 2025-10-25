import { AudioFilter } from './audioFilters';

export interface BeatDetectionResult {
  beats: number[]; // Array of beat timestamps in seconds
  bpm: number; // Detected BPM
  confidence: number; // Detection confidence (0-1)
  duration: number; // Audio duration in seconds
}

interface ScoredBeat {
  time: number;        // Beat timestamp in seconds
  energy: number;      // RMS energy at beat position
  score: number;       // Overall score for prioritization
}

export interface BeatSyncSettings {
  enabled: boolean;
  musicFile?: File;
  beatSensitivity: number; // 0.1 to 1.0
  syncMode: 'auto' | 'manual';
  manualBpm?: number;
  beatOffset: number; // Offset in seconds to align first beat
}

/**
 * Multi-Band Detection: Frequency Band Configuration
 * 
 * Defines the frequency ranges and priorities for multi-band onset detection.
 * Higher weight = more important for beat sync (kicks > hi-hats).
 */
interface FrequencyBand {
  name: string;          // Band identifier
  lowFreq: number;       // Lower frequency bound (Hz)
  highFreq: number;      // Upper frequency bound (Hz)
  weight: number;        // Priority multiplier (5.0 = highest)
  description: string;   // Instruments/sounds in this range
}

/**
 * The 5 frequency bands for professional beat detection
 * Based on audio engineering standards and human perception
 */
const FREQUENCY_BANDS: FrequencyBand[] = [
  {
    name: 'sub-bass',
    lowFreq: 20,
    highFreq: 250,
    weight: 5.0,
    description: 'Kick drums, bass drops, sub-bass'
  },
  {
    name: 'low-mid',
    lowFreq: 250,
    highFreq: 500,
    weight: 3.0,
    description: 'Toms, bass guitar, low piano notes'
  },
  {
    name: 'mid',
    lowFreq: 500,
    highFreq: 2000,
    weight: 2.0,
    description: 'Snares, vocals, guitars, piano melody'
  },
  {
    name: 'high-mid',
    lowFreq: 2000,
    highFreq: 8000,
    weight: 0.5,
    description: 'Hi-hats, cymbals, high vocals'
  },
  {
    name: 'high',
    lowFreq: 8000,
    highFreq: 20000,
    weight: 0.2,
    description: 'Cymbals, air, sparkle, high-frequency details'
  }
];

/**
 * Multi-Band Onset: Represents a beat detected in a specific frequency band
 */
interface BandOnset {
  time: number;      // Timestamp in seconds
  band: string;      // Which frequency band detected this
  weight: number;    // Band's priority weight
  energy: number;    // Local onset strength
  flux: number;      // Spectral flux value at this point
}

export class BeatDetector {
  private audioContext: AudioContext | null = null;
  private audioBuffer: AudioBuffer | null = null;
  
  // FEATURE FLAG: Enable multi-band detection
  // Set to true to use professional 5-band onset detection
  // Set to false to use legacy single-band detection
  // TEMPORARILY DISABLED: Spectral flux needs proper FFT implementation
  private USE_MULTIBAND = false;

  constructor() {
    this.initializeAudioContext();
  }

  private async initializeAudioContext(): Promise<void> {
    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      console.log('✅ Audio context initialized for beat detection');
    } catch (error) {
      console.warn('Failed to initialize audio context for beat detection:', error);
    }
  }

  async loadAudioFile(file: File): Promise<AudioBuffer> {
    if (!this.audioContext) {
      throw new Error('Audio context not available');
    }

    try {
      const arrayBuffer = await file.arrayBuffer();
      this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      return this.audioBuffer;
    } catch (error) {
      console.error('Failed to load audio file:', error);
      throw new Error('Failed to load audio file. Please ensure it\'s a valid audio format.');
    }
  }

  async detectBeats(
    audioBuffer: AudioBuffer, 
    sensitivity: number = 0.5,
    targetBeatCount?: number  // Optional: Select top N beats for N images
  ): Promise<BeatDetectionResult> {
    if (!this.audioContext) {
      throw new Error('Audio context not available');
    }

    console.log('🎵 Starting Beat Detection with web-audio-beat-detector...', {
      duration: audioBuffer.duration.toFixed(2) + 's',
      sampleRate: audioBuffer.sampleRate,
      channels: audioBuffer.numberOfChannels
    });

    try {
      return await this.detectBeatsWebAudio(audioBuffer, sensitivity, targetBeatCount);
    } catch (error) {
      console.error('Web Audio beat detection failed:', error);
      console.warn('Falling back to RMS detection...');
      return this.detectBeatsRMS(audioBuffer, sensitivity, targetBeatCount);
    }
  }

  /**
   * Onset detection using Spectral Flux
   * Routes to multi-band or single-band detection based on feature flag
   */
  private async detectBeatsWebAudio(
    audioBuffer: AudioBuffer,
    sensitivity: number,
    targetBeatCount?: number
  ): Promise<BeatDetectionResult> {
    // PHASE 5: Route to multi-band or legacy single-band
    if (this.USE_MULTIBAND) {
      return await this.detectBeatsMultiBand(audioBuffer, sensitivity, targetBeatCount);
    } else {
      return await this.detectBeatsSingleBand(audioBuffer, sensitivity, targetBeatCount);
    }
  }

  /**
   * PHASE 5: Multi-Band Beat Detection (NEW)
   * 
   * Professional-grade detection using 5 frequency bands.
   * Isolates kicks (bass) from hi-hats (treble) for accurate beat sync.
   */
  private async detectBeatsMultiBand(
    audioBuffer: AudioBuffer,
    sensitivity: number,
    targetBeatCount?: number
  ): Promise<BeatDetectionResult> {
    try {
      console.log('🎛️ MULTI-BAND Beat Detection Starting...');
      console.log(`   Mode: ${FREQUENCY_BANDS.length}-band analysis`);
      console.log(`   Target beats: ${targetBeatCount || 'all detected'}`);
      
      const overallStart = performance.now();
      
      // Step 1: Split audio into frequency bands
      const filterStart = performance.now();
      const bands = await this.splitIntoBands(audioBuffer);
      console.log(`⏱️  Filtering: ${(performance.now() - filterStart).toFixed(0)}ms`);
      
      // Step 2: Detect onsets in each band
      const detectStart = performance.now();
      const allOnsets = await this.detectMultiBandOnsets(bands, sensitivity);
      console.log(`⏱️  Detection: ${(performance.now() - detectStart).toFixed(0)}ms`);
      
      // Step 3: Merge nearby onsets (same beat in multiple bands)
      const mergeStart = performance.now();
      const mergedOnsets = this.mergeNearbyOnsets(allOnsets);
      console.log(`⏱️  Merging: ${(performance.now() - mergeStart).toFixed(0)}ms`);
      
      // Step 4: Select top N beats if specified
      const selectStart = performance.now();
      const selectedBeats = this.selectTopMultiBandBeats(mergedOnsets, targetBeatCount);
      console.log(`⏱️  Selection: ${(performance.now() - selectStart).toFixed(0)}ms`);
      
      // Step 5: Calculate BPM and confidence
      const bpm = this.calculateBPMFromBeats(selectedBeats);
      const confidence = this.calculateConfidence(selectedBeats, bpm);
      
      const totalTime = performance.now() - overallStart;
      
      console.log('✅ Multi-Band Detection Complete!');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`   Total time: ${totalTime.toFixed(0)}ms`);
      console.log(`   Bands analyzed: ${FREQUENCY_BANDS.length}`);
      console.log(`   Total onsets: ${allOnsets.length}`);
      console.log(`   After merge: ${mergedOnsets.length}`);
      console.log(`   Selected beats: ${selectedBeats.length}`);
      console.log(`   BPM: ${Math.round(bpm)}`);
      console.log(`   Confidence: ${(confidence * 100).toFixed(0)}%`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      return {
        beats: selectedBeats,
        bpm: Math.round(bpm),
        confidence,
        duration: audioBuffer.duration
      };
    } catch (error) {
      console.error('Multi-band detection failed:', error);
      console.warn('Falling back to single-band detection...');
      return await this.detectBeatsSingleBand(audioBuffer, sensitivity, targetBeatCount);
    }
  }

  /**
   * Legacy single-band detection (original method)
   * Kept for fallback and comparison
   */
  private async detectBeatsSingleBand(
    audioBuffer: AudioBuffer,
    sensitivity: number,
    targetBeatCount?: number
  ): Promise<BeatDetectionResult> {
    try {
      console.log('🎵 Running onset detection (spectral flux)...');
      
      // Step 1: Compute spectral flux (how much spectrum changes over time)
      const fftSize = 2048; // ~43ms windows at 48kHz
      const hopSize = 1024; // 50% overlap
      const flux = this.computeSpectralFlux(audioBuffer, fftSize, hopSize);
      
      console.log('Spectral flux computed:', {
        fftSize,
        hopSize,
        windowDuration: ((fftSize / audioBuffer.sampleRate) * 1000).toFixed(1) + 'ms',
        fluxValues: flux.length,
        totalDuration: audioBuffer.duration.toFixed(2) + 's'
      });
      
      // Step 2: Detect onsets from flux curve
      const approximateTimestamps = this.detectOnsetsFromFlux(
        flux,
        audioBuffer.sampleRate,
        hopSize,
        sensitivity
      );
      
      // Step 2.5: Refine timestamps to exact waveform peaks
      const beatTimestamps = this.refineTimestamps(audioBuffer, approximateTimestamps);
      
      // Step 3: Calculate BPM from intervals
      const bpm = this.calculateBPMFromBeats(beatTimestamps);
      
      // Step 4: Calculate confidence based on regularity
      const confidence = this.calculateConfidence(beatTimestamps, bpm);
      
      // SANITY CHECK: Warn if detecting too many beats (unrealistic BPM)
      const maxReasonableBPM = 200; // Most music is 60-180 BPM
      if (bpm > maxReasonableBPM) {
        console.warn(`⚠️ DETECTION WARNING: BPM of ${Math.round(bpm)} is unrealistic!`);
        console.warn(`   This usually means the algorithm is detecting noise, not real beats.`);
        console.warn(`   Try: Reduce sensitivity slider or use different music.`);
      }
      
      // CONFIDENCE CHECK: Warn if beats are irregular (low confidence)
      const minReasonableConfidence = 0.50; // 50% minimum for good sync
      if (confidence < minReasonableConfidence) {
        console.warn(`⚠️ CONFIDENCE WARNING: Only ${(confidence * 100).toFixed(0)}% confidence!`);
        console.warn(`   Detected beats are irregular/inconsistent (not following a rhythm).`);
        console.warn(`   Try: Adjust sensitivity slider or use music with clearer beat.`);
      }
      
      console.log('✅ Onset Detection Complete:', {
        onsetsDetected: beatTimestamps.length,
        bpm: Math.round(bpm),
        confidence: (confidence * 100).toFixed(0) + '%',
        duration: audioBuffer.duration.toFixed(2) + 's',
        beatsPerSecond: (beatTimestamps.length / audioBuffer.duration).toFixed(1),
        realistic: bpm <= maxReasonableBPM ? '✅ Yes' : '❌ No - too high!',
        firstFewOnsets: beatTimestamps.slice(0, 5).map((b: number) => b.toFixed(3)),
        avgInterval: beatTimestamps.length > 1 ? 
          (this.calculateAverageInterval(beatTimestamps) * 1000).toFixed(0) + 'ms' : 'N/A'
      });

      // SIMPLE APPROACH: Just use first N detected beats
      // More complex approaches (energy-based, segment-based) failed
      let finalBeats = beatTimestamps;
      
      if (targetBeatCount && beatTimestamps.length > targetBeatCount) {
        // Use first N beats chronologically
        finalBeats = beatTimestamps.slice(0, targetBeatCount);
        console.log(`📊 Using first ${targetBeatCount} beats from ${beatTimestamps.length} detected onsets`);
      } else if (targetBeatCount && beatTimestamps.length < targetBeatCount) {
        console.warn(`⚠️ Only ${beatTimestamps.length} beats detected for ${targetBeatCount} images`);
        console.warn('Recommendation: Reduce image count, adjust sensitivity, or use manual BPM mode');
      }

      return {
        beats: finalBeats,
        bpm: Math.round(bpm),
        confidence,
        duration: audioBuffer.duration
      };
    } catch (error) {
      console.error('Onset detection failed:', error);
      throw error;
    }
  }
  
  /**
   * Compute spectral flux: measure how much the frequency spectrum changes over time
   * High flux = onset (beat, transient, attack)
   */
  /**
   * Compute RMS Energy Envelope
   * 
   * Much simpler and actually works (spectral flux was broken).
   * Detects sudden energy increases = beats.
   */
  private computeSpectralFlux(
    audioBuffer: AudioBuffer,
    fftSize: number,
    hopSize: number
  ): Float32Array {
    const channelData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    
    // Calculate number of windows
    const numWindows = Math.floor((channelData.length - fftSize) / hopSize) + 1;
    const energy = new Float32Array(numWindows);
    
    // Process each window - calculate RMS energy
    for (let i = 0; i < numWindows; i++) {
      const offset = i * hopSize;
      let sumOfSquares = 0;
      
      // Calculate RMS energy in this window
      for (let j = 0; j < fftSize && (offset + j) < channelData.length; j++) {
        const sample = channelData[offset + j];
        sumOfSquares += sample * sample;
      }
      
      // RMS = root mean square
      energy[i] = Math.sqrt(sumOfSquares / fftSize);
    }
    
    // Calculate energy DIFFERENCES (flux = rate of change)
    const flux = new Float32Array(numWindows);
    flux[0] = 0;
    
    for (let i = 1; i < numWindows; i++) {
      // Only count INCREASES in energy (onsets)
      const diff = energy[i] - energy[i - 1];
      flux[i] = Math.max(0, diff); // Positive differences only
    }
    
    return flux;
  }
  
  /**
   * Detect onsets from spectral flux curve using local percentile ranking
   * Each peak is compared to neighbors within ±2.5s and selected if strong locally
   * This adapts to both sparse (intro) and dense (chorus) sections automatically
   */
  private detectOnsetsFromFlux(
    flux: Float32Array,
    sampleRate: number,
    hopSize: number,
    sensitivity: number
  ): number[] {
    if (flux.length === 0) return [];
    
    console.log('🎯 Local Percentile Peak Selection:');
    
    interface Peak {
      index: number;
      value: number;
      localPercentile: number;
    }
    
    // Step 1: Find ALL local maxima (peaks)
    const allPeaks: Peak[] = [];
    // Adaptive minimum peak distance based on sensitivity:
    // - Low sensitivity (0%): 200ms minimum (only main beats, max 300 BPM)
    // - High sensitivity (100%): 60ms minimum (catches rapid hi-hats, fast EDM)
    const minPeakDistanceSeconds = 0.2 - (sensitivity * 0.14); // 200ms to 60ms
    const minPeakDistance = Math.floor((minPeakDistanceSeconds * sampleRate) / hopSize);
    
    for (let i = 1; i < flux.length - 1; i++) {
      const isLocalMax = flux[i] > flux[i - 1] && flux[i] > flux[i + 1];
      
      if (isLocalMax && flux[i] > 0) {
        // Check distance from last peak
        const farEnough = allPeaks.length === 0 || 
          (i - allPeaks[allPeaks.length - 1].index) >= minPeakDistance;
        
        if (farEnough) {
          allPeaks.push({ 
            index: i, 
            value: flux[i],
            localPercentile: 0  // Will calculate next
          });
        }
      }
    }
    
    console.log(`📊 Found ${allPeaks.length} total peaks (min distance: ${(minPeakDistanceSeconds * 1000).toFixed(0)}ms)`);
    
    if (allPeaks.length === 0) return [];
    
    // Step 2: Calculate local percentile for each peak
    // Compare each peak to neighbors within ±2.5 seconds
    const neighborhoodSeconds = 2.5;
    const neighborhoodIndices = Math.floor((neighborhoodSeconds * sampleRate) / hopSize);
    
    for (let i = 0; i < allPeaks.length; i++) {
      const peak = allPeaks[i];
      
      // Find all peaks within ±2.5s neighborhood
      const neighbors: Peak[] = [];
      for (let j = 0; j < allPeaks.length; j++) {
        const distance = Math.abs(allPeaks[j].index - peak.index);
        if (distance <= neighborhoodIndices) {
          neighbors.push(allPeaks[j]);
        }
      }
      
      // Calculate what percentile this peak is among neighbors
      const strongerNeighbors = neighbors.filter(n => n.value > peak.value).length;
      peak.localPercentile = 1 - (strongerNeighbors / neighbors.length);
      // 1.0 = strongest in neighborhood, 0.0 = weakest
    }
    
    // Step 3: Select peaks based on local percentile threshold
    // Sensitivity controls threshold:
    // - Low (0.0-0.3): Top 25-40% locally (very selective, main beats only)
    // - Med (0.4-0.6): Top 40-55% locally (balanced, main + strong secondary)
    // - High (0.7-1.0): Top 55-75% locally (very inclusive, catches almost all beats for EDM)
    const percentileThreshold = 0.75 - (sensitivity * 0.50);  // 0.75 to 0.25
    
    const selectedPeaks = allPeaks.filter(p => p.localPercentile >= percentileThreshold);
    
    // Already in chronological order
    
    console.log('Local Percentile Selection:', {
      totalPeaks: allPeaks.length,
      selectedPeaks: selectedPeaks.length,
      percentileThreshold: (percentileThreshold * 100).toFixed(0) + '% (top ' + ((1 - percentileThreshold) * 100).toFixed(0) + '% locally)',
      neighborhoodSize: neighborhoodSeconds + 's (±' + neighborhoodSeconds + 's)',
      avgLocalPercentile: selectedPeaks.length > 0 ? 
        (selectedPeaks.reduce((sum, p) => sum + p.localPercentile, 0) / selectedPeaks.length * 100).toFixed(0) + '%' : 'N/A',
      rejectedPeaks: allPeaks.length - selectedPeaks.length
    });
    
    // Step 5: Convert window indices to timestamps
    const onsetTimestamps = selectedPeaks.map(peak => {
      return (peak.index * hopSize) / sampleRate;
    });
    
    return onsetTimestamps;
  }
  
  /**
   * Refine beat timestamps to exact waveform peaks
   * Looks at raw audio samples around RMS-detected time
   */
  private refineTimestamps(
    audioBuffer: AudioBuffer,
    approximateTimestamps: number[]
  ): number[] {
    console.log('🔍 Refining timestamps to exact waveform peaks...');
    
    const channelData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    const refinedTimestamps: number[] = [];
    
    // Search window: FORWARD ONLY (0ms to +50ms)
    // RMS detects attack, but main peak comes 20-40ms later
    const searchWindowMs = 0.050;  // 50ms forward
    const searchWindowSamples = Math.floor(searchWindowMs * sampleRate);
    
    let totalOffset = 0;
    let refinedCount = 0;
    
    for (const approxTime of approximateTimestamps) {
      const startSample = Math.floor(approxTime * sampleRate);
      
      // Search for peak in FORWARD window only
      let maxAbsValue = 0;
      let maxSample = startSample;
      
      // Search from RMS time to +50ms forward
      const endSample = Math.min(channelData.length - 1, startSample + searchWindowSamples);
      
      for (let i = startSample; i <= endSample; i++) {
        const absValue = Math.abs(channelData[i]);
        if (absValue > maxAbsValue) {
          maxAbsValue = absValue;
          maxSample = i;
        }
      }
      
      const refinedTime = maxSample / sampleRate;
      refinedTimestamps.push(refinedTime);
      
      // Track offset for logging
      const offset = Math.abs(refinedTime - approxTime) * 1000;  // ms
      totalOffset += offset;
      if (offset > 1) refinedCount++;  // Count significant refinements
    }
    
    const avgOffset = approximateTimestamps.length > 0 ? 
      totalOffset / approximateTimestamps.length : 0;
    
    console.log('Timestamp Refinement:', {
      beats: approximateTimestamps.length,
      avgOffsetMs: avgOffset.toFixed(2),
      significantRefinements: refinedCount,
      searchWindow: '+0ms to +' + (searchWindowMs * 1000).toFixed(0) + 'ms (forward only)'
    });
    
    return refinedTimestamps;
  }
  
  /**
   * Calculate BPM from beat timestamps
   */
  private calculateBPMFromBeats(beats: number[]): number {
    if (beats.length < 2) return 120; // Default BPM
    
    // Calculate average interval between beats
    const avgInterval = this.calculateAverageInterval(beats);
    
    // BPM = 60 seconds / interval
    let bpm = 60 / avgInterval;
    
    // Adjust to typical range (90-180 BPM)
    while (bpm < 90) bpm *= 2;
    while (bpm > 180) bpm /= 2;
    
    return bpm;
  }

  private async detectBeatsRMS(
    audioBuffer: AudioBuffer,
    sensitivity: number,
    targetBeatCount?: number
  ): Promise<BeatDetectionResult> {
    // Get audio data from the first channel
    const audioData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    const duration = audioBuffer.duration;

    console.log('Using fallback RMS beat detection...');

    // Apply onset detection using RMS energy
    const beats = this.detectOnsets(audioData, sampleRate, sensitivity);
    
    // Calculate BPM from detected beats
    const bpm = this.calculateBPM(beats);
    
    // Calculate confidence based on beat regularity
    const confidence = this.calculateConfidence(beats, bpm);

    console.log('✅ RMS Beat Detection Complete:', {
      beatsFound: beats.length,
      bpm,
      confidence: (confidence * 100).toFixed(0) + '%',
      firstFewBeats: beats.slice(0, 5).map(b => b.toFixed(2))
    });

    // Simple approach: Use first N beats
    let finalBeats = beats;
    
    if (targetBeatCount && beats.length > targetBeatCount) {
      finalBeats = beats.slice(0, targetBeatCount);
      console.log(`📊 RMS: Using first ${targetBeatCount} beats from ${beats.length} detected`);
    }

    return {
      beats: finalBeats,
      bpm,
      confidence,
      duration
    };
  }

  private detectOnsets(audioData: Float32Array, sampleRate: number, sensitivity: number): number[] {
    const windowSize = 1024;
    const hopSize = 512;
    const beats: number[] = [];
    
    // Calculate energy for all windows first
    const energies: number[] = [];
    for (let i = 0; i < audioData.length - windowSize; i += hopSize) {
      const window = audioData.slice(i, i + windowSize);
      energies.push(this.calculateRMSEnergy(window));
    }
    
    // Global minimum threshold
    const globalThreshold = this.calculateEnergyThreshold(audioData, sensitivity);
    
    // Analyze dynamic range to determine music type
    const maxEnergy = Math.max(...energies);
    const sortedEnergies = [...energies].sort((a, b) => a - b);
    const medianEnergy = sortedEnergies[Math.floor(sortedEnergies.length / 2)];
    const dynamicRange = maxEnergy / (medianEnergy + 0.0001);
    
    // Adaptive multiplier based on music type
    let baseMultiplier: number;
    if (dynamicRange > 10) {
      baseMultiplier = 1.5; // Percussive (EDM/pop)
    } else if (dynamicRange > 5) {
      baseMultiplier = 1.3; // Mixed (rock/pop)
    } else {
      baseMultiplier = 1.2; // Melodic (classical/orchestral)
    }
    
    console.log('RMS Detection Analysis:', {
      dynamicRange: dynamicRange.toFixed(1),
      musicType: dynamicRange > 10 ? 'percussive' : dynamicRange > 5 ? 'mixed' : 'melodic',
      baseMultiplier: baseMultiplier.toFixed(2)
    });
    
    // Local adaptive threshold detection
    const localWindowSize = Math.floor((0.5 * sampleRate) / hopSize); // 500ms window
    
    for (let i = 0; i < energies.length; i++) {
      const energy = energies[i];
      
      // Calculate local average energy
      const windowStart = Math.max(0, i - localWindowSize);
      const windowEnd = Math.min(energies.length, i + localWindowSize);
      
      let localSum = 0;
      for (let j = windowStart; j < windowEnd; j++) {
        localSum += energies[j];
      }
      const localAverage = localSum / (windowEnd - windowStart);
      
      // Must exceed local threshold AND global minimum
      // Use adaptive multiplier based on music type
      const localThreshold = localAverage * (baseMultiplier + sensitivity * 0.3);
      const exceedsLocalThreshold = energy > localThreshold;
      const exceedsGlobalMin = energy > globalThreshold * 0.3;
      
      if (exceedsLocalThreshold && exceedsGlobalMin) {
        const timeStamp = (i * hopSize) / sampleRate;
        
        // Avoid beats too close together (minimum 100ms apart)
        if (beats.length === 0 || timeStamp - beats[beats.length - 1] > 0.1) {
          beats.push(timeStamp);
        }
      }
    }

    console.log('Raw beats detected (local adaptive):', beats.length);
    const refinedBeats = this.refineBeats(beats);
    console.log('Beats after refinement:', refinedBeats.length);
    
    return refinedBeats;
  }

  private calculateRMSEnergy(window: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < window.length; i++) {
      sum += window[i] * window[i];
    }
    return Math.sqrt(sum / window.length);
  }

  private calculateEnergyThreshold(audioData: Float32Array, sensitivity: number): number {
    const windowSize = 1024;
    const hopSize = 512;
    const energies: number[] = [];
    
    // Calculate energy for all windows
    for (let i = 0; i < audioData.length - windowSize; i += hopSize) {
      const window = audioData.slice(i, i + windowSize);
      energies.push(this.calculateRMSEnergy(window));
    }
    
    // Use percentile-based threshold - HIGHER to be more selective
    energies.sort((a, b) => a - b);
    // Higher threshold = fewer beats = only strongest onsets (kicks, not hi-hats)
    const percentile = 0.7 + (sensitivity * 0.25); // 70-95th percentile
    const index = Math.floor(energies.length * percentile);
    
    const threshold = energies[index] || 0;
    console.log('Beat Detection Threshold:', {
      sensitivity,
      percentile: `${(percentile * 100).toFixed(0)}th`,
      threshold: threshold.toFixed(6),
      totalWindows: energies.length,
      minEnergy: energies[0]?.toFixed(6),
      maxEnergy: energies[energies.length - 1]?.toFixed(6)
    });
    
    return threshold;
  }

  private refineBeats(rawBeats: number[]): number[] {
    if (rawBeats.length < 2) return rawBeats;
    
    // DISABLED: Refinement is too aggressive and kills most beats
    // For now, just remove obvious doubles (beats < 100ms apart)
    console.log('Removing duplicate beats (< 100ms apart)...');
    
    const dedupedBeats: number[] = [rawBeats[0]];
    for (let i = 1; i < rawBeats.length; i++) {
      const timeSinceLastBeat = rawBeats[i] - dedupedBeats[dedupedBeats.length - 1];
      if (timeSinceLastBeat >= 0.1) {  // At least 100ms apart
        dedupedBeats.push(rawBeats[i]);
      }
    }
    
    console.log('Beat deduplication:', {
      rawBeats: rawBeats.length,
      afterDedup: dedupedBeats.length,
      removed: rawBeats.length - dedupedBeats.length
    });
    
    return dedupedBeats;
  }

  private calculateBPM(beats: number[]): number {
    if (beats.length < 2) return 120; // Default BPM

    const intervals = [];
    for (let i = 1; i < beats.length; i++) {
      intervals.push(beats[i] - beats[i - 1]);
    }

    // Calculate average interval
    const avgInterval = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
    
    // Convert to BPM
    return Math.round(60 / avgInterval);
  }

  private calculateConfidence(beats: number[], bpm: number): number {
    if (beats.length < 4) return 0.3;

    const expectedInterval = 60 / bpm;
    let deviations = 0;
    
    for (let i = 1; i < beats.length; i++) {
      const actualInterval = beats[i] - beats[i - 1];
      const deviation = Math.abs(actualInterval - expectedInterval) / expectedInterval;
      deviations += deviation;
    }

    const avgDeviation = deviations / (beats.length - 1);
    
    // Convert deviation to confidence (lower deviation = higher confidence)
    return Math.max(0, Math.min(1, 1 - avgDeviation * 2));
  }

  // Generate beat-synced frame timings for given number of images
  generateFrameTimings(beats: number[], imageCount: number, offset: number = 0): number[] {
    if (beats.length === 0 || imageCount === 0) return [];

    const adjustedBeats = beats.map(beat => beat + offset).filter(beat => beat >= 0);
    
    if (adjustedBeats.length === 0) return [];

    // If we have more beats than images, use the first N beats
    if (adjustedBeats.length >= imageCount) {
      return adjustedBeats.slice(0, imageCount);
    }

    // If we have fewer beats than images, extrapolate based on BPM
    const frameTimes = [...adjustedBeats];
    const avgInterval = this.calculateAverageInterval(adjustedBeats);
    
    // Extend forward to reach required image count
    let lastTime = adjustedBeats[adjustedBeats.length - 1];
    while (frameTimes.length < imageCount) {
      lastTime += avgInterval;
      frameTimes.push(lastTime);
    }

    return frameTimes.slice(0, imageCount);
  }

  /**
   * SMART SYNC: Convert beat timestamps to frame durations
   * 
   * Intelligent behavior:
   * - More beats than images? Use first N beats, perfect sync ✓
   * - More images than beats? Use only images that fit beats ✓
   * - Quality always prioritized over quantity!
   */
  generateFrameDurations(beats: number[], imageCount: number, offset: number = 0): number[] {
    if (beats.length === 0 || imageCount === 0) return [];
    
    // Apply offset to beats
    const adjustedBeats = beats.map(b => b + offset).filter(b => b >= 0);
    
    if (adjustedBeats.length === 0) return [];
    
    // SMART DECISION: Use whichever is less (quality over quantity)
    const usableCount = Math.min(imageCount, adjustedBeats.length - 1);
    
    console.log('🎯 SMART SYNC DECISION:', {
      imagesUploaded: imageCount,
      beatsDetected: adjustedBeats.length,
      decision: imageCount <= adjustedBeats.length 
        ? `✓ All ${imageCount} images will sync to beats` 
        : `⚠️  Only ${usableCount} images will be used (${imageCount - usableCount} extra images ignored)`,
      strategy: imageCount <= adjustedBeats.length 
        ? 'One image per beat' 
        : 'Limited by beat count',
      audioUsed: `${(adjustedBeats[usableCount]).toFixed(1)}s / ${adjustedBeats[adjustedBeats.length - 1].toFixed(1)}s`
    });
    
    if (adjustedBeats.length >= imageCount) {
      // PLENTY OF BEATS: Use first N consecutive beats for N images
      const durations: number[] = [];
      
      // Each image shows from one beat to the next beat
      for (let i = 0; i < imageCount; i++) {
        if (i + 1 < adjustedBeats.length) {
          // Duration = time from this beat to next beat
          const duration = adjustedBeats[i + 1] - adjustedBeats[i];
          durations.push(duration);
        } else {
          // Last image: use average interval
          const avgInterval = this.calculateAverageInterval(adjustedBeats);
          durations.push(avgInterval);
        }
      }
      
      console.log('✅ Perfect Sync - All images will be used:', {
        images: imageCount,
        beats: adjustedBeats.length,
        beatsUsed: `First ${imageCount} of ${adjustedBeats.length}`,
        videoDuration: durations.reduce((sum, d) => sum + d, 0).toFixed(2) + 's',
        avgBeatInterval: (durations.reduce((sum, d) => sum + d, 0) / imageCount).toFixed(3) + 's'
      });
      
      return durations;
      
    } else {
      // FEWER BEATS THAN IMAGES: Only use images up to available beats
      // Don't extend beyond music - stop naturally when beats end
      const durations: number[] = [];
      const usableImages = Math.min(adjustedBeats.length - 1, imageCount);
      
      // Use actual beat intervals for available beats
      for (let i = 0; i < usableImages; i++) {
        durations.push(adjustedBeats[i + 1] - adjustedBeats[i]);
      }
      
      console.log('⚠️  Limited by beats - Some images won\'t be used:', {
        imagesUploaded: imageCount,
        imagesUsed: usableImages,
        imagesIgnored: imageCount - usableImages,
        beatsAvailable: adjustedBeats.length,
        explanation: `Only ${usableImages} images synced to ${usableImages} beats. ${imageCount - usableImages} extra images won't appear.`,
        videoDuration: durations.reduce((sum, d) => sum + d, 0).toFixed(2) + 's',
        recommendation: 'Upload fewer images or use longer music'
      });
      
      return durations;
    }
  }

  private calculateAverageInterval(beats: number[]): number {
    if (beats.length < 2) return 0.5; // Default 0.5s interval

    let totalInterval = 0;
    for (let i = 1; i < beats.length; i++) {
      totalInterval += beats[i] - beats[i - 1];
    }

    return totalInterval / (beats.length - 1);
  }


  // Calculate total duration needed for all images with beat sync
  calculateSyncedDuration(beats: number[], imageCount: number, offset: number = 0): number {
    const frameTimings = this.generateFrameTimings(beats, imageCount, offset);
    if (frameTimings.length === 0) return 0;

    // Add a small buffer after the last frame
    return frameTimings[frameTimings.length - 1] + 0.1;
  }

  cleanup(): void {
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  // ========================================
  // MULTI-BAND DETECTION METHODS
  // ========================================

  /**
   * PHASE 2: Split audio into frequency bands
   * 
   * Creates 5 filtered versions of the audio, each containing only a specific frequency range.
   * This allows detecting kicks (bass) separately from hi-hats (treble).
   * 
   * @param audioBuffer - Original audio to split
   * @returns Map of band name to filtered audio buffer
   */
  private async splitIntoBands(
    audioBuffer: AudioBuffer
  ): Promise<Map<string, AudioBuffer>> {
    console.log('🎛️ Splitting audio into frequency bands...');
    console.log(`   Sample rate: ${audioBuffer.sampleRate} Hz`);
    console.log(`   Duration: ${audioBuffer.duration.toFixed(2)}s`);
    
    const bands = new Map<string, AudioBuffer>();
    const startTime = performance.now();
    
    // Filter audio for each frequency band
    for (const band of FREQUENCY_BANDS) {
      const bandStart = performance.now();
      
      console.log(`   Filtering ${band.name} (${band.lowFreq}-${band.highFreq} Hz)...`);
      
      try {
        const filtered = await AudioFilter.createBandpassFilter(
          audioBuffer,
          band.lowFreq,
          band.highFreq
        );
        
        bands.set(band.name, filtered);
        
        const bandTime = performance.now() - bandStart;
        console.log(`     ✓ ${band.name}: ${bandTime.toFixed(0)}ms - ${band.description}`);
      } catch (error) {
        console.error(`     ✗ Failed to filter ${band.name}:`, error);
        throw error;
      }
    }
    
    const totalTime = performance.now() - startTime;
    console.log(`✅ All bands filtered in ${totalTime.toFixed(0)}ms`);
    
    return bands;
  }

  /**
   * Helper: Get RMS energy at a specific time position
   * Used for scoring onset strength
   */
  private getEnergyAt(
    channelData: Float32Array,
    time: number,
    sampleRate: number,
    windowSize: number = 0.05  // 50ms window
  ): number {
    const sampleIndex = Math.floor(time * sampleRate);
    const windowSamples = Math.floor(windowSize * sampleRate);
    
    const start = Math.max(0, sampleIndex - Math.floor(windowSamples / 2));
    const end = Math.min(channelData.length, sampleIndex + Math.floor(windowSamples / 2));
    
    let sumSquares = 0;
    for (let i = start; i < end; i++) {
      sumSquares += channelData[i] * channelData[i];
    }
    
    return Math.sqrt(sumSquares / (end - start));
  }

  /**
   * PHASE 3: Detect onsets in a single audio buffer (reusable)
   * 
   * Extracted from detectBeatsWebAudio to be reusable for any audio buffer.
   * This is the core onset detection that works on filtered bands.
   * 
   * @param audioBuffer - Audio buffer to analyze (could be filtered to specific band)
   * @param sensitivity - Detection sensitivity (0-1)
   * @param bandName - Optional band name for logging
   * @returns Array of onset timestamps in seconds
   */
  private async detectOnsetsInBuffer(
    audioBuffer: AudioBuffer,
    sensitivity: number,
    bandName?: string
  ): Promise<number[]> {
    const fftSize = 2048;
    const hopSize = 1024;
    
    // Compute spectral flux
    const flux = this.computeSpectralFlux(audioBuffer, fftSize, hopSize);
    
    // Detect onsets from flux curve
    const timestamps = this.detectOnsetsFromFlux(
      flux,
      audioBuffer.sampleRate,
      hopSize,
      sensitivity
    );
    
    return timestamps;
  }

  /**
   * PHASE 3: Detect onsets in all frequency bands
   * 
   * Runs onset detection separately on each filtered band and collects all onsets
   * with their band information and energy levels.
   * 
   * @param bands - Map of filtered audio buffers (one per frequency band)
   * @param sensitivity - Detection sensitivity
   * @returns Array of all onsets across all bands with metadata
   */
  private async detectMultiBandOnsets(
    bands: Map<string, AudioBuffer>,
    sensitivity: number
  ): Promise<BandOnset[]> {
    console.log('🎵 Detecting onsets in each frequency band...');
    
    const allOnsets: BandOnset[] = [];
    let totalOnsets = 0;
    
    // Convert Map to array for iteration (TypeScript compatibility)
    const bandEntries = Array.from(bands.entries());
    
    for (const [bandName, buffer] of bandEntries) {
      const bandConfig = FREQUENCY_BANDS.find(b => b.name === bandName);
      if (!bandConfig) continue;
      
      console.log(`   Analyzing ${bandName} band...`);
      
      try {
        // Detect onsets in this specific frequency band
        const timestamps = await this.detectOnsetsInBuffer(
          buffer,
          sensitivity,
          bandName
        );
        
        // Calculate energy and flux for each onset
        const channelData = buffer.getChannelData(0);
        const sampleRate = buffer.sampleRate;
        
        // Compute flux for energy reference
        const flux = this.computeSpectralFlux(buffer, 2048, 1024);
        
        for (const time of timestamps) {
          const energy = this.getEnergyAt(channelData, time, sampleRate);
          
          // Get flux value at this time
          const fluxIndex = Math.floor((time * sampleRate) / 1024);
          const fluxValue = flux[Math.min(fluxIndex, flux.length - 1)];
          
          allOnsets.push({
            time,
            band: bandName,
            weight: bandConfig.weight,
            energy,
            flux: fluxValue
          });
        }
        
        console.log(`     ✓ ${timestamps.length} onsets in ${bandName}`);
        totalOnsets += timestamps.length;
        
      } catch (error) {
        console.error(`     ✗ Failed to detect onsets in ${bandName}:`, error);
      }
    }
    
    console.log(`📊 Total onsets detected: ${totalOnsets} across ${bands.size} bands`);
    
    return allOnsets;
  }

  /**
   * PHASE 4: Score a multi-band onset
   * 
   * Calculates importance score based on:
   * - Band weight (bass = 5x, hi-hats = 0.5x)
   * - Local energy
   * - Simultaneity bonus (multiple bands firing together)
   * 
   * @param onset - The onset to score
   * @param allOnsets - All onsets for simultaneity calculation
   * @returns Score value (higher = more important)
   */
  private scoreMultiBandOnset(onset: BandOnset, allOnsets: BandOnset[]): number {
    // Base score = band weight × local energy
    let score = onset.weight * onset.energy;
    
    // Bonus for multiple bands firing simultaneously (within 50ms)
    // This indicates a "full spectrum hit" - very important beat
    const simultaneousCount = this.countSimultaneousOnsets(onset, allOnsets);
    const simultaneousBonus = 1 + (simultaneousCount * 0.2); // Up to +100% boost
    
    score *= simultaneousBonus;
    
    return score;
  }

  /**
   * Count how many other bands have onsets near this one
   * Multiple bands = more important beat (e.g., kick + snare together)
   */
  private countSimultaneousOnsets(
    target: BandOnset,
    allOnsets: BandOnset[]
  ): number {
    const WINDOW = 0.05; // 50ms window
    
    let count = 0;
    for (const other of allOnsets) {
      if (other.band !== target.band && 
          Math.abs(other.time - target.time) < WINDOW) {
        count++;
      }
    }
    return count;
  }

  /**
   * PHASE 4: Merge nearby onsets
   * 
   * Same beat might trigger in multiple bands (e.g., kick in both sub-bass and low-mid).
   * Group nearby onsets and keep the one with highest score.
   * 
   * @param onsets - All detected onsets
   * @param threshold - Time window for merging (default 50ms)
   * @returns Merged onsets (duplicates removed)
   */
  private mergeNearbyOnsets(
    onsets: BandOnset[],
    threshold: number = 0.05
  ): BandOnset[] {
    if (onsets.length === 0) return [];
    
    // Sort by time
    const sorted = [...onsets].sort((a, b) => a.time - b.time);
    
    const merged: BandOnset[] = [];
    let currentGroup: BandOnset[] = [];
    
    for (const onset of sorted) {
      if (currentGroup.length === 0) {
        currentGroup.push(onset);
        continue;
      }
      
      const lastTime = currentGroup[currentGroup.length - 1].time;
      
      if (onset.time - lastTime < threshold) {
        // Within threshold - add to current group
        currentGroup.push(onset);
      } else {
        // Outside threshold - finalize current group, start new one
        merged.push(this.selectBestFromGroup(currentGroup, onsets));
        currentGroup = [onset];
      }
    }
    
    // Don't forget last group
    if (currentGroup.length > 0) {
      merged.push(this.selectBestFromGroup(currentGroup, onsets));
    }
    
    console.log(`🔗 Merged ${onsets.length} onsets → ${merged.length} unique beats`);
    
    return merged;
  }

  /**
   * From a group of nearby onsets, select the one with highest score
   */
  private selectBestFromGroup(group: BandOnset[], allOnsets: BandOnset[]): BandOnset {
    return group.reduce((best, current) => {
      const bestScore = this.scoreMultiBandOnset(best, allOnsets);
      const currentScore = this.scoreMultiBandOnset(current, allOnsets);
      return currentScore > bestScore ? current : best;
    });
  }

  /**
   * PHASE 4: Select top N beats from multi-band onsets
   * 
   * Scores all onsets and selects the N strongest for N images.
   * Natural selection based on score (not segment-based).
   * 
   * @param onsets - All merged onsets
   * @param targetCount - Number of beats to select (image count)
   * @returns Array of beat timestamps in chronological order
   */
  private selectTopMultiBandBeats(
    onsets: BandOnset[],
    targetCount?: number
  ): number[] {
    if (!targetCount || onsets.length <= targetCount) {
      // Use all onsets
      return onsets.map(o => o.time).sort((a, b) => a - b);
    }
    
    // Score all onsets
    const scored = onsets.map(onset => ({
      time: onset.time,
      score: this.scoreMultiBandOnset(onset, onsets),
      band: onset.band
    }));
    
    // Sort by score (highest first)
    scored.sort((a, b) => b.score - a.score);
    
    // Take top N
    const selected = scored.slice(0, targetCount);
    
    // Log top scores for debugging
    console.log(`🎯 Top 10 scores: ${scored.slice(0, 10).map(s => s.score.toFixed(2)).join(', ')}`);
    console.log(`🎯 Selected beats from bands: ${selected.map(s => s.band).join(', ')}`);
    
    // Return in chronological order
    return selected
      .map(s => s.time)
      .sort((a, b) => a - b);
  }

  /**
   * PHASE 1: Score beats by RMS energy
   * Louder beats (like kick drums) score higher than quiet beats (like hi-hats)
   */
  private scoreBeats(audioBuffer: AudioBuffer, beatTimes: number[]): ScoredBeat[] {
    const channelData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    
    return beatTimes.map(time => {
      const sampleIndex = Math.floor(time * sampleRate);
      
      // Calculate RMS energy in 100ms window around beat
      const windowSize = Math.floor(0.1 * sampleRate); // 100ms window
      const start = Math.max(0, sampleIndex - Math.floor(windowSize / 2));
      const end = Math.min(channelData.length, sampleIndex + Math.floor(windowSize / 2));
      
      // Calculate RMS energy
      let sumSquares = 0;
      for (let i = start; i < end; i++) {
        sumSquares += channelData[i] * channelData[i];
      }
      const energy = Math.sqrt(sumSquares / (end - start));
      
      // For Phase 1, score = energy
      // (Phase 2 will add frequency weighting)
      const score = energy;
      
      return {
        time,
        energy,
        score
      };
    });
  }

  /**
   * PHASE 1: Select top N beats with even distribution
   * Divides song into N segments and picks strongest beat from each segment
   * This prevents clustering all beats in the chorus (high-energy section)
   */
  private selectTopBeats(scoredBeats: ScoredBeat[], targetCount: number): number[] {
    if (scoredBeats.length === 0) return [];
    
    // Get song duration from last beat
    const songDuration = Math.max(...scoredBeats.map(b => b.time));
    
    // Divide song into equal time segments
    const segmentDuration = songDuration / targetCount;
    
    const selectedBeats: number[] = [];
    
    for (let i = 0; i < targetCount; i++) {
      const segmentStart = i * segmentDuration;
      const segmentEnd = (i + 1) * segmentDuration;
      
      // Find all beats in this time segment
      const beatsInSegment = scoredBeats.filter(
        b => b.time >= segmentStart && b.time < segmentEnd
      );
      
      if (beatsInSegment.length > 0) {
        // Pick the STRONGEST beat in this segment
        const strongestBeat = beatsInSegment.reduce((max, current) => 
          current.score > max.score ? current : max
        );
        selectedBeats.push(strongestBeat.time);
      } else {
        // No beats in this segment - find closest beat
        const closest = scoredBeats.reduce((closest, current) => {
          const distToSegmentCenter = Math.abs(current.time - (segmentStart + segmentEnd) / 2);
          const distToClosest = Math.abs(closest.time - (segmentStart + segmentEnd) / 2);
          return distToSegmentCenter < distToClosest ? current : closest;
        });
        selectedBeats.push(closest.time);
      }
    }
    
    // Already in chronological order due to segment-based iteration
    return selectedBeats;
  }
}
