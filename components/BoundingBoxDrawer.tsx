import { useRef, useState, useEffect, useCallback } from 'react';
import { Square, Check, X, RotateCcw } from 'lucide-react';
import { BoundingBox } from '@/lib/types';
import { cn } from '@/lib/utils';

interface BoundingBoxDrawerProps {
  image: HTMLImageElement;
  onBoundingBoxComplete: (bbox: BoundingBox) => void;
  onCancel?: () => void;
  className?: string;
}

export default function BoundingBoxDrawer({
  image,
  onBoundingBoxComplete,
  onCancel,
  className
}: BoundingBoxDrawerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null);
  const [currentPoint, setCurrentPoint] = useState<{ x: number; y: number } | null>(null);
  const [boundingBox, setBoundingBox] = useState<BoundingBox | null>(null);
  const [canvasScale, setCanvasScale] = useState(1);

  // Initialize canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size to match container while maintaining aspect ratio
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

    // Calculate scale factor for coordinate conversion
    const scale = image.width / displayWidth;
    setCanvasScale(scale);

    // Draw image
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    // Draw existing bounding box if any
    if (boundingBox) {
      drawBoundingBox(ctx, boundingBox, scale);
    }
  }, [image, boundingBox]);

  const drawBoundingBox = useCallback((
    ctx: CanvasRenderingContext2D,
    bbox: BoundingBox,
    scale: number
  ) => {
    const x = bbox.x / scale;
    const y = bbox.y / scale;
    const width = bbox.width / scale;
    const height = bbox.height / scale;

    // Draw semi-transparent overlay outside the box
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.clearRect(x, y, width, height);

    // Redraw image in the cleared area
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();
    ctx.drawImage(image, 0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();

    // Draw bounding box border
    ctx.strokeStyle = '#3B82F6';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(x, y, width, height);
    ctx.setLineDash([]);

    // Draw corner handles
    const handleSize = 8;
    ctx.fillStyle = '#3B82F6';
    const corners = [
      [x, y], // top-left
      [x + width, y], // top-right
      [x, y + height], // bottom-left
      [x + width, y + height], // bottom-right
    ];

    corners.forEach(([cx, cy]) => {
      ctx.fillRect(cx - handleSize / 2, cy - handleSize / 2, handleSize, handleSize);
    });
  }, [image]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setIsDrawing(true);
    setStartPoint({ x, y });
    setCurrentPoint({ x, y });
    setBoundingBox(null);
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !startPoint) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setCurrentPoint({ x, y });

    // Draw preview
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Redraw image
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    // Draw preview rectangle
    const width = x - startPoint.x;
    const height = y - startPoint.y;

    ctx.strokeStyle = '#3B82F6';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(startPoint.x, startPoint.y, width, height);
    ctx.setLineDash([]);

    // Draw semi-transparent fill
    ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
    ctx.fillRect(startPoint.x, startPoint.y, width, height);
  }, [isDrawing, startPoint, image]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !startPoint) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setIsDrawing(false);

    // Calculate bounding box in image coordinates
    const minX = Math.min(startPoint.x, x);
    const minY = Math.min(startPoint.y, y);
    const maxX = Math.max(startPoint.x, x);
    const maxY = Math.max(startPoint.y, y);

    const width = maxX - minX;
    const height = maxY - minY;

    // Validate minimum size (at least 20x20 pixels)
    if (width < 20 || height < 20) {
      // Too small, reset
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      }
      setStartPoint(null);
      setCurrentPoint(null);
      return;
    }

    // Convert to image coordinates
    const bbox: BoundingBox = {
      x: Math.round(minX * canvasScale),
      y: Math.round(minY * canvasScale),
      width: Math.round(width * canvasScale),
      height: Math.round(height * canvasScale),
    };

    setBoundingBox(bbox);
    setStartPoint(null);
    setCurrentPoint(null);
  }, [isDrawing, startPoint, canvasScale]);

  const handleAccept = useCallback(() => {
    if (boundingBox) {
      onBoundingBoxComplete(boundingBox);
    }
  }, [boundingBox, onBoundingBoxComplete]);

  const handleReset = useCallback(() => {
    setBoundingBox(null);
    setStartPoint(null);
    setCurrentPoint(null);

    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      }
    }
  }, [image]);

  return (
    <div className={cn("flex flex-col space-y-4", className)}>
      {/* Instructions */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start space-x-3">
          <Square className="w-5 h-5 text-blue-600 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-medium text-blue-900 mb-1">
              Draw a Box Around Your Object
            </h3>
            <p className="text-sm text-blue-700">
              {!boundingBox ? (
                'Click and drag to draw a rectangle around the object you want to track.'
              ) : (
                'Box drawn! Click Accept to continue or Reset to redraw.'
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Canvas Container */}
      <div className="relative bg-gray-900 rounded-lg overflow-hidden" style={{ height: '500px' }}>
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          className={cn(
            "absolute inset-0 m-auto cursor-crosshair",
            isDrawing && "cursor-crosshair"
          )}
          style={{ maxWidth: '100%', maxHeight: '100%' }}
        />

        {/* Cursor hint */}
        {!boundingBox && !isDrawing && (
          <div className="absolute top-4 left-4 bg-black bg-opacity-75 text-white text-sm px-3 py-2 rounded-lg">
            Click and drag to draw
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-between">
        <button
          onClick={handleReset}
          disabled={!boundingBox && !isDrawing}
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
            disabled={!boundingBox}
            className={cn(
              "flex items-center space-x-2 px-6 py-2 rounded-lg transition-colors",
              "bg-blue-600 text-white hover:bg-blue-700",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            <Check className="w-4 h-4" />
            <span>Accept & Continue</span>
          </button>
        </div>
      </div>

      {/* Bounding Box Info */}
      {boundingBox && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
          <div className="text-sm text-gray-600">
            <span className="font-medium">Selected Area:</span>{' '}
            {boundingBox.width} × {boundingBox.height} pixels
            {' '}({Math.round((boundingBox.width * boundingBox.height) / (image.width * image.height) * 100)}% of image)
          </div>
        </div>
      )}
    </div>
  );
}
