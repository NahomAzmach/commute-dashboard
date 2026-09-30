/** @type {import('next').NextConfig} */
const nextConfig = {
  // onnxruntime-node ships a native .node binary addon - webpack can't
  // bundle that, so it must be externalized and resolved via Node's own
  // require() at runtime instead.
  serverExternalPackages: ['onnxruntime-node'],
  // The routes that run vehicle detection (lib/vehicleDetect.ts) need the
  // bundled ONNX model and onnxruntime-node's native binary, but neither is
  // discoverable via static import analysis (the model is read by a runtime
  // fs path, and the native addon is loaded through the package's own
  // internal binding logic) - without this they'd be missing from the
  // deployed function. Only the linux/x64 binary is needed since that's
  // Vercel's build target; the package ships every platform by default.
  outputFileTracingIncludes: {
    'app/api/cron/check/route': [
      './models/yolov8n.onnx',
      './node_modules/onnxruntime-node/dist/**',
      './node_modules/onnxruntime-node/bin/napi-v6/linux/x64/onnxruntime_binding.node',
      './node_modules/onnxruntime-node/bin/napi-v6/linux/x64/libonnxruntime.*',
    ],
    'app/api/explore/route': [
      './models/yolov8n.onnx',
      './node_modules/onnxruntime-node/dist/**',
      './node_modules/onnxruntime-node/bin/napi-v6/linux/x64/onnxruntime_binding.node',
      './node_modules/onnxruntime-node/bin/napi-v6/linux/x64/libonnxruntime.*',
    ],
  },
  // The binding's require() uses a ${process.platform}/${process.arch}
  // template, so Next's tracer conservatively pulls in every platform's
  // binary (darwin, win32 with its large DirectML DLLs, linux/arm64) -
  // ~290MB combined. Only linux/x64 ever actually runs on Vercel.
  outputFileTracingExcludes: {
    'app/api/cron/check/route': [
      './node_modules/onnxruntime-node/bin/napi-v6/darwin/**',
      './node_modules/onnxruntime-node/bin/napi-v6/win32/**',
      './node_modules/onnxruntime-node/bin/napi-v6/linux/arm64/**',
    ],
    'app/api/explore/route': [
      './node_modules/onnxruntime-node/bin/napi-v6/darwin/**',
      './node_modules/onnxruntime-node/bin/napi-v6/win32/**',
      './node_modules/onnxruntime-node/bin/napi-v6/linux/arm64/**',
    ],
  },
};

module.exports = nextConfig;
