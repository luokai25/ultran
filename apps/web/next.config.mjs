/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@ultran/ui', '@ultran/connectors'],
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
