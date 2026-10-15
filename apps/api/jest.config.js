export default {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  testRegex: "\\.(spec|e2e-spec)\\.ts$",
  moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1" },
};
