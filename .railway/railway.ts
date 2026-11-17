import { defineRailway, github, project, service } from "railway/iac";

export const PRODUCTION_WATCH_PATTERNS = [
  "src/**",
  "public/**",
  "drizzle/**",
  "scripts/**",
  // The server runs the CLI's diff, merge and agent-tool code and its API schema: those folders deploy too.
  "packages/nb-cli/lib/**",
  "packages/nb-cli/schema/**",
  "package.json",
  "package-lock.json",
  "next.config.ts",
  "tsconfig.json",
  "Dockerfile",
  "railway.json",
];

export default defineRailway(() => {
  const NetworkBaseIn = github("rama730/NetworkBase.in", { branch: "main", checkSuites: false });

  // ponytail: restrict Railway auto-deploys to runtime-affecting paths so docs/, tests/ and the CLI's own tests, scripts and docs do not trigger dual 4 GB Docker builds and container overlap spikes. ceiling: manual redeploy if a build-only root dotfile changes. upgrade: split CI build artifact from deploy trigger.
  const networkbaseWeb = service("networkbase-web", {
    source: NetworkBaseIn,
    build: {
      buildEnvironment: "V3",
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile",
      watchPatterns: PRODUCTION_WATCH_PATTERNS,
    },
    healthcheck: "/api/v1/live",
    healthcheckTimeout: 100,
    replicas: { "asia-southeast1-eqsg3a": 1 },
    domains: ["networkbase.in"],
    networking: { privateNetworkEndpoint: "nb-s32" },
  });
  const networkbaseWorker = service("networkbase-worker", {
    source: NetworkBaseIn,
    build: {
      buildEnvironment: "V3",
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile",
      watchPatterns: PRODUCTION_WATCH_PATTERNS,
    },
    healthcheck: "/api/v1/live",
    healthcheckTimeout: 100,
    replicas: { "asia-southeast1-eqsg3a": 1 },
  });

  return project("networkbase-production", {
    variables: { managed: false },
    resources: [networkbaseWeb, networkbaseWorker],
  });
});
