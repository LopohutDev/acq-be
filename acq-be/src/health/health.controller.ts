import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { PaymentService } from '../payment/payment.service';

@Controller('health')
export class HealthController {
  constructor(private readonly paymentService: PaymentService) {}

  @Get('payment-test')
  @HttpCode(HttpStatus.OK)
  async testPaymentConnection() {
    try {
      const testResponse = await fetch('https://experiapg-be-2025-prod-490015751188.asia-southeast1.run.app/api/v1/payments', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.EXPERIA_PG_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: 100, // PHP 1.00
          currency: 'PHP',
          description: 'Test payment',
        }),
      });

      const responseText = await testResponse.text();
      
      return {
        success: testResponse.ok,
        status: testResponse.status,
        statusText: testResponse.statusText,
        response: responseText,
        apiKeySet: !!process.env.EXPERIA_PG_API_KEY,
        apiKeyPrefix: process.env.EXPERIA_PG_API_KEY ? process.env.EXPERIA_PG_API_KEY.substring(0, 10) + '...' : 'not set',
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        apiKeySet: !!process.env.EXPERIA_PG_API_KEY,
        apiKeyPrefix: process.env.EXPERIA_PG_API_KEY ? process.env.EXPERIA_PG_API_KEY.substring(0, 10) + '...' : 'not set',
      };
    }
  }
}