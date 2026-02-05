import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentStatus } from '@prisma/client';

interface CreatePaymentRequest {
  amount: number;
  currency: 'PHP' | 'USD';
  description?: string;
  customer?: {
    email: string;
    name: string;
    phone: string;
  };
  successUrl?: string;
  cancelUrl?: string;
  metadata?: Record<string, unknown>;
}

interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    statusCode: number;
  };
}

export interface PaymentResponse {
  id: string;
  externalId: string;
  fullOrderRef: string; // This is the reference number
  checkoutUrl: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  amount: number;
  currency: string;
  environment: 'TEST' | 'LIVE';
  description?: string;
  customer?: {
    email: string;
    name: string;
    phone: string;
  } | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt?: string;
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  private readonly apiUrl =
    'https://experiapg-be-2025-prod-490015751188.asia-southeast1.run.app/api/v1';
  private readonly apiKey: string;

  constructor(private prisma: PrismaService) {
    const apiKey = process.env.EXPERIA_PG_API_KEY;
    if (!apiKey) {
      throw new Error('EXPERIA_PG_API_KEY environment variable is required');
    }
    this.apiKey = apiKey;
  }

  // Convert PHP to centavos
  toAmount(pesos: number): number {
    return Math.round(pesos * 100);
  }

  // Convert centavos to PHP
  toPesos(amount: number): number {
    return amount / 100;
  }

