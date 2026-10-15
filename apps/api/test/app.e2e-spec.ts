import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { healthResponseSchema, timeResponseSchema } from "@webinar/shared";
import { AppModule } from "../src/app.module.js";

describe("app", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(() => app.close());

  describe("GET /health", () => {
    it("returns 200 with a body matching the shared schema", async () => {
      const res = await request(app.getHttpServer()).get("/health");
      expect(res.status).toBe(200);
      expect(healthResponseSchema.safeParse(res.body).success).toBe(true);
    });
  });

  describe("GET /time", () => {
    it("returns 200 with a body matching the shared schema", async () => {
      const res = await request(app.getHttpServer()).get("/time");
      expect(res.status).toBe(200);
      expect(timeResponseSchema.safeParse(res.body).success).toBe(true);
    });

    it("returns the current server time within 2 seconds", async () => {
      const res = await request(app.getHttpServer()).get("/time");
      expect(Math.abs(Date.parse(res.body.now) - Date.now())).toBeLessThanOrEqual(2000);
    });

    it("ends with Z", async () => {
      const res = await request(app.getHttpServer()).get("/time");
      expect(res.body.now.endsWith("Z")).toBe(true);
    });
  });

  it("returns 404 for an unknown path", async () => {
    const res = await request(app.getHttpServer()).get("/nope");
    expect(res.status).toBe(404);
  });
});
