/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@ultron/ui', '@ultron/connectors'],
  experimental: {
    typedRoutes: true,
    cpus: 1,
  },
};

export default nextConfig;
