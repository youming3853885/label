/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: { unoptimized: true },

  // react-konva imports konva, which has an optional dependency on the
  // Node-only `canvas` package. We never run server-side rendering of the
  // canvas (the AnnotatorView is dynamic({ssr:false})) so alias `canvas`
  // to a false-import to keep webpack happy.
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      canvas: false,
      encoding: false,
    };
    return config;
  },
};
export default nextConfig;
