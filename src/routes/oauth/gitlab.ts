import { Prisma, User } from "@prisma/client";
import axios from "axios";
import { Response, Router } from "express";
import prisma from "../../../prisma/client";
import { getAccessToken, getRefreshToken } from "../../utils/common";
import generateUniqueHook from "../../utils/hook-generator";

const router = Router();

const APP_REDIRECT_SCHEME =
  process.env.NODE_ENV === "production"
    ? "ping4gitlab://"
    : "exp://localhost:19000/--";

type GitLabTokenResponse = {
  access_token: string;
  token_type: string;
  refresh_token: string;
  expires_in: number;
  created_at: number;
  scope: string;
};

type GitlabUserResponse = {
  id: number;
  email: string;
};

const redirectWithError = (res: Response, error: string) =>
  res.redirect(
    `${APP_REDIRECT_SCHEME}/gitlab/login?error=${encodeURIComponent(error)}`
  );

router.get("/authorize", async (req, res) => {
  return res.redirect(
    "https://gitlab.com/oauth/authorize?" +
      new URLSearchParams({
        client_id: process.env.GITLAB_APP_ID!,
        redirect_uri: `${req.protocol}://${req.headers.host}/oauth/gitlab/callback`,
        response_type: "code",
        scope: "read_user",
        state: req.query.state as string,
      })
  );
});

router.get("/callback", async (req, res) => {
  const { code, state } = req.query;

  const { data: tokens } = await axios.post<GitLabTokenResponse>(
    "https://gitlab.com/oauth/token",
    null,
    {
      params: {
        client_id: process.env.GITLAB_APP_ID!,
        client_secret: process.env.GITLAB_APP_SECRET!,
        grant_type: "authorization_code",
        code,
        redirect_uri: `${req.protocol}://${req.headers.host}/oauth/gitlab/callback`,
      },
    }
  );

  const { data: profile } = await axios.get<GitlabUserResponse>(
    "https://gitlab.com/api/v4/user",
    {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
      },
    }
  );

  const alreadyExistingUser = await prisma.user.findUnique({
    where: {
      gitlabId: profile.id,
    },
  });

  // Login
  if (alreadyExistingUser) {
    const accessToken = getAccessToken(alreadyExistingUser.id);
    const refreshToken = getRefreshToken(alreadyExistingUser.id);

    return res.redirect(
      `${APP_REDIRECT_SCHEME}/gitlab/login?accessToken=${accessToken}&refreshToken=${refreshToken}`
    );
  }

  // Signup
  let user: User;
  try {
    if (state) {
      // The user is connecting the account along with the email password account
      try {
        user = await prisma.user.findUniqueOrThrow({
          where: {
            id: state as string,
          },
        });
      } catch {
        return redirectWithError(
          res,
          "The user with the given id does not exist"
        );
      }

      await prisma.user.update({
        where: {
          id: user.id,
        },
        data: {
          gitlabId: profile.id,
          // If the user didn't have an email password account, we set the email based on the gitlab account
          ...(!user.email && { email: profile.email }),
        },
      });
    } else {
      // New user
      user = await prisma.user.create({
        data: {
          hookId: generateUniqueHook(),
          gitlabId: profile.id,
          email: profile.email,
        },
      });
    }
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2002") {
        return redirectWithError(
          res,
          "An account with this email already exists"
        );
      }
    }
    throw e;
  }

  const accessToken = getAccessToken(user.id);
  const refreshToken = getRefreshToken(user.id);

  return res.redirect(
    `${APP_REDIRECT_SCHEME}/gitlab/login?accessToken=${accessToken}&refreshToken=${refreshToken}`
  );
});

export default router;
