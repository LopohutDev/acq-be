import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  RawBody,
  Headers,
  Logger,
} from '@nestjs/common';
import { PaymentService } from './payment.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentStatusService } from './payment-status.service';
import * as crypto from 'crypto';

@Controller('payments')
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);

  constructor(
    private readonly paymentService: PaymentService,
    private readonly prisma: PrismaService,
    private readonly paymentStatusService: PaymentStatusService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async createPayment(
    @Request() req,
    @Body() createPaymentDto: CreatePaymentDto,
  ) {
    const payment = await this.paymentService.createPayment({
      bookingId: createPaymentDto.bookingId,
      amount: createPaymentDto.amount,
      customerEmail: req.user.email,
      customerName: `${req.user.firstName} ${req.user.lastName}`,
      customerPhone: req.user.phone || '',
      description: createPaymentDto.description,
    });

    return {
      success: true,
      data: {
        paymentId: payment.data.id,
        referenceNumber: payment.data.fullOrderRef,
        checkoutUrl: payment.data.checkoutUrl,
        amount: payment.data.amount,
        currency: payment.data.currency,
        status: payment.data.status,
      },
    };
  }

  @Get(':referenceNumber')
  @UseGuards(JwtAuthGuard)
  async getPaymentStatus(@Param('referenceNumber') referenceNumber: string) {
    const payment = await this.paymentService.getPaymentStatus(referenceNumber);

    return {
      success: true,
      data: {
        referenceNumber: payment.fullOrderRef,
        status: payment.status,
        amount: payment.amount,
        currency: payment.currency,
        paymentMethod: payment.customer ? 'online' : null,
        createdAt: payment.createdAt,
        updatedAt: payment.updatedAt,
      },
    };
  }

  @Get('public-test')
  @HttpCode(HttpStatus.OK)
  async testPaymentConnection() {
    try {
      const testResponse = await fetch(
        'https://experiapg-be-2025-prod-490015751188.asia-southeast1.run.app/api/v1/payments',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.EXPERIA_PG_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            amount: 100, // PHP 1.00
            currency: 'PHP',
            description: 'Test payment',
            successUrl: `${process.env.FRONTEND_URL || 'http://localhost:8081'}/payment/callback?reference={referenceNumber}&status=success`,
            cancelUrl: `${process.env.FRONTEND_URL || 'http://localhost:8081'}/payment/callback?reference={referenceNumber}&status=cancelled`,
          }),
        },
      );

      const responseText = await testResponse.text();

      return {
        success: testResponse.ok,
        status: testResponse.status,
        statusText: testResponse.statusText,
        response: responseText,
        apiKeySet: !!process.env.EXPERIA_PG_API_KEY,
        apiKeyPrefix: process.env.EXPERIA_PG_API_KEY
          ? process.env.EXPERIA_PG_API_KEY.substring(0, 10) + '...'
          : 'not set',
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        apiKeySet: !!process.env.EXPERIA_PG_API_KEY,
        apiKeyPrefix: process.env.EXPERIA_PG_API_KEY
          ? process.env.EXPERIA_PG_API_KEY.substring(0, 10) + '...'
          : 'not set',
      };
    }
  }

  @Get('booking/:bookingId')
  @UseGuards(JwtAuthGuard)
  async getPaymentByBookingId(@Param('bookingId') bookingId: string) {
    const payment = await this.paymentService.getPaymentByBookingId(bookingId);

    if (!payment) {
      return {
        success: false,
        message: 'Payment not found for this booking',
      };
    }

    return {
      success: true,
      data: {
        referenceNumber: payment.referenceNumber,
        status: payment.status,
        amount: payment.amount,
        currency: payment.currency,
        checkoutUrl: payment.checkoutUrl,
      },
    };
  }

  // Webhook endpoint for payment status updates (Experia PG format)
  @Post('webhooks/experia')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body() body: any,
    @Headers('experia-signature') signature: string,
  ) {
    const webhookSecret = process.env.EXPERIA_PG_WEBHOOK_SECRET;

    console.log('Webhook received:', body?.toString());

    try {
      // Verify webhook signature if secret is configured
      if (webhookSecret && signature && signature !== 'test') {
        const isValid = this.verifyWebhookSignature(
          body,
          signature,
          webhookSecret,
        );
        if (!isValid) {
          this.logger.warn('Invalid webhook signature received');
          throw new Error('Invalid webhook signature');
        }
      } else if (!webhookSecret) {
        this.logger.warn(
          'Webhook secret not configured - skipping signature verification',
        );
      } else if (signature === 'test') {
        this.logger.log(
          '🧪 Using test webhook signature - skipping verification',
        );
      }

      const event = JSON.parse(body?.toString() || '{}');

      // Log the actual webhook structure for debugging
      this.logger.log(
        'Webhook event structure:',
        JSON.stringify(event, null, 2),
      );

      // Updated structure based on actual payload
      const eventId =
        event.data?.transactionId || event.data?.fullOrderRef || 'no-id';
      const eventType = event.event; // 'payment.completed'
      const paymentData = event.data; // Contains the payment details

      // Handle idempotency - prevent duplicate processing
      if (eventId && eventId !== 'no-id') {
        const existingEvent = await this.prisma.webhookEvent.findUnique({
          where: { eventId },
        });

        if (existingEvent) {
          this.logger.log(`Webhook event ${eventId} already processed`);
          return { received: true };
        }

        // Mark event as processed
        await this.prisma.webhookEvent.create({
          data: { eventId },
        });
      }

      if (!paymentData?.externalId) {
        this.logger.log('Webhook received without externalId');
        return { received: true };
      }

      // Find payment by external ID (checkout session ID)
      const payment = await this.paymentService.getPaymentByExternalId(
        paymentData.externalId,
      );

      if (!payment) {
        this.logger.warn(
          `Payment not found for external ID: ${paymentData.externalId}`,
        );
        return { received: true };
      }

      // Update payment status based on event type and status
      let newStatus;
      switch (eventType) {
        case 'payment.completed':
          newStatus = paymentData.status; // Use status from payload: SUCCEEDED, FAILED, etc.
          this.logger.log(
            `Payment ${newStatus}: ${paymentData.fullOrderRef} (${paymentData.amount / 100} PHP)`,
          );
          break;
        case 'payment.failed':
          newStatus = 'FAILED';
          this.logger.log(`Payment failed: ${paymentData.fullOrderRef}`);
          break;
        case 'payment.cancelled':
          newStatus = 'CANCELLED';
          this.logger.log(`Payment cancelled: ${paymentData.fullOrderRef}`);
          break;
        default:
          this.logger.log(`Unhandled webhook event type: ${eventType}`);
          return { received: true };
      }

      // Update payment status and booking status
      await this.paymentStatusService.updatePaymentStatusFromAPI(
        payment.referenceNumber,
        newStatus,
      );

      this.logger.log(
        `✅ Webhook processed successfully: ${eventType} for payment ${payment.referenceNumber}`,
      );
      return { received: true };
    } catch (error) {
      this.logger.error('Webhook processing error:', error);
      // Return 500 so PayMongo retries
      throw error;
    }
  }

  private verifyWebhookSignature(
    payload: Buffer,
    signature: string,
    secret: string,
  ): boolean {
    try {
      const computedSignature = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');

      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(computedSignature),
      );
    } catch (error) {
      this.logger.error('Error verifying webhook signature:', error);
      return false;
    }
  }
}
