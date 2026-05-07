/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The annotator page uses react-konva which doesn't SSR cleanly.
  // We handle that with dynamic imports per-component.
  images: { unoptimized: true },
};
export default nextConfig;
