# Migration Guide: Face Matchcut → Object Matchcut

## Overview

This document outlines the migration strategy from the existing face-based matchcut tool to an object-based matchcut tool. The key insight is that **90% of the codebase can be reused**, requiring only targeted replacements of the computer vision algorithms.

## What Stays (No Changes Needed)

### ✅ UI Components (100% Reusable)
- `components/ImageUpload.tsx` - Drag-and-drop, validation
- `components/ImageGrid.tsx` - Reordering, status indicators
- `components/AnimationPreview.tsx` - Playback, scrubbing
- `components/ExportOptions.tsx` - Settings, beat sync
- `components/ProcessingIndicator.tsx` - Progress feedback

**Why:** These components are format-agnostic and work with any aligned frames.

### ✅ Export Pipeline (100% Reusable)
- `lib/videoExport.ts` - FFmpeg integration, format conversion
- `lib/audioManager.ts` - Audio synchronization
- `lib/beatDetection.ts` - Beat detection algorithms
- `lib/audioFilters.ts` - Audio filtering utilities

**Why:** Export logic doesn't care about HOW frames were aligned, only that they exist.

### ✅ Project Infrastructure (100% Reusable)
- Next.js 14 setup
- TypeScript configuration
- Tailwind CSS styling
- State management patterns
- Error handling architecture

**Why:** These are framework-level concerns independent of the CV algorithms.

## What Changes (Targeted Replacements)

### 🔄 Computer Vision Core (10% of codebase)

#### 1. Segmentation: `lib/faceDetection.ts` → `lib/objectSegmentation.ts`

**Old Approach:**
```typescript
// MediaPipe Face Landmarker
const faceResult = await faceDetector.detectFace(image);
const eyePoints = faceResult.eyePoints;
```

**New Approach:**
```typescript
// SAM + GrabCut
const mask = await objectSegmentor.segmentObject(image, boundingBox);
const features = await featureMatcher.extractFeatures(image, mask);
```

**Key Changes:**
- Replace MediaPipe → SAM (ONNX Runtime Web)
- Add GrabCut fallback
- User draws bounding box instead of automatic face detection
- Return mask instead of landmarks

#### 2. Alignment: `lib/imageAlignment.ts` (Adapt, Don't Replace)

**Old Approach:**
```typescript
// Eye-based alignment
const transform = calculateAlignmentTransform(eyePoints, resolution);
const alignedCanvas = alignImageFaceCrop(image, faceResult, resolution);
```

**New Approach:**
```typescript
// Feature-based alignment
const matches = await featureMatcher.matchFeatures(features1, features2);
const transform = await featureMatcher.computeTransform(matches);
const alignedCanvas = alignImageObjectCrop(image, transform, mask, resolution);
```

**Key Changes:**
- Replace eye points → ORB feature points
- Replace eye distance calculation → RANSAC affine transform
- Keep canvas warping logic (already excellent)
- Keep smoothing/interpolation code (already excellent)

#### 3. New Files to Create

**`lib/objectSegmentation.ts`** (~300 lines)
- SAM model loading and inference
- GrabCut fallback implementation
- Mask validation and quality scoring
- Bounding box prompt handling

**`lib/featureMatching.ts`** (~400 lines)
- ORB keypoint detection
- Feature descriptor matching
- RANSAC affine transform estimation
- Match quality validation

**`components/BoundingBoxDrawer.tsx`** (~200 lines)
- Canvas-based rectangle drawing
- Click-and-drag interaction
- Visual feedback (crosshair, preview)

**`components/MaskRefiner.tsx`** (~300 lines)
- Brush tool for mask editing
- Add/remove mode toggle
- Mask overlay visualization
- Accept/reject workflow

### 🔄 Main Application Logic: `app/page.tsx`

**Changes Required:**
1. Replace `faceDetector` → `objectSegmentor`
2. Add bounding box drawing step for first frame
3. Update `processImages()` to use new segmentation
4. Replace eye alignment → feature-based alignment
5. Keep all state management (already works)

**Estimated Changes:** ~100 lines modified, ~50 lines added

