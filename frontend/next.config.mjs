/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // wagmi's connector barrel statically reaches @coinbase/cdp-sdk, whose x402
    // payment helpers import optional packages that are not installed. The
    // dashboard only uses EIP-6963 injected wallets and never runs those code
    // paths, so they resolve to an empty module instead of failing the build.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@x402/core": false,
      "@x402/evm": false,
      "@x402/svm": false,
    };
    // Optional node-only peers of the wallet SDKs.
    config.externals = [...(config.externals ?? []), "pino-pretty", "lokijs", "encoding"];
    return config;
  },
};

export default nextConfig;