  async testConnection() {
    try {
      const response = await fetch(`${this.apiUrl}/payments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: 100, // PHP 1.00
          currency: 'PHP',
          description: 'Test connection',
        }),
      });

      const responseText = await response.text();

      return {
        success: response.ok,
        status: response.status,
        statusText: response.statusText,
        response: responseText,
        apiKeySet: !!this.apiKey,
        apiKeyPrefix: this.apiKey
          ? this.apiKey.substring(0, 10) + '...'
          : 'not set',
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        apiKeySet: !!this.apiKey,
        apiKeyPrefix: this.apiKey
          ? this.apiKey.substring(0, 10) + '...'
          : 'not set',
      };
    }
  }

  async createPayment(bookingData: {
    bookingId: string;
    amount: number;
    customerEmail: string;
    customerName: string;
    customerPhone: string;
    description?: string;
  }): Promise<{ data: PaymentResponse }> {
    const request: CreatePaymentRequest = {
      amount: this.toAmount(bookingData.amount),
      currency: 'PHP',
      description:
        bookingData.description || `Parking Booking #${bookingData.bookingId}`,
      customer: {
        email: bookingData.customerEmail,
        name: bookingData.customerName,
        phone: bookingData.customerPhone,
      },
      successUrl: `${process.env.FRONTEND_URL || 'http://localhost:8080'}/payment/callback?reference={referenceNumber}&status=success`,
      cancelUrl: `${process.env.FRONTEND_URL || 'http://localhost:8080'}/payment/callback?reference={referenceNumber}&status=cancelled`,
      metadata: {
        bookingId: bookingData.bookingId,
        type: 'parking_booking',
        callbackUrl: `${process.env.FRONTEND_URL || 'http://localhost:8080'}/payment/callback?reference={referenceNumber}`,
      },
    };

    try {
      this.logger.log(
        `Creating payment for booking ${bookingData.bookingId} with amount ${request.amount} centavos`,
      );
      this.logger.log(`API URL: ${this.apiUrl}/payments`);

      const response = await fetch(`${this.apiUrl}/payments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      this.logger.log(`Payment API response status: ${response.status}`);

      const responseText = await response.text();
      this.logger.log(`Payment API response: ${responseText}`);

      if (!response.ok) {
        let errorMessage = 'Payment API error';
        try {
          const error: ErrorResponse = JSON.parse(responseText);
          errorMessage = error.error?.message || 'Payment API error';
        } catch (parseError) {
          errorMessage = `Payment API error: ${response.status} ${response.statusText} - ${responseText}`;
        }
        throw new Error(errorMessage);
      }

      const paymentData: PaymentResponse = JSON.parse(responseText);

      if (!paymentData || !paymentData.fullOrderRef) {
        throw new Error('Invalid payment response format from API');
      }

      if (!paymentData.fullOrderRef) {
        throw new Error('Payment response missing reference number');
      }

      // Save payment to database
      await this.prisma.payment.create({
        data: {
          referenceNumber: paymentData.fullOrderRef, // Use fullOrderRef as referenceNumber
          amount: paymentData.amount,
          currency: paymentData.currency,
          status: this.mapPaymentStatus(paymentData.status),
          description: paymentData.description,
          checkoutUrl: paymentData.checkoutUrl,
          externalId: paymentData.externalId,
          paymentMethod: paymentData.customer ? 'online' : null,
          metadata: (paymentData.metadata as any) || null,
          bookingId: bookingData.bookingId,
        },
      });

      this.logger.log(
        `Payment created: ${paymentData.fullOrderRef} for booking: ${bookingData.bookingId}`,
      );

      // Return in expected format for controller
      return {
        data: paymentData,
      };
    } catch (error) {
      this.logger.error(
        `Failed to create payment for booking ${bookingData.bookingId}:`,
        error,
      );
      this.logger.error('Error details:', {
        message: error.message,
        stack: error.stack,
        apiKey: this.apiKey ? 'SET' : 'NOT_SET',
        apiUrl: this.apiUrl,
      });
      throw error;
    }
  }

  async getPaymentStatus(referenceNumber: string): Promise<PaymentResponse> {
    try {
      const response = await fetch(
        `${this.apiUrl}/payments/${referenceNumber}`,
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
        },
      );

      if (!response.ok) {
        const error: ErrorResponse = await response.json();
        throw new Error(error.error.message);
      }

      const paymentData: PaymentResponse = await response.json();

      // Update payment status in database
      await this.prisma.payment.update({
        where: { referenceNumber },
        data: {
          status: this.mapPaymentStatus(paymentData.status),
          paymentMethod: paymentData.customer ? 'online' : null,
        },
      });

      // Update booking status based on payment status
      await this.updateBookingStatus(referenceNumber, paymentData.status);

      return paymentData;
    } catch (error) {
      this.logger.error(
        `Failed to get payment status for ${referenceNumber}:`,
        error,
      );
      throw error;
    }
  }

  async pollPaymentStatus(
    referenceNumber: string,
    maxAttempts: number = 20,
  ): Promise<string> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const payment = await this.getPaymentStatus(referenceNumber);
        const status = payment.status;

        // Terminal states - stop polling
        if (
          status === 'SUCCEEDED' ||
          status === 'FAILED' ||
          status === 'CANCELLED'
        ) {
          this.logger.log(`Payment ${referenceNumber} final status: ${status}`);
          return status;
        }

        // Still PENDING - wait and retry
        // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (max)
        const delayMs = Math.min(Math.pow(2, attempt) * 1000, 30000);
        this.logger.log(
          `Payment ${referenceNumber} still pending. Checking again in ${delayMs / 1000}s...`,
        );
        await this.delay(delayMs);
      } catch (error) {
        // Network error - continue polling
        this.logger.error(
          `Error checking payment status for ${referenceNumber}:`,
          error.message,
        );

        if (attempt < maxAttempts - 1) {
          const delayMs = 5000; // 5 second retry on errors
          await this.delay(delayMs);
        }
      }
    }

    // Timeout - mark as abandoned
    this.logger.warn(
      `Payment status check timeout for ${referenceNumber} after 10 minutes`,
    );
    throw new Error('Payment status check timeout after 10 minutes');
  }

  private mapPaymentStatus(status: string): PaymentStatus {
    switch (status) {
      case 'PENDING':
        return PaymentStatus.PENDING;
      case 'SUCCEEDED':
        return PaymentStatus.SUCCEEDED;
      case 'FAILED':
        return PaymentStatus.FAILED;
      case 'CANCELLED':
        return PaymentStatus.CANCELLED;
      default:
        return PaymentStatus.PENDING;
    }
  }

  private async updateBookingStatus(
    referenceNumber: string,
    paymentStatus: string,
  ): Promise<void> {
    const payment = await this.prisma.payment.findUnique({
      where: { referenceNumber },
      include: { booking: true },
    });

    if (!payment) return;

    let bookingStatus;
    switch (paymentStatus) {
      case 'SUCCEEDED':
        bookingStatus = 'CONFIRMED';
        break;
      case 'FAILED':
      case 'CANCELLED':
        bookingStatus = 'CANCELLED';
        break;
      default:
        return; // Don't update for PENDING status
    }

    await this.prisma.booking.update({
      where: { id: payment.bookingId },
      data: { status: bookingStatus },
    });

    this.logger.log(
      `Updated booking ${payment.bookingId} status to ${bookingStatus} based on payment ${paymentStatus}`,
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async getPaymentByBookingId(bookingId: string) {
    return this.prisma.payment.findUnique({
      where: { bookingId },
    });
  }

  async getPaymentByReferenceNumber(referenceNumber: string) {
    return this.prisma.payment.findUnique({
      where: { referenceNumber },
    });
  }

  async getPaymentByExternalId(externalId: string) {
    return this.prisma.payment.findFirst({
      where: { externalId },
      include: {
        booking: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
            parkingSpot: {
              include: {
                owner: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                  },
                },
              },
            },
          },
        },
      },
    });
  }
}
