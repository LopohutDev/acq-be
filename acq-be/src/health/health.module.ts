import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PaymentModule } from '../payment/payment.module';

@Module({
  imports: [PaymentModule],
  controllers: [HealthController],
})
export class HealthModule {}