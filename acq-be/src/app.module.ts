import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { ParkingModule } from './parking/parking.module';
import { BookingModule } from './booking/booking.module';
import { PaymentModule } from './payment/payment.module';
import { HealthModule } from './health/health.module';
import { DebugModule } from './debug/debug.module';
import { QuickFixModule } from './quick-fix/quick-fix.module';
import { WebhookConfigModule } from './webhook-config/webhook-config.module';
// import { EmailModule } from './email/email.module';
// import { PMOModule } from './pmo/pmo.module';
// import { EmailAccountModule } from './email/email-account.module';

@Module({
  imports: [
    // Configuration module
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Serve static files (uploaded images)
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'uploads'),
      serveRoot: '/uploads',
    }),

    // Prisma module
    PrismaModule,

    // Feature modules
    AuthModule,
    UsersModule,
    AdminModule,
    ParkingModule,
    BookingModule,
    PaymentModule,
    // EmailModule,
    // PMOModule,
    // EmailAccountModule,
    HealthModule,
    DebugModule,
    QuickFixModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
