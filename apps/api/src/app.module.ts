import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import { TimeController } from "./time.controller.js";

@Module({ controllers: [HealthController, TimeController] })
export class AppModule {}
