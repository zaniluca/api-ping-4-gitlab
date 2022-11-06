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
  email: string;
};

router.get("/authorize", async (_req, res) => {
  return res.redirect(
    "https://gitlab.com/oauth/authorize?" +
      new URLSearchParams({
        client_id: process.env.GITLAB_APP_ID!,
        redirect_uri: "http://localhost:8080/oauth/gitlab/callback", // TODO: switch link based on environment
        response_type: "code",
        scope: "read_user",
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
        redirect_uri: "http://localhost:8080/oauth/gitlab/callback", // TODO: switch link based on environment
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
      `exp://localhost:19000/--/gitlab/login?accessToken=${accessToken}&refreshToken=${refreshToken}` // TODO: switch link based on environment
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

  await prisma.user.update({
    where: {
      id: user.id,
    },
    data: {
      gitlabId: profile.id,
      email: profile.email,
    },
  });

  const accessToken = getAccessToken(user.id);
  const refreshToken = getRefreshToken(user.id);

  return res.redirect(
    `exp://localhost:19000/--/gitlab/login?accessToken=${accessToken}&refreshToken=${refreshToken}` // TODO: switch link based on environment
  );
});

export default router;