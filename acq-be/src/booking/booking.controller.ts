import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  UseGuards,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { BookingService } from './booking.service';
import { PaymentService } from '../payment/payment.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('bookings')
@UseGuards(JwtAuthGuard)
export class BookingController {
  constructor(
    private readonly bookingService: BookingService,
    private readonly paymentService: PaymentService,
  ) {}

  @Post()
  create(@Request() req, @Body() createBookingDto: CreateBookingDto) {
    return this.bookingService.create(createBookingDto, req.user.id);
  }

  @Get()
  findAll(@Request() req) {
    return this.bookingService.findAllByUser(req.user.id);
  }

  @Get(':id')
  findOne(@Request() req, @Param('id') id: string) {
    return this.bookingService.findOne(id, req.user.id);
  }

  @Patch(':id/cancel')
  cancel(@Request() req, @Param('id') id: string) {
    return this.bookingService.cancel(id, req.user.id);
  }

  @Patch(':id/dev-cancel')
  devCancel(@Request() req, @Param('id') id: string) {
    return this.bookingService.devCancel(id, req.user.id);
  }

  @Post(':id/pay')
  @UseGuards(JwtAuthGuard)
  async initiatePayment(@Request() req, @Param('id') id: string) {
    // Get booking details
    const booking = await this.bookingService.findOne(id, req.user.id);

    if (booking.userId !== req.user.id) {
      throw new BadRequestException('You can only pay for your own bookings');
    }

    // Check if payment already exists
    const existingPayment = await this.paymentService.getPaymentByBookingId(id);
    if (existingPayment) {
      return {
        success: true,
        data: {
          referenceNumber: existingPayment.referenceNumber,
          checkoutUrl: existingPayment.checkoutUrl,
          status: existingPayment.status,
        },
      };
    }

    // Create payment
    const payment = await this.paymentService.createPayment({
      bookingId: id,
      amount: booking.totalPrice,
      customerEmail: req.user.email,
      customerName: `${req.user.firstName} ${req.user.lastName}`,
      customerPhone: req.user.phone || '',
      description: `Parking booking for ${booking.parkingSpot.tower} - ${booking.parkingSpot.slotNumber}`,
    });

    return {
      success: true,
      data: {
        referenceNumber: payment.data.fullOrderRef,
        checkoutUrl: payment.data.checkoutUrl,
        status: payment.data.status,
      },
    };
  }
}
