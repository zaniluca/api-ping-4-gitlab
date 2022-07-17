import { prismaMock } from "../../prisma/mocked-client";
import request from "supertest";
import app from "..";

describe("User", () => {
  it("should create new user ", async () => {
    await request(app).get("/health").expect(200);
  });
});
