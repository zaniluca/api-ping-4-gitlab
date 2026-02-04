import { createMiddleware } from "hono/factory";
import * as Sentry from "@sentry/cloudflare";
import { AppEnv } from "./utils/types";
import { ValidationTargets } from "hono";
import { zValidator } from "@hono/zod-validator";
import { ZodSchema } from "zod";
import pino from "pino";
import { createHandler as debugLog } from "hono-pino/debug-log";
import { jwt } from "hono/jwt";

const jwtAuth = createMiddleware<AppEnv>(async (c, next) => {
  const jwtMiddleware = jwt({ secret: c.env.JWT_ACCESS_SECRET });
  return jwtMiddleware(c, next);
});

const attachUserInfo = createMiddleware<AppEnv>(async (c, next) => {
  const payload = c.get("jwtPayload");
  const logger = c.get("logger");

  if (payload?.uid) {
    logger.assign({
      user: {
        id: payload.uid as string,
        hookId: payload.hookId as string,
      },
    });

    Sentry.setUser({
      id: payload.uid as string,
      username: payload.hookId as string,
    });
  }

  await next();
});

export const authRequired = [jwtAuth, attachUserInfo];

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

export type Logger = Pick<
  pino.Logger,
  "info" | "warn" | "error" | "bindings" | "debug" | "trace"
> & {
  assign: (obj: pino.Bindings) => void;
  setMsg: (msg: string) => void;
};

export const loggerMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const pinoLogger = pino({
    browser: {
      asObject: true,
      write:
        c.env.ENVIRONMENT === "development"
          ? debugLog({
              normalLogFormat: "[{time}] {levelLabel} {msg} {bindings}",
            })
          : undefined,
    },
    level: "info",
  });

  let currentLogger = pinoLogger;
  let accumulatedBindings: pino.Bindings = {};

  const assignFn = (obj: pino.Bindings) => {
    accumulatedBindings = { ...accumulatedBindings, ...obj };
    currentLogger = currentLogger.child(obj);
    Object.assign(loggerWithAssign, currentLogger, {
      assign: assignFn,
      bindings: bindingsFn,
      setMsg: setMsgFn,
    });
  };

  const bindingsFn = () => accumulatedBindings;

  const setMsgFn = (msg: string) => {
    assignFn({ msg });
  };

  const loggerWithAssign: Logger = {
    ...pinoLogger,
    assign: assignFn,
    bindings: bindingsFn,
    setMsg: setMsgFn,
  } as Logger;

  c.set("logger", loggerWithAssign);

  await next();
});

export const wideLoggingMiddleware = createMiddleware<AppEnv>(
  async (c, next) => {
    const startTime = Date.now();
    const logger = c.get("logger");

    logger.assign({
      headers: c.req.header(),
      requestId: c.get("requestId"),
      timestamp: new Date().toISOString(),
      method: c.req.method,
      path: c.req.path,
      service: "api",
      version: c.env.SENTRY_RELEASE || "unknown",
    });
    try {
      await next();

      logger.assign({
        durationMs: Date.now() - startTime,
      });

      if (logger.bindings().outcome === "error") {
        // Log has already been handled in error middleware
        return;
      }
      logger.assign({
        statusCode: c.res.status,
        outcome: "success",
      });
      logger.info(`${c.req.method} ${c.req.path}`);
    } finally {
      logger.assign({
        durationMs: Date.now() - startTime,
      });
    }
  },
);
