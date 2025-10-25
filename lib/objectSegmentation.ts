import * as ort from 'onnxruntime-web';
import {
  BoundingBox,
  ObjectMask,
  ObjectSegmentationResult,
  SegmentationQuality,
} from './types';

/**
 * Object Segmentation Engine using SAM (Segment Anything Model)
 * with GrabCut fallback for browsers without WebGPU support
 */
export class ObjectSegmentor {
  private samSession: ort.InferenceSession | null = null;
  private isInitialized = false;
  private useSAM = true;
  private modelUrl = 'https://huggingface.co/schmuell/sam-vit-b-01ec64/resolve/main/sam_vit_b_01ec64.onnx';

  constructor() {
    this.checkWebGPUSupport();
  }

  private async checkWebGPUSupport(): Promise<void> {
    try {
      // Check if WebGPU is available
      if ('gpu' in navigator) {
        const adapter = await (navigator as any).gpu?.requestAdapter();
        if (adapter) {
          console.log('WebGPU is available - will use SAM');
          this.useSAM = true;
          return;
        }
      }
      console.log('WebGPU not available - will use GrabCut fallback');
      this.useSAM = false;
    } catch (error) {
      console.warn('WebGPU check failed:', error);
      this.useSAM = false;
    }
  }

  async initialize(): Promise<void> {
    try {
      console.log('Initializing Object Segmentor...');
      
      if (this.useSAM) {
        await this.initializeSAM();
      } else {
        console.log('Using GrabCut fallback (SAM not available)');
      }
      
      this.isInitialized = true;
      console.log('Object Segmentor initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Object Segmentor:', error);
      // Fallback to GrabCut
      this.useSAM = false;
      this.isInitialized = true;
      console.log('Falling back to GrabCut segmentation');
    }
  }

  private async initializeSAM(): Promise<void> {
    try {
      console.log('Loading SAM model from:', this.modelUrl);
      
      // Configure ONNX Runtime for WebGPU
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.simd = true;
      
      // Try to load from cache first
      const cachedModel = await this.loadModelFromCache();
      
      if (cachedModel) {
        console.log('Loading SAM model from cache...');
        this.samSession = await ort.InferenceSession.create(cachedModel, {
          executionProviders: ['webgpu', 'wasm'],
        });
      } else {
        console.log('Downloading SAM model (this may take a moment)...');
        this.samSession = await ort.InferenceSession.create(this.modelUrl, {
          executionProviders: ['webgpu', 'wasm'],
        });
        
        // Cache the model for future use
        await this.cacheModel(this.modelUrl);
      }
      
      console.log('SAM model loaded successfully');
    } catch (error) {
      console.error('Failed to load SAM model:', error);
      throw error;
    }
  }

