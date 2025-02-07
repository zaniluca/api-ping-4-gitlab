import {
  uniqueNamesGenerator,
  adjectives,
  animals,
} from "unique-names-generator";

const APP_DOMAIN = "pfg.app";
const APP_ENV = process.env.SENTRY_ENVIRONMENT ?? "development";

export const generateUniqueHook = () => {
  return process.env.NODE_ENV === "test"
    ? "test"
    : uniqueNamesGenerator({
        dictionaries: [adjectives, animals],
        length: 2,
        separator: "_",
      });
};

export const getEmailFromHook = (hook: string) => {
  if (APP_ENV === "production") {
    return `${hook}@${APP_DOMAIN}`;
  }
  return `${hook}@${APP_ENV}.${APP_DOMAIN}`;
};
