import { Controller, Get, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { PaymentService, PaymentResponse } from '../payment/payment.service';

@Controller('debug')
export class DebugController {
  constructor(private readonly paymentService: PaymentService) {}

  @Get('payment-status')
  @HttpCode(HttpStatus.OK)
  async checkPaymentStatus(@Query('reference') reference: string) {
    try {
      // Check local database first
      const localPayment = await this.paymentService.getPaymentByReferenceNumber(reference);
      
      // Check Experia PG API
      const apiPayment = await this.paymentService.getPaymentStatus(reference);
      
      return {
        success: true,
        localPayment,
        apiPayment,
        reference,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        reference,
      };
    }
  }

  @Get('all-payments')
  @HttpCode(HttpStatus.OK)
  async getAllPayments() {
    try {
      const payments = await this.paymentService['prisma'].payment.findMany({
        include: {
          booking: {
            include: {
              user: {
                select: { id: true, firstName: true, lastName: true, email: true },
              },
              parkingSpot: {
                select: { id: true, title: true, address: true },
              },
            },
          },
        },
        orderBy: { id: 'desc' },
      });

      return {
        success: true,
        payments,
        count: payments.length,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}