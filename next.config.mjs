import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TAILSCALE_DEV_HOST = "office-mac.tail3158df.ts.net";

/** @type {import("next").NextConfig} */
const nextConfig = {
  outputFileTracingRoot: __dirname,
  allowedDevOrigins: ["localhost", "*.localhost", "127.0.0.1", "*.nport.link", "*.ngrok-free.app", "*.ngrok.app", "*.ngrok.io", "*.ts.net", TAILSCALE_DEV_HOST, "100.*"],
  serverExternalPackages: ["keytar"],
  devIndicators: {
    position: "top-right",
  },
  experimental: {
    serverActions: {
      // Allow loopback iframe/proxy origins in local development previews.
      // Example host values: 127.0.0.1:55700
      allowedOrigins: ["127.0.0.*", "*.ngrok-free.app", "*.ngrok.app", "*.ngrok.io", "*.ts.net", TAILSCALE_DEV_HOST, "100.*"],
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
