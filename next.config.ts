import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/.well-known/oauth-protected-resource",
        destination: "/oauth-meta/protected-resource",
      },
      {
        source: "/.well-known/oauth-authorization-server",
        destination: "/oauth-meta/authorization-server",
      },
    ];
  },
};

export default nextConfig;
