# Object Match Cut Generator

Auto-aligned match cut video generator for objects. Upload multiple photos of the same object shot in different environments, and automatically generate smooth match cut animations with perfect alignment.

## Features

- 🎯 **AI-Powered Object Segmentation** - SAM (Segment Anything Model) with GrabCut fallback
- 🔍 **Feature-Based Alignment** - ORB keypoint detection with RANSAC for robust alignment
- 🎨 **Mask Refinement Tools** - Brush tool to perfect object boundaries
- 🎬 **Professional Export** - GIF, MP4 with customizable settings
- 🎵 **Beat Sync** - Sync frame changes to music beats
- 🔊 **Audio Effects** - Built-in or custom sound effects
- 📱 **Client-Side Processing** - All processing happens in your browser
- ⚡ **Fast Performance** - WebGPU acceleration with WASM fallback

## Tech Stack

- **Frontend:** Next.js 14, React 18, TypeScript, Tailwind CSS
- **Computer Vision:** 
  - SAM via ONNX Runtime Web (~40MB)
  - OpenCV.js for ORB features and GrabCut fallback (~8MB)
- **Video Export:** FFmpeg.wasm, MediaRecorder API
- **Audio:** Web Audio API, beat detection algorithms

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Installation

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build
```

### Development

```bash
# Start dev server
npm run dev

# Lint code
npm run lint

# Build production
npm run build

# Start production server
npm start
```

## Project Structure

```
├── app/                    # Next.js app directory
│   ├── page.tsx           # Main application page
│   ├── layout.tsx         # Root layout
│   └── globals.css        # Global styles
├── components/            # React components
│   ├── ImageUpload.tsx    # Drag-and-drop image upload
│   ├── ImageGrid.tsx      # Image management grid
│   ├── AnimationPreview.tsx # Preview with playback controls
│   ├── ExportOptions.tsx  # Export settings panel
│   └── ProcessingIndicator.tsx # Progress feedback
├── lib/                   # Core libraries
│   ├── objectSegmentation.ts # SAM + GrabCut segmentation
│   ├── featureMatching.ts    # ORB + RANSAC alignment
│   ├── imageAlignment.ts     # Canvas-based alignment
│   ├── videoExport.ts        # FFmpeg export pipeline
│   ├── audioManager.ts       # Audio synchronization
│   ├── beatDetection.ts      # Beat detection algorithms
│   ├── types.ts              # TypeScript definitions
│   └── utils.ts              # Utility functions
└── public/                # Static assets
    ├── favicon.svg
    └── *.mp3              # Built-in sound effects
```

## Usage

1. **Upload Images** - Drag and drop or select 5-30 images of the same object
2. **Draw Bounding Box** - On the first frame, draw a box around your object
3. **Refine Mask** (Optional) - Use the brush tool to perfect the object boundary
4. **Auto-Process** - AI segments and aligns all remaining frames
5. **Preview** - Scrub through the animation, adjust frame order
6. **Export** - Choose format (GIF/MP4), add audio, export!

## Performance Targets

| Metric | Target (Desktop) | Target (Mobile) |
|--------|-----------------|-----------------|
| Model load time | <5s | <10s |
| Segmentation per frame | 2-5s (GPU) | 5-15s |
| Feature matching | 100-200ms | 300-500ms |
| Total processing (10 images) | <10s | <30s |
| Export (WebM, 10 frames) | <3s | <10s |

## Browser Support

- Chrome/Edge 113+ (WebGPU support)
- Safari 18+ (WebGPU support)
- Firefox (WASM fallback)

## Known Limitations

- **3D Rotation:** Affine transforms only capture in-plane rotation
- **Low Texture:** Objects with few features may have weak alignments
- **Occlusion:** Partially hidden objects may fail alignment
- **Max Images:** 30 images per project (memory constraints)

## Contributing

This is a personal project, but suggestions and bug reports are welcome!

## License

MIT License - See LICENSE file for details

## Acknowledgments

- Built on top of the Face Match Cut Generator codebase
- Uses MediaPipe SAM for segmentation
- Uses OpenCV.js for feature detection
- FFmpeg.wasm for video encoding

## Development Status

🚧 **In Active Development** - Migrating from face-based to object-based alignment

See `.kiro/specs/object-tracking-matchcut-tool/` for detailed requirements and implementation plan.
