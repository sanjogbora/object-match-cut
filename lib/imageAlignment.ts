import { 
  EyePoints, 
  ResolutionConfig, 
  FaceDetectionResult, 
  FaceLandmark,
  AffineTransform,
  ObjectMask 
} from './types';

export type AlignmentMode = 'full' | 'face-crop' | 'object-crop' | 'smart-frame';

// Legacy transform type for face-based alignment (uses nested arrays)
interface LegacyAlignmentTransform {
  rotation: number;
  scale: number;
  translation: [number, number];
  matrix: number[][];
}

export class ImageAligner {
  private targetEyeDistance = 0.35; // Target eye distance as proportion of canvas width
  private targetEyeY = 0.4; // Target eye Y position as proportion of canvas height
  
  // Enhanced alignment features
  private previousTransforms: LegacyAlignmentTransform[] = [];
  private smoothingFactor = 0.15; // Temporal smoothing to reduce jitter
  private useSubPixelPrecision = true;

  constructor(targetEyeDistance = 0.35, targetEyeY = 0.4) {
    this.targetEyeDistance = targetEyeDistance;
    this.targetEyeY = targetEyeY;
  }

  // Enhanced eye center calculation using pupil approximation
  private calculatePreciseEyeCenter(landmarks: FaceLandmark[], eyeIndices: number[]): [number, number] {
    const validLandmarks = eyeIndices
      .map(idx => landmarks[idx])
      .filter(landmark => landmark);

    if (validLandmarks.length === 0) {
      throw new Error('No valid eye landmarks found');
    }

    // Weight inner eye landmarks more heavily (closer to actual pupil position)
    let weightedX = 0, weightedY = 0, totalWeight = 0;

    validLandmarks.forEach((landmark, i) => {
      // Inner landmarks get higher weight for better pupil approximation
      const isCorner = eyeIndices[i] === 33 || eyeIndices[i] === 133 || eyeIndices[i] === 362 || eyeIndices[i] === 263;
      const weight = isCorner ? 0.5 : 1.5; // Reduce weight of corner points
      
      weightedX += landmark.x * weight;
      weightedY += landmark.y * weight;
      totalWeight += weight;
    });

    return [weightedX / totalWeight, weightedY / totalWeight];
  }

  alignImage(
    sourceImage: HTMLImageElement,
    eyePoints: EyePoints,
    targetResolution: ResolutionConfig
  ): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = targetResolution.width;
    canvas.height = targetResolution.height;
    const ctx = canvas.getContext('2d')!;

    // Calculate alignment transform
    const transform = this.calculateAlignmentTransform(
      eyePoints,
      targetResolution
    );

    // Apply transformation and draw image
    ctx.save();
    ctx.setTransform(
      transform.matrix[0][0], transform.matrix[0][1],
      transform.matrix[1][0], transform.matrix[1][1],
      transform.matrix[0][2], transform.matrix[1][2]
    );

    ctx.drawImage(sourceImage, 0, 0);
    ctx.restore();

