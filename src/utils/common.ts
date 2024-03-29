import * as jwt from "jsonwebtoken";
import * as Sentry from "@sentry/node";
import type { CustomJWTClaims, Headers } from "./types";
import prisma from "../../prisma/client";

export const getAccessToken = (payload: CustomJWTClaims) => {
  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET!, {
    expiresIn: "1h",
  });
};

export const getRefreshToken = (uid: string) => {
  return jwt.sign(
    {
      uid,
    },
    process.env.JWT_REFRESH_SECRET!,
    {
      expiresIn: "60d",
    }
  );
};

export const getTokenPayload = (token: string) => {
  try {
    return jwt.decode(token) as CustomJWTClaims;
  } catch (e) {
    throw new Error("Invalid token");
  }
};

export const parseHeaders = (headers: string) => {
  let json: Record<string, string> = {};
  const sanitized = headers.trimEnd().replace(/[']+/g, "").split("\n");

  sanitized.map((e) => {
    let elements = e.split(": ");
    if (elements.length > 2) return;
    json[elements[0].trim().toLocaleLowerCase()] = elements[1];
  });

  return json as Headers;
};

export const updateLastLogin = async (id: string) => {
  try {
    await prisma.user.update({
      where: {
        id,
      },
      data: {
        lastLogin: new Date(),
      },
    });
  } catch (error) {
    Sentry.captureException(error);
    console.error(error);
  }
};
