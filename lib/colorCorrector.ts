import { ObjectMask } from './types';

/**
 * Color statistics for an image region
 */
export interface ColorStats {
  meanR: number;
  meanG: number;
  meanB: number;
  stdR: number;
  stdG: number;
  stdB: number;
  pixelCount: number;
}

/**
 * Color Corrector for mask-based color normalization
 * Uses linear color transfer to match colors across frames
 */
export class ColorCorrector {
  /**
   * Extract color statistics from masked region only
   */
  extractColorStats(
    image: HTMLImageElement,
    mask: ObjectMask
  ): ColorStats {
    // Create canvas to extract image data
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);

    const imageData = ctx.getImageData(0, 0, image.width, image.height);
    const data = imageData.data;

    // Calculate mean values (only within mask)
    let sumR = 0, sumG = 0, sumB = 0;
    let pixelCount = 0;

    for (let i = 0; i < mask.data.length; i++) {
      if (mask.data[i] > 0) {
        const idx = i * 4;
        sumR += data[idx];
        sumG += data[idx + 1];
        sumB += data[idx + 2];
        pixelCount++;
      }
    }

    if (pixelCount === 0) {
      console.warn('No pixels in mask for color statistics');
      return {
        meanR: 128,
        meanG: 128,
        meanB: 128,
        stdR: 0,
        stdG: 0,
        stdB: 0,
        pixelCount: 0,
      };
    }

    const meanR = sumR / pixelCount;
    const meanG = sumG / pixelCount;
    const meanB = sumB / pixelCount;

    // Calculate standard deviation
    let sumSqR = 0, sumSqG = 0, sumSqB = 0;

    for (let i = 0; i < mask.data.length; i++) {
      if (mask.data[i] > 0) {
        const idx = i * 4;
        sumSqR += Math.pow(data[idx] - meanR, 2);
        sumSqG += Math.pow(data[idx + 1] - meanG, 2);
        sumSqB += Math.pow(data[idx + 2] - meanB, 2);
      }
    }

    const stdR = Math.sqrt(sumSqR / pixelCount);
    const stdG = Math.sqrt(sumSqG / pixelCount);
    const stdB = Math.sqrt(sumSqB / pixelCount);

