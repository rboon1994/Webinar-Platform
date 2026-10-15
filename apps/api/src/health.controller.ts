import { Controller, Get } from "@nestjs/common";
import type { HealthResponse } from "@webinar/shared";

@Controller("health")
export class HealthController {
  @Get()
  get(): HealthResponse {
    return { status: "ok" };
  }
}
