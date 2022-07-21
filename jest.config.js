module.exports = {
  clearMocks: true,
  preset: "ts-jest",
  testEnvironment: "node",
  setupFilesAfterEnv: ["<rootDir>/prisma/mocked-client.ts"],
  globals: {
    "ts-jest": {
      tsconfig: "./.tsconfig.json",
    },
  },
};
