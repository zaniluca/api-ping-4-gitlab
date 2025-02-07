import { Prisma, User } from "@prisma/client";
import axios, { AxiosError } from "axios";
import { Response, Router } from "express";
import prisma from "../../../prisma/client";
import { getAccessToken, getRefreshToken } from "../../utils/common";
import * as Sentry from "@sentry/node";
import { APP_URL_SCHEME } from "../../utils/constants";
import { generateUniqueHook, getEmailFromHook } from "../../utils/hook";

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

// Workaround for redirecting with a script
// Seems like android mobile browsers don't redirect properly
const redirect = (res: Response, url: string) =>
  res.send(`
  <script>
    window.location.href = "${url}";
  </script>
`);

const redirectWithError = (res: Response, error: string) =>
  redirect(res, `${APP_URL_SCHEME}login?error=${encodeURIComponent(error)}`);

const addEmailToGitlab = async (token: string, email: string) => {
  console.log("Adding notification email: ", email);
  try {
    await axios.post(
      "https://gitlab.com/api/v4/user/emails",
      {
        email: email,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
  } catch (err: unknown | AxiosError) {
    if (axios.isAxiosError(err)) {
      console.error("Couldn't add notification email: ", err.response?.data);
      Sentry.captureMessage("Couldn't add notification email", {
        extra: err.response?.data,
      });
      return;
    }

    console.error(
      "Recived unknwon error while adding notification email: ",
      err
    );
  }
};

const setHookEmailForNotifications = async (token: string, email: string) => {
  try {
    await axios.put(
      "https://gitlab.com/api/v4/notification_settings",
      {
        notification_email: email,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
  } catch (err: unknown | AxiosError) {
    if (axios.isAxiosError(err)) {
      console.error("Couldn't set notification email: ", err.response?.data);
      Sentry.captureMessage("Couldn't set notification email", {
        extra: err.response?.data,
      });
      return;
    }

    console.error(
      "Recived unknwon error while setting notification email: ",
      err
    );
  }
};

router.get("/authorize", async (req, res) => {
  return res.redirect(
    "https://gitlab.com/oauth/authorize?" +
      new URLSearchParams({
        client_id: process.env.GITLAB_APP_ID!,
        redirect_uri: `${req.protocol}://${req.get(
          "host"
        )}/oauth/gitlab/callback`,
        response_type: "code",
        scope: "read_user api",
        state: req.query.state as string,
      })
  );
});

router.get("/callback", async (req, res) => {
  if (req.query.error && req.query.error_description) {
    console.error(
      "Error on GitLab OAuth callback: ",
      req.query.error,
      req.query.error_description
    );

    return redirectWithError(res, req.query.error_description as string);
  }

  const { code, state } = req.query;

  let profile: GitlabUserResponse;
  let gitlabToken: string;
  try {
    const { data: tokens } = await axios.post<GitLabTokenResponse>(
      "https://gitlab.com/oauth/token",
      null,
      {
        params: {
          client_id: process.env.GITLAB_APP_ID!,
          client_secret: process.env.GITLAB_APP_SECRET!,
          grant_type: "authorization_code",
          code,
          redirect_uri: `${req.protocol}://${req.get(
            "host"
          )}/oauth/gitlab/callback`,
        },
      }
    );

    gitlabToken = tokens.access_token;

    const { data } = await axios.get<GitlabUserResponse>(
      "https://gitlab.com/api/v4/user",
      {
        headers: {
          Authorization: `Bearer ${gitlabToken}`,
        },
      }
    );

    profile = data;
  } catch (error) {
    Sentry.captureException(error);
    console.error("Error while authenticating with GitLab", error);
    return redirectWithError(res, "Couldn't authenticate with GitLab");
  }

  const alreadyExistingUser = await prisma.user.findUnique({
    where: {
      gitlabId: profile.id,
    },
  });

  // Login
  if (alreadyExistingUser) {
    const accessToken = getAccessToken({
      uid: alreadyExistingUser.id,
      hookId: alreadyExistingUser.hookId,
    });
    const refreshToken = getRefreshToken(alreadyExistingUser.id);

    return redirect(
      res,
      `${APP_URL_SCHEME}login?accessToken=${accessToken}&refreshToken=${refreshToken}`
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
      } catch (error) {
        console.error("Error while retriving user from state: ", error);
        return redirectWithError(
          res,
          "We couldn't associate your GitLab account with your email password account. Please try again."
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
    Sentry.captureException(e);
    throw e;
  }

  await addEmailToGitlab(gitlabToken, getEmailFromHook(user.hookId!));

  const accessToken = getAccessToken({
    uid: user.id,
    hookId: user.hookId,
  });
  const refreshToken = getRefreshToken(user.id);

  return redirect(
    res,
    `${APP_URL_SCHEME}login?accessToken=${accessToken}&refreshToken=${refreshToken}`
  );
});

export default router;
