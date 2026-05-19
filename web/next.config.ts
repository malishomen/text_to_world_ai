import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // React 19 strict-mode double-mount kills the @react-three/fiber WebGL
  // context in dev (Three.js renderer disposed on the first unmount; the
  // remount cannot restore the lost context, canvas renders fully black).
  // Production builds aren't strict-mode-double-mounted so this only
  // affects local development.
  reactStrictMode: false,
};

export default nextConfig;
