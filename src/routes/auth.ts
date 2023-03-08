import { Router, Request } from "express";
import prisma from "../../prisma/client";
import bcrypt from "bcrypt";
import type {
  AuthRequestWithPayload,
  RequestWithPayload,
} from "../utils/types";
import {
  getAccessToken,
  getRefreshToken,
  getUidFromToken,
  updateLastLogin,
} from "../utils/common";
import type { User } from "@prisma/client";
import {
  LoginBodySchema,
  RefreshBodySchema,
  SignupBodySchema,
} from "../utils/validation";
import {
  BadRequestError,
  CredentialsError,
  ErrorWithStatus,
} from "../utils/errors";
import { expressjwt } from "express-jwt";
import generateUniqueHook from "../utils/hook-generator";
import { validate } from "../middlewares";
import type { InferType } from "yup";

const router = Router();

type LoginPayload = InferType<typeof LoginBodySchema>;

router.post(
  "/login",
  validate({ bodySchema: LoginBodySchema }),
  async (req: RequestWithPayload<LoginPayload>, res, next) => {
    const { email, password } = req.body;

    if (!password || !email) {
      return next(new BadRequestError("Missing required fields"));
    }

    const user = await prisma.user.findUnique({
      where: {
        email,
      },
    });

    if (
      !user ||
      !user.password ||
      !bcrypt.compareSync(password, user.password)
    ) {
      return next(new CredentialsError("Invalid credentials"));
    }

    await updateLastLogin(user.id);

    return res.status(200).json({
      accessToken: getAccessToken(user.id),
      refreshToken: getRefreshToken(user.id),
    });
  }
);

type SignupPayload = InferType<typeof SignupBodySchema>;

router.post(
  "/signup",
  expressjwt({
    secret: process.env.JWT_ACCESS_SECRET!,
    algorithms: ["HS256"],
    credentialsRequired: false,
  }),
  validate({ bodySchema: SignupBodySchema }),
  async (req: AuthRequestWithPayload<SignupPayload>, res, next) => {
    const { password, email } = req.body;
    const isAnonymous = !!req.auth?.uid;

    const alreadyExists = await prisma.user.count({
      where: {
        email,
      },
    });

    if (alreadyExists) {
      return next(new ErrorWithStatus(409, "User already exists"));
    }

    let user: Pick<User, "id">;

    if (isAnonymous) {
      console.log("Upgrading anonymous user to permanent user");

      user = await prisma.user.update({
        where: {
          id: req.auth?.uid,
        },
        data: {
          email,
          password: bcrypt.hashSync(password, 10),
        },
        select: {
          id: true,
        },
      });
    } else {
      user = await prisma.user.create({
        data: {
          email,
          password: bcrypt.hashSync(password, 10),
          hookId: generateUniqueHook(),
        },
        select: {
          id: true,
        },
      });
    }

    // If the user is anonymous we don't create a new resource so the status should not be 201
    return res.status(isAnonymous ? 200 : 201).json({
      accessToken: getAccessToken(user.id),
      refreshToken: getRefreshToken(user.id),
    });
  }
);

router.post("/anonymous", async (_req: Request, res) => {
  const user = await prisma.user.create({
    data: {
      hookId: generateUniqueHook(),
    },
    select: {
      id: true,
    },
  });

  return res.status(201).json({
    accessToken: getAccessToken(user.id),
    refreshToken: getRefreshToken(user.id),
  });
});

type RefreshPayload = InferType<typeof RefreshBodySchema>;

router.post(
  "/refresh",
  validate({ bodySchema: RefreshBodySchema }),
  async (req: RequestWithPayload<RefreshPayload>, res) => {
    const { refreshToken } = req.body;

    const uid = getUidFromToken(refreshToken);

    await updateLastLogin(uid);

    return res.status(200).json({
      accessToken: getAccessToken(uid),
      refreshToken: getRefreshToken(uid),
    });
  }
);

export default router;
