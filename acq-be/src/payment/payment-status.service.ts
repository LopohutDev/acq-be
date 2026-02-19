import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GmailService } from '../gmail/gmail.service';

@Injectable()
export class PaymentStatusService {
  private readonly logger = new Logger(PaymentStatusService.name);

  constructor(
    private prisma: PrismaService,
    private gmailService: GmailService,
  ) {}

  async updatePaymentStatusFromAPI(
    referenceNumber: string,
    paymentStatus: string,
  ) {
    try {
      this.logger.log(
        `Updating payment ${referenceNumber} to status: ${paymentStatus}`,
      );

      await this.prisma.payment.update({
        where: { referenceNumber },
        data: {
          status:
            paymentStatus === 'SUCCEEDED'
              ? 'SUCCEEDED'
              : paymentStatus === 'FAILED'
                ? 'FAILED'
                : paymentStatus === 'CANCELLED'
                  ? 'CANCELLED'
                  : 'PENDING',
        },
      });

      await this.updateBookingStatus(referenceNumber, paymentStatus);

      this.logger.log(
        `Updated payment ${referenceNumber} to ${paymentStatus} and corresponding booking`,
      );

      return { success: true };
    } catch (error) {
      this.logger.error(
        `Failed to update payment status for ${referenceNumber}:`,
        error,
      );
      return { success: false, error: error.message };
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
            parkingSpot: {
              include: {
                owner: true,
              },
            },
          },
        },
      },
    });

    if (!payment) {
      this.logger.error(`Payment ${referenceNumber} not found`);
      return;
    }

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
        return;
    }

    await this.prisma.booking.update({
      where: { id: payment.bookingId },
      data: { status: bookingStatus },
    });

    this.logger.log(
      `Updated booking ${payment.bookingId} status to ${bookingStatus}`,
    );

    if (paymentStatus === 'SUCCEEDED' && payment.booking) {
      await this.sendBookingConfirmationEmail(payment);
      await this.sendGuestConfirmationEmail(payment);
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

  private async sendBookingConfirmationEmail(payment: any) {
    try {
      const { booking } = payment;
      const user = booking.user;
      const parkingSpot = booking.parkingSpot;
      const owner = parkingSpot.owner;

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
      this.logger.error(`Failed to send PMO email: ${error.message}`);
    }
  }
}
