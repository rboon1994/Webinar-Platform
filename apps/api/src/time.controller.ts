import { Controller, Get } from "@nestjs/common";
import type { TimeResponse } from "@webinar/shared";

@Controller("time")
export class TimeController {
  @Get()
  get(): TimeResponse {
    return { now: new Date().toISOString() };
  }
}
