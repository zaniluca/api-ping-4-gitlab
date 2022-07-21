module.exports = {
  clearMocks: true,
  preset: "ts-jest",
  testEnvironment: "node",
  setupFilesAfterEnv: ["<rootDir>/prisma/mocked-client.ts"],
  testPathIgnorePatterns: ["dist/", "node_modules/"],
};
