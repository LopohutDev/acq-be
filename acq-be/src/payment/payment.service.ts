import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentStatus, BookingStatus } from '@prisma/client';
import { GmailService } from '../gmail/gmail.service';

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
  fullOrderRef: string;
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

  constructor(
    private prisma: PrismaService,
    private gmailService: GmailService,
  ) {
    const apiKey = process.env.EXPERIA_PG_API_KEY;
    if (!apiKey) {
      throw new Error('EXPERIA_PG_API_KEY environment variable is required');
    }
    this.apiKey = apiKey;
  }

  toAmount(pesos: number): number {
    return Math.round(pesos * 100);
  }

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
          amount: 100,
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
      },
    };

    try {
      this.logger.log(
        `Creating payment for booking ${bookingData.bookingId} with amount ${request.amount} centavos`,
      );

      const response = await fetch(`${this.apiUrl}/payments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      const responseText = await response.text();

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

      await this.prisma.payment.create({
        data: {
          referenceNumber: paymentData.fullOrderRef,
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

      return { data: paymentData };
    } catch (error) {
      this.logger.error(
        `Failed to create payment for booking ${bookingData.bookingId}:`,
        error,
      );
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

      await this.prisma.payment.update({
        where: { referenceNumber },
        data: {
          status: this.mapPaymentStatus(paymentData.status),
          paymentMethod: paymentData.customer ? 'online' : null,
        },
      });

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

        if (
          status === 'SUCCEEDED' ||
          status === 'FAILED' ||
          status === 'CANCELLED'
        ) {
          this.logger.log(`Payment ${referenceNumber} final status: ${status}`);
          return status;
        }

        const delayMs = Math.min(Math.pow(2, attempt) * 1000, 30000);
        this.logger.log(
          `Payment ${referenceNumber} still pending. Checking again in ${delayMs / 1000}s...`,
        );
        await this.delay(delayMs);
      } catch (error) {
        this.logger.error(
          `Error checking payment status for ${referenceNumber}:`,
          error.message,
        );

        if (attempt < maxAttempts - 1) {
          await this.delay(5000);
        }
      }
    }

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
      include: {
        booking: {
          include: {
            user: true,
            parkingSpot: true,
          },
        },
      },
    });

    if (!payment) return;

    let bookingStatus: BookingStatus;
    switch (paymentStatus) {
      case 'SUCCEEDED':
        bookingStatus = BookingStatus.CONFIRMED;
        break;
      case 'FAILED':
      case 'CANCELLED':
        bookingStatus = BookingStatus.CANCELLED;
        break;
      default:
        return;
    }

    await this.prisma.booking.update({
      where: { id: payment.bookingId },
      data: { status: bookingStatus },
    });

    this.logger.log(
      `Updated booking ${payment.bookingId} status to ${bookingStatus} based on payment ${paymentStatus}`,
    );

    if (paymentStatus === 'SUCCEEDED' && payment.booking) {
      await this.sendBookingConfirmationEmail(payment);
      await this.sendGuestConfirmationEmail(payment);
    }
  }

  private async sendBookingConfirmationEmail(payment: any) {
    try {
      const { booking } = payment;
      const user = booking.user;
      const parkingSpot = booking.parkingSpot;

      const owner = await this.prisma.user.findUnique({
        where: { id: parkingSpot.ownerId },
      });

      if (!owner) {
        this.logger.log(`Parking spot owner not found. Skipping PMO email.`);
        return;
      }

      const gmailAccount = await this.prisma.clientEmailAccount.findUnique({
        where: { clientId: owner.id },
      });

      if (!gmailAccount) {
        this.logger.log(
          `Owner ${owner.id} does not have Gmail connected. Skipping PMO email.`,
        );
        return;
      }

      const subject = `Temporary Guest Parking – ${parkingSpot.tower} Slot ${parkingSpot.slotNumber}`;
      const body = `Hi,

Good day.

Please allow my guest to temporarily use my parking slot.

<strong>Parking Slot:</strong> ${parkingSpot.tower} – Slot ${parkingSpot.slotNumber}
<strong>Guest Name:</strong> ${user.firstName} ${user.lastName}

<strong>Schedule:</strong>
${new Date(booking.startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(booking.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
${new Date(booking.endTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(booking.endTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}

<strong>Tower & Unit:</strong> ${booking.tower || 'N/A'} ${booking.unitNumber || ''}

<strong>Vehicle Details:</strong>
Plate No.: ${booking.vehiclePlateNumber || 'N/A'}
Model/Color: ${booking.vehicleModel || 'N/A'}${booking.vehicleColor ? ` – ${booking.vehicleColor}` : ''}`;

      await this.gmailService.sendPmoEmail(
        owner.id,
        subject,
        body,
        booking.id,
        user.email,
      );
      this.logger.log(
        `PMO confirmation email sent for booking ${booking.id} from owner ${owner.id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send PMO email for booking ${payment.bookingId}: ${error.message}`,
      );
    }
  }

  private async sendGuestConfirmationEmail(payment: any) {
    try {
      const { booking } = payment;
      const user = booking.user;
      const parkingSpot = booking.parkingSpot;
      const owner = parkingSpot.owner;

      const invoiceNumber = `INV-${booking.id.slice(0, 8).toUpperCase()}`;
      const invoiceDate = new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

      const subject = `Booking Confirmed – ${parkingSpot.tower} Slot ${parkingSpot.slotNumber}`;
      const body = `Hi ${user.firstName},

Your parking booking has been confirmed. Thank you for your payment.

<strong>INVOICE</strong>
Invoice #: ${invoiceNumber}
Date: ${invoiceDate}

<strong>Booking Details:</strong>
Parking Slot: ${parkingSpot.tower} – Slot ${parkingSpot.slotNumber}

<strong>Schedule:</strong>
${new Date(booking.startTime).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} – ${new Date(booking.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
${new Date(booking.endTime).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} – ${new Date(booking.endTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}

<strong>Vehicle:</strong>
Plate No.: ${booking.vehiclePlateNumber || 'N/A'}
Model/Color: ${booking.vehicleModel || 'N/A'}${booking.vehicleColor ? ` – ${booking.vehicleColor}` : ''}

<strong>Payment Summary:</strong>
Total Amount: ₱${(payment.amount / 100).toFixed(2)}
Payment Status: Paid
Payment Reference: ${payment.referenceNumber}

If you have any questions, please don't hesitate to reach out.

Best regards,
${owner.firstName} ${owner.lastName}`;

      await this.gmailService.sendSystemEmail(
        user.email,
        subject,
        body,
        booking.id,
      );
      this.logger.log(`Guest confirmation email sent to ${user.email}`);
    } catch (error) {
      this.logger.error(
        `Failed to send guest confirmation email: ${error.message}`,
      );
    }
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
