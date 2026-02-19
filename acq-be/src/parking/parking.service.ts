import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateParkingDto } from './dto/create-parking.dto';
import { UpdateParkingDto } from './dto/update-parking.dto';
import { ApproveParkingDto, ApprovalAction } from './dto/approve-parking.dto';
import { ParkingStatus } from '@prisma/client';

@Injectable()
export class ParkingService {
  constructor(private prisma: PrismaService) {}

  private async getPlatformSettings() {
    let settings = await this.prisma.platformSettings.findFirst();
    if (!settings) {
      settings = await this.prisma.platformSettings.create({
        data: { requireAddressForParking: true },
      });
    }
    return settings;
  }

  async create(createParkingDto: CreateParkingDto, images: string[] = []) {
    if (!createParkingDto.ownerId) {
      throw new Error('Owner ID is required');
    }

    const platformSettings = await this.getPlatformSettings();

    if (platformSettings.requireAddressForParking) {
      if (!createParkingDto.address) {
        throw new BadRequestException('Address is required for parking spots');
      }
      if (!createParkingDto.city) {
        throw new BadRequestException('City is required for parking spots');
      }
      if (!createParkingDto.zipCode) {
        throw new BadRequestException('ZIP Code is required for parking spots');
      }
    }

    const data: any = {
      tower: createParkingDto.tower,
      slotNumber: createParkingDto.slotNumber,
      ownerId: createParkingDto.ownerId,
      pricePerHour: createParkingDto.pricePerHour,
      images,
    };

    if (createParkingDto.address) {
      data.address = createParkingDto.address;
    }

    if (createParkingDto.city) {
      data.city = createParkingDto.city;
    }

    if (createParkingDto.zipCode) {
      data.zipCode = createParkingDto.zipCode;
    }

    if (
      !createParkingDto.address &&
      !platformSettings?.requireAddressForParking
    ) {
      data.address =
        '1550 Coronado St., Brgy. Hulo, Mandaluyong City, 1550 Metro Manila, Philippines';
      if (!createParkingDto.city) {
        data.city = 'Mandaluyong City';
      }
      if (!createParkingDto.zipCode) {
        data.zipCode = '1550';
      }
    }

    if (createParkingDto.latitude) {
      data.latitude = createParkingDto.latitude;
    }
    if (createParkingDto.longitude) {
      data.longitude = createParkingDto.longitude;
    }
    if (createParkingDto.pricePerDay) {
      data.pricePerDay = createParkingDto.pricePerDay;
    }

    return this.prisma.parkingSpot.create({
      data,
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

    const platformSettings = await this.getPlatformSettings();

    const updateData: any = {};

    if (updateParkingDto.tower !== undefined) {
      updateData.tower = updateParkingDto.tower;
    }
    if (updateParkingDto.slotNumber !== undefined) {
      updateData.slotNumber = updateParkingDto.slotNumber;
    }

    if (platformSettings.requireAddressForParking) {
      if (updateParkingDto.address !== undefined && !updateParkingDto.address) {
        throw new BadRequestException('Address is required for parking spots');
      }
      if (updateParkingDto.city !== undefined && !updateParkingDto.city) {
        throw new BadRequestException('City is required for parking spots');
      }
      if (updateParkingDto.zipCode !== undefined && !updateParkingDto.zipCode) {
        throw new BadRequestException('ZIP Code is required for parking spots');
      }
    }

    if (updateParkingDto.address !== undefined) {
      updateData.address = updateParkingDto.address;
    }
    if (updateParkingDto.city !== undefined) {
      updateData.city = updateParkingDto.city;
    }
    if (updateParkingDto.zipCode !== undefined) {
      updateData.zipCode = updateParkingDto.zipCode;
    }
    if (updateParkingDto.latitude !== undefined) {
      updateData.latitude = updateParkingDto.latitude;
    }
    if (updateParkingDto.longitude !== undefined) {
      updateData.longitude = updateParkingDto.longitude;
    }
    if (updateParkingDto.pricePerHour !== undefined) {
      updateData.pricePerHour = updateParkingDto.pricePerHour;
    }
    if (updateParkingDto.pricePerDay !== undefined) {
      updateData.pricePerDay = updateParkingDto.pricePerDay;
    }

    return this.prisma.parkingSpot.update({
      where: { id },
      data: updateData,
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
