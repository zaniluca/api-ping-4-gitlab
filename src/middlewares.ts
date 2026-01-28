import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import * as Sentry from "@sentry/cloudflare";
import { AppEnv } from "./utils/types";
import { ValidationTargets } from "hono";
import { zValidator } from "@hono/zod-validator";
import { ZodSchema } from "zod";

/**
 * Middleware to attach user info to Sentry context
 * Should be used after JWT middleware
 */
export const attachSentryUserInfo = createMiddleware<AppEnv>(
  async (c, next) => {
    const payload = c.get("jwtPayload");

    if (payload?.uid) {
      Sentry.setUser({
        id: payload.uid as string,
        username: payload.hookId as string,
      });
    }

    await next();
  },
);

/**
 * Custom error logger middleware
 */
export const errorLogger = createMiddleware<AppEnv>(async (c, next) => {
  await next();

  // Check if there's an error in the response
  if (c.error) {
    // Skip logging for test environment
    if (c.env.ENVIRONMENT === "test") return;

    // Skip logging for UnauthorizedError (401/403)
    if (c.error instanceof HTTPException) {
      const status = c.error.status;
      if (status === 401 || status === 403) return;
    }

    console.error(`${c.error.name}: ${c.error.message}`);
  }
});

export const validate = <
  Target extends keyof ValidationTargets,
  T extends ZodSchema,
>(
  target: Target,
  schema: T,
) =>
  zValidator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          message: result.error.issues[0]?.message || "Validation failed",
        },
        400,
      );
    }
  });
