import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async create(createUserDto: CreateUserDto): Promise<User> {
    return await this.prisma.user.create({
      data: createUserDto,
    });
  }

  async findAll(): Promise<User[]> {
    return await this.prisma.user.findMany();
  }

  async findOne(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  async findByEmail(email: string): Promise<User | null> {
    return await this.prisma.user.findUnique({
      where: { email },
    });
  }

  async update(id: string, updateUserDto: UpdateUserDto): Promise<User> {
    await this.findOne(id); // Check if user exists

    return await this.prisma.user.update({
      where: { id },
      data: updateUserDto,
    });
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id); // Check if user exists

    await this.prisma.user.delete({
      where: { id },
    });
  }

  // Profile Management Methods
  async getProfile(userId: string): Promise<any> {
    console.log(`Looking for user with ID: ${userId}`);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        userType: true,
        isActive: true,
        bio: true,
        profilePicture: true,
        isBusinessClient: true,
        businessName: true,
        businessWebsite: true,
        businessAddress: true,
        businessDescription: true,
        industryType: true,
        employeeCount: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      console.log(`User not found with ID: ${userId}`);
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    console.log(`Found user:`, user);
    return user;
  }

  async updateProfile(
    userId: string,
    updateData: Partial<User>,
  ): Promise<User> {
    await this.getProfile(userId); // Check if user exists

    // Don't allow updating email, password, or role through profile update
    const { email, password, role, ...allowedUpdateData } = updateData;

    return await this.prisma.user.update({
      where: { id: userId },
      data: allowedUpdateData,
    });
  }

  async getProfileStats(userId: string) {
    const user = await this.getProfile(userId);

    // Get user's bookings and parking spots
    const [bookings, parkingSpots] = await Promise.all([
      this.prisma.booking.findMany({
        where: { userId },
        include: { payment: true },
      }),
      this.prisma.parkingSpot.findMany({
        where: { ownerId: userId },
      }),
    ]);

    const totalBookings = bookings.length;
    const activeParkingSpots = parkingSpots.filter(
      (spot) => spot.status === 'APPROVED',
    ).length;
    const totalRevenue = bookings
      .filter((booking) => booking.payment?.status === 'SUCCEEDED')
      .reduce((sum, booking) => sum + (booking.totalPrice || 0), 0);

    // Calculate profile completion
    const profileFields = [
      user.firstName,
      user.lastName,
      user.phone,
      user.bio,
      user.profilePicture,
    ];

    const businessFields =
      user.userType === 'OWNER'
        ? [user.businessName, user.businessAddress, user.businessDescription]
        : [];

    const allFields = [...profileFields, ...businessFields];
    const completedFields = allFields.filter(
      (field) => field && field.trim() !== '',
    ).length;
    const profileCompletion = Math.round(
      (completedFields / allFields.length) * 100,
    );

    return {
      totalBookings,
      activeParkingSpots,
      totalRevenue,
      profileCompletion,
    };
  }

  async uploadProfilePicture(userId: string, file: Express.Multer.File) {
    await this.getProfile(userId);

    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const profilePictureUrl = `/uploads/profiles/${file.filename}`;

    await this.prisma.user.update({
      where: { id: userId },
      data: { profilePicture: profilePictureUrl },
    });

    return { profilePicture: profilePictureUrl };
  }

  async updateBusinessProfile(
    userId: string,
    businessData: {
      businessName?: string;
      businessWebsite?: string;
      businessAddress?: string;
      businessDescription?: string;
      industryType?: string;
      employeeCount?: number;
    },
  ) {
    await this.getProfile(userId); // Check if user exists

    return await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...businessData,
        isBusinessClient: true,
      },
    });
  }
}
