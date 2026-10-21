import { configFromEnv, handleVoice } from "../../src/server/handlers";

export default async (req: Request): Promise<Response> => handleVoice(req, { config: configFromEnv() });

export const config = {
  path: "/api/voice",
  method: "POST",
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
