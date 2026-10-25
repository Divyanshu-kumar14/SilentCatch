/** @type {import('next').NextConfig} */
const nextConfig = {
  // Docker multi-stage: `.next/standalone` ships a lean runtime (docker-expert pattern)
  output: "standalone",
};

export default nextConfig;
