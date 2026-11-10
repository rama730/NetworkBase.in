import { defineRailway, github, project, service } from "railway/iac";

export default defineRailway(() => {
  const NetworkBaseIn = github("rama730/NetworkBase.in", { branch: "main", checkSuites: false });

  const networkbaseWeb = service("networkbase-web", {
    source: NetworkBaseIn,
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    healthcheck: "/api/v1/live",
    healthcheckTimeout: 100,
    replicas: { "asia-southeast1-eqsg3a": 1 },
    domains: ["networkbase.in"],
    networking: { privateNetworkEndpoint: "nb-s32" },
  });
  const networkbaseWorker = service("networkbase-worker", {
    source: NetworkBaseIn,
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    healthcheck: "/api/v1/live",
    healthcheckTimeout: 100,
    replicas: { "asia-southeast1-eqsg3a": 1 },
  });

  return project("networkbase-production", {
    variables: { managed: false },
    resources: [networkbaseWeb, networkbaseWorker],
  });
});
