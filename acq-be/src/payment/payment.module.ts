import { Module } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { PaymentStatusService } from './payment-status.service';
import { PrismaModule } from '../prisma/prisma.module';
import { GmailModule } from '../gmail/gmail.module';

@Module({
  imports: [PrismaModule, GmailModule],
  controllers: [PaymentController],
  providers: [PaymentService, PaymentStatusService],
  exports: [PaymentService, PaymentStatusService],
})
export class PaymentModule {}
