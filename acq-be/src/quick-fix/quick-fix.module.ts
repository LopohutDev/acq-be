import { Module } from '@nestjs/common';
import { QuickFixController } from './quick-fix.controller';
import { PaymentModule } from '../payment/payment.module';

@Module({
  imports: [PaymentModule],
  controllers: [QuickFixController],
})
export class QuickFixModule {}
