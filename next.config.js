/** @type {import('next').NextConfig} */
const nextConfig = {
  // onnxruntime-web resolves its wasm binary via a dynamic asset-style
  // reference internally. Left to webpack, Next tries to "help" by bundling
  // it as a browser static asset (rewriting it to a /_next/static/media/
  // URL), which breaks at runtime in a plain Node.js server context.
  // Externalizing it means Node's own require() resolves it untouched.
  serverExternalPackages: ['onnxruntime-web'],
  // The routes that run vehicle detection (lib/vehicleDetect.ts) need the
  // bundled ONNX model and onnxruntime-web's wasm runtime, but both are
  // loaded dynamically at runtime (fs.readFileSync / internal wasm fetch),
  // so Next's default file tracing won't discover them on its own - without
  // this they'd be missing from the deployed function and fail at runtime.
  outputFileTracingIncludes: {
    'app/api/cron/check/route': ['./models/yolov8n.onnx', './node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.{wasm,mjs}'],
    'app/api/explore/route': ['./models/yolov8n.onnx', './node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.{wasm,mjs}'],
  },
};

module.exports = nextConfig;
