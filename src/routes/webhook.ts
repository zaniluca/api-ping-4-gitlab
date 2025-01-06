import { Router } from "express";
import type { Headers, PipelineStatus, WebhookPayload } from "../utils/types";
import hash from "object-hash";
import prisma from "../../prisma/client";
import { Notification, Prisma, User } from "@prisma/client";
import { Expo, ExpoPushMessage } from "expo-server-sdk";
import { parseHeaders } from "../utils/common";
import { ErrorWithStatus } from "../utils/errors";
import * as Sentry from "@sentry/node";
import { IncomingForm } from "formidable";

const router = Router();

// optionally providing an access token if you have enabled push security
const expo = new Expo({
  accessToken: process.env.EXPO_ACCESS_TOKEN,
  useFcmV1: true,
});

const removeFooterFromHtml = (html?: string) => {
  const FOOTER_REGEX = /<div\b[^>]*class="footer"[^>]*>([\s\S]*?)<\/div>/;
  return html?.replace(FOOTER_REGEX, "") ?? "<p>No Content</p>"; // TODO: Remove this and make db field nullable
};

const isValidToken = (t: string) => {
  if (Expo.isExpoPushToken(t)) return t;
  console.error(`Push token ${t} is not a valid Expo push token`);
  return;
};

type NotificationWithHeaders = Notification & {
  headers: Headers;
};

const composePipelineNotification = (n: NotificationWithHeaders) => {
  const status = n.headers["x-gitlab-pipeline-status"];
  const STATUS_TITLE: Record<PipelineStatus, string> = {
    success: "Pipeline Succeded!",
    failed: "Pipeline Failed!",
  };

  return {
    title: status ? STATUS_TITLE[status] : "Pipeline",
    body: n.subject,
  };
};

const composeNotificationContent = (n: NotificationWithHeaders) => {
  // We treat a notification as generic if it doesn't have a project associated
  const isPipeline = !!n.headers["x-gitlab-pipeline-id"];

  if (isPipeline) {
    return composePipelineNotification(n);
  }

  const title = sanitizeSubject(n.subject);

  const body = n.text?.split("\n")[0].trim();
  return {
    title,
    body: body ?? "You have a new notification!",
  };
};

const sanitizeText = (text?: string) => {
  // Removing "Reply to this email..."
  //https://stackoverflow.com/a/56391193/12661017
  // return text.trimStart().replace(/-- .*/g, "$'");
  return text?.trimStart()?.split("--")?.[0] ?? "No Text"; // TODO: Remove this and make db field nullable
};

const sanitizeSubject = (subject: string) => {
  // Remove everything before the first |
  const STRING_BEFORE_FIRST_PIPE_REGEX = /^[^\|]*\|/;

  return subject.replace(STRING_BEFORE_FIRST_PIPE_REGEX, "").trimStart();
};

