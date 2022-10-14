import type { User } from "@prisma/client";
import axios from "axios";
import { Router } from "express";
import prisma from "../../../prisma/client";
import { getAccessToken, getRefreshToken } from "../../utils/common";
import generateUniqueHook from "../../utils/hook-generator";

const router = Router();

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
};

router.get("/authorize", async (_req, res) => {
  return res.redirect(
    "https://gitlab.com/oauth/authorize?" +
      new URLSearchParams({
        client_id: process.env.GITLAB_APP_ID!,
        redirect_uri: "http://localhost:3000/api/gitlab/callback",
        response_type: "code",
        scope: "api",
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
        redirect_uri: "http://localhost:3000/api/gitlab/callback", // TODO: switch link based on environment
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

  const userAccount = await prisma.account.findFirst({
    where: {
      providerAccountId: profile.id.toString(),
      provider: "GITLAB",
    },
  });

  // Login
  if (userAccount) {
    const accessToken = getAccessToken(userAccount.userId);
    const refreshToken = getRefreshToken(userAccount.userId);

    return res.redirect(
      `http://localhost:3000?accessToken=${accessToken}&refreshToken=${refreshToken}` // TODO: redirect to deep link of app
    );
  }

  // Signup
  let user: User;
  if (state) {
    // The user is connecting the account along with the email password account
    user = await prisma.user.findUniqueOrThrow({
      where: {
        id: state as string,
      },
    });
  } else {
    // New user
    user = await prisma.user.create({
      data: {
        hookId: generateUniqueHook(),
      },
    });
  }

  await prisma.account.create({
    data: {
      provider: "GITLAB",
      providerAccountId: profile.id.toString(),
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenType: tokens.token_type,
      userId: user.id,
      expiresAt: new Date(
        tokens.created_at + tokens.expires_in * 1000
      ).valueOf(),
      scope: tokens.scope,
    },
  });

  const accessToken = getAccessToken(user.id);
  const refreshToken = getRefreshToken(user.id);

  return res.redirect(
    `http://localhost:3000?accessToken=${accessToken}&refreshToken=${refreshToken}` // TODO: redirect to deep link of app
  );
});

export default router;
