export interface EyePoints {
  left: [number, number];
  right: [number, number];
}

// Object Tracking Types
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ObjectMask {
  data: Uint8Array;
  width: number;
  height: number;
  confidence: number;
  boundingBox: BoundingBox;
  area: number; // Percentage of image area
  solidity: number; // Shape solidity metric (0-1)
}

export interface FeaturePoint {
  x: number;
  y: number;
  size: number;
  angle: number;
  response: number;
  octave: number;
  descriptor?: Float32Array;
}

export interface FeatureSet {
  keypoints: FeaturePoint[];
  descriptors: Float32Array;
  count: number;
}

export interface FeatureMatch {
  queryIdx: number;
  trainIdx: number;
  distance: number;
}

export interface MatchResult {
  matches: FeatureMatch[];
  inlierCount: number;
  confidence: number;
  transform?: AffineTransform;
}

export interface AffineTransform {
  matrix: Float64Array; // 2x3 transformation matrix
  rotation: number; // Rotation angle in degrees
  scale: number; // Scale factor
  translation: [number, number]; // Translation vector [x, y]
}

export interface SegmentationQuality {
  confidence: number;
  area: number;
  solidity: number;
  isValid: boolean;
  warnings: string[];
}

export interface AlignmentQuality {
  featureCount: number;
  matchCount: number;
  inlierCount: number;
  confidence: number;
  isValid: boolean;
  warnings: string[];
}

export interface ImageData {
  id: string;
  file: File;
  url: string;
  aligned: boolean;
  
  // Legacy face tracking (keep for backward compatibility)
  eyePoints?: EyePoints;
  faceResult?: FaceDetectionResult;
  
  // Object tracking (new)
  boundingBox?: BoundingBox;
  mask?: ObjectMask;
  features?: FeatureSet;
  matches?: MatchResult;
  transform?: AffineTransform;
  segmentationQuality?: SegmentationQuality;
  alignmentQuality?: AlignmentQuality;
  
  // Common properties
  alignedCanvas?: HTMLCanvasElement;
  processedUrl?: string;
  error?: string; // Error message if processing failed
  status: 'pending' | 'processing' | 'aligned' | 'failed';
}

export interface ProcessingStatus {
  isProcessing: boolean;
  currentStep: string;
  progress: number;
  error?: string;
}

export interface BeatSyncSettings {
  enabled: boolean;
  musicFile?: File;
  beatSensitivity: number; // 0.1 - 1.0: Controls onset detection threshold
  beatOffset: number; // -2.0 to +2.0: Start time adjustment in seconds
}

export interface ExportSettings {
  format: 'gif' | 'mp4';
  resolution: '480p' | '720p' | '1080p';
  frameDuration: number;
  addSound: boolean;
  soundType: 'builtin' | 'custom';
  builtinSound: 'click';
  customAudioFile?: File;
  audioVolume: number;
  beatSync: BeatSyncSettings;
  loop: boolean;
  alignmentMode: 'full' | 'face-crop' | 'object-crop' | 'smart-frame';
}

export interface ResolutionConfig {
  width: number;
  height: number;
}

export type ProcessingStep = 
  | 'idle' 
  | 'detecting_faces'  // Legacy
  | 'segmenting_objects' // New
  | 'extracting_features' // New
  | 'matching_features' // New
  | 'aligning_images' 
  | 'generating_preview' 
  | 'exporting_video' 
  | 'complete' 
  | 'error';

export interface AudioSettings {
  enabled: boolean;
  type: 'builtin' | 'custom';
  builtinSound: 'click' | 'shutter' | 'pop';
  customFile?: File;
  volume: number;
  syncMode: 'frame-start' | 'frame-center';
}

export const RESOLUTION_CONFIGS: Record<string, ResolutionConfig> = {
  '480p': { width: 640, height: 480 },
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
};

export interface FaceLandmark {
  x: number;
  y: number;
  z?: number;
}

export interface FaceDetectionResult {
  landmarks: FaceLandmark[];
  eyePoints: EyePoints;
  confidence: number;
  faceBounds?: {
    left: number;
    right: number;
    top: number;
    bottom: number;
    width: number;
    height: number;
    centerX: number;
    centerY: number;
  };
}

// Object Segmentation Result
export interface ObjectSegmentationResult {
  mask: ObjectMask;
  boundingBox: BoundingBox;
  confidence: number;
  quality: SegmentationQuality;
  method: 'sam' | 'grabcut';
}

export interface AnimationFrame {
  canvas: HTMLCanvasElement;
  duration: number;
  imageId: string;
}

export interface VideoExportProgress {
  phase: 'preparing' | 'encoding' | 'finalizing' | 'complete';
  progress: number;
  frameCount?: number;
  currentFrame?: number;
  message?: string;
}

export interface AppState {
  images: ImageData[];
  processingStatus: ProcessingStatus;
  exportSettings: ExportSettings;
  previewFrames: AnimationFrame[];
  isPlaying: boolean;
  currentFrame: number;
  audioSettings: AudioSettings;
}

// Object Tracking Configuration
export interface ObjectTrackingConfig {
  segmentationMethod: 'sam' | 'grabcut' | 'auto';
  featureDetector: 'orb' | 'sift' | 'akaze';
  featureCount: number; // 500-2000
  matcherType: 'bruteforce' | 'flann';
  ransacThreshold: number; // 1-5 pixels
  minInliers: number; // Minimum inliers for valid alignment
  minMatches: number; // Minimum matches to attempt alignment
  useGaussianBlur: boolean;
  blurSigma: number;
}

export const DEFAULT_TRACKING_CONFIG: ObjectTrackingConfig = {
  segmentationMethod: 'auto',
  featureDetector: 'orb',
  featureCount: 1000,
  matcherType: 'bruteforce',
  ransacThreshold: 3.0,
  minInliers: 50,
  minMatches: 30,
  useGaussianBlur: true,
  blurSigma: 1.0,
};

// Processing Statistics
export interface ProcessingStats {
  totalImages: number;
  processedImages: number;
  alignedImages: number;
  failedImages: number;
  averageFeatureCount: number;
  averageMatchCount: number;
  averageInlierCount: number;
  averageConfidence: number;
  processingTime: number; // milliseconds
}