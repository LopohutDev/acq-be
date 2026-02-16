import { Module } from '@nestjs/common';
import { DebugController } from './debug.controller';
import { PaymentModule } from '../payment/payment.module';

@Module({
  imports: [PaymentModule],
  controllers: [DebugController],
})
export class DebugModule {}
