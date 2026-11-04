/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@ultron/ui', '@ultron/connectors'],
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
