import { Module, type DynamicModule } from "@nestjs/common";
import type { Database } from "../../shared/database/client.ts";
import { type RateLimiter } from "../../shared/http/rate-limit.ts";
import { AuthRepository } from "./infrastructure/auth-repository.ts";
import { AuthUseCases, type Mailer } from "./application/auth-use-cases.ts";
import { AUTH_TOKENS, AuthController, type AuthConfig } from "./presentation/auth.controller.ts";

/**
 * Wiring của module `auth`.
 *
 * Composition root nối repository, use case và controller lại với nhau. Module
 * này **không** phụ thuộc module sản phẩm nào, đúng đồ thị phụ thuộc ở ADR-0005.
 */
@Module({})
export class AuthModule {
  static register(deps: {
    db: Database;
    mailer: Mailer;
    config: AuthConfig;
    limiter: RateLimiter;
    /**
     * Instance dựng sẵn ở composition root.
     *
     * `SessionGuard` của `shared/authorization` dùng chính instance này làm
     * `ActorResolver`, nên nó phải được dựng **một lần** bên ngoài rồi truyền
     * vào — hai instance riêng sẽ có hai đồng hồ và hai đường tới database cho
     * cùng một trách nhiệm. Tham số optional để chỗ gọi cũ (test) vẫn dựng được
     * module mà không phải tự lắp repository.
     */
    useCases?: AuthUseCases;
  }): DynamicModule {
    const repository = new AuthRepository(deps.db);
    const useCases =
      deps.useCases ??
      new AuthUseCases({
        db: deps.db,
        repository,
        mailer: deps.mailer,
        csrfSecret: deps.config.csrfSecret,
      });

    return {
      module: AuthModule,
      controllers: [AuthController],
      providers: [
        { provide: AUTH_TOKENS.useCases, useValue: useCases },
        { provide: AUTH_TOKENS.rateLimiter, useValue: deps.limiter },
        { provide: AUTH_TOKENS.config, useValue: deps.config },
      ],
    };
  }
}
