import { configFromEnv, handleParse } from "../../src/server/handlers";

export default async (req: Request): Promise<Response> => handleParse(req, { config: configFromEnv() });

export const config = {
  path: "/api/parse",
  method: "POST",
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