    return canvas;
  }

  private calculateAlignmentTransform(
    eyePoints: EyePoints,
    targetResolution: ResolutionConfig
  ): LegacyAlignmentTransform {
    const { left, right } = eyePoints;
    const { width, height } = targetResolution;

    // Calculate current eye properties with higher precision
    const eyeCenterX = (left[0] + right[0]) / 2;
    const eyeCenterY = (left[1] + right[1]) / 2;
    const currentEyeDistance = Math.sqrt(
      Math.pow(right[0] - left[0], 2) + Math.pow(right[1] - left[1], 2)
    );
    const eyeAngle = Math.atan2(right[1] - left[1], right[0] - left[0]);

    // Calculate target eye properties
    const targetEyeDistancePixels = width * this.targetEyeDistance;
    const targetEyeCenterX = width / 2;
    const targetEyeCenterY = height * this.targetEyeY;

    // Calculate transformations
    const scale = targetEyeDistancePixels / currentEyeDistance;
    const rotation = -eyeAngle; // Negative to counter-rotate

    // Create base transform
    const transform: LegacyAlignmentTransform = {
      rotation: rotation * (180 / Math.PI), // Convert to degrees
      scale,
      translation: [targetEyeCenterX - eyeCenterX * scale, targetEyeCenterY - eyeCenterY * scale],
      matrix: this.createTransformMatrix(scale, rotation, targetEyeCenterX - eyeCenterX * scale, targetEyeCenterY - eyeCenterY * scale)
    };

    // Apply temporal smoothing to reduce jitter between frames
    return this.applySmoothingToTransform(transform);
  }

  private createTransformMatrix(scale: number, rotation: number, tx: number, ty: number): number[][] {
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);

    return [
      [scale * cos, -scale * sin, tx],
      [scale * sin, scale * cos, ty]
    ];
  }

  private applySmoothingToTransform(transform: LegacyAlignmentTransform): LegacyAlignmentTransform {
    if (this.previousTransforms.length === 0) {
      this.previousTransforms.push(transform);
      return transform;
    }

    const recent = this.previousTransforms[this.previousTransforms.length - 1];
    const alpha = this.smoothingFactor;

    const smoothed: LegacyAlignmentTransform = {
      rotation: this.interpolateAngle(recent.rotation, transform.rotation, alpha),
      scale: recent.scale * (1 - alpha) + transform.scale * alpha,
      translation: [
        recent.translation[0] * (1 - alpha) + transform.translation[0] * alpha,
        recent.translation[1] * (1 - alpha) + transform.translation[1] * alpha
      ],
      matrix: transform.matrix // Recalculate matrix after smoothing
    };

    // Recalculate matrix with smoothed values
    const radians = smoothed.rotation * (Math.PI / 180);
    smoothed.matrix = this.createTransformMatrix(smoothed.scale, radians, smoothed.translation[0], smoothed.translation[1]);

    this.previousTransforms.push(smoothed);
    
    // Keep only recent transforms for memory efficiency
    if (this.previousTransforms.length > 3) {
      this.previousTransforms.shift();
    }

    return smoothed;
  }

  private interpolateAngle(angle1: number, angle2: number, alpha: number): number {
    // Handle angle wraparound for smooth rotation interpolation
    let diff = angle2 - angle1;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    return angle1 + diff * alpha;
  }

  // Reset smoothing state (call when processing a new set of images)
  resetSmoothingState(): void {
    this.previousTransforms = [];
  }

  // Full image alignment method that preserves entire image on canvas
  alignImageFull(
    sourceImage: HTMLImageElement,
    eyePoints: EyePoints,
    targetResolution: ResolutionConfig
  ): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = targetResolution.width;
    canvas.height = targetResolution.height;
    const ctx = canvas.getContext('2d')!;

    const { left, right } = eyePoints;
    const { width: canvasWidth, height: canvasHeight } = targetResolution;

    // Calculate eye properties in source image
    const eyeCenterX = (left[0] + right[0]) / 2;
    const eyeCenterY = (left[1] + right[1]) / 2;
    const eyeAngle = Math.atan2(right[1] - left[1], right[0] - left[0]);
    const currentEyeDistance = Math.sqrt(
      Math.pow(right[0] - left[0], 2) + Math.pow(right[1] - left[1], 2)
    );

    // Target eye properties on canvas
    const targetEyeDistance = canvasWidth * this.targetEyeDistance;
    const targetEyeCenterX = canvasWidth / 2;
    const targetEyeCenterY = canvasHeight * this.targetEyeY;
    
    // Calculate scale based on eye distance
    const eyeScale = targetEyeDistance / currentEyeDistance;
    
    // Calculate the scaled image dimensions
    const scaledImageWidth = sourceImage.width * eyeScale;
    const scaledImageHeight = sourceImage.height * eyeScale;
    
    // Calculate final scale to fit entire image on canvas if needed
    const canvasFitScaleX = canvasWidth / scaledImageWidth;
    const canvasFitScaleY = canvasHeight / scaledImageHeight;
    const canvasFitScale = Math.min(canvasFitScaleX, canvasFitScaleY, 1); // Don't upscale beyond eye scale
    
    // Final scale combines eye alignment and canvas fitting
    const finalScale = eyeScale * canvasFitScale;
    
    // Calculate where the image should be positioned to keep eyes at target position
    const scaledEyeCenterX = eyeCenterX * finalScale;
    const scaledEyeCenterY = eyeCenterY * finalScale;
    
    // Calculate image position (top-left corner) to place eyes at target position
    const cos = Math.cos(-eyeAngle);
    const sin = Math.sin(-eyeAngle);
    
    // Apply transformations
    ctx.save();
    
    // Clear canvas with transparent background
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    
    console.log('alignImageFull debug:', {
      sourceImageSize: { width: sourceImage.width, height: sourceImage.height },
      canvasSize: { width: canvasWidth, height: canvasHeight },
      eyeScale,
      canvasFitScale,
      finalScale,
      eyeCenterX,
      eyeCenterY,
      targetEyeCenterX,
      targetEyeCenterY,
      eyeAngle: eyeAngle * (180 / Math.PI) + ' degrees',
      imageComplete: sourceImage.complete,
      imageSrc: sourceImage.src.substring(0, 50) + '...'
    });
    
    // Verify source image has content by drawing to a test canvas
    const testCanvas = document.createElement('canvas');
    testCanvas.width = sourceImage.width;
    testCanvas.height = sourceImage.height;
    const testCtx = testCanvas.getContext('2d')!;
    testCtx.drawImage(sourceImage, 0, 0);
    const testImageData = testCtx.getImageData(0, 0, sourceImage.width, sourceImage.height);
    const sourceHasContent = testImageData.data.some((value, index) => {
      return index % 4 === 3 && value > 0; // Check alpha channel
    });
    console.log('Source image has content:', sourceHasContent);
    
    // Move to target eye center
    ctx.translate(targetEyeCenterX, targetEyeCenterY);
    
    // Rotate to align eyes horizontally
    ctx.rotate(-eyeAngle);
    
    // Scale to match target eye distance and fit canvas
    ctx.scale(finalScale, finalScale);
    
    // Draw image centered on eye center in the scaled/rotated coordinate system
    ctx.drawImage(
      sourceImage,
      -eyeCenterX,
      -eyeCenterY,
      sourceImage.width,
      sourceImage.height
    );
    
    console.log('DrawImage parameters:', {
      dx: -eyeCenterX,
      dy: -eyeCenterY, 
      dWidth: sourceImage.width,
      dHeight: sourceImage.height,
      currentTransform: ctx.getTransform()
    });
    
    // Check immediately if drawing worked within the transform
    const immediateCheck = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
    const drewSomething = immediateCheck.data.some((value, index) => {
      return index % 4 === 3 && value > 0;
    });
    console.log('Content exists immediately after drawImage (within transform):', drewSomething);
    
    ctx.restore();
    
    // Debug: Check if canvas has content
    const imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
    const hasContent = imageData.data.some((value, index) => {
      return index % 4 === 3 && value > 0; // Check alpha channel for non-transparent pixels
    });
    console.log('Canvas has content after drawing:', hasContent);
    
    if (!hasContent) {
      console.warn('WARNING: Canvas appears to be empty after alignment');
      // Debug: Try a simple red rectangle to verify canvas is working
      ctx.fillStyle = 'red';
      ctx.fillRect(10, 10, 50, 50);
      console.log('Added debug red rectangle to empty canvas');
    }

    return canvas;
  }

  // Enhanced face cropping alignment with improved eye detection
  alignImageFaceCrop(
    sourceImage: HTMLImageElement,
    faceResult: FaceDetectionResult,
    targetResolution: ResolutionConfig,
    padding: number = 0.6 // 60% padding around face for better framing
  ): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = targetResolution.width;
    canvas.height = targetResolution.height;
    const ctx = canvas.getContext('2d')!;

    // Enable high-quality rendering for better results
    if (this.useSubPixelPrecision) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
    }

    const { eyePoints, faceBounds, landmarks } = faceResult;
    const { width: canvasWidth, height: canvasHeight } = targetResolution;

    if (!faceBounds) {
      // Fallback to full alignment if no face bounds
      return this.alignImageFull(sourceImage, eyePoints, targetResolution);
    }

    // Try to use enhanced eye detection if landmarks are available
    let enhancedEyePoints = eyePoints;
    if (landmarks && landmarks.length > 0) {
      try {
        const leftEyeIndices = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161];
        const rightEyeIndices = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384];
        
        const leftEyeCenter = this.calculatePreciseEyeCenter(landmarks, leftEyeIndices);
        const rightEyeCenter = this.calculatePreciseEyeCenter(landmarks, rightEyeIndices);
        
        enhancedEyePoints = {
          left: [leftEyeCenter[0] * sourceImage.width, leftEyeCenter[1] * sourceImage.height],
          right: [rightEyeCenter[0] * sourceImage.width, rightEyeCenter[1] * sourceImage.height]
        };
      } catch (error) {
        console.log('Enhanced eye detection failed, using fallback:', error);
        // Continue with original eye points
      }
    }

    // Calculate padded face region with extra vertical padding
    const faceWidth = faceBounds.width;
    const faceHeight = faceBounds.height;
    const paddingX = faceWidth * padding;
    const paddingY = faceHeight * (padding + 0.2); // Extra 20% vertical padding for forehead/chin

    const cropLeft = Math.max(0, faceBounds.left - paddingX);
    const cropTop = Math.max(0, faceBounds.top - paddingY);
    const cropRight = Math.min(sourceImage.width, faceBounds.right + paddingX);
    const cropBottom = Math.min(sourceImage.height, faceBounds.bottom + paddingY);

    const cropWidth = cropRight - cropLeft;
    const cropHeight = cropBottom - cropTop;

    // Adjust eye points relative to crop region (use enhanced points if available)
    const adjustedEyePoints: EyePoints = {
      left: [enhancedEyePoints.left[0] - cropLeft, enhancedEyePoints.left[1] - cropTop],
      right: [enhancedEyePoints.right[0] - cropLeft, enhancedEyePoints.right[1] - cropTop]
    };

    // Calculate eye properties in cropped region
    const eyeCenterX = (adjustedEyePoints.left[0] + adjustedEyePoints.right[0]) / 2;
    const eyeCenterY = (adjustedEyePoints.left[1] + adjustedEyePoints.right[1]) / 2;
    const eyeAngle = Math.atan2(
      adjustedEyePoints.right[1] - adjustedEyePoints.left[1],
      adjustedEyePoints.right[0] - adjustedEyePoints.left[0]
    );
    const currentEyeDistance = Math.sqrt(
      Math.pow(adjustedEyePoints.right[0] - adjustedEyePoints.left[0], 2) +
      Math.pow(adjustedEyePoints.right[1] - adjustedEyePoints.left[1], 2)
    );

    // Target eye properties
    const targetEyeDistance = canvasWidth * this.targetEyeDistance;
    const targetEyeCenterX = canvasWidth / 2;
    const targetEyeCenterY = canvasHeight * this.targetEyeY;

    // Calculate scale to fit cropped region to canvas
    const eyeScale = targetEyeDistance / currentEyeDistance;
    const scaleToFitX = canvasWidth / cropWidth;
    const scaleToFitY = canvasHeight / cropHeight;
    const fitScale = Math.min(scaleToFitX, scaleToFitY);
    
    // Use the more appropriate scale
    const finalScale = Math.min(eyeScale, fitScale * 1.2); // Allow slight overflow for better framing

    // Apply transformations
    ctx.save();
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    
    console.log('alignImageFaceCrop debug:', {
      cropRegion: { left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight },
      canvasSize: { width: canvasWidth, height: canvasHeight },
      eyeScale,
      fitScale,
      finalScale,
      eyeCenterX,
      eyeCenterY,
      targetEyeCenterX,
      targetEyeCenterY,
      eyeAngle: eyeAngle * (180 / Math.PI) + ' degrees'
    });

    // Move to target eye center
    ctx.translate(targetEyeCenterX, targetEyeCenterY);

    // Rotate to align eyes horizontally
    ctx.rotate(-eyeAngle);

    // Scale the cropped region
    ctx.scale(finalScale, finalScale);

    // Draw the cropped region centered on eye center
    ctx.drawImage(
      sourceImage,
      cropLeft, cropTop, cropWidth, cropHeight, // Source crop
      -eyeCenterX, -eyeCenterY, cropWidth, cropHeight // Destination
    );

    ctx.restore();
    
    // Debug: Check if canvas has content
    const imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
    const hasContent = imageData.data.some((value, index) => {
      return index % 4 === 3 && value > 0; // Check alpha channel for non-transparent pixels
    });
    console.log('Canvas has content after face crop drawing:', hasContent);
    
    if (!hasContent) {
      console.warn('WARNING: Face crop canvas appears to be empty after alignment');
      // Debug: Try a simple blue rectangle to verify canvas is working
      ctx.fillStyle = 'blue';
      ctx.fillRect(10, 10, 50, 50);
      console.log('Added debug blue rectangle to empty face crop canvas');
    }

    return canvas;
  }

  // Alternative simpler alignment method using canvas transforms
  alignImageSimple(
    sourceImage: HTMLImageElement,
    eyePoints: EyePoints,
    targetResolution: ResolutionConfig
  ): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = targetResolution.width;
    canvas.height = targetResolution.height;
    const ctx = canvas.getContext('2d')!;

    const { left, right } = eyePoints;
    const { width, height } = targetResolution;

    // Calculate eye center and angle
    const eyeCenterX = (left[0] + right[0]) / 2;
    const eyeCenterY = (left[1] + right[1]) / 2;
    const eyeAngle = Math.atan2(right[1] - left[1], right[0] - left[0]);
    const currentEyeDistance = Math.sqrt(
      Math.pow(right[0] - left[0], 2) + Math.pow(right[1] - left[1], 2)
    );

    // Target properties
    const targetEyeDistance = width * this.targetEyeDistance;
    const targetCenterX = width / 2;
    const targetCenterY = height * this.targetEyeY;
    const scale = targetEyeDistance / currentEyeDistance;

    // Apply transformations
    ctx.save();
    
    // Move to target center
    ctx.translate(targetCenterX, targetCenterY);
    
    // Rotate to align eyes horizontally
    ctx.rotate(-eyeAngle);
    
    // Scale to match target eye distance
    ctx.scale(scale, scale);
    
    // Draw image centered on eye center
    ctx.drawImage(
      sourceImage,
      -eyeCenterX,
      -eyeCenterY
    );
    
    ctx.restore();

    return canvas;
  }

  // Method to check if eye points are valid for alignment
  validateEyePoints(eyePoints: EyePoints, imageWidth: number, imageHeight: number): boolean {
    const { left, right } = eyePoints;

    // Check if points are within image bounds
    if (left[0] < 0 || left[0] > imageWidth || left[1] < 0 || left[1] > imageHeight) {
      return false;
    }
    if (right[0] < 0 || right[0] > imageWidth || right[1] < 0 || right[1] > imageHeight) {
      return false;
    }

    // Check if eyes are reasonably far apart
    const eyeDistance = Math.sqrt(
      Math.pow(right[0] - left[0], 2) + Math.pow(right[1] - left[1], 2)
    );
    const minEyeDistance = Math.min(imageWidth, imageHeight) * 0.05; // 5% of smaller dimension
    const maxEyeDistance = Math.max(imageWidth, imageHeight) * 0.8;  // 80% of larger dimension

    return eyeDistance >= minEyeDistance && eyeDistance <= maxEyeDistance;
  }

  // Get preview of alignment transformation
  getAlignmentPreview(
    sourceImage: HTMLImageElement,
    eyePoints: EyePoints,
    targetResolution: ResolutionConfig,
    previewSize = 200
  ): HTMLCanvasElement {
    // Create smaller preview
    const previewResolution = {
      width: previewSize,
      height: (previewSize * targetResolution.height) / targetResolution.width
    };

    return this.alignImageFull(sourceImage, eyePoints, previewResolution);
  }

  // ========== OBJECT TRACKING ALIGNMENT METHODS ==========

  /**
   * Align image using feature-based affine transform
   * This is the main method for object tracking alignment
   */
  alignImageWithTransform(
    sourceImage: HTMLImageElement,
    transform: AffineTransform,
    targetResolution: ResolutionConfig
  ): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = targetResolution.width;
    canvas.height = targetResolution.height;
    const ctx = canvas.getContext('2d')!;

    // Enable high-quality rendering
    if (this.useSubPixelPrecision) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
    }

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Apply affine transform
    ctx.save();
    
    // The transform matrix is [a, b, c, d, tx, ty]
    // where the transformation is: x' = a*x + c*y + tx, y' = b*x + d*y + ty
    const m = transform.matrix;
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    
    ctx.drawImage(sourceImage, 0, 0);
    ctx.restore();

    return canvas;
  }

  /**
   * Align image with object crop (similar to face-crop but for objects)
   */
  alignImageObjectCrop(
    sourceImage: HTMLImageElement,
    transform: AffineTransform,
    mask: ObjectMask,
    targetResolution: ResolutionConfig,
    padding: number = 0.2
  ): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = targetResolution.width;
    canvas.height = targetResolution.height;
    const ctx = canvas.getContext('2d')!;

    // Enable high-quality rendering
    if (this.useSubPixelPrecision) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
    }

    const { boundingBox } = mask;
    const { width: canvasWidth, height: canvasHeight } = targetResolution;

    // Calculate padded crop region
    const paddingX = boundingBox.width * padding;
    const paddingY = boundingBox.height * padding;

    const cropLeft = Math.max(0, boundingBox.x - paddingX);
    const cropTop = Math.max(0, boundingBox.y - paddingY);
    const cropRight = Math.min(sourceImage.width, boundingBox.x + boundingBox.width + paddingX);
    const cropBottom = Math.min(sourceImage.height, boundingBox.y + boundingBox.height + paddingY);

    const cropWidth = cropRight - cropLeft;
    const cropHeight = cropBottom - cropTop;

    // Calculate scale to fit crop to canvas
    const scaleX = canvasWidth / cropWidth;
    const scaleY = canvasHeight / cropHeight;
    const scale = Math.min(scaleX, scaleY);

    // Calculate center position
    const centerX = canvasWidth / 2;
    const centerY = canvasHeight / 2;
    const cropCenterX = cropLeft + cropWidth / 2;
    const cropCenterY = cropTop + cropHeight / 2;

    ctx.save();
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // Move to center
    ctx.translate(centerX, centerY);

    // Apply rotation from transform
    const rotation = transform.rotation * (Math.PI / 180);
    ctx.rotate(rotation);

    // Apply scale
    ctx.scale(scale, scale);

    // Draw image centered on crop region
    ctx.drawImage(
      sourceImage,
      -cropCenterX,
      -cropCenterY
    );

    ctx.restore();

    return canvas;
  }

  /**
   * Normalize object scale to target height
   */
  normalizeObjectScale(
    sourceImage: HTMLImageElement,
    mask: ObjectMask,
    targetHeight: number = 400
  ): { scale: number; canvas: HTMLCanvasElement } {
    const objectHeight = mask.boundingBox.height;
    const scale = targetHeight / objectHeight;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(sourceImage.width * scale);
    canvas.height = Math.round(sourceImage.height * scale);

    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    ctx.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);

    return { scale, canvas };
  }

  /**
   * Apply warp with border padding (for cv.warpAffine equivalent)
   */
  warpAffineWithPadding(
    sourceImage: HTMLImageElement,
    transform: AffineTransform,
    targetResolution: ResolutionConfig,
    borderPadding: number = 50
  ): HTMLCanvasElement {
    const paddedWidth = targetResolution.width + borderPadding * 2;
    const paddedHeight = targetResolution.height + borderPadding * 2;

    const canvas = document.createElement('canvas');
    canvas.width = paddedWidth;
    canvas.height = paddedHeight;
    const ctx = canvas.getContext('2d')!;

    // Enable high-quality rendering
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Fill with black background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, paddedWidth, paddedHeight);

    // Apply transform with padding offset
    ctx.save();
    ctx.translate(borderPadding, borderPadding);
    
    const m = transform.matrix;
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4] + borderPadding, m[5] + borderPadding);
    
    ctx.drawImage(sourceImage, 0, 0);
    ctx.restore();

    return canvas;
  }

  /**
   * Smooth transform using temporal filtering (reduces jitter)
   * Note: Uses separate storage from legacy face-based transforms
   */
  private previousAffineTransforms: AffineTransform[] = [];
  
  smoothTransform(transform: AffineTransform): AffineTransform {
    if (this.previousAffineTransforms.length === 0) {
      this.previousAffineTransforms.push(transform);
      return transform;
    }

    const recent = this.previousAffineTransforms[this.previousAffineTransforms.length - 1];
    const alpha = this.smoothingFactor;

    // Smooth rotation
    let rotationDiff = transform.rotation - recent.rotation;
    if (rotationDiff > 180) rotationDiff -= 360;
    if (rotationDiff < -180) rotationDiff += 360;
    const smoothedRotation = recent.rotation + rotationDiff * alpha;

    // Smooth scale
    const smoothedScale = recent.scale * (1 - alpha) + transform.scale * alpha;

    // Smooth translation
    const smoothedTranslation: [number, number] = [
      recent.translation[0] * (1 - alpha) + transform.translation[0] * alpha,
      recent.translation[1] * (1 - alpha) + transform.translation[1] * alpha,
    ];

    // Reconstruct matrix with smoothed values
    const rad = smoothedRotation * (Math.PI / 180);
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const smoothedMatrix = new Float64Array([
      smoothedScale * cos,
      smoothedScale * sin,
      -smoothedScale * sin,
      smoothedScale * cos,
      smoothedTranslation[0],
      smoothedTranslation[1],
    ]);

    const smoothedTransform: AffineTransform = {
      matrix: smoothedMatrix,
      rotation: smoothedRotation,
      scale: smoothedScale,
      translation: smoothedTranslation,
    };

    this.previousAffineTransforms.push(smoothedTransform);

    // Keep only recent transforms
    if (this.previousAffineTransforms.length > 5) {
      this.previousAffineTransforms.shift();
    }

    return smoothedTransform;
  }
}