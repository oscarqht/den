import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import("next").NextConfig} */
const nextConfig = {
  outputFileTracingRoot: __dirname,
  allowedDevOrigins: ["localhost", "*.localhost", "127.0.0.1", "*.nport.link", "*.ts.net", "100.*"],
  serverExternalPackages: ["keytar"],
  devIndicators: {
    position: "top-right",
  },
  experimental: {
    serverActions: {
      // Allow loopback iframe/proxy origins in local development previews.
      // Example host values: 127.0.0.1:55700
      allowedOrigins: ["127.0.0.*", "*.ts.net", "100.*"],
    },
  },
  async rewrites() {
    return [
      {
        source: "/terminal/:path*",
        destination: "http://127.0.0.1:7681/:path*",
      },
    ];
  },
};

export default nextConfig;
