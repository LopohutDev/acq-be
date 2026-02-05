import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PaymentStatusService {
  private readonly logger = new Logger(PaymentStatusService.name);

  constructor(private prisma: PrismaService) {}

  // Force update payment status from API response
  async updatePaymentStatusFromAPI(referenceNumber: string, paymentStatus: string) {
    try {
      this.logger.log(`🔄 Updating payment ${referenceNumber} to status: ${paymentStatus}`);

      // Update payment in database
      await this.prisma.payment.update({
        where: { referenceNumber },
        data: {
          status: paymentStatus === 'SUCCEEDED' ? 'SUCCEEDED' : 
                 paymentStatus === 'FAILED' ? 'FAILED' : 
                 paymentStatus === 'CANCELLED' ? 'CANCELLED' : 'PENDING',

        },
      });

      // Update booking status based on payment status
      await this.updateBookingStatus(referenceNumber, paymentStatus);

      this.logger.log(`✅ Updated payment ${referenceNumber} to ${paymentStatus} and corresponding booking`);
      
      return { success: true };
    } catch (error) {
      this.logger.error(`❌ Failed to update payment status for ${referenceNumber}:`, error);
      return { success: false, error: error.message };
    }
  }

  private async updateBookingStatus(referenceNumber: string, paymentStatus: string): Promise<void> {
    this.logger.log(`🔍 Looking up payment ${referenceNumber} to update booking status`);

    const payment = await this.prisma.payment.findUnique({
      where: { referenceNumber },
      include: { booking: true },
    });

    if (!payment) {
      this.logger.error(`❌ Payment ${referenceNumber} not found for booking status update`);
      return;
    }

    this.logger.log(`📋 Found payment ${referenceNumber} for booking ${payment.bookingId}, current booking status: ${payment.booking?.status}`);

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
        this.logger.log(`ℹ️ No booking status update needed for payment status: ${paymentStatus}`);
        return; // Don't update for PENDING status
    }

    this.logger.log(`🔄 Updating booking ${payment.bookingId} status from ${payment.booking?.status} to ${bookingStatus}`);

    await this.prisma.booking.update({
      where: { id: payment.bookingId },
      data: { status: bookingStatus },
    });

    this.logger.log(`✅ Updated booking ${payment.bookingId} status to ${bookingStatus} based on payment ${paymentStatus}`);
  }
}