# Implementation Plan

## Phase 1: Adapt Existing Face Matchcut Codebase

**Note:** This project builds upon an existing face-based matchcut tool. The UI, export pipeline, audio system, and project structure are already production-ready. We only need to replace face detection with object segmentation and adapt the alignment logic.

- [x] 1. Update project metadata and branding



  - Update package.json name and description for object tracking
  - Update app/layout.tsx metadata (title, description, keywords)
  - Update header branding in app/page.tsx from "Match Cut Generator" to "Object Match Cut Generator"
  - Update hero section copy to reference objects instead of faces
  - _Requirements: 10.3_

- [ ] 2. Extend type definitions for object tracking
  - Add ObjectMask, BoundingBox, FeaturePoint, and MatchResult interfaces to lib/types.ts
  - Update ImageData interface to include mask, features, and transform properties
  - Add SegmentationQuality and AlignmentQuality types
  - Keep existing ExportSettings, AnimationFrame, and other types (already working)
  - _Requirements: 1.1, 2.1, 4.1_

- [ ] 3. Verify existing UI components work as-is
  - Test ImageUpload component (already supports drag-and-drop, validation)
  - Test ImageGrid component (already has reordering, status indicators, error handling)
  - Test AnimationPreview component (already has scrubbing, playback controls)
  - Test ExportOptions component (already has format selection, beat sync, audio)
  - No changes needed - these are production-ready
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

## Phase 2: Replace Face Detection with Object Segmentation

- [ ] 4. Create SAM-based object segmentation engine
  - Create new lib/objectSegmentation.ts file
  - Set up ONNX Runtime Web for SAM model loading and inference
  - Implement model downloading and IndexedDB caching (reuse pattern from faceDetection.ts)
  - Create segmentObject() method that accepts bounding box input
  - Add mask validation logic (area >5%, solidity >0.6, confidence >0.7)
  - Return mask data in format compatible with existing ImageData type
  - _Requirements: 2.1, 2.2, 2.4, 2.5_

- [ ] 5. Add GrabCut fallback segmentation
  - Install opencv.js package if not already present
  - Add GrabCut implementation to objectSegmentation.ts
  - Create automatic fallback logic when SAM fails to load
  - Ensure consistent mask format between SAM and GrabCut
  - Add error handling and user notifications
  - _Requirements: 2.3_

- [ ] 6. Build bounding box drawing UI
  - Create new components/BoundingBoxDrawer.tsx component
  - Implement click-and-drag rectangle drawing on canvas
  - Add visual feedback (crosshair cursor, preview rectangle)
  - Integrate with first frame in app/page.tsx workflow
  - Store bounding box coordinates in ImageData
  - _Requirements: 2.1, 3.3_

- [ ] 7. Add mask refinement brush tool
  - Create new components/MaskRefiner.tsx component
  - Implement brush tool with adjustable size
  - Add add/remove mode toggle
  - Draw mask overlay with transparency
  - Update mask data on brush strokes
  - Add accept/reject buttons
  - _Requirements: 3.1, 3.2, 3.4, 3.5_

## Phase 3: Replace Eye Alignment with Feature-Based Alignment

- [ ] 8. Create ORB feature detection system
  - Create new lib/featureMatching.ts file
  - Integrate OpenCV.js ORB detector (may already be available)
  - Implement extractFeatures() that works within mask boundaries
  - Extract 500-1000 keypoints with BRIEF descriptors
  - Add Gaussian blur preprocessing (σ=1.0)
  - Return FeatureSet with keypoints and descriptors
  - _Requirements: 4.1, 4.2, 4.3_

- [ ] 9. Implement feature matching and RANSAC alignment
  - Add matchFeatures() method to featureMatching.ts
  - Use BruteForceMatcher with Hamming distance
  - Apply Lowe ratio test (0.75) for filtering
  - Implement RANSAC with cv.estimateAffinePartial2D()
  - Set reprojection threshold to 3.0 pixels
  - Validate minimum 50 inliers, warn if <30 matches
  - Return AffineTransform matrix
  - _Requirements: 4.4, 5.4, 5.5_

- [ ] 10. Adapt imageAlignment.ts for object alignment
  - Rename alignImageFaceCrop() → alignImageObjectCrop()
  - Replace eye-based transform with feature-based transform
  - Keep canvas warping logic (cv.warpAffine with padding)
  - Reuse smoothing/interpolation code (already excellent)
  - Update to use object mask instead of face bounds
  - Keep scale normalization to 400px height
  - _Requirements: 5.1, 5.2, 5.3_

