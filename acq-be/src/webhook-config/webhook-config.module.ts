import { Module } from '@nestjs/common';
import { WebhookConfigController } from './webhook-config.controller';
import { PaymentModule } from '../payment/payment.module';

@Module({
  imports: [PaymentModule],
  controllers: [WebhookConfigController],
})
export class WebhookConfigModule {}
