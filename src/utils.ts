import * as jwt from "jsonwebtoken";
import type { CustomJWTClaims } from "./types";

/**
 * Generate a short lived JWT token for the user.
 * @param uid User ID to be associated with the token
 * @returns JWT access token
 */
export const getAccessToken = (uid: string) => {
  return jwt.sign(
    {
      uid,
    },
    process.env.JWT_ACCESS_SECRET!,
    {
      expiresIn: "1h",
    }
  );
};

/**
 * Generate a long lived JWT token for the user.
 * used to get a new token when the old one expires.
 * @param uid User ID to be associated with the token
 * @returns JWT refresh token
 */
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

/**
 * Decodes a JWT token and returns the user ID.
 * @param token JWT token
 * @returns user ID associatex with provided token
 */
export const getUidFromToken = (token: string) => {
  try {
    return (jwt.decode(token) as CustomJWTClaims).uid;
  } catch (e) {
    throw new Error("Invalid token");
  }
};

/**
 * Validate if a refresh token is valid.
 * @param token JWT token
 */
export const validateRefreshToken = (token: string) => {
  try {
    jwt.decode(token);
    return jwt.verify(token, process.env.JWT_REFRESH_SECRET!);
  } catch (e) {
    console.error("Could not decode refresh token: ", e);
    return false;
  }
};
