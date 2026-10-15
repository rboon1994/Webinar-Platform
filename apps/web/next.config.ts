import type { NextConfig } from "next";

const config: NextConfig = {
  // stop `next dev` from generating apps/web/AGENTS.md
  agentRules: false,
};

export default config;