  private async loadModelFromCache(): Promise<ArrayBuffer | null> {
    try {
      const db = await this.openIndexedDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(['models'], 'readonly');
        const store = transaction.objectStore('models');
        const request = store.get('sam-vit-b');
        
        request.onsuccess = () => {
          resolve(request.result?.data || null);
        };
        
        request.onerror = () => {
          reject(request.error);
        };
      });
    } catch (error) {
      console.warn('Failed to load model from cache:', error);
      return null;
    }
  }

  private async cacheModel(url: string): Promise<void> {
    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      
      const db = await this.openIndexedDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(['models'], 'readwrite');
        const store = transaction.objectStore('models');
        const request = store.put({
          id: 'sam-vit-b',
          data: arrayBuffer,
          timestamp: Date.now(),
        });
        
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.warn('Failed to cache model:', error);
    }
  }

  private async openIndexedDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('ObjectSegmentorDB', 1);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('models')) {
          db.createObjectStore('models', { keyPath: 'id' });
        }
      };
    });
  }

  async segmentObject(
    image: HTMLImageElement,
    boundingBox: BoundingBox
  ): Promise<ObjectSegmentationResult> {
    if (!this.isInitialized) {
      throw new Error('Object Segmentor not initialized');
    }

    if (this.useSAM && this.samSession) {
      return this.segmentWithSAM(image, boundingBox);
    } else {
      return this.segmentWithGrabCut(image, boundingBox);
    }
  }

  private async segmentWithSAM(
    image: HTMLImageElement,
    boundingBox: BoundingBox
  ): Promise<ObjectSegmentationResult> {
    try {
      console.log('Segmenting with SAM...', boundingBox);
      
      // Prepare image tensor
      const imageTensor = await this.imageToTensor(image);
      
      // Prepare bounding box prompt
      const boxTensor = this.boundingBoxToTensor(boundingBox, image.width, image.height);
      
      // Run SAM inference
      const feeds = {
        image: imageTensor,
        point_coords: boxTensor.coords,
        point_labels: boxTensor.labels,
      };
      
      const results = await this.samSession!.run(feeds);
      
      // Extract mask from results
      const maskData = results.masks.data as Float32Array;
      const mask = this.processSAMMask(maskData, image.width, image.height);
      
      // Validate mask quality
      const quality = this.validateMask(mask, image.width, image.height);
      
      return {
        mask,
        boundingBox,
        confidence: quality.confidence,
        quality,
        method: 'sam',
      };
    } catch (error) {
      console.error('SAM segmentation failed:', error);
      // Fallback to GrabCut
      return this.segmentWithGrabCut(image, boundingBox);
    }
  }

  private async imageToTensor(image: HTMLImageElement): Promise<ort.Tensor> {
    // Create canvas to extract image data
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    
    const imageData = ctx.getImageData(0, 0, image.width, image.height);
    const { data, width, height } = imageData;
    
    // Convert to RGB float32 tensor [1, 3, H, W]
    const rgbData = new Float32Array(3 * width * height);
    
    for (let i = 0; i < width * height; i++) {
      rgbData[i] = data[i * 4] / 255.0; // R
      rgbData[width * height + i] = data[i * 4 + 1] / 255.0; // G
      rgbData[width * height * 2 + i] = data[i * 4 + 2] / 255.0; // B
    }
    
    return new ort.Tensor('float32', rgbData, [1, 3, height, width]);
  }

  private boundingBoxToTensor(
    bbox: BoundingBox,
    imageWidth: number,
    imageHeight: number
  ): { coords: ort.Tensor; labels: ort.Tensor } {
    // Convert bounding box to point prompts (top-left and bottom-right corners)
    const coords = new Float32Array([
      bbox.x, bbox.y,
      bbox.x + bbox.width, bbox.y + bbox.height,
    ]);
    
    const labels = new Float32Array([2, 3]); // 2 = top-left, 3 = bottom-right
    
    return {
      coords: new ort.Tensor('float32', coords, [1, 2, 2]),
      labels: new ort.Tensor('float32', labels, [1, 2]),
    };
  }

  private processSAMMask(
    maskData: Float32Array,
    width: number,
    height: number
  ): ObjectMask {
    // Convert float mask to binary
    const binaryMask = new Uint8Array(width * height);
    
    for (let i = 0; i < maskData.length; i++) {
      binaryMask[i] = maskData[i] > 0.5 ? 255 : 0;
    }
    
    // Calculate mask properties
    const area = this.calculateMaskArea(binaryMask, width, height);
    const solidity = this.calculateSolidity(binaryMask, width, height);
    const boundingBox = this.calculateMaskBoundingBox(binaryMask, width, height);
    
    return {
      data: binaryMask,
      width,
      height,
      confidence: 0.9, // SAM typically has high confidence
      boundingBox,
      area,
      solidity,
    };
  }

  private async segmentWithGrabCut(
    image: HTMLImageElement,
    boundingBox: BoundingBox
  ): Promise<ObjectSegmentationResult> {
    console.log('Segmenting with GrabCut fallback...');
    
    try {
      // Load OpenCV.js if not already loaded
      await this.loadOpenCV();
      
      // Create canvas and get image data
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      
      // Convert to OpenCV Mat
      const src = (window as any).cv.imread(canvas);
      const mask = new (window as any).cv.Mat();
      const bgdModel = new (window as any).cv.Mat();
      const fgdModel = new (window as any).cv.Mat();
      
      // Define rectangle for GrabCut
      const rect = new (window as any).cv.Rect(
        Math.max(0, boundingBox.x),
        Math.max(0, boundingBox.y),
        Math.min(boundingBox.width, image.width - boundingBox.x),
        Math.min(boundingBox.height, image.height - boundingBox.y)
      );
      
      // Run GrabCut algorithm
      (window as any).cv.grabCut(
        src,
        mask,
        rect,
        bgdModel,
        fgdModel,
        5, // iterations
        (window as any).cv.GC_INIT_WITH_RECT
      );
      
      // Convert mask to binary (keep only definite foreground and probable foreground)
      const binaryMask = new Uint8Array(image.width * image.height);
      for (let i = 0; i < mask.data.length; i++) {
        const value = mask.data[i];
        // GC_FGD = 1, GC_PR_FGD = 3
        binaryMask[i] = (value === 1 || value === 3) ? 255 : 0;
      }
      
      // Calculate mask properties
      const area = this.calculateMaskArea(binaryMask, image.width, image.height);
      const solidity = this.calculateSolidity(binaryMask, image.width, image.height);
      const maskBoundingBox = this.calculateMaskBoundingBox(binaryMask, image.width, image.height);
      
      const objectMask: ObjectMask = {
        data: binaryMask,
        width: image.width,
        height: image.height,
        confidence: 0.75, // GrabCut has decent confidence
        boundingBox: maskBoundingBox,
        area,
        solidity,
      };
      
      // Cleanup OpenCV resources
      src.delete();
      mask.delete();
      bgdModel.delete();
      fgdModel.delete();
      
      const quality = this.validateMask(objectMask, image.width, image.height);
      
      return {
        mask: objectMask,
        boundingBox: maskBoundingBox,
        confidence: 0.75,
        quality,
        method: 'grabcut',
      };
    } catch (error) {
      console.error('GrabCut segmentation failed:', error);
      // Ultimate fallback: rectangular mask
      const mask = this.createRectangularMask(image.width, image.height, boundingBox);
      const quality = this.validateMask(mask, image.width, image.height);
      
      return {
        mask,
        boundingBox,
        confidence: 0.6,
        quality,
        method: 'grabcut',
      };
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
        // Wait for OpenCV to be ready
        const checkReady = setInterval(() => {
          if ((window as any).cv && (window as any).cv.Mat) {
            clearInterval(checkReady);
            console.log('OpenCV.js loaded successfully');
            resolve();
          }
        }, 100);
        
        // Timeout after 10 seconds
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

  private createRectangularMask(
    width: number,
    height: number,
    bbox: BoundingBox
  ): ObjectMask {
    const data = new Uint8Array(width * height);
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const inBox = x >= bbox.x && x < bbox.x + bbox.width &&
                     y >= bbox.y && y < bbox.y + bbox.height;
        data[y * width + x] = inBox ? 255 : 0;
      }
    }
    
    const area = (bbox.width * bbox.height) / (width * height);
    
    return {
      data,
      width,
      height,
      confidence: 0.7,
      boundingBox: bbox,
      area,
      solidity: 1.0, // Rectangle has perfect solidity
    };
  }

  private validateMask(
    mask: ObjectMask,
    imageWidth: number,
    imageHeight: number
  ): SegmentationQuality {
    const warnings: string[] = [];
    let isValid = true;
    
    // Check area (should be >5% of image)
    if (mask.area < 0.05) {
      warnings.push('Mask area is very small (<5% of image)');
      isValid = false;
    }
    
    // Check solidity (should be >0.6)
    if (mask.solidity < 0.6) {
      warnings.push('Mask has low solidity (<0.6) - object may be fragmented');
    }
    
    // Check confidence
    if (mask.confidence < 0.7) {
      warnings.push('Low segmentation confidence (<0.7)');
    }
    
    return {
      confidence: mask.confidence,
      area: mask.area,
      solidity: mask.solidity,
      isValid,
      warnings,
    };
  }

  private calculateMaskArea(
    mask: Uint8Array,
    width: number,
    height: number
  ): number {
    let count = 0;
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] > 0) count++;
    }
    return count / (width * height);
  }

  private calculateSolidity(
    mask: Uint8Array,
    width: number,
    height: number
  ): number {
    // Solidity = mask area / convex hull area
    // For simplicity, use bounding box area as approximation
    const bbox = this.calculateMaskBoundingBox(mask, width, height);
    const maskArea = this.calculateMaskArea(mask, width, height) * width * height;
    const bboxArea = bbox.width * bbox.height;
    
    return bboxArea > 0 ? maskArea / bboxArea : 0;
  }

  private calculateMaskBoundingBox(
    mask: Uint8Array,
    width: number,
    height: number
  ): BoundingBox {
    let minX = width, minY = height, maxX = 0, maxY = 0;
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (mask[y * width + x] > 0) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }
    
    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }

  cleanup(): void {
    if (this.samSession) {
      // ONNX Runtime sessions don't have explicit cleanup in browser
      this.samSession = null;
    }
    this.isInitialized = false;
  }

  isReady(): boolean {
    return this.isInitialized;
  }

  getMethod(): 'sam' | 'grabcut' {
    return this.useSAM ? 'sam' : 'grabcut';
  }
}
