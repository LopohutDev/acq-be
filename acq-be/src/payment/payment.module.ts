import { Module } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { PaymentStatusService } from './payment-status.service';

@Module({
  controllers: [PaymentController],
  providers: [PaymentService, PaymentStatusService],
  exports: [PaymentService],
})
export class PaymentModule {}
