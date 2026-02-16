import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { PaymentService } from '../payment/payment.service';

@Controller('quick-fix')
export class QuickFixController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('update-payment')
  @HttpCode(HttpStatus.OK)
  async forcePaymentUpdate(@Body() body: { referenceNumber: string }) {
    try {
      // Force refresh from Experia PG API
      const payment = await this.paymentService.getPaymentStatus(
        body.referenceNumber,
      );

      return {
        success: true,
        message: 'Payment status refreshed from Experia PG',
        currentStatus: payment.status,
        reference: body.referenceNumber,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}
