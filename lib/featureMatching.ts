import {
    FeaturePoint,
    FeatureSet,
    FeatureMatch,
    MatchResult,
    AffineTransform,
    ObjectMask,
    ObjectTrackingConfig,
    DEFAULT_TRACKING_CONFIG,
} from './types';

/**
 * Feature Matching Engine using ORB (Oriented FAST and Rotated BRIEF)
 * with RANSAC for robust geometric alignment
 */
export class FeatureMatcher {
    private config: ObjectTrackingConfig;
    private isOpenCVReady = false;

    constructor(config: Partial<ObjectTrackingConfig> = {}) {
        this.config = { ...DEFAULT_TRACKING_CONFIG, ...config };
    }

    async initialize(): Promise<void> {
        try {
            console.log('Initializing Feature Matcher...');
            await this.loadOpenCV();
            this.isOpenCVReady = true;
            console.log('Feature Matcher initialized successfully');
        } catch (error) {
            console.error('Failed to initialize Feature Matcher:', error);
            throw error;
        }
    }

    private async loadOpenCV(): Promise<void> {
        // Check if OpenCV is already loaded
        if ((window as any).cv && (window as any).cv.Mat) {
            return;
        }

        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://docs.opencv.org/4.8.0/opencv.js';
            script.async = true;

            script.onload = () => {
                const checkReady = setInterval(() => {
                    if ((window as any).cv && (window as any).cv.Mat) {
                        clearInterval(checkReady);
                        console.log('OpenCV.js loaded for feature detection');
                        resolve();
                    }
                }, 100);

                setTimeout(() => {
                    clearInterval(checkReady);
                    reject(new Error('OpenCV.js loading timeout'));
                }, 10000);
            };

            script.onerror = () => {
                reject(new Error('Failed to load OpenCV.js'));
            };

            document.head.appendChild(script);
        });
    }

    async extractFeatures(
        image: HTMLImageElement,
        mask?: ObjectMask
    ): Promise<FeatureSet> {
        if (!this.isOpenCVReady) {
            throw new Error('Feature Matcher not initialized');
        }

        try {
            console.log('Extracting ORB features...');

            // Create canvas and get image data
            const canvas = document.createElement('canvas');
            canvas.width = image.width;
            canvas.height = image.height;
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(image, 0, 0);

            // Convert to OpenCV Mat
            const src = (window as any).cv.imread(canvas);
            const gray = new (window as any).cv.Mat();

            // Convert to grayscale
            (window as any).cv.cvtColor(src, gray, (window as any).cv.COLOR_RGBA2GRAY);

            // Apply Gaussian blur if configured
            if (this.config.useGaussianBlur) {
                const blurred = new (window as any).cv.Mat();
                const ksize = new (window as any).cv.Size(5, 5);
                (window as any).cv.GaussianBlur(
                    gray,
                    blurred,
                    ksize,
                    this.config.blurSigma,
                    this.config.blurSigma
                );
                gray.delete();
                gray.data = blurred.data;
                blurred.delete();
            }

            // Create ORB detector
            const orb = new (window as any).cv.ORB(this.config.featureCount);
            const keypoints = new (window as any).cv.KeyPointVector();
            const descriptors = new (window as any).cv.Mat();

            // Apply mask if provided
            let cvMask: any = null;
            if (mask) {
                cvMask = this.createOpenCVMask(mask);
            }

            // Detect keypoints and compute descriptors
            orb.detectAndCompute(gray, cvMask || new (window as any).cv.Mat(), keypoints, descriptors);

            console.log(`Detected ${keypoints.size()} ORB keypoints`);

            // Convert to our format
            const features: FeaturePoint[] = [];
            for (let i = 0; i < keypoints.size(); i++) {
                const kp = keypoints.get(i);
                features.push({
                    x: kp.pt.x,
                    y: kp.pt.y,
                    size: kp.size,
                    angle: kp.angle,
                    response: kp.response,
                    octave: kp.octave,
                });
            }

            // Extract descriptor data
            const descriptorData = new Float32Array(descriptors.data);

            // Cleanup
            src.delete();
            gray.delete();
            orb.delete();
            keypoints.delete();
            if (cvMask) cvMask.delete();

            const featureSet: FeatureSet = {
                keypoints: features,
                descriptors: descriptorData,
                count: features.length,
            };

            // Don't delete descriptors yet - we need the data
            // descriptors.delete();

            return featureSet;
        } catch (error) {
            console.error('Feature extraction failed:', error);
            throw error;
        }
    }

    private createOpenCVMask(mask: ObjectMask): any {
        const cv = (window as any).cv;
        const cvMask = new cv.Mat(mask.height, mask.width, cv.CV_8UC1);

        // Copy mask data
        for (let i = 0; i < mask.data.length; i++) {
            cvMask.data[i] = mask.data[i];
        }

        return cvMask;
    }

    async matchFeatures(
        features1: FeatureSet,
        features2: FeatureSet
    ): Promise<MatchResult> {
        if (!this.isOpenCVReady) {
            throw new Error('Feature Matcher not initialized');
        }

        try {
            console.log('Matching features...');

            const cv = (window as any).cv;

            // Convert descriptors to OpenCV Mats
            const desc1 = this.descriptorsToMat(features1.descriptors, features1.count);
            const desc2 = this.descriptorsToMat(features2.descriptors, features2.count);

            // Create BFMatcher (Brute Force Matcher)
            const matcher = new cv.BFMatcher(cv.NORM_HAMMING, true); // crossCheck = true

            // Match descriptors
            const matches = new cv.DMatchVector();
            matcher.match(desc1, desc2, matches);

            console.log(`Found ${matches.size()} initial matches`);

            // Convert matches to our format
            const matchArray: FeatureMatch[] = [];
            for (let i = 0; i < matches.size(); i++) {
                const match = matches.get(i);
                matchArray.push({
                    queryIdx: match.queryIdx,
                    trainIdx: match.trainIdx,
                    distance: match.distance,
                });
            }

            // Apply Lowe's ratio test (if we had k=2 matches)
            // For now, just sort by distance and take best matches
            matchArray.sort((a, b) => a.distance - b.distance);

            // Take top matches (filter by distance threshold)
            const maxDistance = matchArray.length > 0 ? matchArray[0].distance * 2.5 : 100;
            const goodMatches = matchArray.filter(m => m.distance < maxDistance);

            console.log(`${goodMatches.length} good matches after filtering`);

            // Cleanup
            desc1.delete();
            desc2.delete();
            matcher.delete();
            matches.delete();

            // Compute transform if we have enough matches
            let transform: AffineTransform | undefined;
            let inlierCount = 0;

            if (goodMatches.length >= this.config.minMatches) {
                const result = await this.computeTransform(
                    features1.keypoints,
                    features2.keypoints,
                    goodMatches
                );
                transform = result.transform;
                inlierCount = result.inlierCount;
            }

            const confidence = this.calculateMatchConfidence(
                goodMatches.length,
                inlierCount,
                features1.count,
                features2.count
            );

            return {
                matches: goodMatches,
                inlierCount,
                confidence,
                transform,
            };
        } catch (error) {
            console.error('Feature matching failed:', error);
            throw error;
        }
    }

    private descriptorsToMat(descriptors: Float32Array, count: number): any {
        const cv = (window as any).cv;
        const descriptorSize = 32; // ORB uses 32-byte descriptors

        const mat = new cv.Mat(count, descriptorSize, cv.CV_8UC1);

        // Copy descriptor data
        for (let i = 0; i < descriptors.length && i < mat.data.length; i++) {
            mat.data[i] = Math.round(descriptors[i]);
        }

        return mat;
    }

    async computeTransform(
        keypoints1: FeaturePoint[],
        keypoints2: FeaturePoint[],
        matches: FeatureMatch[]
    ): Promise<{ transform: AffineTransform; inlierCount: number }> {
        if (!this.isOpenCVReady) {
            throw new Error('Feature Matcher not initialized');
        }

        try {
            const cv = (window as any).cv;

            // Extract matched point pairs
            const srcPoints: number[] = [];
            const dstPoints: number[] = [];

            for (const match of matches) {
                const kp1 = keypoints1[match.queryIdx];
                const kp2 = keypoints2[match.trainIdx];

                if (kp1 && kp2) {
                    srcPoints.push(kp1.x, kp1.y);
                    dstPoints.push(kp2.x, kp2.y);
                }
            }

            if (srcPoints.length < this.config.minMatches * 2) {
                throw new Error('Not enough matched points for transform estimation');
            }

            // Convert to OpenCV Mats
            const srcMat = cv.matFromArray(srcPoints.length / 2, 1, cv.CV_32FC2, srcPoints);
            const dstMat = cv.matFromArray(dstPoints.length / 2, 1, cv.CV_32FC2, dstPoints);

            // Estimate affine transform using RANSAC
            const transformMat = cv.estimateAffinePartial2D(
                srcMat,
                dstMat,
                new cv.Mat(),
                cv.RANSAC,
                this.config.ransacThreshold
            );

            // Extract transform parameters
            const matrix = new Float64Array(6);
            for (let i = 0; i < 6; i++) {
                matrix[i] = transformMat.data64F[i];
            }

            // Calculate rotation, scale, and translation
            const rotation = Math.atan2(matrix[1], matrix[0]) * (180 / Math.PI);
            const scale = Math.sqrt(matrix[0] * matrix[0] + matrix[1] * matrix[1]);
            const translation: [number, number] = [matrix[2], matrix[5]];

            // Count inliers (points that fit the model)
            let inlierCount = 0;
            for (let i = 0; i < srcPoints.length / 2; i++) {
                const x1 = srcPoints[i * 2];
                const y1 = srcPoints[i * 2 + 1];
                const x2 = dstPoints[i * 2];
                const y2 = dstPoints[i * 2 + 1];

                // Apply transform to source point
                const x1_transformed = matrix[0] * x1 + matrix[1] * y1 + matrix[2];
                const y1_transformed = matrix[3] * x1 + matrix[4] * y1 + matrix[5];

                // Calculate reprojection error
                const error = Math.sqrt(
                    Math.pow(x1_transformed - x2, 2) + Math.pow(y1_transformed - y2, 2)
                );

                if (error < this.config.ransacThreshold) {
                    inlierCount++;
                }
            }

            console.log(`RANSAC: ${inlierCount} inliers out of ${srcPoints.length / 2} matches`);

            // Cleanup
            srcMat.delete();
            dstMat.delete();
            transformMat.delete();

            const transform: AffineTransform = {
                matrix,
                rotation,
                scale,
                translation,
            };

            return { transform, inlierCount };
        } catch (error) {
            console.error('Transform computation failed:', error);
            throw error;
        }
    }

    private calculateMatchConfidence(
        matchCount: number,
        inlierCount: number,
        featureCount1: number,
        featureCount2: number
    ): number {
        // Confidence based on:
        // 1. Number of matches relative to features
        // 2. Inlier ratio
        // 3. Absolute number of inliers

        const matchRatio = matchCount / Math.min(featureCount1, featureCount2);
        const inlierRatio = inlierCount / Math.max(matchCount, 1);
        const inlierScore = Math.min(inlierCount / this.config.minInliers, 1);

        const confidence = (matchRatio * 0.3 + inlierRatio * 0.4 + inlierScore * 0.3);

        return Math.min(Math.max(confidence, 0), 1);
    }

    computeAngularDistances(transforms: AffineTransform[]): number[][] {
        const n = transforms.length;
        const distances: number[][] = Array(n).fill(0).map(() => Array(n).fill(0));

        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                if (i === j) {
                    distances[i][j] = 0;
                } else {
                    // Angular distance between rotations
                    let angleDiff = Math.abs(transforms[i].rotation - transforms[j].rotation);
                    // Normalize to [0, 180]
                    if (angleDiff > 180) angleDiff = 360 - angleDiff;
                    distances[i][j] = angleDiff;
                }
            }
        }

        return distances;
    }

    findMedianFrame(transforms: AffineTransform[]): number {
        const distances = this.computeAngularDistances(transforms);
        const n = transforms.length;

        // Calculate cumulative distance for each frame
        const cumulativeDistances = distances.map(row =>
            row.reduce((sum, dist) => sum + dist, 0)
        );

        // Find frame with minimum cumulative distance
        let minDistance = Infinity;
        let medianIndex = 0;

        for (let i = 0; i < n; i++) {
            if (cumulativeDistances[i] < minDistance) {
                minDistance = cumulativeDistances[i];
                medianIndex = i;
            }
        }

        console.log(`Median frame: ${medianIndex} (cumulative distance: ${minDistance.toFixed(2)}°)`);

        return medianIndex;
    }

    orderFrames(transforms: AffineTransform[], referenceIndex: number = 0): number[] {
        const n = transforms.length;
        const distances = this.computeAngularDistances(transforms);

        // Greedy nearest-neighbor ordering
        const ordered: number[] = [referenceIndex];
        const remaining = new Set(Array.from({ length: n }, (_, i) => i));
        remaining.delete(referenceIndex);

        while (remaining.size > 0) {
            const current = ordered[ordered.length - 1];
            let nearest = -1;
            let minDist = Infinity;

            remaining.forEach(candidate => {
                if (distances[current][candidate] < minDist) {
                    minDist = distances[current][candidate];
                    nearest = candidate;
                }
            });

            if (nearest !== -1) {
                ordered.push(nearest);
                remaining.delete(nearest);
            } else {
                break;
            }
        }

        console.log('Frame ordering:', ordered);

        return ordered;
    }

    cleanup(): void {
        this.isOpenCVReady = false;
    }

    isReady(): boolean {
        return this.isOpenCVReady;
    }
}
