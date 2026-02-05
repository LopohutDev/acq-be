import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateParkingDto } from './dto/create-parking.dto';
import { UpdateParkingDto } from './dto/update-parking.dto';
import { ApproveParkingDto, ApprovalAction } from './dto/approve-parking.dto';
import { ParkingStatus } from '@prisma/client';

@Injectable()
export class ParkingService {
  constructor(private prisma: PrismaService) {}

  async create(createParkingDto: CreateParkingDto, images: string[] = []) {
    if (!createParkingDto.ownerId) {
      throw new Error('Owner ID is required');
    }

    return this.prisma.parkingSpot.create({
      data: {
        ...createParkingDto,
        ownerId: createParkingDto.ownerId,
        images,
      },
      include: {
        owner: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });
  }

  async findAll(page: number = 1, limit: number = 10, status?: ParkingStatus) {
    const skip = (page - 1) * limit;
    const where = status ? { status } : {};

    const [parkingSpots, total] = await Promise.all([
      this.prisma.parkingSpot.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          owner: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      }),
      this.prisma.parkingSpot.count({ where }),
    ]);

    return {
      parkingSpots,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const parkingSpot = await this.prisma.parkingSpot.findUnique({
      where: { id },
      include: {
        owner: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
          },
        },
      },
    });

    if (!parkingSpot) {
      throw new NotFoundException('Parking spot not found');
    }

    return parkingSpot;
  }

  async update(id: string, updateParkingDto: UpdateParkingDto) {
    await this.findOne(id);

    return this.prisma.parkingSpot.update({
      where: { id },
      data: updateParkingDto,
      include: {
        owner: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });
  }

  async updateImages(id: string, images: string[]) {
    await this.findOne(id);

    return this.prisma.parkingSpot.update({
      where: { id },
      data: { images },
      include: {
        owner: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });
  }

  async approve(id: string, approveParkingDto: ApproveParkingDto) {
    await this.findOne(id);

    const status =
      approveParkingDto.action === ApprovalAction.APPROVE
        ? ParkingStatus.APPROVED
        : ParkingStatus.REJECTED;

    return this.prisma.parkingSpot.update({
      where: { id },
      data: {
        status,
        rejectionReason:
          approveParkingDto.action === ApprovalAction.REJECT
            ? approveParkingDto.rejectionReason
            : null,
      },
      include: {
        owner: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.parkingSpot.delete({ where: { id } });
  }
}
