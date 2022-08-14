import * as Yup from "yup";
import * as jwt from "jsonwebtoken";

export const SignupBodySchema = Yup.object({
  email: Yup.string().email().required().label("Email"),
  password: Yup.string()
    .required()
    .label("Password")
    .min(6)
    .matches(/^(?=.*[a-z])/, "Must contain at least one lowercase character")
    .matches(/^(?=.*[A-Z])/, "Must contain at least one uppercase character")
    .matches(/^(?=.*[0-9])/, "Must contain at least one number")
    .matches(/^(?=.*[!@#%&])/, "Must contain at least one special character"),
});

export const RefreshBodySchema = Yup.object({
  refreshToken: Yup.string()
    .required()
    .test("is-valid-refresh-token", "Invalid refresh token", (value) => {
      try {
        jwt.decode(value!);
        return !!jwt.verify(value!, process.env.JWT_REFRESH_SECRET!);
      } catch (e) {
        return false;
      }
    }),
});
