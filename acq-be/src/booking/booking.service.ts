import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { BookingStatus, ParkingStatus, PaymentStatus } from '@prisma/client';

@Injectable()
export class BookingService {
  constructor(private prisma: PrismaService) {}

  async create(createBookingDto: CreateBookingDto, userId: string) {
    // Validate parking spot exists and is approved
    const parkingSpot = await this.prisma.parkingSpot.findUnique({
      where: { id: createBookingDto.parkingSpotId },
    });

    if (!parkingSpot) {
      throw new NotFoundException('Parking spot not found');
    }

    if (parkingSpot.status !== ParkingStatus.APPROVED) {
      throw new BadRequestException('Parking spot is not available for booking');
    }

    // Cannot book own parking spot
    if (parkingSpot.ownerId === userId) {
      throw new BadRequestException('You cannot book your own parking spot');
    }

    const startTime = new Date(createBookingDto.startTime);
    const endTime = new Date(createBookingDto.endTime);

    // Validate times
    if (startTime >= endTime) {
      throw new BadRequestException('End time must be after start time');
    }

    if (startTime < new Date()) {
      throw new BadRequestException('Start time must be in the future');
    }

    // Check for overlapping bookings
    const overlappingBooking = await this.prisma.booking.findFirst({
      where: {
        parkingSpotId: createBookingDto.parkingSpotId,
        status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
        OR: [
          {
            startTime: { lte: startTime },
            endTime: { gt: startTime },
          },
          {
            startTime: { lt: endTime },
            endTime: { gte: endTime },
          },
          {
            startTime: { gte: startTime },
            endTime: { lte: endTime },
          },
        ],
      },
    });

    if (overlappingBooking) {
      throw new BadRequestException('This time slot is already booked');
    }

    // Calculate total price
    const hours = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);
    const totalPrice = Math.round(hours * parkingSpot.pricePerHour * 100) / 100;

    return this.prisma.booking.create({
      data: {
        startTime,
        endTime,
        totalPrice,
        notes: createBookingDto.notes,
        parkingSpotId: createBookingDto.parkingSpotId,
        userId,
        status: BookingStatus.PENDING, // Changed to PENDING - will be CONFIRMED after payment
      },
      include: {
        parkingSpot: {
          include: {
            owner: {
              select: { id: true, firstName: true, lastName: true, email: true },
            },
          },
        },
        user: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });
  }

  async findAllByUser(userId: string) {
    return this.prisma.booking.findMany({
      where: { userId },
      include: {
        parkingSpot: {
          include: {
            owner: {
              select: { id: true, firstName: true, lastName: true, email: true },
            },
          },
        },
        payment: true, // Include payment data to show payment status
        user: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
      orderBy: { id: 'desc' },
    });
  }

  async findOne(id: string, userId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: {
        parkingSpot: {
          include: {
            owner: {
              select: { id: true, firstName: true, lastName: true, email: true },
            },
          },
        },
        payment: true, // Include payment data
        user: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    // Only allow user to see their own bookings or parking spot owner
    if (booking.userId !== userId && booking.parkingSpot.ownerId !== userId) {
      throw new NotFoundException('Booking not found');
    }

    return booking;
  }

  async cancel(id: string, userId: string) {
    const booking = await this.findOne(id, userId);

    if (booking.userId !== userId) {
      throw new BadRequestException('You can only cancel your own bookings');
    }

    if (booking.status === BookingStatus.CANCELLED) {
      throw new BadRequestException('Booking is already cancelled');
    }

    if (booking.status === BookingStatus.COMPLETED) {
      throw new BadRequestException('Cannot cancel a completed booking');
    }

    return this.prisma.booking.update({
      where: { id },
      data: { status: BookingStatus.CANCELLED },
    });
  }
}