router.post("/webhook", async (req, res, next) => {
  const { token } = req.query;

  if (!token || token !== process.env.WEBHOOK_SECRET) {
    return next(new ErrorWithStatus(403, "Unauthorized"));
  }

  const form = new IncomingForm({
    encoding: "utf-8",
    keepExtensions: true,
    // Since we're dealing with text fields only, we can set a reasonable maxFileSize
    maxFileSize: 2 * 1024 * 1024, // 2MB
  });

  let payload: WebhookPayload | undefined;
  try {
    const [fields] = await form.parse(req);

    if (!fields) {
      console.error("Failed to parse fields", fields);
      return next(
        new ErrorWithStatus(500, `Failed to parse fields: ${fields}`)
      );
    }

    // formidable returns arrays for field values, we take the first value
    payload = {
      to: fields.to?.[0] ?? "",
      subject: fields.subject?.[0] ?? "",
      text: fields.text?.[0],
      html: fields.html?.[0],
      headers: fields.headers?.[0] ?? "",
    };

    if (!payload.headers || !payload.to || !payload.subject) {
      console.warn("Webhook payload is missing some fields", payload);
      Sentry.captureEvent({
        message: "Webhook payload is missing some fields",
        extra: payload,
      });
      return next(
        new ErrorWithStatus(400, "Webhook payload is missing some fields")
      );
    }
  } catch (error) {
    console.error("Failed to parse form", error);
    return next(new ErrorWithStatus(500, `Failed to parse form: ${error}`));
  }

  const {
    to,
    subject: rawSubject,
    text: rawText,
    html: rawHtml,
    headers: rawHeaders,
  } = payload;

  // Parsing headers string into object
  const headers = parseHeaders(rawHeaders);

  // Removing unwanted parts from text
  // But also keeping original
  const text = sanitizeText(rawText);

  // Removing unwanted parts from html
  const html = removeFooterFromHtml(rawHtml);

  // Removing unwanted parts from subject
  const subject = sanitizeSubject(rawSubject);

  const hashPayload = {
    subject,
    text,
    html,
    to,
  };

  const hookId = to.split("@")[0];
  const contentHash = hash(hashPayload);

  let user: User;
  try {
    user = await prisma.user.findUniqueOrThrow({
      where: {
        hookId,
      },
    });
  } catch (error) {
    console.warn(`User with hook ${hookId} doesn't exist`);
    return next(
      new ErrorWithStatus(400, `User with hook ${hookId} doesn't exist`)
    );
  }

  let notification: Notification;
  try {
    notification = await prisma.notification.create({
      data: {
        subject,
        text,
        html,
        headers,
        contentHash,
        userId: user.id,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      switch (e.code) {
        case "P2002":
          console.warn("Notification already exists", e.message, e.meta);
          res.status(200).end();
          return;
        default:
          console.error("Failed to create notification", e);
          Sentry.captureException(e);
          res.status(400).end();
          return;
      }
    }
    console.error("Unknown Error creating notification", e);
    Sentry.captureException(e);
    res.status(500).end();
    return;
  }

  const notificationsCount = await prisma.notification.count({
    where: {
      userId: user.id,
    },
  });

  if (!user.onboardingCompleted && !!notificationsCount) {
    console.log("First notification recived, Onboarding completed");

    user = await prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        onboardingCompleted: true,
      },
    });
  }

  if (user.mutedUntil && user.mutedUntil > new Date()) {
    console.log("User is muted until", user.mutedUntil);
    return res.status(200).end();
  }

  const pushTokens = user.expoPushTokens.filter(isValidToken);

  if (pushTokens.length === 0) {
    console.warn("User doesn't have any valid token");
    return next(new ErrorWithStatus(400, "User doesn't have any valid token"));
  }

  const notificationPayload: ExpoPushMessage = {
    to: pushTokens,
    sound: "default",
    channelId: "default",
    ...composeNotificationContent(notification as NotificationWithHeaders),
    data: { nid: notification.id },
  };

  if (notificationsCount === 1) {
    notificationPayload.title = "Welcome to Ping for Gitlab!";
    notificationPayload.body =
      "You succesfully connected to Gitlab! come back to the app to complete the onboarding process";
  }

  const chunks = expo.chunkPushNotifications([notificationPayload]);

  let receiptIds = [];
  for (const chunk of chunks) {
    try {
      let ticketChunk = await expo.sendPushNotificationsAsync(chunk);

      for (let ticket of ticketChunk) {
        if (ticket.status === "ok") {
          receiptIds.push(ticket.id);
        } else {
          if (ticket.details && ticket.details.error) {
            console.error(`Push ticket error: ${ticket.message}`);
            Sentry.captureException(
              new Error(`Push ticket error: ${ticket.message}`),
              {
                extra: {
                  ticket_details: ticket.details,
                  notification_payload: notificationPayload,
                },
              }
            );

            // Only "DeviceNotRegistered" is considered a valid error for tickets
            // see https://docs.expo.dev/push-notifications/sending-notifications/#push-ticket-errors
            if (
              ticket.details &&
              ticket.details.error &&
              ticket.details.error === "DeviceNotRegistered"
            ) {
              // TODO: Remove token from user
              console.warn(
                `Invalid push token detected: ${ticket.details.expoPushToken}`
              );
            }
          }
        }
      }
    } catch (error) {
      console.error("Error sending push notification chunk", error);
      Sentry.captureException(error, {
        extra: {
          chunk_size: chunk.length,
          notification_payload: notificationPayload,
        },
      });
    }
  }

  let receiptIdChunks = expo.chunkPushNotificationReceiptIds(receiptIds);
  for (let chunk of receiptIdChunks) {
    try {
      let receipts = await expo.getPushNotificationReceiptsAsync(chunk);

      for (const [receiptId, receipt] of Object.entries(receipts)) {
        if (receipt.status === "ok") {
          continue;
        } else if (receipt.status === "error") {
          console.error(
            `There was an error sending a notification: ${receipt.message}`
          );
          Sentry.captureException(
            new Error(`Push receipt error: ${receipt.message}`),
            {
              extra: {
                receipt_id: receiptId,
                receipt_details: receipt.details,
              },
            }
          );

          // See https://docs.expo.dev/push-notifications/sending-notifications/#push-receipt-errors
          if (receipt.details && receipt.details.error) {
            console.error(`Push receipt error: ${receipt.details.error}`);
          }
        }
      }
    } catch (error) {
      console.error("Error checking receipts:", error);
      Sentry.captureException(error, {
        extra: {
          receipt_ids: chunk,
        },
      });
    }
  }

  res.status(200).end();
});

export default router;
