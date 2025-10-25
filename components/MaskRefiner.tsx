import { useRef, useState, useEffect, useCallback } from 'react';
import { Brush, Eraser, Check, X, RotateCcw, Plus, Minus } from 'lucide-react';
import { ObjectMask } from '@/lib/types';
import { cn } from '@/lib/utils';

interface MaskRefinerProps {
  image: HTMLImageElement;
  initialMask: ObjectMask;
  onMaskComplete: (mask: ObjectMask) => void;
  onCancel?: () => void;
  className?: string;
}

type BrushMode = 'add' | 'remove';

export default function MaskRefiner({
  image,
  initialMask,
  onMaskComplete,
  onCancel,
  className
}: MaskRefinerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mask, setMask] = useState<Uint8Array>(new Uint8Array(initialMask.data));
  const [brushMode, setBrushMode] = useState<BrushMode>('add');
  const [brushSize, setBrushSize] = useState(20);
  const [isDrawing, setIsDrawing] = useState(false);
  const [canvasScale, setCanvasScale] = useState(1);
  const [hasChanges, setHasChanges] = useState(false);

  // Initialize canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    const container = canvas.parentElement;
    if (!container) return;

    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    const imageAspect = image.width / image.height;
    const containerAspect = containerWidth / containerHeight;

    let displayWidth, displayHeight;
    if (imageAspect > containerAspect) {
      displayWidth = containerWidth;
      displayHeight = containerWidth / imageAspect;
    } else {
      displayHeight = containerHeight;
      displayWidth = containerHeight * imageAspect;
    }

    canvas.width = displayWidth;
    canvas.height = displayHeight;

    const scale = image.width / displayWidth;
    setCanvasScale(scale);

    // Draw initial state
    redrawCanvas(ctx, displayWidth, displayHeight, scale);
  }, [image, initialMask]);

  // Redraw canvas when mask changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    redrawCanvas(ctx, canvas.width, canvas.height, canvasScale);
  }, [mask, canvasScale]);

  const redrawCanvas = useCallback((
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    scale: number
  ) => {
    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw image
    ctx.drawImage(image, 0, 0, width, height);

    // Draw mask overlay
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const imgX = Math.floor(x * scale);
        const imgY = Math.floor(y * scale);
        const maskIdx = imgY * image.width + imgX;
        const canvasIdx = (y * width + x) * 4;

        if (mask[maskIdx] > 0) {
          // Highlight masked area with semi-transparent blue
          data[canvasIdx] = Math.min(255, data[canvasIdx] + 30); // R
          data[canvasIdx + 1] = Math.min(255, data[canvasIdx + 1] + 60); // G
          data[canvasIdx + 2] = Math.min(255, data[canvasIdx + 2] + 120); // B
          data[canvasIdx + 3] = 200; // A
        } else {
          // Dim unmasked area
          data[canvasIdx] = data[canvasIdx] * 0.5;
          data[canvasIdx + 1] = data[canvasIdx + 1] * 0.5;
          data[canvasIdx + 2] = data[canvasIdx + 2] * 0.5;
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }, [image, mask]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDrawing(true);
    handleBrushStroke(e);
  }, [brushMode, brushSize, canvasScale]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    handleBrushStroke(e);
  }, [isDrawing, brushMode, brushSize, canvasScale]);

  const handleMouseUp = useCallback(() => {
    setIsDrawing(false);
  }, []);

  const handleBrushStroke = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Convert to image coordinates
    const imgX = Math.floor(x * canvasScale);
    const imgY = Math.floor(y * canvasScale);

    // Apply brush
    const newMask = new Uint8Array(mask);
    const brushValue = brushMode === 'add' ? 255 : 0;
    const brushRadius = Math.floor(brushSize * canvasScale / 2);

    for (let dy = -brushRadius; dy <= brushRadius; dy++) {
      for (let dx = -brushRadius; dx <= brushRadius; dx++) {
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance <= brushRadius) {
          const px = imgX + dx;
          const py = imgY + dy;

          if (px >= 0 && px < image.width && py >= 0 && py < image.height) {
            const idx = py * image.width + px;
            newMask[idx] = brushValue;
          }
        }
      }
    }

    setMask(newMask);
    setHasChanges(true);
  }, [mask, brushMode, brushSize, canvasScale, image.width, image.height]);

  const handleAccept = useCallback(() => {
    // Calculate updated mask properties
    let count = 0;
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] > 0) count++;
    }

    const area = count / (image.width * image.height);

    // Calculate bounding box
    let minX = image.width, minY = image.height, maxX = 0, maxY = 0;
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        if (mask[y * image.width + x] > 0) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }

    const boundingBox = {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };

    // Calculate solidity (simplified)
    const bboxArea = boundingBox.width * boundingBox.height;
    const solidity = bboxArea > 0 ? (count / bboxArea) : 0;

    const updatedMask: ObjectMask = {
      data: mask,
      width: image.width,
      height: image.height,
      confidence: initialMask.confidence,
      boundingBox,
      area,
      solidity,
    };

    onMaskComplete(updatedMask);
  }, [mask, image.width, image.height, initialMask.confidence, onMaskComplete]);

  const handleReset = useCallback(() => {
    setMask(new Uint8Array(initialMask.data));
    setHasChanges(false);
  }, [initialMask.data]);

  const increaseBrushSize = useCallback(() => {
    setBrushSize(prev => Math.min(100, prev + 5));
  }, []);

  const decreaseBrushSize = useCallback(() => {
    setBrushSize(prev => Math.max(5, prev - 5));
  }, []);

  return (
    <div className={cn("flex flex-col space-y-4", className)}>
      {/* Instructions */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start space-x-3">
          <Brush className="w-5 h-5 text-blue-600 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-medium text-blue-900 mb-1">
              Refine Object Mask
            </h3>
            <p className="text-sm text-blue-700">
              Use the brush to add or remove areas from the mask. Blue areas are included in the object.
            </p>
          </div>
        </div>
      </div>

      {/* Tools */}
      <div className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg p-4">
        {/* Brush Mode */}
        <div className="flex items-center space-x-2">
          <span className="text-sm font-medium text-gray-700">Mode:</span>
          <button
            onClick={() => setBrushMode('add')}
            className={cn(
              "flex items-center space-x-2 px-3 py-2 rounded-lg transition-colors",
              brushMode === 'add'
                ? "bg-blue-600 text-white"
                : "bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"
            )}
          >
            <Plus className="w-4 h-4" />
            <span>Add</span>
          </button>
          <button
            onClick={() => setBrushMode('remove')}
            className={cn(
              "flex items-center space-x-2 px-3 py-2 rounded-lg transition-colors",
              brushMode === 'remove'
                ? "bg-red-600 text-white"
                : "bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"
            )}
          >
            <Minus className="w-4 h-4" />
            <span>Remove</span>
          </button>
        </div>

        {/* Brush Size */}
        <div className="flex items-center space-x-3">
          <span className="text-sm font-medium text-gray-700">Brush Size:</span>
          <button
            onClick={decreaseBrushSize}
            className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50"
          >
            <Minus className="w-4 h-4" />
          </button>
          <span className="text-sm font-mono w-12 text-center">{brushSize}px</span>
          <button
            onClick={increaseBrushSize}
            className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Canvas Container */}
      <div className="relative bg-gray-900 rounded-lg overflow-hidden" style={{ height: '500px' }}>
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          className="absolute inset-0 m-auto cursor-crosshair"
          style={{ maxWidth: '100%', maxHeight: '100%' }}
        />

        {/* Brush cursor preview */}
        <div className="absolute top-4 left-4 bg-black bg-opacity-75 text-white text-sm px-3 py-2 rounded-lg">
          {brushMode === 'add' ? '+ Add to mask' : '- Remove from mask'}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-between">
        <button
          onClick={handleReset}
          disabled={!hasChanges}
          className={cn(
            "flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors",
            "border border-gray-300 hover:bg-gray-50",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          <RotateCcw className="w-4 h-4" />
          <span>Reset</span>
        </button>

        <div className="flex items-center space-x-3">
          {onCancel && (
            <button
              onClick={onCancel}
              className="flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors border border-gray-300 hover:bg-gray-50"
            >
              <X className="w-4 h-4" />
              <span>Cancel</span>
            </button>
          )}

          <button
            onClick={handleAccept}
            className="flex items-center space-x-2 px-6 py-2 rounded-lg transition-colors bg-blue-600 text-white hover:bg-blue-700"
          >
            <Check className="w-4 h-4" />
            <span>Accept & Continue</span>
          </button>
        </div>
      </div>

      {/* Mask Info */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
        <div className="text-sm text-gray-600">
          <span className="font-medium">Masked Area:</span>{' '}
          {(() => {
            let count = 0;
            for (let i = 0; i < mask.length; i++) {
              if (mask[i] > 0) count++;
            }
            const percentage = (count / mask.length * 100).toFixed(1);
            return `${percentage}% of image`;
          })()}
          {hasChanges && (
            <span className="ml-2 text-blue-600 font-medium">(Modified)</span>
          )}
        </div>
      </div>
    </div>
  );
}