### 🔄 Type Definitions: `lib/types.ts`

**Add New Interfaces:**
```typescript
interface ObjectMask {
  data: Uint8Array;
  width: number;
  height: number;
  confidence: number;
  boundingBox: BoundingBox;
}

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FeaturePoint {
  x: number;
  y: number;
  descriptor: Float32Array;
}

interface MatchResult {
  matches: Array<[number, number]>;
  inlierCount: number;
  confidence: number;
}
```

**Update Existing:**
```typescript
interface ImageData {
  // ... existing fields ...
  mask?: ObjectMask;           // NEW
  features?: FeaturePoint[];   // NEW
  transform?: AffineTransform; // NEW
}
```

## Migration Strategy

### Phase 1: Setup (Week 1)
1. ✅ Update project metadata and branding
2. ✅ Extend type definitions
3. ✅ Verify existing UI works as-is

### Phase 2: Segmentation (Week 2)
4. Create `objectSegmentation.ts` with SAM
5. Add GrabCut fallback
6. Build bounding box drawing UI
7. Add mask refinement brush tool

### Phase 3: Alignment (Week 3)
8. Create `featureMatching.ts` with ORB
9. Implement RANSAC alignment
10. Adapt `imageAlignment.ts` for objects
11. Add median frame detection
12. Implement frame ordering
13. Add mask-based color correction

### Phase 4: Integration (Week 4)
14. Update main pipeline in `app/page.tsx`
15. Add object-specific UI feedback
16. Verify export pipeline works
17. Add Web Workers for parallel processing
18. Performance optimization

### Phase 5: Polish (Week 5+)
19. Comprehensive testing
20. Advanced features and documentation

## Code Reuse Statistics

| Category | Lines of Code | Reuse % | Status |
|----------|---------------|---------|--------|
| UI Components | ~2,000 | 100% | ✅ Keep as-is |
| Export Pipeline | ~1,500 | 100% | ✅ Keep as-is |
| Audio System | ~800 | 100% | ✅ Keep as-is |
| Project Structure | ~500 | 100% | ✅ Keep as-is |
| Computer Vision | ~1,200 | 30% | 🔄 Adapt |
| **Total** | **~6,000** | **~90%** | **Excellent!** |

## Testing Strategy

### Unit Tests
- Test `objectSegmentation.ts` with sample images
- Test `featureMatching.ts` with known feature sets
- Test edge cases (no features, failed segmentation)

### Integration Tests
- Full pipeline test: upload → segment → align → export
- Test with various object types (textured, plain, small, large)
- Test error recovery (failed segmentation, insufficient features)

### Performance Tests
- Benchmark SAM vs GrabCut speed
- Measure feature extraction time
- Verify <10s processing for 10 images

## Deployment Checklist

- [ ] All new files created and tested
- [ ] Type definitions updated
- [ ] Main pipeline integrated
- [ ] UI feedback updated
- [ ] Error handling tested
- [ ] Performance targets met
- [ ] Documentation updated
- [ ] README reflects new functionality
- [ ] Examples added to docs

## Rollback Plan

If migration fails, the original face-based code is preserved in git history. Simply:
1. Revert changes to `app/page.tsx`
2. Remove new files (`objectSegmentation.ts`, `featureMatching.ts`, etc.)
3. Restore original `lib/types.ts`

The modular architecture ensures clean rollback without affecting the export pipeline or UI.

## Success Metrics

- ✅ 95% of frames successfully aligned (≥50 inliers)
- ✅ <10s processing time for 10 images (GPU-enabled)
- ✅ <5% crash rate on model load
- ✅ User completes first matchcut in <5 minutes
- ✅ Works on 90% of target devices

## Conclusion

This migration is **low-risk** and **high-reward** because:
1. We're building on a proven, production-ready foundation
2. Only 10% of code needs replacement
3. The export pipeline (most complex part) works as-is
4. Modular architecture allows incremental development
5. Easy rollback if needed

**Estimated Time Savings:** 3-4 weeks compared to building from scratch! 🚀
