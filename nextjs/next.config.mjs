/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keeps the Docker image small. See the Dockerfile.
  output: 'standalone',
  // The default indicator sits on top of the bottom-left chat launcher.
  devIndicators: false,
  async redirects() {
    return [{ source: '/seller/orders/cancellations', destination: '/seller/orders/returns?tab=cancellations', permanent: false }];
  },
};

export default nextConfig;
