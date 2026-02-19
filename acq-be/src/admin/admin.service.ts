import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailLogService } from '../email-log/email-log.service';
import { UserRole, ParkingStatus, EmailStatus } from '@prisma/client';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private emailLogService: EmailLogService,
  ) {}

  // Dashboard Statistics
  async getDashboardStats() {
    const [
      totalUsers,
      activeUsers,
      adminUsers,
      totalParkingSpots,
      pendingParkingSpots,
      approvedParkingSpots,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.user.count({ where: { role: UserRole.ADMIN } }),
      this.prisma.parkingSpot.count(),
      this.prisma.parkingSpot.count({
        where: { status: ParkingStatus.PENDING },
      }),
      this.prisma.parkingSpot.count({
        where: { status: ParkingStatus.APPROVED },
      }),
    ]);

    return {
      totalUsers,
      activeUsers,
      inactiveUsers: totalUsers - activeUsers,
      adminUsers,
      regularUsers: totalUsers - adminUsers,
      totalParkingSpots,
      pendingParkingSpots,
      approvedParkingSpots,
    };
  }

  // User Management
  async getAllUsers(page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          role: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.user.count(),
    ]);

    return {
      users,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getUserById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  async updateUserRole(id: string, role: UserRole) {
    const user = await this.prisma.user.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return await this.prisma.user.update({
      where: { id },
      data: { role },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
      },
    });
  }

  async toggleUserStatus(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return await this.prisma.user.update({
      where: { id },
      data: { isActive: !user.isActive },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
      },
    });
  }

  async deleteUser(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    await this.prisma.user.delete({ where: { id } });

    return { message: 'User deleted successfully' };
  }

  // Email Monitoring
  async getEmailStats() {
    return this.emailLogService.getStats();
  }

  async getAllEmails(params: {
    page: number;
    limit: number;
    status?: EmailStatus;
    userId?: string;
    search?: string;
    startDate?: Date;
    endDate?: Date;
  }) {
    const skip = (params.page - 1) * params.limit;

    const { data, total } = await this.emailLogService.findAll({
      skip,
      take: params.limit,
      status: params.status,
      userId: params.userId,
      search: params.search,
      startDate: params.startDate,
      endDate: params.endDate,
    });

    return {
      emails: data,
      pagination: {
        total,
        page: params.page,
        limit: params.limit,
        totalPages: Math.ceil(total / params.limit),
      },
    };
  }

  async getEmailById(id: string) {
    const email = await this.emailLogService.findOne(id);

    if (!email) {
      throw new NotFoundException(`Email with ID ${id} not found`);
    }

    return email;
  }
}