    return {
      meanR,
      meanG,
      meanB,
      stdR,
      stdG,
      stdB,
      pixelCount,
    };
  }

  /**
   * Apply linear color transfer to match target statistics
   * Formula: output = (input - μ_source) × (σ_target / σ_source) + μ_target
   */
  async applyColorTransfer(
    image: HTMLImageElement,
    mask: ObjectMask,
    sourceStats: ColorStats,
    targetStats: ColorStats,
    intensity: number = 1.0
  ): Promise<HTMLCanvasElement> {
    // Create canvas
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);

    const imageData = ctx.getImageData(0, 0, image.width, image.height);
    const data = imageData.data;

    // Calculate scale factors (avoid division by zero)
    const scaleR = sourceStats.stdR > 0 ? targetStats.stdR / sourceStats.stdR : 1;
    const scaleG = sourceStats.stdG > 0 ? targetStats.stdG / sourceStats.stdG : 1;
    const scaleB = sourceStats.stdB > 0 ? targetStats.stdB / sourceStats.stdB : 1;

    // Apply color transfer only within mask
    for (let i = 0; i < mask.data.length; i++) {
      if (mask.data[i] > 0) {
        const idx = i * 4;

        // Apply linear color transfer
        let r = (data[idx] - sourceStats.meanR) * scaleR + targetStats.meanR;
        let g = (data[idx + 1] - sourceStats.meanG) * scaleG + targetStats.meanG;
        let b = (data[idx + 2] - sourceStats.meanB) * scaleB + targetStats.meanB;

        // Blend with original based on intensity
        r = data[idx] * (1 - intensity) + r * intensity;
        g = data[idx + 1] * (1 - intensity) + g * intensity;
        b = data[idx + 2] * (1 - intensity) + b * intensity;

        // Clamp to valid range
        data[idx] = Math.max(0, Math.min(255, r));
        data[idx + 1] = Math.max(0, Math.min(255, g));
        data[idx + 2] = Math.max(0, Math.min(255, b));
      }
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  /**
   * Adjust exposure (±1 EV max)
   * EV adjustment: multiply by 2^EV
   */
  async adjustExposure(
    image: HTMLImageElement,
    mask: ObjectMask,
    evAdjustment: number
  ): Promise<HTMLCanvasElement> {
    // Clamp EV adjustment to ±1
    evAdjustment = Math.max(-1, Math.min(1, evAdjustment));

    // Calculate multiplier: 2^EV
    const multiplier = Math.pow(2, evAdjustment);

    // Create canvas
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);

    const imageData = ctx.getImageData(0, 0, image.width, image.height);
    const data = imageData.data;

    // Apply exposure adjustment only within mask
    for (let i = 0; i < mask.data.length; i++) {
      if (mask.data[i] > 0) {
        const idx = i * 4;

        // Apply multiplier
        data[idx] = Math.max(0, Math.min(255, data[idx] * multiplier));
        data[idx + 1] = Math.max(0, Math.min(255, data[idx + 1] * multiplier));
        data[idx + 2] = Math.max(0, Math.min(255, data[idx + 2] * multiplier));
      }
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  /**
   * Apply both color transfer and exposure adjustment
   */
  async correctColors(
    image: HTMLImageElement,
    mask: ObjectMask,
    sourceStats: ColorStats,
    targetStats: ColorStats,
    options: {
      colorTransferIntensity?: number;
      exposureAdjustment?: number;
    } = {}
  ): Promise<HTMLCanvasElement> {
    const {
      colorTransferIntensity = 1.0,
      exposureAdjustment = 0,
    } = options;

    // Apply color transfer first
    let canvas = await this.applyColorTransfer(
      image,
      mask,
      sourceStats,
      targetStats,
      colorTransferIntensity
    );

    // Apply exposure adjustment if needed
    if (Math.abs(exposureAdjustment) > 0.01) {
      // Convert canvas to image
      const tempImage = new Image();
      tempImage.src = canvas.toDataURL();
      await new Promise(resolve => {
        tempImage.onload = resolve;
      });

      canvas = await this.adjustExposure(tempImage, mask, exposureAdjustment);
    }

    return canvas;
  }

  /**
   * Normalize colors across multiple images
   * Uses the first image as reference
   */
  async normalizeColors(
    images: HTMLImageElement[],
    masks: ObjectMask[],
    options: {
      colorTransferIntensity?: number;
      useMedianAsReference?: boolean;
    } = {}
  ): Promise<HTMLCanvasElement[]> {
    if (images.length !== masks.length) {
      throw new Error('Number of images and masks must match');
    }

    if (images.length === 0) {
      return [];
    }

    // Extract color statistics for all images
    const allStats = images.map((img, i) => this.extractColorStats(img, masks[i]));

    // Determine reference statistics
    let referenceStats: ColorStats;
    if (options.useMedianAsReference && images.length > 2) {
      // Use median statistics as reference
      referenceStats = this.calculateMedianStats(allStats);
    } else {
      // Use first image as reference
      referenceStats = allStats[0];
    }

    console.log('Reference color stats:', referenceStats);

    // Apply color correction to all images
    const correctedCanvases: HTMLCanvasElement[] = [];

    for (let i = 0; i < images.length; i++) {
      const canvas = await this.applyColorTransfer(
        images[i],
        masks[i],
        allStats[i],
        referenceStats,
        options.colorTransferIntensity
      );
      correctedCanvases.push(canvas);
    }

    return correctedCanvases;
  }

  /**
   * Calculate median color statistics from multiple samples
   */
  private calculateMedianStats(allStats: ColorStats[]): ColorStats {
    const sortedMeanR = allStats.map(s => s.meanR).sort((a, b) => a - b);
    const sortedMeanG = allStats.map(s => s.meanG).sort((a, b) => a - b);
    const sortedMeanB = allStats.map(s => s.meanB).sort((a, b) => a - b);
    const sortedStdR = allStats.map(s => s.stdR).sort((a, b) => a - b);
    const sortedStdG = allStats.map(s => s.stdG).sort((a, b) => a - b);
    const sortedStdB = allStats.map(s => s.stdB).sort((a, b) => a - b);

    const mid = Math.floor(allStats.length / 2);

    return {
      meanR: sortedMeanR[mid],
      meanG: sortedMeanG[mid],
      meanB: sortedMeanB[mid],
      stdR: sortedStdR[mid],
      stdG: sortedStdG[mid],
      stdB: sortedStdB[mid],
      pixelCount: allStats[mid].pixelCount,
    };
  }

  /**
   * Check if color correction is needed
   * Returns true if colors vary significantly across images
   */
  shouldApplyColorCorrection(allStats: ColorStats[]): boolean {
    if (allStats.length < 2) return false;

    // Calculate variance in mean values
    const meanRValues = allStats.map(s => s.meanR);
    const meanGValues = allStats.map(s => s.meanG);
    const meanBValues = allStats.map(s => s.meanB);

    const varianceR = this.calculateVariance(meanRValues);
    const varianceG = this.calculateVariance(meanGValues);
    const varianceB = this.calculateVariance(meanBValues);

    // If any channel has high variance (>20), correction is recommended
    const threshold = 400; // variance threshold (std ~20)
    return varianceR > threshold || varianceG > threshold || varianceB > threshold;
  }

  private calculateVariance(values: number[]): number {
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    return squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length;
  }
}