- [ ] 11. Implement median frame detection and re-alignment
  - Add computeAngularDistances() to featureMatching.ts
  - Calculate pairwise rotation angles from affine matrices
  - Find median frame by cumulative angular distance
  - Re-compute all transforms relative to median frame
  - Update alignment workflow in app/page.tsx
  - _Requirements: 5.1, 5.2_

- [ ] 12. Add automatic frame ordering by rotation
  - Extract rotation angles from affine matrices
  - Implement greedy nearest-neighbor sorting
  - Add orderFrames() function to featureMatching.ts
  - Integrate with existing drag-to-reorder UI (already works!)
  - Add lock order toggle in UI
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [ ] 13. Implement mask-based color correction
  - Update lib/colorCorrector.ts (or create if needed)
  - Extract mean RGB and std dev within object mask only
  - Apply linear color transfer per channel
  - Add optional exposure compensation (±1 EV)
  - Ignore background pixels during analysis
  - Preserve local contrast
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

## Phase 4: Integration and Testing

- [ ] 14. Update main processing pipeline in app/page.tsx
  - Replace faceDetector with objectSegmentor
  - Add bounding box drawing step for first frame
  - Update processImages() to use new segmentation
  - Replace eye alignment with feature-based alignment
  - Keep all existing state management (already works)
  - Maintain progress reporting (already implemented)
  - _Requirements: All segmentation and alignment requirements_

- [ ] 15. Add object-specific UI feedback
  - Update ProcessingIndicator for object-specific messages
  - Add mask quality visualization in ImageGrid
  - Show feature match count in image details
  - Display alignment confidence scores
  - Update error messages for object context
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [ ] 16. Verify export pipeline works with objects
  - Test GIF export with object-aligned frames (should work as-is)
  - Test MP4 export with audio (should work as-is)
  - Test beat sync with object sequences (should work as-is)
  - Verify PNG sequence export (should work as-is)
  - No changes needed - export is format-agnostic
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [ ] 17. Add Web Workers for parallel segmentation
  - Create workers/segmentationWorker.ts
  - Move SAM/GrabCut processing to worker
  - Implement message passing for mask data
  - Add worker pool management (4 concurrent)
  - Mobile: limit to 5 images concurrent
  - _Requirements: 4.5, 10.4_

- [ ] 18. Performance optimization and error handling
  - Add WebGPU detection for SAM (if supported)
  - Implement automatic WASM fallback
  - Add memory monitoring for large images
  - Create retry logic for failed segmentations
  - Add graceful degradation messages
  - _Requirements: 10.1, 10.2, 10.4, 2.5, 4.4, 5.5_

## Phase 5: Polish and Documentation

- [ ]* 19. Create comprehensive test suite
  - Write unit tests for objectSegmentation.ts
  - Write unit tests for featureMatching.ts
  - Test edge cases (no features, failed segmentation)
  - Add integration test for full pipeline
  - Performance benchmarks for SAM vs GrabCut
  - _Requirements: All requirements validation_

- [ ]* 20. Add advanced features and documentation
  - Add algorithm parameter controls (feature count, RANSAC threshold)
  - Create user guide for object selection best practices
  - Add tooltips explaining mask quality indicators
  - Build tutorial for first-time users
  - Document API for future extensions
  - _Requirements: Enhanced user experience_

## Summary

**Existing Code to Keep (90%):**
- ✅ All UI components (ImageUpload, ImageGrid, AnimationPreview, ExportOptions)
- ✅ Export pipeline (videoExport.ts with FFmpeg, beat sync, audio)
- ✅ Audio system (audioManager.ts, beatDetection.ts, audioFilters.ts)
- ✅ Project structure (Next.js, TypeScript, Tailwind)
- ✅ State management and error handling patterns

**New Code to Write (10%):**
- 🆕 lib/objectSegmentation.ts (SAM + GrabCut)
- 🆕 lib/featureMatching.ts (ORB + RANSAC)
- 🆕 components/BoundingBoxDrawer.tsx
- 🆕 components/MaskRefiner.tsx
- 🔄 Adapt lib/imageAlignment.ts (replace eye logic with feature logic)
- 🔄 Update app/page.tsx (replace face workflow with object workflow)

**Estimated Time Savings:** 3-4 weeks by reusing existing production-ready code!